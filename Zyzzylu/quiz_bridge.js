// ── STATE ──────────────────────────────────────────────────────────────
let cppInitialized = false;
let timerInterval  = null;
let quizTimeLimit  = 0;
let quizTimeLeft   = 0;
let currentQuizPool = [];
let activeSeed1 = 0;
let activeSeed2 = 0;

// Fixed per page-load — mirrors Zyzzyva's per-process PID behaviour
const SESSION_SEED2 = Math.floor(Math.random() * 32767) + 1024;

// Session-wide wrong-guess tracking { word: count }
// Saved in <zyzzylu-session> so it survives quit → reload
let sessionIncorrect = {};

// ── WASM INIT ──────────────────────────────────────────────────────────
if (typeof Module !== 'undefined')
  Module.onRuntimeInitialized = () => tryInitCppEngine();

const _coreOnload = window.onload;
window.onload = async () => { if (_coreOnload) await _coreOnload(); tryInitCppEngine(); };

async function tryInitCppEngine() {
  if (!cppInitialized && typeof Module !== 'undefined'
      && Module.loadDictionary && dict?.length) {
    document.getElementById('wCnt').innerText = 'Loading WASM…';
    Module.loadDictionary(dict.join('\n'));
    cppInitialized = true;
    document.getElementById('wCnt').innerText =
      dict.length.toLocaleString() + ' Words (WASM Active)';
  }
}

// ── MWC RNG — matches Zyzzyva's George Marsaglia MWC exactly ──────────
// z = 36969*(z & 0xffff) + (z >> 16)
// w = 18000*(w & 0xffff) + (w >> 16)
// result = (z << 16) + (w & 0xffff)
function createMwcRandom(s1, s2) {
  let z = (Number(s1) >>> 0) || 1;
  let w = (Number(s2) >>> 0) || 1;
  return () => {
    z = (36969 * (z & 0xffff) + (z >>> 16)) >>> 0;
    w = (18000 * (w & 0xffff) + (w >>> 16)) >>> 0;
    return ((z << 16) + (w & 0xffff)) >>> 0;
  };
}

// Fisher-Yates using modulo — matches Zyzzyva's C++ `quint32 % limit`
function shuffleMwc(arr, s1, s2) {
  const rng = createMwcRandom(s1, s2);
  const a = [...arr];
  for (let i = 0; i < a.length - 1; i++) {
    const j = i + (rng() % (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── SESSION TRACKING ───────────────────────────────────────────────────
const trackWrongGuess = w => { if (w) sessionIncorrect[w] = (sessionIncorrect[w] || 0) + 1; };

// ── QUIZ LIFECYCLE ─────────────────────────────────────────────────────
function startQuiz() {
  if (!cppInitialized) { toast('WASM engine initialising — please wait'); return; }

  let pool = dict.filter(w => matchFilters(w, qFilters));
  pool = applyLimitFilters(pool, qFilters);
  if (!pool.length) { toast('No words match the selected filters!'); return; }

  sessionIncorrect = {};
  activeSeed1 = Math.floor(Date.now() / 1000); // Unix timestamp — matches Zyzzyva seed
  activeSeed2 = SESSION_SEED2;                  // fixed per session — mirrors Zyzzyva PID

  const quizType    = sel('qTypeSelect');
  const order       = sel('qOrderSelect');
  quizTimeLimit     = sel('qTimerSelect');

  currentQuizPool = buildOrderedPool(pool, quizType, order, activeSeed1, activeSeed2);
  Module.generateQuiz(quizType, currentQuizPool.join(' '), order === 1 ? 3 : order);
  showQuizPane();
  loadCurrentQuestion();
}

// Build alphagram-shuffled word pool (matching Zyzzyva's question-order algorithm)
function buildOrderedPool(pool, quizType, order, s1, s2) {
  if (order !== 1) return [...pool];               // alphabetical or probability — no MWC
  if (quizType === 2) return shuffleMwc(pool, s1, s2); // Build quiz: shuffle words directly

  // Anagram/hook quizzes: deduplicate to alphagrams, sort, MWC-shuffle, then expand
  const byAlpha = {};
  pool.forEach(w => {
    const a = [...w].sort().join('');
    (byAlpha[a] = byAlpha[a] || []).push(w);
  });
  const shuffledAlphas = shuffleMwc(Object.keys(byAlpha).sort(), s1, s2);
  return shuffledAlphas.flatMap(a => byAlpha[a]);
}

function loadCurrentQuestion() {
  clearInterval(timerInterval);
  const q = parseQ();
  if (!q) { endQuiz(); return; }
  renderQuizUI(q, parseProg());
  startTimer();
  setTimeout(() => document.getElementById('qAnswerInput')?.focus(), 80);
}

function handleCheck() {
  clearInterval(timerInterval);
  // Flush current-question wrong guesses into session tracker
  parseQ()?.userIncorrectAnswers?.forEach(w => { sessionIncorrect[w] = sessionIncorrect[w] || 1; });
  Module.checkAnswers();
  renderQuizUI(parseQ(), parseProg());
}

function handleNext() {
  Module.nextQuestion() ? loadCurrentQuestion() : endQuiz();
}

function quitQuiz() {
  clearInterval(timerInterval);
  document.getElementById('qEnginePane').style.display   = 'none';
  document.getElementById('qSettingsPane').style.display = 'block';
}

function endQuiz() {
  clearInterval(timerInterval);
  const prog  = parseProg();
  const total = prog.totalCorrect + prog.totalMissed;
  const acc   = total > 0 ? Math.round(prog.totalCorrect / total * 100) : 0;
  document.getElementById('qEnginePane').innerHTML = `
    <div class="q-clean-layout" style="text-align:center;padding:20px 0">
      <h2 style="font-size:24px;color:var(--accent);margin-bottom:20px">Quiz Complete!</h2>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;
                  padding:20px;margin-bottom:24px;display:flex;flex-direction:column;gap:12px">
        ${row('Total Questions',  prog.totalQuestions,   'var(--text2)')}
        ${row('Correct Answers',  prog.totalCorrect,     'var(--accent)')}
        ${row('Missed Answers',   prog.totalMissed,      'var(--danger)')}
        ${row('Wrong Guesses',    prog.totalIncorrect,   'var(--orange)')}
        <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px;
                    display:flex;justify-content:space-between">
          <span style="font-weight:600">Accuracy</span>
          <span class="mono" style="font-weight:700;color:var(--orange)">${acc}%</span>
        </div>
      </div>
      <button class="btn btn-p" style="width:100%;padding:14px" onclick="quitQuiz()">
        Back to Settings
      </button>
    </div>`;
}

// ── UI RENDERING ───────────────────────────────────────────────────────
function renderQuizUI(q, prog) {
  const pane = document.getElementById('qEnginePane');
  if (!pane) return;
  const pct   = (prog.currentQuestion / prog.totalQuestions) * 100;
  const tiles = [...q.questionText].map(c => `<div class="quiz-tile">${c}</div>`).join('');
  const isChecked = q.checked;

  pane.innerHTML = `
    <div class="q-clean-layout">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;
                  border-bottom:1px solid var(--border);padding-bottom:12px">
        <span class="mono" style="font-size:13px;color:var(--text2)">
          ${prog.currentQuestion} / ${prog.totalQuestions}
        </span>
        <div style="display:flex;gap:14px;align-items:center">
          <span class="mono" id="qTimerDisplay"
                style="font-weight:700;color:var(--orange);font-size:14px"></span>
          <span class="mono" style="font-size:13px;color:var(--accent);font-weight:600">
            ${q.correctAnswersCount} / ${q.totalAnswers} found
          </span>
        </div>
      </div>

      <!-- Progress bar -->
      <div style="height:4px;background:var(--surface2);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--accent);transition:width .3s"></div>
      </div>

      <!-- Tiles -->
      <div style="display:flex;justify-content:center;gap:8px;margin:16px 0;flex-wrap:wrap">
        ${tiles}
      </div>

      <!-- Input — readonly (not disabled) so Enter key still fires -->
      <input type="text" id="qAnswerInput" class="input-field mono"
        style="text-transform:uppercase;text-align:center;font-size:18px;
               font-weight:600;letter-spacing:1px;margin-bottom:12px;
               ${isChecked ? 'opacity:.45;cursor:default;' : ''}"
        placeholder="${isChecked
          ? (q.correctAnswersCount === q.totalAnswers ? 'ALL FOUND — ENTER for next' : 'CHECKED — ENTER for next')
          : 'TYPE ANSWER & PRESS ENTER'}"
        ${isChecked ? 'readonly' : ''}
        oninput="onQuizInput()"
        onkeydown="handleEnterKey(event)">

      <!-- Answers list -->
      <div class="quiz-history-pane" style="min-height:160px;max-height:220px;margin-bottom:12px">
        ${renderAnswersList(q)}
      </div>

      <!-- Buttons -->
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" style="flex:1;min-width:60px"  onclick="quitQuiz()">Quit</button>
        <button class="btn" style="flex:1;min-width:64px;color:var(--orange)"
                onclick="saveCurrentZzq()">Save 💾</button>
        <button class="btn" style="flex:1;min-width:64px;color:#0A84FF"
                onclick="showAnalysis()">Analyze</button>
        ${isChecked
          ? `<button class="btn btn-p" style="flex:2;min-width:140px"
                     onclick="handleNext()">Next →&nbsp;<small style="opacity:.7">(Enter)</small></button>`
          : `<button class="btn btn-p" id="qActionButton" style="flex:2;min-width:140px"
                     onclick="handleCheck()">Check Answers ✓</button>`}
      </div>
    </div>`;

  if (quizTimeLimit > 0) updateTimerDisplay();
}

function renderAnswersList(q) {
  if (!q.checked) {
    if (!q.userCorrectAnswers.length && !q.userIncorrectAnswers.length)
      return `<p style="text-align:center;color:var(--text2);padding:20px 0">No answers yet</p>`;

    return [
      ...q.userCorrectAnswers.map(w => {
        const star = saved.includes(w);
        return `<div class="item-row" style="padding:8px 4px;border-bottom:1px solid rgba(58,58,60,.3)">
          <span class="mono" style="color:var(--accent);font-weight:600">✓ ${w}</span>
          <button onclick="toggleSavedWord('${w}',this)" style="border:none;background:none;
            color:${star?'var(--orange)':'var(--text2)'};font-size:16px;cursor:pointer;padding:0 4px">
            ${star?'★':'☆'}</button></div>`;
      }),
      ...q.userIncorrectAnswers.map(w =>
        `<div class="item-row" style="padding:8px 4px;border-bottom:1px solid rgba(58,58,60,.3);opacity:.8">
          <span class="mono" style="color:var(--danger);text-decoration:line-through">✕ ${w}</span>
          <span style="color:var(--text2);font-size:11px">Invalid</span></div>`)
    ].join('');
  }

  // Checked state — show full results
  let cr = { answers: [], incorrectAnswers: [] };
  try { const s = Module.checkAnswers(); if (s && s !== '{}') cr = JSON.parse(s); } catch(_) {}

  return [
    ...(cr.answers || []).map(a => {
      const ok = a.status === 'correct', star = saved.includes(a.word);
      return `<div class="item-row" style="padding:8px 4px;border-bottom:1px solid rgba(58,58,60,.3)">
        <div style="display:flex;align-items:center;gap:8px;flex:1">
          <span style="color:${ok?'var(--accent)':'var(--danger)'};font-weight:700;width:18px">${ok?'✓':'⊘'}</span>
          <span class="mono hook-box" style="font-size:11px">${a.front||'—'}</span>
          <span class="mono" style="font-weight:700;font-size:16px;
            color:${ok?'var(--text)':'rgba(255,59,48,.8)'}">${a.word}</span>
          <span class="mono hook-box" style="font-size:11px">${a.back||'—'}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;color:var(--text2)">${ok?'✓':'Missed'}</span>
          <button onclick="toggleSavedWord('${a.word}',this)" style="border:none;background:none;
            color:${star?'var(--orange)':'var(--text2)'};font-size:16px;cursor:pointer;padding:0 4px">
            ${star?'★':'☆'}</button></div></div>`;
    }),
    ...(cr.incorrectAnswers || []).map(w =>
      `<div class="item-row" style="padding:8px 4px;border-bottom:1px solid rgba(58,58,60,.3);opacity:.7">
        <span class="mono" style="color:var(--danger);text-decoration:line-through">✕ ${w}</span>
        <span style="color:var(--text2);font-size:11px">Invalid</span></div>`)
  ].join('') || `<p style="text-align:center;color:var(--text2);padding:20px 0">No answers</p>`;
}

// ── INPUT HANDLING ─────────────────────────────────────────────────────

// Central Enter handler — routes to Next or Submit depending on question state
function handleEnterKey(e) {
  if (e.key !== 'Enter') return;
  const q = parseQ();
  if (!q) return;
  if (q.checked) { e.preventDefault(); handleNext(); return; }
  submitUserAnswer();
}

function submitUserAnswer() {
  const inp = document.getElementById('qAnswerInput');
  if (!inp) return;
  const raw = inp.value.trim();
  if (!raw) { handleCheck(); return; }     // empty input → check answers

  const val  = raw.toUpperCase();
  const q    = parseQ();
  const qType = sel('qTypeSelect');
  const expectedLen = q.questionText.length + (qType === 2 ? 1 : 0);

  if (val.length !== expectedLen) {
    shake(inp); toast(`⚠️ Answer must be ${expectedLen} letters`); return;
  }

  const prevWrong = q.userIncorrectAnswers?.length || 0;
  inp.value = '';

  Module.submitAnswer(val);

  // If new wrong guess was added, track it in session
  const afterQ = parseQ();
  if ((afterQ.userIncorrectAnswers?.length || 0) > prevWrong)
    trackWrongGuess(val);

  renderQuizUI(afterQ, parseProg());
  document.getElementById('qAnswerInput')?.focus();
}

function onQuizInput() {
  const inp = document.getElementById('qAnswerInput');
  const btn = document.getElementById('qActionButton');
  if (!inp) return;
  // Update action button label
  if (btn) {
    const hasText = inp.value.trim().length > 0;
    btn.innerText  = hasText ? 'Submit' : 'Check Answers ✓';
    btn.onclick    = hasText ? submitUserAnswer : handleCheck;
  }
  // Tile validation (anagram mode only)
  if (!cppInitialized || sel('qTypeSelect') !== 0) return;
  const q = parseQ();
  if (!q || q.checked) return;
  const typed = inp.value.toUpperCase();
  const avail = {};
  for (const c of q.questionText) avail[c] = (avail[c] || 0) + 1;
  const used  = {};
  for (const c of typed) {
    used[c] = (used[c] || 0) + 1;
    if (used[c] > (avail[c] || 0)) {
      inp.value = typed.slice(0, -1);
      shake(inp); toast(`⚠️ "${c}" not in tiles`); return;
    }
  }
}

// ── ANALYZE VIEW ───────────────────────────────────────────────────────
function showAnalysis() {
  const q = parseQ(); if (!q) return;
  if (!q.checked) {
    if (!confirm('⚠️ This reveals all answers and finalises this question. Proceed?')) return;
    clearInterval(timerInterval);
  }
  const resultsStr = Module.checkAnswers();
  let cr;
  try { cr = JSON.parse(resultsStr); } catch(_) {}
  if (!cr?.answers) { toast('No analysis data'); return; }

  // Ensure session tracks any current-question wrong guesses
  (cr.incorrectAnswers || []).forEach(w => { if (!sessionIncorrect[w]) trackWrongGuess(w); });

  const prog      = parseProg();
  const sessTotal = prog.totalCorrect + prog.totalMissed;
  const sessAcc   = sessTotal > 0 ? Math.round(prog.totalCorrect / sessTotal * 100) : 0;
  const curCorrect = cr.answers.filter(a => a?.status === 'correct').length;
  const curAcc    = cr.answers.length > 0
    ? Math.round(curCorrect / cr.answers.length * 100) : 0;
  const col       = p => p >= 70 ? 'var(--accent)' : p >= 40 ? 'var(--orange)' : 'var(--danger)';

  const missed     = cr.answers.filter(a => a?.status === 'missed').map(a => a.word);
  const wrongThisQ = cr.incorrectAnswers || [];
  const sessWords  = Object.keys(sessionIncorrect);
  const isClean    = wrongThisQ.length === 0;

  const badge = isClean
    ? `<span style="background:rgba(52,199,89,.15);color:var(--accent);
                    padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">✓ CLEAN</span>`
    : `<span style="background:rgba(255,59,48,.1);color:var(--danger);
                    padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">⚠ HAD WRONG GUESSES</span>`;

  const listOf = (arr, col, icon = '•') => arr.length
    ? arr.map(w => {
        const cnt = sessionIncorrect[w];
        return `<div class="mono" style="color:${col};font-size:15px;padding:2px 0">
          ${icon} ${w}${cnt > 1 ? ` <span style="color:var(--text2);font-size:12px">(×${cnt})</span>` : ''}
        </div>`;
      }).join('')
    : `<div class="mono" style="color:var(--text2);text-align:center;padding:8px 0">None</div>`;

  document.getElementById('qEnginePane').innerHTML = `
    <div class="q-clean-layout">
      <h3 class="mono" style="font-size:16px;border-bottom:1px solid var(--border);padding-bottom:6px">
        Analysis
      </h3>

      <!-- Stats grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div style="background:var(--surface2);border:1px solid var(--border);
                    border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:10px;color:var(--text2);font-weight:700;
                      text-transform:uppercase;margin-bottom:4px">Current Q</div>
          <div style="font-size:26px;font-weight:800;color:${col(curAcc)}">${curAcc}%</div>
          <div style="font-size:11px;color:var(--text2)">${curCorrect}/${cr.answers.length}</div>
          <div style="margin-top:4px">${badge}</div>
        </div>
        <div style="background:var(--surface2);border:1px solid var(--border);
                    border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:10px;color:var(--text2);font-weight:700;
                      text-transform:uppercase;margin-bottom:4px">Session</div>
          <div style="font-size:26px;font-weight:800;color:${col(sessAcc)}">${sessAcc}%</div>
          <div style="font-size:11px;color:var(--text2)">${prog.totalCorrect}/${sessTotal}</div>
        </div>
      </div>

      <!-- Missed -->
      <div style="background:rgba(255,149,0,.08);border:1px solid rgba(255,149,0,.25);
                  border-radius:8px;padding:12px;max-height:150px;overflow-y:auto">
        <div style="font-size:11px;text-transform:uppercase;font-weight:700;
                    color:var(--orange);margin-bottom:6px">Missed (${missed.length})</div>
        ${listOf(missed, 'var(--orange)')}
      </div>

      <!-- Wrong this question -->
      <div style="background:rgba(255,59,48,.05);border:1px solid rgba(255,59,48,.2);
                  border-radius:8px;padding:12px;max-height:120px;overflow-y:auto">
        <div style="font-size:11px;text-transform:uppercase;font-weight:700;
                    color:var(--danger);margin-bottom:6px">Wrong This Q (${wrongThisQ.length})</div>
        ${listOf(wrongThisQ, 'var(--danger)', '✕')}
      </div>

      <!-- All session wrong guesses -->
      <div style="background:rgba(255,59,48,.03);border:1px solid rgba(255,59,48,.15);
                  border-radius:8px;padding:12px;max-height:150px;overflow-y:auto">
        <div style="font-size:11px;text-transform:uppercase;font-weight:700;
                    color:var(--danger);margin-bottom:6px">
          All Session Wrong — persists in save (${sessWords.length})
        </div>
        ${listOf(sessWords, 'var(--danger)', '✕')}
      </div>

      <button class="btn btn-p" style="width:100%" onclick="renderActiveQuiz()">Back to Quiz</button>
    </div>`;
}

function renderActiveQuiz() {
  const q = parseQ(); if (!q) return;
  renderQuizUI(q, parseProg());
}

// ── SAVE .zzq ──────────────────────────────────────────────────────────
function saveCurrentZzq() {
  if (!currentQuizPool?.length) { toast('No active quiz to save'); return; }
  let name = prompt('ชื่อไฟล์:', 'zyzzylu_quiz');
  if (name === null) return;
  name = (name.trim() || 'zyzzylu_quiz').replace(/\.zzq$/i, '') + '.zzq';

  const prog       = parseProg();
  const q          = parseQ();
  const isChecked  = q.checked;

  // Attempt to get check results for complete questions
  let cr = null;
  if (isChecked) {
    try { const s = Module.checkAnswers(); if (s && s !== '{}') cr = JSON.parse(s); } catch(_) {}
  }

  const lines = [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<!DOCTYPE zyzzyva-quiz SYSTEM \'http://boshvark.com/dtd/zyzzyva-quiz.dtd\'>',
    '<zyzzyva-quiz type="Anagrams" question-order="Random" lexicon="CSW24" method="Standard">',
    ' <question-source type="search">',
    '  <zyzzyva-search version="1">',
    '   <conditions>',
    '    <and>',
  ];

  // Conditions
  if (qFilters.length) {
    qFilters.forEach(f => {
      const n = f.not ? '1' : '0';
      if      (f.type === 'length')         lines.push(`     <condition type="Length" min="${f.v1}" max="${f.v2}"/>`);
      else if (f.type === 'point_value')    lines.push(`     <condition type="Point Value" min="${f.v1}" max="${f.v2}"/>`);
      else if (f.type === 'num_vowels')     lines.push(`     <condition type="Number of Vowels" min="${f.v1}" max="${f.v2}"/>`);
      else if (f.type === 'begins')         lines.push(`     <condition type="Begins With" string="${f.v1}" negated="${n}"/>`);
      else if (f.type === 'ends')           lines.push(`     <condition type="Ends With" string="${f.v1}" negated="${n}"/>`);
      else if (f.type === 'includes')       lines.push(`     <condition type="Includes Letters" string="${f.v1}" negated="${n}"/>`);
      else if (f.type === 'probability_order')
        lines.push(`     <condition type="Probability Order" min="${f.v1}" max="${f.v2}"/>`);
      else if (f.type === 'limit_probability_order')
        // Zyzzyva uses int="2" bool="true" to mark LimitByProbabilityOrder
        lines.push(`     <condition type="Probability Order" int="2" bool="true" min="0" max="${f.v2}"/>`);
      else if (f.type === 'anagram_match')  lines.push(`     <condition type="Anagram Match" string="${f.v1}" negated="${n}"/>`);
    });
  } else {
    const lens = currentQuizPool.map(w => w.length);
    lines.push(`     <condition type="Length" min="${Math.min(...lens)}" max="${Math.max(...lens)}"/>`);
  }

  lines.push('    </and>', '   </conditions>', '  </zyzzyva-search>', ' </question-source>',
    ` <randomizer algorithm="1" seed="${activeSeed1}" seed2="${activeSeed2}"/>`,
  );

  // Progress
  const attr = [
    `question="${prog.currentQuestion - 1}"`,
    `total-questions="${prog.totalQuestions}"`,
    `correct="${prog.totalCorrect}"`,
    `correct-questions="${prog.fullyCorrectQuestions || 0}"`,
    `question-complete="${isChecked}"`,
  ].join(' ');

  const correctWords   = q.userCorrectAnswers   || [];
  const incorrectWords = isChecked ? (cr?.incorrectAnswers || []) : (q.userIncorrectAnswers || []);
  const missedWords    = isChecked ? (cr?.answers?.filter(a => a.status === 'missed').map(a => a.word) || []) : [];
  const hasBody        = correctWords.length || incorrectWords.length || missedWords.length;

  if (hasBody) {
    lines.push(` <progress ${attr}>`);
    if (correctWords.length) {
      lines.push('  <question-correct-responses>');
      correctWords.forEach(w => lines.push(`   <response word="${w}"/>`));
      lines.push('  </question-correct-responses>');
    }
    if (incorrectWords.length) {
      lines.push('  <incorrect-responses>');
      incorrectWords.forEach(w => lines.push(`   <response word="${w}" count="1"/>`));
      lines.push('  </incorrect-responses>');
    }
    if (missedWords.length) {
      lines.push('  <missed-responses>');
      missedWords.forEach(w => lines.push(`   <response word="${w}" count="1"/>`));
      lines.push('  </missed-responses>');
    }
    lines.push(' </progress>');
  } else {
    lines.push(` <progress ${attr}/>`);
  }

  // Zyzzylu extension — session wrong guesses
  const sessWords = Object.keys(sessionIncorrect);
  if (sessWords.length) {
    lines.push(' <zyzzylu-session>', '  <all-incorrect-responses>');
    sessWords.forEach(w => lines.push(`   <response word="${w}" count="${sessionIncorrect[w]}"/>`));
    lines.push('  </all-incorrect-responses>', ' </zyzzylu-session>');
  }

  lines.push('</zyzzyva-quiz>');

  downloadText(lines.join('\r\n'), name);
  toast(`Saved ${name}`);
}

// ── LOAD .zzq ──────────────────────────────────────────────────────────
function loadZzq(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const content = e.target.result.trim();
    try {
      if (!content.startsWith('<?xml')) {
        loadPlainWordList(content); return;
      }
      loadXmlZzq(content);
    } catch(err) {
      console.error(err); toast('Error parsing quiz file');
    }
  };
  reader.readAsText(file);
}

function loadPlainWordList(content) {
  const words = content.split(/\r?\n/).map(w => w.trim().toUpperCase()).filter(w => dictSet.has(w));
  if (!words.length) { toast('No valid words in file'); return; }
  sessionIncorrect = {};
  currentQuizPool  = words;
  activeSeed1 = Math.floor(Date.now() / 1000);
  activeSeed2 = SESSION_SEED2;
  Module.generateQuiz(sel('qTypeSelect'), words.join(' '), 3);
  showQuizPane();
  loadCurrentQuestion();
  toast(`Loaded ${words.length} words`);
}

function loadXmlZzq(content) {
  const xml      = new DOMParser().parseFromString(content, 'text/xml');
  const quizNode = xml.querySelector('zyzzyva-quiz');
  if (!quizNode) { toast('Invalid .zzq file'); return; }

  // Quiz type
  const typeAttr = quizNode.getAttribute('type') || '';
  const typeVal  = typeAttr.toLowerCase().includes('hook') ? 1
                 : typeAttr.toLowerCase().includes('build') ? 2 : 0;
  document.getElementById('qTypeSelect').value = String(typeVal);

  // Seeds — use stored seeds to reproduce Zyzzyva's exact question order
  const rnd = xml.getElementsByTagName('randomizer')[0];
  activeSeed1 = parseInt(rnd?.getAttribute('seed') || '0') || Math.floor(Date.now() / 1000);
  activeSeed2 = parseInt(rnd?.getAttribute('seed2') || '0') || SESSION_SEED2;

  // Rebuild filter list from conditions
  qFilters.length = 0;
  xml.querySelectorAll('condition').forEach(cond => {
    const negated  = cond.parentNode?.tagName?.toLowerCase() === 'not'
                     || cond.getAttribute('negated') === '1';
    const typeRaw  = cond.getAttribute('type') || '';
    const typeNorm = typeRaw.replace(/\s+/g, '').toLowerCase();
    const intAttr  = cond.getAttribute('int');
    const boolAttr = cond.getAttribute('bool');
    let ft = '', v1 = '', v2 = '';

    if      (typeNorm === 'length')
      { ft='length';          v1=cond.getAttribute('min')||'2';  v2=cond.getAttribute('max')||'8'; }
    else if (typeNorm === 'pointvalue')
      { ft='point_value';     v1=cond.getAttribute('min')||'0';  v2=cond.getAttribute('max')||'50'; }
    else if (typeNorm === 'numberofvowels')
      { ft='num_vowels';      v1=cond.getAttribute('min')||'1';  v2=cond.getAttribute('max')||'7'; }
    else if (typeNorm === 'beginswith' || typeNorm === 'begins')
      { ft='begins';          v1=cond.getAttribute('string') || cond.getAttribute('text') || ''; }
    else if (typeNorm === 'endswith' || typeNorm === 'ends')
      { ft='ends';            v1=cond.getAttribute('string') || cond.getAttribute('text') || ''; }
    else if (typeNorm === 'includesletters' || typeNorm === 'includes' || typeNorm === 'contains')
      { ft='includes';        v1=cond.getAttribute('string') || cond.getAttribute('text') || ''; }
    else if (typeNorm === 'anagrammatch')
      { ft='anagram_match';   v1=cond.getAttribute('string') || cond.getAttribute('text') || ''; }
    else if (typeNorm === 'probabilityorder') {
      // int="2" or bool="true" → Zyzzyva's LimitByProbabilityOrder; otherwise regular range
      if (intAttr === '2' || boolAttr === 'true')
        { ft='limit_probability_order'; v1='1'; v2=cond.getAttribute('max')||'100'; }
      else
        { ft='probability_order'; v1=cond.getAttribute('min')||'1'; v2=cond.getAttribute('max')||'1000'; }
    }
    else if (typeNorm === 'limitbyprobabilityorder')
      { ft='limit_probability_order'; v1=cond.getAttribute('min')||'1'; v2=cond.getAttribute('max')||'100'; }

    if (ft) { fId++; qFilters.push({ id: fId, type: ft, v1, v2, not: negated }); }
  });
  renderFilters('Q');

  // Build word pool from conditions
  let pool = dict.filter(w => matchFilters(w, qFilters));
  pool     = applyLimitFilters(pool, qFilters);

  // Fallback: extract words from response nodes if no conditions matched
  if (!pool.length) {
    xml.querySelectorAll('response').forEach(r => {
      const w = r.getAttribute('word')?.trim().toUpperCase();
      if (w && dictSet.has(w)) pool.push(w);
    });
  }
  if (!pool.length) { alert('No matching words found in this quiz file'); return; }

  // Shuffle using stored seeds to reproduce Zyzzyva's order
  currentQuizPool = buildOrderedPool(pool, typeVal, 1, activeSeed1, activeSeed2);
  quizTimeLimit   = sel('qTimerSelect');
  document.getElementById('qOrderSelect').value = '1';
  Module.generateQuiz(typeVal, currentQuizPool.join(' '), 3);

  // Restore saved progress
  const prog = xml.querySelector('progress');
  if (prog) {
    const qIdx      = parseInt(prog.getAttribute('question') || '0');
    const correct   = parseInt(prog.getAttribute('correct')  || '0');
    const complete  = prog.getAttribute('question-complete') === 'true';
    const cq        = parseInt(prog.getAttribute('correct-questions') || '0');

    const userCorrect   = [];
    const userIncorrect = [];
    prog.querySelector('question-correct-responses')
      ?.querySelectorAll('response')
      .forEach(r => { const w=r.getAttribute('word'); if(w) userCorrect.push(w.toUpperCase()); });
    prog.querySelector('incorrect-responses')
      ?.querySelectorAll('response')
      .forEach(r => { const w=r.getAttribute('word'); if(w) userIncorrect.push(w.toUpperCase()); });

    Module.restoreProgress(qIdx, correct, 0, 0, cq,
      userCorrect.join(' '), userIncorrect.join(' '), complete);
  }

  // Load session wrong-guess history (Zyzzylu extension)
  sessionIncorrect = {};
  const sessNode = xml.querySelector('zyzzylu-session all-incorrect-responses');
  if (sessNode) {
    sessNode.querySelectorAll('response').forEach(r => {
      const w = r.getAttribute('word')?.trim().toUpperCase();
      const c = parseInt(r.getAttribute('count') || '1');
      if (w) sessionIncorrect[w] = c;
    });
  } else if (prog) {
    // Zyzzyva file without zyzzylu-session — seed from current question's incorrect-responses
    prog.querySelector('incorrect-responses')
      ?.querySelectorAll('response')
      .forEach(r => {
        const w = r.getAttribute('word')?.trim().toUpperCase();
        const c = parseInt(r.getAttribute('count') || '1');
        if (w) sessionIncorrect[w] = (sessionIncorrect[w] || 0) + c;
      });
  }

  showQuizPane();
  loadCurrentQuestion();
  toast(`Loaded .zzq — ${pool.length} words`);
}

// ── TIMER ──────────────────────────────────────────────────────────────
function startTimer() {
  if (quizTimeLimit <= 0) {
    const el = document.getElementById('qTimerDisplay'); if (el) el.innerText = ''; return;
  }
  quizTimeLeft = quizTimeLimit;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    quizTimeLeft--;
    updateTimerDisplay();
    if (quizTimeLeft <= 0) { clearInterval(timerInterval); handleCheck(); }
  }, 1000);
}

function updateTimerDisplay() {
  const el = document.getElementById('qTimerDisplay'); if (!el) return;
  const m = Math.floor(quizTimeLeft / 60), s = quizTimeLeft % 60;
  el.innerText     = `⏱ ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  el.style.color   = quizTimeLeft <= 10 ? 'var(--danger)' : 'var(--orange)';
}

// ── UTILITIES ──────────────────────────────────────────────────────────
const parseQ    = () => { try { const s=Module.getCurrentQuestionJson(); return (!s||s==='{}')?null:JSON.parse(s); } catch(_){return null;} };
const parseProg = () => { try { return JSON.parse(Module.getProgressJson()); } catch(_){return {};} };
const sel       = id => parseInt(document.getElementById(id)?.value || '0');
const showQuizPane = () => {
  document.getElementById('qSettingsPane').style.display = 'none';
  document.getElementById('qEnginePane').style.display   = 'block';
};
const shake = el => { el.classList.remove('shake-input'); void el.offsetWidth; el.classList.add('shake-input'); setTimeout(()=>el.classList.remove('shake-input'),350); };
const row   = (label, val, col) =>
  `<div style="display:flex;justify-content:space-between">
    <span style="color:${col}">${label}</span>
    <span class="mono" style="font-weight:700;color:${col}">${val}</span></div>`;
const downloadText = (text, filename) => {
  const a = document.createElement('a');
  a.download = filename;
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

function toggleSavedWord(word, btn) {
  toggleSave(word);
  const s = saved.includes(word);
  btn.style.color = s ? 'var(--orange)' : 'var(--text2)';
  btn.innerText   = s ? '★' : '☆';
}

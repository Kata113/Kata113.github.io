// ── STATE ──────────────────────────────────────────────────────────────
let cppInitialized = false;
let timerInterval  = null;
let quizTimeLimit  = 0;
let quizTimeLeft   = 0;
let currentQuizPool = [];
let activeSeed1 = 0;
let activeSeed2 = 0;
let quizHistory = []; // { word, status } for end-screen review

// seed2 mirrors Zyzzyva's getPid() — constant per process/session
// Linux PIDs are quint16 range (1–65535); generated once per page load
const SESSION_SEED2 = Math.floor(Math.random() * 65534) + 1;

// Session-wide wrong-guess tracking { word: count }
// Persisted in localStorage keyed by seed pair so it survives tab refresh
let sessionIncorrect = {};

// ── WASM INIT ──────────────────────────────────────────────────────────
if (typeof Module !== 'undefined')
  Module.onRuntimeInitialized = () => tryInitCppEngine();

const _coreOnload = window.onload;
window.onload = async () => { if (_coreOnload) await _coreOnload(); tryInitCppEngine(); };

function tryInitCppEngine() {
  if (!cppInitialized && typeof Module !== 'undefined'
      && Module.loadDictionary && dict?.length) {
    document.getElementById('wCnt').innerText = 'Loading WASM…';
    Module.loadDictionary(dict.join('\n'));
    cppInitialized = true;
    document.getElementById('wCnt').innerText =
      dict.length.toLocaleString() + ' Words (WASM Active)';
  }
}

// ── MWC RNG — Zyzzyva's Marsaglia MWC algorithm ───────────────────────
// Ref: QuizEngine.cpp + Rand class
// z = 36969*(z & 0xffff) + (z >> 16)
// w = 18000*(w & 0xffff) + (w >> 16)
// return (z << 16) + (w & 0xffff)
function createMwcRandom(s1, s2) {
  let z = (Number(s1) >>> 0) || 1;
  let w = (Number(s2) >>> 0) || 1;
  return () => {
    z = (36969 * (z & 0xffff) + (z >>> 16)) >>> 0;
    w = (18000 * (w & 0xffff) + (w >>> 16)) >>> 0;
    return ((z << 16) + (w & 0xffff)) >>> 0;
  };
}

// Fisher-Yates shuffle matching Zyzzyva's loop exactly:
//   for i in 0..num-2: swap(i, i + rng.rand(num-i-1))
// where rand(n) returns [0..n] inclusive = rng() % (n+1) = rng() % (num-i)
function shuffleMwc(arr, s1, s2) {
  const rng = createMwcRandom(s1, s2);
  const a   = [...arr];
  for (let i = 0; i < a.length - 1; i++) {
    const j = i + (rng() % (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── SESSION STORAGE (localStorage keyed by seed pair) ─────────────────
function sessionKey() { return `zzlu_si_${activeSeed1}_${activeSeed2}`; }
function saveSessionIncorrect() {
  if (!activeSeed1) return;
  if (Object.keys(sessionIncorrect).length)
    localStorage.setItem(sessionKey(), JSON.stringify(sessionIncorrect));
  else
    localStorage.removeItem(sessionKey());
}
function loadSessionIncorrect() {
  if (!activeSeed1) return;
  try {
    const raw = localStorage.getItem(sessionKey());
    sessionIncorrect = raw ? JSON.parse(raw) : {};
  } catch(_) { sessionIncorrect = {}; }
}
function trackWrongGuess(w) {
  if (!w) return;
  sessionIncorrect[w] = (sessionIncorrect[w] || 0) + 1;
  saveSessionIncorrect();
}

// ── QUIZ LIFECYCLE ─────────────────────────────────────────────────────
function startQuiz() {
  if (!cppInitialized) { toast('WASM engine initialising — please wait'); return; }

  let pool = dict.filter(w => matchFilters(w, qFilters));
  pool = applyLimitFilters(pool, qFilters);
  if (!pool.length) { toast('No words match the selected filters!'); return; }

  // Zyzzyva: seed = QDateTime::currentDateTime().toTime_t()  (Unix seconds)
  //          seed2 = Auxil::getPid()  (process ID, constant per session)
  activeSeed1 = Math.floor(Date.now() / 1000);
  activeSeed2 = SESSION_SEED2;
  sessionIncorrect = {};
  quizHistory = [];
  saveSessionIncorrect();

  const quizType  = sel('qTypeSelect');
  const order     = sel('qOrderSelect');
  quizTimeLimit   = sel('qTimerSelect');

  currentQuizPool = buildOrderedPool(pool, quizType, order, activeSeed1, activeSeed2);
  Module.generateQuiz(quizType, currentQuizPool.join(' '), order === 1 ? 3 : order);
  showQuizPane();
  loadCurrentQuestion();
}

// Build word pool in the same question-order as Zyzzyva would produce
// for a given seed pair. Reference: QuizEngine::newQuiz, RandomOrder case.
//
// Zyzzyva's steps for Anagram quizzes:
//  1. questionWords = wordEngine->search(…)  → alphabetically sorted
//  2. questions     = wordEngine->alphagrams(questionWords)
//                     → unique alphagrams in FIRST-APPEARANCE order
//                       (NOT sorted by alphagram string)
//  3. rng.srand(seed, getPid())
//  4. for i in 0..num-2: swap(i, i + rng.rand(num-i-1))
function buildOrderedPool(pool, quizType, order, s1, s2) {
  if (order === 2) {
    // Probability order: sort by probability rank (best/most common first)
    return [...pool].sort((a, b) => {
      const ra = probRankMap[a] || 9999999;
      const rb = probRankMap[b] || 9999999;
      return ra !== rb ? ra - rb : (a < b ? -1 : 1);
    });
  }
  if (order === 0) return [...pool].sort(); // Alphabetical
  if (quizType === 2) return shuffleMwc(pool, s1, s2);  // Build quiz: words directly

  // Step 1: alphabetical sort (matches search() output)
  const sorted = [...pool].sort();

  // Step 2: alphagrams in first-appearance order from sorted words
  //   e.g. "ARTS" (alphagram ARST) appears before "BAKE" (ABEK) alphabetically,
  //   so ARST leads even though ABEK < ARST as strings.
  const seen    = new Set();
  const alphaOrder = [];
  const byAlpha = {};
  for (const w of sorted) {
    const a = [...w].sort().join('');
    (byAlpha[a] = byAlpha[a] || []).push(w);
    if (!seen.has(a)) { seen.add(a); alphaOrder.push(a); }
  }

  // Step 3+4: MWC-shuffle the alphagram list
  const shuffled = shuffleMwc(alphaOrder, s1, s2);

  // Expand back to words; WASM receives with order=3 (PreserveOrder)
  return shuffled.flatMap(a => byAlpha[a]);
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
  parseQ()?.userIncorrectAnswers?.forEach(w => {
    if (w && !sessionIncorrect[w]) trackWrongGuess(w);
  });
  const resultStr = Module.checkAnswers();
  // Track answered words for end-screen review
  try {
    if (resultStr && resultStr !== '{}') {
      const cr = JSON.parse(resultStr);
      (cr.answers || []).forEach(a => {
        if (a.word && !quizHistory.some(h => h.word === a.word)) {
          quizHistory.push({ word: a.word, status: a.status });
        }
      });
    }
  } catch(_) {}
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

  // Build word review list with hook + prob layout
  const wordRow = ({ word, status }) => {
    const hk    = getHooksAndDots(word);
    const prob  = probRankMap[word];
    const score = getWordScore(word);
    const ok    = status === 'correct';
    const col   = ok ? 'var(--accent)' : 'var(--danger)';
    const fH    = hk.f !== '-'
      ? `<span style="color:var(--accent);letter-spacing:3px;">${hk.f.split('').join(' ')}</span>`
      : `<span style="color:var(--border);">—</span>`;
    const bH    = hk.b !== '-'
      ? `<span style="color:var(--accent);letter-spacing:3px;">${hk.b.split('').join(' ')}</span>`
      : `<span style="color:var(--border);">—</span>`;
    return `<div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:6px;
                        padding:8px 4px;border-bottom:1px solid rgba(58,58,60,.3);">
      <div class="mono" style="text-align:right;font-size:12px;font-weight:700;
                                line-height:1.8;word-break:break-all;min-width:0;">${fH}</div>
      <div style="text-align:center;white-space:nowrap;padding:0 4px;">
        <div style="font-size:10px;color:${col};font-weight:700;margin-bottom:1px;">${ok?'✓':'⊘'}</div>
        <span class="mono" style="font-size:18px;font-weight:700;color:${col};">${word}</span>
        <div style="font-size:10px;color:var(--text2);margin-top:2px;">
          <span style="color:var(--orange);font-weight:700;">${score}</span>pts
          ${prob ? `<span style="margin-left:4px;">#${prob}</span>` : ''}
        </div>
      </div>
      <div class="mono" style="text-align:left;font-size:12px;font-weight:700;
                                line-height:1.8;word-break:break-all;min-width:0;">${bH}</div>
    </div>`;
  };

  const wordListHtml = quizHistory.length
    ? quizHistory.map(wordRow).join('')
    : '<p style="text-align:center;color:var(--text2);padding:16px 0;">No word history</p>';

  document.getElementById('qEnginePane').innerHTML = `
    <div class="q-clean-layout" style="text-align:center;padding:20px 0">
      <h2 style="font-size:24px;color:var(--accent);margin-bottom:20px">Quiz Complete!</h2>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;
                  padding:20px;margin-bottom:16px;display:flex;flex-direction:column;gap:12px">
        ${statRow('Total Questions',  prog.totalQuestions, 'var(--text2)')}
        ${statRow('Correct Answers',  prog.totalCorrect,   'var(--accent)')}
        ${statRow('Missed Answers',   prog.totalMissed,    'var(--danger)')}
        ${statRow('Wrong Guesses',    prog.totalIncorrect, 'var(--orange)')}
        <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px;
                    display:flex;justify-content:space-between">
          <span style="font-weight:600">Accuracy</span>
          <span class="mono" style="font-weight:700;color:var(--orange)">${acc}%</span>
        </div>
      </div>
      <div style="text-align:left;margin-bottom:16px;">
        <div style="display:grid;grid-template-columns:1fr auto 1fr;font-size:10px;
                    font-weight:700;text-transform:uppercase;color:var(--text2);
                    padding:6px 4px;border-bottom:1px solid var(--border);margin-bottom:2px;">
          <span style="text-align:right;">Front Hook</span>
          <span style="text-align:center;padding:0 4px;">Word · Score · #Prob</span>
          <span style="text-align:left;">Back Hook</span>
        </div>
        <div style="max-height:50vh;overflow-y:auto;background:var(--surface2);
                    border:1px solid var(--border);border-radius:10px;">
          ${wordListHtml}
        </div>
      </div>
      <button class="btn btn-p" style="width:100%;padding:14px" onclick="quitQuiz()">
        Back to Settings
      </button>
    </div>`;
}

// ── QUIZ UI ────────────────────────────────────────────────────────────
function renderQuizUI(q, prog) {
  const pane = document.getElementById('qEnginePane');
  if (!pane) return;
  const pct       = (prog.currentQuestion / prog.totalQuestions) * 100;
  const tiles     = [...q.questionText].map(c => `<div class="quiz-tile">${c}</div>`).join('');
  const isChecked = q.checked;

  pane.innerHTML = `
    <div class="q-clean-layout">
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

      <div style="height:4px;background:var(--surface2);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--accent);transition:width .3s"></div>
      </div>

      <div style="display:flex;justify-content:center;gap:8px;margin:16px 0;flex-wrap:wrap">
        ${tiles}
      </div>

      <input type="text" id="qAnswerInput" class="input-field mono"
        style="text-transform:uppercase;text-align:center;font-size:18px;
               font-weight:600;letter-spacing:1px;margin-bottom:12px;
               ${isChecked ? 'opacity:.45;cursor:default;' : ''}"
        placeholder="${isChecked
          ? (q.correctAnswersCount === q.totalAnswers
              ? 'ALL FOUND — ENTER for next'
              : 'CHECKED — ENTER for next')
          : 'TYPE ANSWER & PRESS ENTER'}"
        ${isChecked ? 'readonly' : ''}
        oninput="onQuizInput()"
        onkeydown="handleEnterKey(event)">

      <div class="quiz-history-pane"
           style="min-height:160px;max-height:260px;margin-bottom:12px;padding:0;">
        <div style="display:grid;grid-template-columns:1fr auto 1fr;font-size:9px;
                    font-weight:700;text-transform:uppercase;color:var(--text2);
                    padding:5px 4px;border-bottom:1px solid var(--border);
                    background:var(--surface);border-radius:8px 8px 0 0;position:sticky;top:0;">
          <span style="text-align:right;">Front</span>
          <span style="text-align:center;padding:0 4px;">Word · Pts · #Prob</span>
          <span style="text-align:left;">Back</span>
        </div>
        ${renderAnswersList(q)}
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" style="flex:1;min-width:60px"  onclick="quitQuiz()">Quit</button>
        <button class="btn" style="flex:1;min-width:64px;color:var(--orange)"
                onclick="saveCurrentZzq()">Save 💾</button>
        <button class="btn" style="flex:1;min-width:64px;color:#0A84FF"
                onclick="showAnalysis()">Analyze</button>
        ${isChecked
          ? `<button class="btn btn-p" style="flex:2;min-width:140px"
                     onclick="handleNext()">Next → <small style="opacity:.7">(Enter)</small></button>`
          : `<button class="btn btn-p" id="qActionButton" style="flex:2;min-width:140px"
                     onclick="handleCheck()">Check Answers ✓</button>`}
      </div>
    </div>`;

  if (quizTimeLimit > 0) updateTimerDisplay();
}

function renderAnswersList(q) {
  // Shared helper: render one word as 3-column hook row
  const hookRow = (word, statusColor, statusIcon, showStar) => {
    const hk    = getHooksAndDots(word);
    const prob  = probRankMap[word];
    const score = getWordScore(word);
    const star  = saved.includes(word);
    const fH = hk.f !== '-'
      ? `<span style="color:var(--accent);letter-spacing:3px;">${hk.f.split('').join(' ')}</span>`
      : `<span style="color:var(--border);">—</span>`;
    const bH = hk.b !== '-'
      ? `<span style="color:var(--accent);letter-spacing:3px;">${hk.b.split('').join(' ')}</span>`
      : `<span style="color:var(--border);">—</span>`;
    const dotF = hk.dotF.trim() === '•'
      ? `<span style="color:var(--danger);font-size:9px;margin-right:2px;">●</span>` : '';
    const dotB = hk.dotB.trim() === '•'
      ? `<span style="color:var(--danger);font-size:9px;margin-left:2px;">●</span>` : '';
    return `<div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:4px;
                        padding:8px 4px;border-bottom:1px solid rgba(58,58,60,.3);">
      <div class="mono" style="text-align:right;font-size:12px;font-weight:700;
                                line-height:1.8;word-break:break-all;min-width:0;">${fH}</div>
      <div style="text-align:center;white-space:nowrap;padding:0 4px;">
        <div style="font-size:10px;color:${statusColor};font-weight:700;margin-bottom:1px;">${statusIcon}</div>
        <div>${dotF}<span class="mono" style="font-size:18px;font-weight:700;
                                               color:${statusColor};">${word}</span>${dotB}
          ${showStar ? `<button onclick="toggleSavedWord('${word}',this)"
            style="border:none;background:none;font-size:14px;cursor:pointer;padding:0 3px;vertical-align:middle;
                   color:${star?'var(--orange)':'var(--text2)'}">${star?'★':'☆'}</button>` : ''}
        </div>
        <div style="font-size:10px;color:var(--text2);margin-top:1px;">
          <span style="color:var(--orange);font-weight:700;">${score}</span>pts
          ${prob ? `<span style="margin-left:4px;">#${prob}</span>` : ''}
        </div>
      </div>
      <div class="mono" style="text-align:left;font-size:12px;font-weight:700;
                                line-height:1.8;word-break:break-all;min-width:0;">${bH}</div>
    </div>`;
  };

  if (!q.checked) {
    const rows = [
      ...q.userCorrectAnswers.map(w => hookRow(w, 'var(--accent)', '✓', true)),
      ...q.userIncorrectAnswers.map(w =>
        `<div style="padding:8px 4px;border-bottom:1px solid rgba(58,58,60,.3);opacity:.8;">
          <span class="mono" style="color:var(--danger);text-decoration:line-through;font-size:14px;">✕ ${w}</span>
          <span style="color:var(--text2);font-size:11px;margin-left:8px;">Invalid</span>
        </div>`)
    ].join('');
    return rows || `<p style="text-align:center;color:var(--text2);padding:20px 0">No answers yet</p>`;
  }

  let cr = { answers: [], incorrectAnswers: [] };
  try { const s = Module.checkAnswers(); if (s && s !== '{}') cr = JSON.parse(s); } catch(_) {}

  const rows = [
    ...(cr.answers || []).map(a => {
      const ok = a.status === 'correct';
      return hookRow(a.word, ok ? 'var(--accent)' : 'var(--danger)', ok ? '✓' : '⊘ MISSED', ok);
    }),
    ...(cr.incorrectAnswers || []).map(w =>
      `<div style="padding:8px 4px;border-bottom:1px solid rgba(58,58,60,.3);opacity:.7;">
        <span class="mono" style="color:var(--danger);text-decoration:line-through;font-size:14px;">✕ ${w}</span>
        <span style="color:var(--text2);font-size:11px;margin-left:8px;">Wrong guess</span>
      </div>`)
  ].join('');
  return rows || `<p style="text-align:center;color:var(--text2);padding:20px 0">No answers</p>`;
}

// ── INPUT HANDLING ─────────────────────────────────────────────────────
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
  if (!raw) { handleCheck(); return; }

  const val   = raw.toUpperCase();
  const q     = parseQ();
  const qType = sel('qTypeSelect');
  const expectedLen = q.questionText.length + (qType === 2 ? 1 : 0);

  if (val.length !== expectedLen) {
    shake(inp); toast(`⚠️ Answer must be ${expectedLen} letters`); return;
  }

  const prevWrong = q.userIncorrectAnswers?.length || 0;
  inp.value = '';
  Module.submitAnswer(val);

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
  if (btn) {
    const hasText = inp.value.trim().length > 0;
    btn.innerText = hasText ? 'Submit' : 'Check Answers ✓';
    btn.onclick   = hasText ? submitUserAnswer : handleCheck;
  }
  if (!cppInitialized || sel('qTypeSelect') !== 0) return;
  const q = parseQ();
  if (!q || q.checked) return;
  const typed = inp.value.toUpperCase();
  const avail = {};
  for (const c of q.questionText) avail[c] = (avail[c] || 0) + 1;
  const used = {};
  for (const c of typed) {
    used[c] = (used[c] || 0) + 1;
    if (used[c] > (avail[c] || 0)) {
      inp.value = typed.slice(0, -1);
      shake(inp); toast(`⚠️ "${c}" not in tiles`); return;
    }
  }
}

// ── ANALYZE ────────────────────────────────────────────────────────────
function showAnalysis() {
  const q = parseQ(); if (!q) return;
  if (!q.checked) {
    if (!confirm('⚠️ This reveals all answers and finalises this question. Proceed?')) return;
    clearInterval(timerInterval);
  }
  let cr;
  try { cr = JSON.parse(Module.checkAnswers()); } catch(_) {}
  if (!cr?.answers) { toast('No analysis data'); return; }

  (cr.incorrectAnswers || []).forEach(w => { if (w && !sessionIncorrect[w]) trackWrongGuess(w); });

  const prog      = parseProg();
  const sessTotal = prog.totalCorrect + prog.totalMissed;
  const sessAcc   = sessTotal > 0 ? Math.round(prog.totalCorrect / sessTotal * 100) : 0;
  const curCorrect = cr.answers.filter(a => a?.status === 'correct').length;
  const curAcc    = cr.answers.length > 0 ? Math.round(curCorrect / cr.answers.length * 100) : 0;
  const col       = p => p >= 70 ? 'var(--accent)' : p >= 40 ? 'var(--orange)' : 'var(--danger)';
  const missed    = cr.answers.filter(a => a?.status === 'missed').map(a => a.word);
  const wrongQ    = cr.incorrectAnswers || [];
  const sessWords = Object.keys(sessionIncorrect);
  const badge     = wrongQ.length === 0
    ? `<span style="background:rgba(52,199,89,.15);color:var(--accent);
                    padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">✓ CLEAN</span>`
    : `<span style="background:rgba(255,59,48,.1);color:var(--danger);
                    padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">⚠ HAD WRONG GUESSES</span>`;

  const wordList = (arr, color, icon='•') => arr.length
    ? arr.map(w => {
        const cnt = sessionIncorrect[w];
        return `<div class="mono" style="color:${color};font-size:15px;padding:2px 0">
          ${icon} ${w}${cnt > 1 ? ` <span style="color:var(--text2);font-size:12px">(×${cnt})</span>` : ''}</div>`;
      }).join('')
    : `<div style="color:var(--text2);text-align:center;padding:6px 0;font-size:13px">None</div>`;

  document.getElementById('qEnginePane').innerHTML = `
    <div class="q-clean-layout">
      <h3 class="mono" style="font-size:16px;border-bottom:1px solid var(--border);padding-bottom:6px">
        Analysis
      </h3>
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
      <div style="background:rgba(255,149,0,.08);border:1px solid rgba(255,149,0,.25);
                  border-radius:8px;padding:12px;max-height:150px;overflow-y:auto">
        <div style="font-size:11px;text-transform:uppercase;font-weight:700;
                    color:var(--orange);margin-bottom:6px">Missed (${missed.length})</div>
        ${wordList(missed, 'var(--orange)')}
      </div>
      <div style="background:rgba(255,59,48,.05);border:1px solid rgba(255,59,48,.2);
                  border-radius:8px;padding:12px;max-height:120px;overflow-y:auto">
        <div style="font-size:11px;text-transform:uppercase;font-weight:700;
                    color:var(--danger);margin-bottom:6px">Wrong This Q (${wrongQ.length})</div>
        ${wordList(wrongQ, 'var(--danger)', '✕')}
      </div>
      <div style="background:rgba(255,59,48,.03);border:1px solid rgba(255,59,48,.15);
                  border-radius:8px;padding:12px;max-height:150px;overflow-y:auto">
        <div style="font-size:11px;text-transform:uppercase;font-weight:700;
                    color:var(--danger);margin-bottom:6px">
          All Session Wrong (${sessWords.length})
          <span style="color:var(--text2);font-weight:400;font-size:10px"> — saved in localStorage per seed</span>
        </div>
        ${wordList(sessWords, 'var(--danger)', '✕')}
      </div>
      <button class="btn btn-p" style="width:100%" onclick="renderActiveQuiz()">Back to Quiz</button>
    </div>`;
}

function renderActiveQuiz() {
  const q = parseQ(); if (!q) return;
  renderQuizUI(q, parseProg());
}

// ── SAVE .zzq — 100% Zyzzyva-compatible XML ───────────────────────────
// IMPORTANT: Zyzzyva's fromDomElement uses `else return false` for unknown
// tags — so we CANNOT add any custom XML elements. Session data goes in an
// XML comment instead (comments are skipped by .toElement() in Qt's DOM).
function saveCurrentZzq() {
  if (!currentQuizPool?.length) { toast('No active quiz to save'); return; }
  let name = prompt('ชื่อไฟล์:', 'zyzzylu_quiz');
  if (name === null) return;
  name = (name.trim() || 'zyzzylu_quiz').replace(/\.zzq$/i, '') + '.zzq';

  const prog      = parseProg();
  const q         = parseQ();
  const isChecked = q?.checked ?? false;

  let cr = null;
  if (isChecked) {
    try { const s = Module.checkAnswers(); if (s && s !== '{}') cr = JSON.parse(s); } catch(_) {}
  }

  const quizTypeVal  = sel('qTypeSelect');
  const quizOrderVal = sel('qOrderSelect');
  const quizTypeStr  = ['Anagrams', 'Anagrams with Hooks', 'Build Word'][quizTypeVal] || 'Anagrams';
  const quizOrderStr = ['Alphabetical', 'Random', 'Probability'][quizOrderVal] || 'Random';

  const lines = [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<!DOCTYPE zyzzyva-quiz SYSTEM \'http://boshvark.com/dtd/zyzzyva-quiz.dtd\'>',
    `<zyzzyva-quiz lexicon="CSW24" method="Standard" question-order="${quizOrderStr}" type="${quizTypeStr}">`,
    ' <question-source type="search">',
    '  <zyzzyva-search version="1">',
    '   <conditions>',
    '    <and>',
  ];

  // Conditions — use exact Zyzzyva type strings confirmed from source files
  if (qFilters.length) {
    qFilters.forEach(f => {
      const neg = f.not ? '1' : '0';
      switch (f.type) {
        case 'length':
          lines.push(`     <condition max="${f.v2}" min="${f.v1}" type="Length"/>`); break;
        case 'point_value':
          lines.push(`     <condition max="${f.v2}" min="${f.v1}" type="Point Value"/>`); break;
        case 'num_vowels':
          lines.push(`     <condition max="${f.v2}" min="${f.v1}" type="Number of Vowels"/>`); break;
        case 'begins':
          lines.push(`     <condition negated="${neg}" string="${f.v1}" type="Begins With"/>`); break;
        case 'ends':
          lines.push(`     <condition negated="${neg}" string="${f.v1}" type="Ends With"/>`); break;
        case 'includes':
          lines.push(`     <condition negated="${neg}" string="${f.v1}" type="Includes Letters"/>`); break;
        case 'probability_order':
          lines.push(`     <condition max="${f.v2}" min="${f.v1}" type="Probability Order"/>`); break;
        case 'limit_probability_order':
          // Zyzzyva saves LimitByProbabilityOrder as Probability Order with int="2"
          // Confirmed from 7_Letter_Prob_100.zzq: bool="false" int="2" max min type (alphabetical)
          lines.push(`     <condition bool="false" int="2" max="${f.v2}" min="${f.v1 || '1'}" type="Probability Order"/>`); break;
        case 'anagram_match':
          lines.push(`     <condition negated="${neg}" string="${f.v1}" type="Anagram Match"/>`); break;
        case 'subanagram_match':
          lines.push(`     <condition negated="${neg}" string="${f.v1}" type="Subanagram Match"/>`); break;
        case 'pattern_match':
          lines.push(`     <condition negated="${neg}" string="${f.v1}" type="Pattern Match"/>`); break;
      }
    });
  } else {
    // Fallback: infer length range from the pool
    const lens = currentQuizPool.map(w => w.length);
    lines.push(`     <condition max="${Math.max(...lens)}" min="${Math.min(...lens)}" type="Length"/>`);
  }

  lines.push('    </and>', '   </conditions>', '  </zyzzyva-search>', ' </question-source>');

  // Randomizer — algorithm="1" = Marsaglia MWC (QuizSpec::setRandomAlgorithm)
  lines.push(` <randomizer algorithm="1" seed="${activeSeed1}" seed2="${activeSeed2}"/>`);

  // Progress
  const qIdx      = (prog.currentQuestion ?? 1) - 1;
  const correctW  = q?.userCorrectAnswers   || [];
  const incorrectW = isChecked ? (cr?.incorrectAnswers || []) : (q?.userIncorrectAnswers || []);
  const missedW   = isChecked ? (cr?.answers?.filter(a => a.status === 'missed').map(a => a.word) || []) : [];
  const hasBody   = correctW.length || incorrectW.length || missedW.length;

  const progressAttr = [
    `correct="${prog.totalCorrect}"`,
    `question="${qIdx}"`,
    `question-complete="${isChecked}"`,
  ].join(' ');

  if (hasBody) {
    lines.push(` <progress ${progressAttr}>`);
    if (correctW.length) {
      lines.push('  <question-correct-responses>');
      correctW.forEach(w => lines.push(`   <response word="${w}"/>`));
      lines.push('  </question-correct-responses>');
    }
    if (incorrectW.length) {
      lines.push('  <incorrect-responses>');
      incorrectW.forEach(w => lines.push(`   <response count="1" word="${w}"/>`));
      lines.push('  </incorrect-responses>');
    }
    if (missedW.length) {
      lines.push('  <missed-responses>');
      missedW.forEach(w => lines.push(`   <response count="1" word="${w}"/>`));
      lines.push('  </missed-responses>');
    }
    lines.push(' </progress>');
  } else {
    lines.push(` <progress ${progressAttr}/>`);
  }

  // Session wrong-guess data — stored as XML COMMENT so Zyzzyva ignores it.
  // QDomElement's toElement() skips comment nodes, so Zyzzyva's fromDomElement
  // never sees this and the file remains fully compatible.
  const sessWords = Object.keys(sessionIncorrect);
  if (sessWords.length) {
    const sessData = sessWords.map(w => `${w}:${sessionIncorrect[w]}`).join(',');
    lines.push(` <!-- zyzzylu-session: ${sessData} -->`);
  }

  lines.push('</zyzzyva-quiz>');
  downloadBlob(lines.join('\r\n'), name);
  toast(`Saved ${name}`);
}

// ── LOAD .zzq ──────────────────────────────────────────────────────────
function loadZzq(event) {
  const file = event.target.files[0]; if (!file) return;
  // Reset input so the same file can be reloaded
  event.target.value = '';
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const content = e.target.result.trim();
      content.startsWith('<?xml') ? loadXmlZzq(content) : loadPlainWordList(content);
    } catch(err) {
      console.error(err); toast('Error parsing quiz file');
    }
  };
  reader.readAsText(file);
}

function loadPlainWordList(content) {
  const words = content.split(/\r?\n/).map(w => w.trim().toUpperCase()).filter(w => dictSet.has(w));
  if (!words.length) { toast('No valid words in file'); return; }
  activeSeed1 = Math.floor(Date.now() / 1000);
  activeSeed2 = SESSION_SEED2;
  sessionIncorrect = {};
  currentQuizPool  = words;
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
  const typeStr = quizNode.getAttribute('type') || '';
  const typeVal = typeStr.toLowerCase().includes('hook') ? 1
                : typeStr.toLowerCase().includes('build') ? 2 : 0;
  document.getElementById('qTypeSelect').value = String(typeVal);

  // Question order — parse and restore (was hardcoded to '1')
  const orderAttr = quizNode.getAttribute('question-order') || 'Random';
  const orderVal  = orderAttr.toLowerCase().includes('alpha') ? 0
                  : orderAttr.toLowerCase().includes('prob')  ? 2 : 1;
  document.getElementById('qOrderSelect').value = String(orderVal);

  // Seeds — restored exactly from file to reproduce Zyzzyva's question order
  const rnd = xml.getElementsByTagName('randomizer')[0];
  if (!rnd) { toast('.zzq missing <randomizer>'); return; }
  activeSeed1 = parseInt(rnd.getAttribute('seed'))  || Math.floor(Date.now() / 1000);
  activeSeed2 = parseInt(rnd.getAttribute('seed2')) || SESSION_SEED2;

  // Rebuild filters from conditions
  qFilters.length = 0;
  xml.querySelectorAll('condition').forEach(cond => {
    const typeRaw  = cond.getAttribute('type') || '';
    const negated  = cond.parentNode?.tagName?.toLowerCase() === 'not'
                     || cond.getAttribute('negated') === '1';
    const intAttr  = cond.getAttribute('int');
    const boolAttr = cond.getAttribute('bool');
    let ft = '', v1 = '', v2 = '';

    switch (typeRaw) {
      case 'Length':
        ft='length'; v1=cond.getAttribute('min')||'2'; v2=cond.getAttribute('max')||'8'; break;
      case 'Point Value':
        ft='point_value'; v1=cond.getAttribute('min')||'0'; v2=cond.getAttribute('max')||'50'; break;
      case 'Number of Vowels':
        ft='num_vowels'; v1=cond.getAttribute('min')||'1'; v2=cond.getAttribute('max')||'7'; break;
      case 'Begins With':
        ft='begins'; v1=cond.getAttribute('string')||''; break;
      case 'Ends With':
        ft='ends'; v1=cond.getAttribute('string')||''; break;
      case 'Includes Letters':
        ft='includes'; v1=cond.getAttribute('string')||''; break;
      case 'Anagram Match':
        ft='anagram_match'; v1=cond.getAttribute('string')||''; break;
      case 'Subanagram Match':
        ft='subanagram_match'; v1=cond.getAttribute('string')||''; break;
      case 'Pattern Match':
        ft='pattern_match'; v1=cond.getAttribute('string')||''; break;
      case 'Probability Order':
        // int="2" bool="true" → LimitByProbabilityOrder (see 7_Letter_Prob_100.zzq)
        if (intAttr === '2' || boolAttr === 'true')
          { ft='limit_probability_order'; v1='0'; v2=cond.getAttribute('max')||'100'; }
        else
          { ft='probability_order'; v1=cond.getAttribute('min')||'1'; v2=cond.getAttribute('max')||'1000'; }
        break;
    }
    if (ft) { fId++; qFilters.push({ id: fId, type: ft, v1, v2, not: negated }); }
  });
  renderFilters('Q');

  // Build pool and apply filters
  let pool = dict.filter(w => matchFilters(w, qFilters));
  pool     = applyLimitFilters(pool, qFilters);

  if (!pool.length) {
    // Fallback: extract from any response nodes in the file
    const seen = new Set();
    xml.querySelectorAll('response').forEach(r => {
      const w = r.getAttribute('word')?.trim().toUpperCase();
      if (w && dictSet.has(w) && !seen.has(w)) { seen.add(w); pool.push(w); }
    });
  }
  if (!pool.length) { alert('No matching words found'); return; }

  // Reproduce Zyzzyva's exact question order using saved seeds
  currentQuizPool = buildOrderedPool(pool, typeVal, orderVal, activeSeed1, activeSeed2);
  quizTimeLimit   = sel('qTimerSelect');
  Module.generateQuiz(typeVal, currentQuizPool.join(' '), orderVal === 1 ? 3 : orderVal);

  // Restore progress
  const prog = xml.querySelector('progress');
  if (prog) {
    const qIdx     = parseInt(prog.getAttribute('question')          || '0');
    const correct  = parseInt(prog.getAttribute('correct')           || '0');
    const complete = prog.getAttribute('question-complete') === 'true';
    const cq       = parseInt(prog.getAttribute('correct-questions') || '0');

    const correctWords   = [...prog.querySelectorAll('question-correct-responses response')]
                           .map(r => r.getAttribute('word')?.toUpperCase()).filter(Boolean);
    const incorrectWords = [...prog.querySelectorAll('incorrect-responses response')]
                           .map(r => r.getAttribute('word')?.toUpperCase()).filter(Boolean);

    Module.restoreProgress(qIdx, correct, 0, 0, cq,
      correctWords.join(' '), incorrectWords.join(' '), complete);
  }

  // Load session data — from our XML comment (ignored by Zyzzyva)
  sessionIncorrect = {};
  // Walk raw DOM for comment nodes (querySelector can't find comments)
  const walker = document.createTreeWalker(xml, NodeFilter.SHOW_COMMENT, null, false);
  while (walker.nextNode()) {
    const text = walker.currentNode.nodeValue?.trim() || '';
    const m    = text.match(/^zyzzylu-session:\s*(.+)$/);
    if (m) {
      m[1].split(',').forEach(pair => {
        const [w, c] = pair.trim().split(':');
        if (w) sessionIncorrect[w.toUpperCase()] = parseInt(c) || 1;
      });
      break;
    }
  }
  // Also try localStorage (for same seed pair, saved from previous session)
  loadSessionIncorrect();

  showQuizPane();
  loadCurrentQuestion();
  toast(`Loaded .zzq — ${pool.length} words`);
}

// ── TIMER ──────────────────────────────────────────────────────────────
function startTimer() {
  const el = document.getElementById('qTimerDisplay');
  if (quizTimeLimit <= 0) { if (el) el.innerText = ''; return; }
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
  el.innerText   = `⏱ ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  el.style.color = quizTimeLeft <= 10 ? 'var(--danger)' : 'var(--orange)';
}

// ── HELPERS ────────────────────────────────────────────────────────────
const parseQ = () => {
  try { const s = Module.getCurrentQuestionJson(); return (!s || s === '{}') ? null : JSON.parse(s); }
  catch(_) { return null; }
};
const parseProg = () => {
  try { return JSON.parse(Module.getProgressJson()); }
  catch(_) { return {}; }
};
const sel = id => parseInt(document.getElementById(id)?.value || '0');
const showQuizPane = () => {
  document.getElementById('qSettingsPane').style.display = 'none';
  document.getElementById('qEnginePane').style.display   = 'block';
};
const shake = el => {
  el.classList.remove('shake-input'); void el.offsetWidth; el.classList.add('shake-input');
  setTimeout(() => el.classList.remove('shake-input'), 350);
};
const statRow = (label, val, col) =>
  `<div style="display:flex;justify-content:space-between">
    <span style="color:${col}">${label}</span>
    <span class="mono" style="font-weight:700;color:${col}">${val}</span></div>`;
const downloadBlob = (text, filename) => {
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

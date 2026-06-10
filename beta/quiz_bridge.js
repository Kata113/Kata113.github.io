// quiz_bridge.js — Zyzzylu v2 with Zyzzyva-compatible .zzq save/load
let cppInitialized = false;
let timerInterval = null;
let quizTimeLimit = 0;
let quizTimeLeft = 0;
let currentQuizPool = [];
let activeSeed1 = 0;
let activeSeed2 = 0;

// Session-wide wrong-guess tracking: word -> count
// Persists in <zyzzylu-session> of saved .zzq files
let sessionIncorrect = {};

// ─── WASM initialization ──────────────────────────────────────────────
if (typeof Module !== 'undefined') {
  Module.onRuntimeInitialized = () => { console.log("WASM Runtime initialized"); tryInitCppEngine(); };
}

async function tryInitCppEngine() {
  if (typeof Module !== 'undefined' && Module.loadDictionary && dict && dict.length > 0 && !cppInitialized) {
    document.getElementById('wCnt').innerText = "Loading WASM...";
    Module.loadDictionary(dict.join('\n'));
    cppInitialized = true;
    document.getElementById('wCnt').innerText = dict.length.toLocaleString() + " Words (WASM Active)";
  }
}

const oldOnload = window.onload;
window.onload = async () => { if (oldOnload) await oldOnload(); tryInitCppEngine(); };

// ─── MWC RNG — matches Zyzzyva's George Marsaglia MWC ────────────────
// Formula: z = 36969*(z&0xffff)+(z>>16); w = 18000*(w&0xffff)+(w>>16); return (z<<16)+(w&0xffff)
function createMwcRandom(s1, s2) {
  let z = Number(s1) >>> 0;
  let w = Number(s2) >>> 0;
  if (z === 0) z = 1;
  if (w === 0) w = 1;
  return () => {
    z = (36969 * (z & 0xffff) + (z >>> 16)) >>> 0;
    w = (18000 * (w & 0xffff) + (w >>> 16)) >>> 0;
    return ((z << 16) + (w & 0xffff)) >>> 0;  // matches Zyzzyva exactly
  };
}

// Shuffle using Fisher-Yates with Zyzzyva-compatible modulo (not division)
function shuffleMwc(array, s1, s2) {
  const rng = createMwcRandom(s1, s2);
  const a = [...array];
  const n = a.length;
  for (let i = 0; i < n - 1; i++) {
    const limit = n - i;
    const j = i + (rng() % limit);  // modulo matches Zyzzyva's C++ quint32 % limit
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function standardShuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Session incorrect tracking helpers ──────────────────────────────
function trackWrongGuess(word) {
  if (!word) return;
  sessionIncorrect[word] = (sessionIncorrect[word] || 0) + 1;
}

function getSessionIncorrectWords() {
  return Object.keys(sessionIncorrect);
}

// ─── Quiz start ───────────────────────────────────────────────────────
function startQuiz() {
  if (!cppInitialized) { toast("WASM Engine is still initializing. Please wait..."); return; }

  let pool = dict.filter(w => matchFilters(w, qFilters));
  pool = applyLimitFilters(pool, qFilters);
  if (!pool.length) { toast("No words match the selected filters!"); return; }

  sessionIncorrect = {};  // Reset session tracking for new quiz
  activeSeed1 = Math.floor(Date.now() / 1000);   // Unix timestamp (seconds) — matches Zyzzyva
  activeSeed2 = new Date().getMilliseconds();      // Milliseconds 0–999 — matches Zyzzyva

  const quizType  = parseInt(document.getElementById('qTypeSelect')?.value || "0");
  const order     = parseInt(document.getElementById('qOrderSelect')?.value || "1");
  quizTimeLimit   = parseInt(document.getElementById('qTimerSelect')?.value || "0");

  let finalPool = [...pool];
  if (order === 1) {  // Random — use MWC shuffle matching Zyzzyva
    if (quizType === 0 || quizType === 1) {
      let uniq = [...new Set(pool.map(w => [...w].sort().join('')))].sort();
      let shuffledUniq = shuffleMwc(uniq, activeSeed1, activeSeed2);
      const byAlpha = {};
      pool.forEach(w => { const a = [...w].sort().join(''); (byAlpha[a] = byAlpha[a] || []).push(w); });
      finalPool = shuffledUniq.flatMap(a => byAlpha[a] || []);
    } else {
      finalPool = shuffleMwc(pool, activeSeed1, activeSeed2);
    }
  }

  currentQuizPool = finalPool;
  Module.generateQuiz(quizType, finalPool.join(' '), order === 1 ? 3 : order);

  document.getElementById('qSettingsPane').style.display = 'none';
  document.getElementById('qEnginePane').style.display = 'block';
  loadCurrentQuestion();
}

// ─── Question loading ─────────────────────────────────────────────────
function loadCurrentQuestion() {
  clearInterval(timerInterval);
  const qJsonStr = Module.getCurrentQuestionJson();
  if (qJsonStr === "{}" || !qJsonStr) { endQuiz(); return; }
  const q = JSON.parse(qJsonStr);
  const prog = JSON.parse(Module.getProgressJson());
  renderQuizUI(q, prog);

  if (quizTimeLimit > 0) {
    quizTimeLeft = quizTimeLimit;
    updateTimerDisplay();
    timerInterval = setInterval(() => {
      quizTimeLeft--;
      updateTimerDisplay();
      if (quizTimeLeft <= 0) { clearInterval(timerInterval); handleCheck(); }
    }, 1000);
  } else {
    const el = document.getElementById('qTimerDisplay'); if (el) el.innerText = "";
  }
  setTimeout(() => { const inp = document.getElementById('qAnswerInput'); if (inp) inp.focus(); }, 100);
}

// ─── Quiz UI rendering ────────────────────────────────────────────────
function renderQuizUI(q, prog) {
  const pane = document.getElementById('qEnginePane');
  if (!pane) return;
  let tilesHtml = "";
  for (const ch of q.questionText) tilesHtml += `<div class="quiz-tile">${ch}</div>`;
  const pct = (prog.currentQuestion / prog.totalQuestions) * 100;

  pane.innerHTML = `
    <div class="q-clean-layout">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:12px; margin-bottom:10px;">
        <span class="mono" style="font-size:13px; color:var(--text2)">Question ${prog.currentQuestion}/${prog.totalQuestions}</span>
        <div style="display:flex; gap:14px; align-items:center;">
          <span class="mono" id="qTimerDisplay" style="font-weight:700; color:var(--orange); font-size:14px;"></span>
          <span class="mono" style="font-size:13px; color:var(--accent); font-weight:600;">${q.correctAnswersCount}/${q.totalAnswers} found</span>
        </div>
      </div>
      <div style="height:4px; width:100%; background:var(--surface2); border-radius:2px; overflow:hidden; margin-bottom:15px;">
        <div style="height:100%; width:${pct}%; background:var(--accent); transition:width 0.3s ease;"></div>
      </div>
      <div style="display:flex; justify-content:center; gap:8px; margin:20px 0; flex-wrap:wrap;">${tilesHtml}</div>
      <div style="margin-bottom:16px;">
        <input type="text" id="qAnswerInput" class="input-field mono"
          style="text-transform:uppercase; text-align:center; font-size:18px; font-weight:600; letter-spacing:1px;"
          placeholder="${q.checked ? (q.correctAnswersCount === q.totalAnswers ? 'ALL ANSWERS FOUND!' : 'QUESTION CHECKED') : 'TYPE ANSWER & PRESS ENTER'}"
          ${q.checked ? 'disabled' : ''}
          oninput="onQuizInput()"
          onkeydown="if(event.key==='Enter') submitUserAnswer()">
      </div>
      <div class="quiz-history-pane" style="flex:1; min-height:180px; max-height:250px; margin-bottom:16px;">
        <div id="qAnswersList" style="display:flex; flex-direction:column; gap:8px;">${renderAnswersList(q)}</div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn" style="flex:1; min-width:60px;" onclick="quitQuiz()">Quit</button>
        <button class="btn" style="flex:1; min-width:70px; color:var(--orange);" onclick="saveCurrentZzq()">Save 💾</button>
        <button class="btn" style="flex:1; min-width:70px; color:#0A84FF;" onclick="showAnalysis()">Analyze</button>
        ${q.checked
          ? `<button class="btn btn-p" style="flex:2; min-width:150px;" onclick="handleNext()">Next Question →</button>`
          : `<button class="btn btn-p" id="qActionButton" style="flex:2; min-width:150px;" onclick="handleCheck()">Check Answers ✓</button>`}
      </div>
    </div>`;
}

function renderAnswersList(q) {
  if (!q.checked) {
    if (!q.userCorrectAnswers.length && !q.userIncorrectAnswers.length)
      return `<p style="text-align:center; color:var(--text2); padding:20px 0;">No answers submitted yet.</p>`;
    let html = "";
    q.userCorrectAnswers.forEach(w => {
      const star = saved.includes(w);
      html += `<div class="item-row" style="border-bottom:1px solid rgba(58,58,60,.3); padding:8px 4px;">
        <span class="mono" style="color:var(--accent); font-weight:600;">✓ ${w}</span>
        <button class="btn-not" onclick="toggleSavedWord('${w}', this)" style="border:none; background:none; color:${star?'var(--orange)':'var(--text2)'}; font-size:16px; cursor:pointer; padding:0 4px;">${star?'★':'☆'}</button>
      </div>`;
    });
    q.userIncorrectAnswers.forEach(w => {
      html += `<div class="item-row" style="border-bottom:1px solid rgba(58,58,60,.3); padding:8px 4px; opacity:.8;">
        <span class="mono" style="color:var(--danger); text-decoration:line-through;">✕ ${w}</span>
        <span style="color:var(--text2); font-size:11px;">Invalid</span>
      </div>`;
    });
    return html;
  }

  let cr = { answers: [], incorrectAnswers: [] };
  try { const s = Module.checkAnswers(); if (s && s !== "{}") cr = JSON.parse(s); } catch(e) {}
  if (!cr.answers) cr.answers = [];
  let html = "";
  cr.answers.forEach(ans => {
    const ok = ans.status === 'correct', star = saved.includes(ans.word);
    html += `<div class="item-row" style="border-bottom:1px solid rgba(58,58,60,.3); padding:8px 4px;">
      <div style="display:flex; align-items:center; gap:8px; flex:1;">
        <span style="color:${ok?'var(--accent)':'var(--danger)'}; font-weight:700; width:18px;">${ok?'✓':'⊘'}</span>
        <span class="mono hook-box" style="font-size:11px;">${ans.front||'-'}</span>
        <span class="mono" style="font-weight:700; font-size:16px; color:${ok?'var(--text)':'rgba(255,59,48,.8)'};">${ans.word}</span>
        <span class="mono hook-box" style="font-size:11px;">${ans.back||'-'}</span>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:11px; color:var(--text2);">${ok?'Correct':'Missed'}</span>
        <button class="btn-not" onclick="toggleSavedWord('${ans.word}', this)" style="border:none; background:none; color:${star?'var(--orange)':'var(--text2)'}; font-size:16px; cursor:pointer; padding:0 4px;">${star?'★':'☆'}</button>
      </div>
    </div>`;
  });
  cr.incorrectAnswers.forEach(w => {
    html += `<div class="item-row" style="border-bottom:1px solid rgba(58,58,60,.3); padding:8px 4px; opacity:.7;">
      <span class="mono" style="color:var(--danger); text-decoration:line-through;">✕ ${w}</span>
      <span style="color:var(--text2); font-size:11px;">Invalid</span>
    </div>`;
  });
  return html;
}

function toggleSavedWord(word, btn) {
  toggleSave(word);
  const s = saved.includes(word);
  btn.style.color = s ? 'var(--orange)' : 'var(--text2)';
  btn.innerText = s ? '★' : '☆';
}

// ─── Answer submission ────────────────────────────────────────────────
function submitUserAnswer() {
  const inp = document.getElementById('qAnswerInput');
  if (!inp) return;
  const val = inp.value.trim();
  if (!val) return;

  const cleanVal = val.toUpperCase().trim();
  let targetWord = cleanVal;
  const c1 = cleanVal.indexOf(':');
  if (c1 !== -1) { const c2 = cleanVal.indexOf(':', c1+1); if (c2 !== -1) targetWord = cleanVal.substring(c1+1, c2); }

  const q = JSON.parse(Module.getCurrentQuestionJson());
  const quizType = parseInt(document.getElementById('qTypeSelect')?.value || "0");
  const expectedLen = q.questionText.length + (quizType === 2 ? 1 : 0);
  if (targetWord.length !== expectedLen) {
    inp.classList.remove('shake-input'); void inp.offsetWidth; inp.classList.add('shake-input');
    setTimeout(() => inp.classList.remove('shake-input'), 350);
    toast(`⚠️ Answer must be ${expectedLen} letters!`, '');
    return;
  }

  const prevWrong = q.userIncorrectAnswers ? q.userIncorrectAnswers.length : 0;
  inp.value = "";

  const correct = Module.submitAnswer(val);
  if (correct) {
    toast("Correct!", "success");
  } else {
    // Check if a NEW wrong guess was added
    const afterQ = JSON.parse(Module.getCurrentQuestionJson());
    if ((afterQ.userIncorrectAnswers?.length || 0) > prevWrong) {
      trackWrongGuess(targetWord);  // add to session tracking immediately
    }
  }

  const updatedQ = JSON.parse(Module.getCurrentQuestionJson());
  const prog = JSON.parse(Module.getProgressJson());
  renderQuizUI(updatedQ, prog);
  document.getElementById('qAnswerInput')?.focus();
}

function handleCheck() {
  clearInterval(timerInterval);
  // Add any current question wrong guesses to session tracking
  const q = JSON.parse(Module.getCurrentQuestionJson());
  if (q.userIncorrectAnswers) {
    q.userIncorrectAnswers.forEach(w => { if (!sessionIncorrect[w]) trackWrongGuess(w); });
  }
  Module.checkAnswers();
  const updatedQ = JSON.parse(Module.getCurrentQuestionJson());
  const prog = JSON.parse(Module.getProgressJson());
  renderQuizUI(updatedQ, prog);
}

function handleNext() {
  const hasNext = Module.nextQuestion();
  if (hasNext) loadCurrentQuestion(); else endQuiz();
}

function quitQuiz() {
  clearInterval(timerInterval);
  document.getElementById('qEnginePane').style.display = 'none';
  document.getElementById('qSettingsPane').style.display = 'block';
}

// ─── End of quiz ──────────────────────────────────────────────────────
function endQuiz() {
  clearInterval(timerInterval);
  const prog = JSON.parse(Module.getProgressJson());
  const pane = document.getElementById('qEnginePane');
  if (!pane) return;
  const total = prog.totalCorrect + prog.totalMissed;
  const acc = total > 0 ? Math.round(prog.totalCorrect / total * 100) : 0;
  pane.innerHTML = `
    <div class="q-clean-layout" style="text-align:center; padding:20px 0;">
      <h2 style="font-size:24px; color:var(--accent); margin-bottom:20px;">Quiz Complete!</h2>
      <div style="background:var(--surface2); border:1px solid var(--border); border-radius:12px; padding:20px; margin-bottom:24px; display:flex; flex-direction:column; gap:12px;">
        <div style="display:flex; justify-content:space-between;"><span style="color:var(--text2);">Total Questions:</span><span class="mono" style="font-weight:700;">${prog.totalQuestions}</span></div>
        <div style="display:flex; justify-content:space-between;"><span style="color:var(--accent);">Correct Answers:</span><span class="mono" style="font-weight:700; color:var(--accent);">${prog.totalCorrect}</span></div>
        <div style="display:flex; justify-content:space-between;"><span style="color:var(--danger);">Missed Answers:</span><span class="mono" style="font-weight:700; color:var(--danger);">${prog.totalMissed}</span></div>
        <div style="display:flex; justify-content:space-between;"><span style="color:var(--orange);">Wrong Guesses:</span><span class="mono" style="font-weight:700; color:var(--orange);">${prog.totalIncorrect}</span></div>
        <div style="display:flex; justify-content:space-between; border-top:1px solid var(--border); padding-top:12px; margin-top:4px;"><span style="font-weight:600;">Accuracy:</span><span class="mono" style="font-weight:700; color:var(--orange);">${acc}%</span></div>
      </div>
      <button class="btn btn-p" style="width:100%; padding:14px;" onclick="quitQuiz()">Back to Settings</button>
    </div>`;
}

function updateTimerDisplay() {
  const el = document.getElementById('qTimerDisplay'); if (!el) return;
  const m = Math.floor(quizTimeLeft/60), s = quizTimeLeft%60;
  el.innerText = `⏱ ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  el.style.color = quizTimeLeft <= 10 ? 'var(--danger)' : 'var(--orange)';
  el.style.textShadow = quizTimeLeft <= 10 ? '0 0 8px rgba(255,59,48,0.4)' : 'none';
}

// ─── SAVE .zzq — fully Zyzzyva-compatible ────────────────────────────
function saveCurrentZzq() {
  if (!currentQuizPool?.length) { toast("No active word pool to save!"); return; }
  let fName = prompt("ชื่อไฟล์ควิซ:", "zyzzylu_quiz");
  if (fName === null) return;
  fName = (fName.trim() || "zyzzylu_quiz");
  if (!fName.toLowerCase().endsWith(".zzq")) fName += ".zzq";

  const prog = JSON.parse(Module.getProgressJson());
  const q    = JSON.parse(Module.getCurrentQuestionJson());

  const currentIdx       = prog.currentQuestion - 1;
  const isComplete       = q.checked;
  const correctQuestions = prog.fullyCorrectQuestions || 0;
  const correctCount     = prog.totalCorrect;

  const xml = [];
  xml.push('<?xml version="1.0" encoding="ISO-8859-1"?>');
  xml.push('<!DOCTYPE zyzzyva-quiz SYSTEM \'http://boshvark.com/dtd/zyzzyva-quiz.dtd\'>');
  xml.push(`<zyzzyva-quiz type="Anagrams" question-order="Random" lexicon="CSW24" method="Standard">`);
  xml.push(' <question-source type="search">');
  xml.push('  <zyzzyva-search version="1">');
  xml.push('   <conditions>');
  xml.push('    <and>');

  if (qFilters && qFilters.length > 0) {
    qFilters.forEach(f => {
      const neg = f.not ? '1' : '0';
      if      (f.type === 'length')                xml.push(`     <condition type="Length" min="${f.v1}" max="${f.v2}"/>`);
      else if (f.type === 'point_value')           xml.push(`     <condition type="Point Value" min="${f.v1}" max="${f.v2}"/>`);
      else if (f.type === 'begins')                xml.push(`     <condition type="Begins With" string="${f.v1}" negated="${neg}"/>`);
      else if (f.type === 'ends')                  xml.push(`     <condition type="Ends With" string="${f.v1}" negated="${neg}"/>`);
      else if (f.type === 'includes')              xml.push(`     <condition type="Includes Letters" string="${f.v1}" negated="${neg}"/>`);
      else if (f.type === 'num_vowels')            xml.push(`     <condition type="Number of Vowels" min="${f.v1}" max="${f.v2}"/>`);
      else if (f.type === 'probability_order')     xml.push(`     <condition type="Probability Order" min="${f.v1}" max="${f.v2}"/>`);
      else if (f.type === 'limit_probability_order') xml.push(`     <condition type="LimitByProbabilityOrder" min="${f.v1}" max="${f.v2}"/>`);
      else if (f.type === 'anagram_match')         xml.push(`     <condition type="Anagram Match" string="${f.v1}" negated="${neg}"/>`);
    });
  } else {
    const lens = currentQuizPool.map(w => w.length);
    xml.push(`     <condition type="Length" min="${Math.min(...lens)}" max="${Math.max(...lens)}"/>`);
  }

  xml.push('    </and>');
  xml.push('   </conditions>');
  xml.push('  </zyzzyva-search>');
  xml.push(' </question-source>');
  xml.push(` <randomizer algorithm="1" seed="${activeSeed1}" seed2="${activeSeed2}"/>`);

  // Build progress attributes
  const progressAttrs = [
    `correct="${correctCount}"`,
    `question-complete="${isComplete ? 'true' : 'false'}"`,
    `total-questions="${prog.totalQuestions}"`,
    `correct-questions="${correctQuestions}"`,
    `question="${currentIdx}"`
  ].join(' ');

  // Get check results for missed/incorrect (if question is checked)
  let checkR = null;
  if (isComplete) {
    try { const s = Module.checkAnswers(); if (s && s !== "{}") checkR = JSON.parse(s); } catch(e) {}
  }

  // If question is active (not checked), just output partial progress
  if (!isComplete) {
    if (q.userCorrectAnswers?.length || q.userIncorrectAnswers?.length) {
      xml.push(` <progress ${progressAttrs}>`);
      if (q.userCorrectAnswers?.length) {
        xml.push('  <question-correct-responses>');
        q.userCorrectAnswers.forEach(w => xml.push(`   <response word="${w}"/>`));
        xml.push('  </question-correct-responses>');
      }
      if (q.userIncorrectAnswers?.length) {
        xml.push('  <incorrect-responses>');
        q.userIncorrectAnswers.forEach(w => xml.push(`   <response word="${w}" count="1"/>`));
        xml.push('  </incorrect-responses>');
      }
      xml.push(' </progress>');
    } else {
      xml.push(` <progress ${progressAttrs}/>`);
    }
  } else {
    xml.push(` <progress ${progressAttrs}>`);
    // question-correct-responses
    if (q.userCorrectAnswers?.length) {
      xml.push('  <question-correct-responses>');
      q.userCorrectAnswers.forEach(w => xml.push(`   <response word="${w}"/>`));
      xml.push('  </question-correct-responses>');
    }
    // incorrect-responses (wrong guesses for this question)
    const incorrectThisQ = checkR?.incorrectAnswers || [];
    if (incorrectThisQ.length) {
      xml.push('  <incorrect-responses>');
      incorrectThisQ.forEach(w => xml.push(`   <response word="${w}" count="1"/>`));
      xml.push('  </incorrect-responses>');
    }
    // missed-responses (valid words not found)
    const missedWords = checkR?.answers?.filter(a => a.status === 'missed').map(a => a.word) || [];
    if (missedWords.length) {
      xml.push('  <missed-responses>');
      missedWords.forEach(w => xml.push(`   <response word="${w}" count="1"/>`));
      xml.push('  </missed-responses>');
    }
    xml.push(' </progress>');
  }

  // Zyzzylu-specific: session-wide wrong guesses with counts (persists across sessions)
  const sessWords = Object.keys(sessionIncorrect);
  if (sessWords.length) {
    xml.push(' <zyzzylu-session>');
    xml.push('  <all-incorrect-responses>');
    sessWords.forEach(w => xml.push(`   <response word="${w}" count="${sessionIncorrect[w]}"/>`));
    xml.push('  </all-incorrect-responses>');
    xml.push(' </zyzzylu-session>');
  }

  xml.push('</zyzzyva-quiz>');

  const blob = new Blob([xml.join("\r\n")], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.download = fName; a.href = URL.createObjectURL(blob);
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  toast(`Saved ${fName}`);
}

// ─── LOAD .zzq — Zyzzyva-compatible ──────────────────────────────────
function loadZzq(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const content = e.target.result.trim();
    try {
      // Plain text word list
      if (!content.startsWith("<?xml")) {
        const loaded = content.split(/\r?\n/).map(w => w.trim().toUpperCase()).filter(w => dictSet.has(w));
        if (!loaded.length) { toast("No valid words found in plain text file."); return; }
        sessionIncorrect = {};
        currentQuizPool  = loaded;
        activeSeed1 = Math.floor(Date.now() / 1000);
        activeSeed2 = new Date().getMilliseconds();
        const quizType = parseInt(document.getElementById('qTypeSelect')?.value || "0");
        quizTimeLimit  = parseInt(document.getElementById('qTimerSelect')?.value || "0");
        Module.generateQuiz(quizType, loaded.join(' '), 3);
        document.getElementById('qSettingsPane').style.display = 'none';
        document.getElementById('qEnginePane').style.display  = 'block';
        loadCurrentQuestion();
        toast(`Loaded ${loaded.length} words`);
        return;
      }

      // XML .zzq file
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(content, "text/xml");
      const quizNode = xmlDoc.querySelector('zyzzyva-quiz');
      if (!quizNode) { toast("Invalid .zzq file!"); return; }

      const typeAttr = quizNode.getAttribute('type') || "Anagrams";
      let typeVal = "0";
      if (typeAttr.toLowerCase().includes("hook")) typeVal = "1";
      else if (typeAttr.toLowerCase().includes("build")) typeVal = "2";
      document.getElementById('qTypeSelect').value = typeVal;

      // Seeds
      const rNode = xmlDoc.getElementsByTagName("randomizer")[0];
      const s1Raw = rNode?.getAttribute("seed");
      const s2Raw = rNode?.getAttribute("seed2");
      activeSeed1 = s1Raw ? parseInt(s1Raw) : Math.floor(Date.now() / 1000);
      activeSeed2 = s2Raw ? parseInt(s2Raw) : new Date().getMilliseconds();

      // Parse search conditions → reconstruct pool
      const condNodes = xmlDoc.querySelectorAll('condition');
      let pool = [];
      if (condNodes.length > 0) {
        qFilters.length = 0;
        condNodes.forEach(cond => {
          const negated = (cond.parentNode.tagName.toLowerCase() === 'not' || cond.getAttribute('negated') === '1');
          const typeRaw = cond.getAttribute('type') || '';
          const typeN = typeRaw.replace(/\s+/g, '').toLowerCase();
          let ft = '', v1 = '', v2 = '';

          if      (typeN === 'length')                         { ft='length';                v1=cond.getAttribute('min')||'2'; v2=cond.getAttribute('max')||'8'; }
          else if (typeN === 'pointvalue')                     { ft='point_value';           v1=cond.getAttribute('min')||'0'; v2=cond.getAttribute('max')||'50'; }
          else if (typeN === 'beginswith' || typeN === 'begins') { ft='begins';              v1=cond.getAttribute('string')||cond.getAttribute('text')||''; }
          else if (typeN === 'endswith'   || typeN === 'ends')   { ft='ends';                v1=cond.getAttribute('string')||cond.getAttribute('text')||''; }
          else if (typeN === 'includesletters' || typeN === 'contains' || typeN === 'includes') { ft='includes'; v1=cond.getAttribute('string')||cond.getAttribute('text')||''; }
          else if (typeN === 'numberofvowels' || typeN === 'vowels') { ft='num_vowels';      v1=cond.getAttribute('min')||'1'; v2=cond.getAttribute('max')||'7'; }
          else if (typeN === 'probabilityorder' || typeN === 'probability') { ft='probability_order'; v1=cond.getAttribute('min')||'1'; v2=cond.getAttribute('max')||'1000'; }
          else if (typeN === 'limitbyprobabilityorder')        { ft='limit_probability_order'; v1=cond.getAttribute('min')||'1'; v2=cond.getAttribute('max')||'100'; }
          else if (typeN === 'anagrammatch')                   { ft='anagram_match';         v1=cond.getAttribute('string')||cond.getAttribute('text')||''; }

          if (ft) {
            fId++;
            qFilters.push({ id: fId, type: ft, v1, v2, not: negated });
          }
        });
        renderFilters('Q');
        pool = dict.filter(w => matchFilters(w, qFilters));
        pool = applyLimitFilters(pool, qFilters);
      } else {
        // Fallback to words from response nodes
        const respNodes = xmlDoc.getElementsByTagName("response");
        for (let i = 0; i < respNodes.length; i++) {
          const w = respNodes[i].getAttribute("word")?.trim().toUpperCase();
          if (w && dictSet.has(w)) pool.push(w);
        }
      }

      if (!pool.length) { alert("No valid words found matching this quiz file."); return; }

      // Shuffle with seeds (matching Zyzzyva order)
      let orderedWords = [];
      if (typeVal === "2") {
        orderedWords = shuffleMwc(pool, activeSeed1, activeSeed2);
      } else {
        let uniq = [...new Set(pool.map(w => [...w].sort().join('')))].sort();
        let shuffledUniq = shuffleMwc(uniq, activeSeed1, activeSeed2);
        const byAlpha = {};
        pool.forEach(w => { const a = [...w].sort().join(''); (byAlpha[a] = byAlpha[a] || []).push(w); });
        orderedWords = shuffledUniq.flatMap(a => byAlpha[a] || []);
      }

      currentQuizPool = orderedWords;
      quizTimeLimit = parseInt(document.getElementById('qTimerSelect')?.value || "0");
      document.getElementById('qOrderSelect').value = "1";
      Module.generateQuiz(parseInt(typeVal), orderedWords.join(' '), 3);

      // Restore progress
      const progressNode = xmlDoc.querySelector('progress');
      if (progressNode) {
        const savedQIdx       = parseInt(progressNode.getAttribute('question') || '0');
        const savedCorrect    = parseInt(progressNode.getAttribute('correct') || '0');
        const savedQComplete  = progressNode.getAttribute('question-complete') === 'true';
        const savedCQ         = parseInt(progressNode.getAttribute('correct-questions') || '0');

        const correctNode = progressNode.querySelector('question-correct-responses');
        const userCorrect = [];
        correctNode?.querySelectorAll('response').forEach(r => {
          const w = r.getAttribute('word'); if (w) userCorrect.push(w.trim().toUpperCase());
        });

        const incorrectNode = progressNode.querySelector('incorrect-responses');
        const userIncorrect = [];
        incorrectNode?.querySelectorAll('response').forEach(r => {
          const w = r.getAttribute('word'); if (w) userIncorrect.push(w.trim().toUpperCase());
        });

        Module.restoreProgress(savedQIdx, savedCorrect, 0, 0, savedCQ,
          userCorrect.join(' '), userIncorrect.join(' '), savedQComplete);
      }

      // Load session-wide wrong guesses (Zyzzylu extension)
      sessionIncorrect = {};
      const sessNode = xmlDoc.querySelector('zyzzylu-session all-incorrect-responses');
      if (sessNode) {
        sessNode.querySelectorAll('response').forEach(r => {
          const w = r.getAttribute('word');
          const c = parseInt(r.getAttribute('count') || '1');
          if (w) sessionIncorrect[w.trim().toUpperCase()] = c;
        });
      } else if (progressNode) {
        // No zyzzylu-session — seed from current question's incorrect-responses
        // (handles files saved by original Zyzzyva)
        progressNode.querySelector('incorrect-responses')?.querySelectorAll('response').forEach(r => {
          const w = r.getAttribute('word');
          const c = parseInt(r.getAttribute('count') || '1');
          if (w) sessionIncorrect[w.trim().toUpperCase()] = (sessionIncorrect[w.trim().toUpperCase()] || 0) + c;
        });
      }

      document.getElementById('qSettingsPane').style.display = 'none';
      document.getElementById('qEnginePane').style.display  = 'block';
      loadCurrentQuestion();
      toast(`Loaded .zzq (${pool.length} words)`);

    } catch(err) {
      console.error(err); toast("Error parsing quiz file.");
    }
  };
  reader.readAsText(file);
}

// ─── Analyze view ─────────────────────────────────────────────────────
function showAnalysis() {
  const qJsonStr = Module.getCurrentQuestionJson();
  if (qJsonStr === "{}" || !qJsonStr) return;
  const q = JSON.parse(qJsonStr);

  if (!q.checked) {
    if (!confirm("⚠️ Viewing analysis reveals all answers and finalizes this question. Proceed?")) return;
    clearInterval(timerInterval);
  }

  const resultsStr = Module.checkAnswers();
  if (!resultsStr || resultsStr === "{}") { toast("No analysis available."); return; }
  let cr;
  try { cr = JSON.parse(resultsStr); } catch(e) { toast("Error loading analysis."); return; }
  if (!cr?.answers) { toast("No analysis data."); return; }

  // Also ensure any current-question wrong guesses are tracked in session
  (cr.incorrectAnswers || []).forEach(w => { if (w && !sessionIncorrect[w]) trackWrongGuess(w); });

  const pane = document.getElementById('qEnginePane');
  if (!pane) return;

  const prog = JSON.parse(Module.getProgressJson());
  const sessTotal = prog.totalCorrect + prog.totalMissed;
  const sessAcc   = sessTotal > 0 ? Math.round(prog.totalCorrect / sessTotal * 100) : 0;
  const curTotal  = cr.answers.length;
  const curCorrect = cr.answers.filter(a => a?.status === 'correct').length;
  const curAcc    = curTotal > 0 ? Math.round(curCorrect / curTotal * 100) : 0;
  const color = p => p >= 70 ? 'var(--accent)' : p >= 40 ? 'var(--orange)' : 'var(--danger)';

  // Missed words for current question
  const missed = cr.answers.filter(a => a?.status === 'missed').map(a => a.word);

  // Wrong guesses for current question specifically
  const wrongThisQ = cr.incorrectAnswers || [];

  // Determine if question is "clean" (no wrong guesses)
  const isClean = wrongThisQ.length === 0;
  const statusBadge = isClean
    ? `<span style="background:rgba(52,199,89,.15); color:var(--accent); padding:2px 8px; border-radius:4px; font-size:11px; font-weight:700;">✓ CLEAN</span>`
    : `<span style="background:rgba(255,59,48,.1); color:var(--danger); padding:2px 8px; border-radius:4px; font-size:11px; font-weight:700;">⚠ HAD WRONG GUESSES</span>`;

  // Stats
  const statsHtml = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
      <div style="background:var(--surface2); border:1px solid var(--border); border-radius:8px; padding:10px; text-align:center;">
        <div style="font-size:10px; color:var(--text2); text-transform:uppercase; font-weight:700; margin-bottom:4px;">Current Q</div>
        <div style="font-size:26px; font-weight:800; color:${color(curAcc)}">${curAcc}%</div>
        <div style="font-size:11px; color:var(--text2);">${curCorrect}/${curTotal} found</div>
        <div style="margin-top:4px;">${statusBadge}</div>
      </div>
      <div style="background:var(--surface2); border:1px solid var(--border); border-radius:8px; padding:10px; text-align:center;">
        <div style="font-size:10px; color:var(--text2); text-transform:uppercase; font-weight:700; margin-bottom:4px;">Session Total</div>
        <div style="font-size:26px; font-weight:800; color:${color(sessAcc)}">${sessAcc}%</div>
        <div style="font-size:11px; color:var(--text2);">${prog.totalCorrect}/${sessTotal} correct</div>
      </div>
    </div>`;

  // Missed section
  let missedHtml = missed.length
    ? missed.map(w => `<div class="mono" style="color:var(--orange); font-size:15px; padding:2px 0;">• ${w}</div>`).join('')
    : `<div class="mono" style="color:var(--text2); text-align:center; padding:10px 0;">None — perfect!</div>`;

  // Wrong this question section
  let wrongQHtml = wrongThisQ.length
    ? wrongThisQ.map(w => {
        const cnt = sessionIncorrect[w] || 1;
        return `<div class="mono" style="color:var(--danger); font-size:15px; padding:2px 0;">✕ ${w}${cnt > 1 ? ` <span style="color:var(--text2); font-size:12px;">(×${cnt})</span>` : ''}</div>`;
      }).join('')
    : `<div class="mono" style="color:var(--text2); text-align:center; padding:10px 0;">None</div>`;

  // All session wrong guesses
  const sessWords = Object.keys(sessionIncorrect);
  let sessHtml = sessWords.length
    ? sessWords.map(w => {
        const cnt = sessionIncorrect[w];
        return `<div class="mono" style="color:var(--danger); font-size:15px; padding:2px 0;">✕ ${w}${cnt > 1 ? ` <span style="color:var(--text2); font-size:12px;">(×${cnt})</span>` : ''}</div>`;
      }).join('')
    : `<div class="mono" style="color:var(--text2); text-align:center; padding:10px 0;">None</div>`;

  pane.innerHTML = `
    <div class="q-clean-layout">
      <h3 class="mono" style="font-size:16px; margin-bottom:8px; border-bottom:1px solid var(--border); padding-bottom:6px;">Review Grid Analysis</h3>
      ${statsHtml}

      <div style="background:rgba(255,149,0,.08); border:1px solid rgba(255,149,0,.25); border-radius:8px; padding:12px; margin-bottom:10px; max-height:160px; overflow-y:auto;">
        <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--orange); margin-bottom:6px;">Missed — Current Question (${missed.length})</div>
        ${missedHtml}
      </div>

      <div style="background:rgba(255,59,48,.05); border:1px solid rgba(255,59,48,.2); border-radius:8px; padding:12px; margin-bottom:10px; max-height:130px; overflow-y:auto;">
        <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--danger); margin-bottom:6px;">Wrong Guesses This Question (${wrongThisQ.length})</div>
        ${wrongQHtml}
      </div>

      <div style="background:rgba(255,59,48,.03); border:1px solid rgba(255,59,48,.15); border-radius:8px; padding:12px; max-height:160px; overflow-y:auto;">
        <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:var(--danger); margin-bottom:6px;">All Session Wrong Guesses — Persists in Save (${sessWords.length} unique)</div>
        ${sessHtml}
      </div>

      <button class="btn btn-p" style="width:100%; margin-top:14px;" onclick="renderActiveQuiz()">Back to Quiz</button>
    </div>`;
}

function renderActiveQuiz() {
  const qJsonStr = Module.getCurrentQuestionJson();
  if (qJsonStr === "{}" || !qJsonStr) return;
  const q = JSON.parse(qJsonStr);
  const prog = JSON.parse(Module.getProgressJson());
  renderQuizUI(q, prog);
}

// ─── Input validation ─────────────────────────────────────────────────
function updateQuizButtonText() {
  const inp = document.getElementById('qAnswerInput');
  const btn = document.getElementById('qActionButton');
  if (!inp || !btn) return;
  if (inp.value.trim()) { btn.innerText = "Submit"; btn.onclick = submitUserAnswer; }
  else { btn.innerText = "Check Answers ✓"; btn.onclick = handleCheck; }
}

function onQuizInput() {
  updateQuizButtonText();
  const inp = document.getElementById('qAnswerInput');
  if (!inp || !cppInitialized) return;
  const quizType = parseInt(document.getElementById('qTypeSelect')?.value || "0");
  if (quizType !== 0) return;
  const qJsonStr = Module.getCurrentQuestionJson();
  if (!qJsonStr || qJsonStr === '{}') return;
  const q = JSON.parse(qJsonStr);
  if (q.checked) return;
  const typed = inp.value.toUpperCase();
  if (!typed) return;
  const available = {};
  for (const c of q.questionText) available[c] = (available[c] || 0) + 1;
  const used = {};
  for (const c of typed) {
    used[c] = (used[c] || 0) + 1;
    if (used[c] > (available[c] || 0)) {
      inp.value = typed.slice(0, -1);
      inp.classList.remove('shake-input'); void inp.offsetWidth; inp.classList.add('shake-input');
      setTimeout(() => inp.classList.remove('shake-input'), 350);
      toast(`⚠️ "${c}" not in tiles!`, '');
      updateQuizButtonText(); return;
    }
  }
}

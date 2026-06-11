// quiz_bridge.js — Zyzzylu v2 with Zyzzyva-compatible .zzq save/load
let cppInitialized = false;
let timerInterval = null;
let quizTimeLimit = 0;
let quizTimeLeft = 0;
let currentQuizPool = [];
let activeSeed1 = 0;
let activeSeed2 = 0;

// ระบบเก็บประวัติคำที่ตอบผิดในเซสชัน เพื่อบันทึกเข้าเซคชั่น <zyzzylu-session> ของไฟล์ .zzq
let sessionIncorrect = {};

// ─── WASM INITIALIZATION ──────────────────────────────────────────────
if (typeof Module !== 'undefined') {
  Module.onRuntimeInitialized = () => { 
    console.log("WASM Runtime initialized"); 
    tryInitCppEngine(); 
  };
}

async function tryInitCppEngine() {
  // แก้ไขจุดนี้: ใช้ typeof dict !== 'undefined' เพื่อป้องกัน Error หลุดระหว่างโหลดเว็บ
  if (typeof Module !== 'undefined' && Module.loadDictionary && typeof dict !== 'undefined' && dict && dict.length > 0 && !cppInitialized) {
    document.getElementById('wCnt').innerText = "Loading WASM...";
    Module.loadDictionary(dict.join('\n'));
    cppInitialized = true;
    document.getElementById('wCnt').innerText = dict.length.toLocaleString() + " Words (WASM Active)";
  }
}

const oldOnload = window.onload;
window.onload = async () => { 
  if (oldOnload) await oldOnload(); 
  tryInitCppEngine(); 
};

// ─── MWC RNG — MATCHES ZYZZYVA'S GEORGE MARSAGLIA MWC ────────────────
function createMwcRandom(s1, s2) {
  let z = Number(s1) >>> 0;
  let w = Number(s2) >>> 0;
  if (z === 0) z = 1;
  if (w === 0) w = 1;

  return () => {
    z = (((36969 * (z & 0xffff)) >>> 0) + (z >>> 16)) >>> 0;
    w = (((18000 * (w & 0xffff)) >>> 0) + (w >>> 16)) >>> 0;
    return (((z << 16) >>> 0) + (w & 0xffff)) >>> 0; 
  };
}

function shuffleMwc(array, s1, s2) {
  const rng = createMwcRandom(s1, s2);
  const a = [...array];
  const n = a.length;
  for (let i = 0; i < n - 1; i++) {
    const limit = n - i;
    const j = i + (rng() % limit); 
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── QUIZ ENGINE CONTROL ─────────────────────────────────────────────
function startQuiz() {
  if (!cppInitialized) { 
    toast("WASM Engine is still initializing. Please wait..."); 
    return; 
  }

  let pool = dict.filter(w => matchFilters(w, qFilters));
  pool = applyLimitFilters(pool, qFilters);
  if (!pool.length) { 
    toast("No words match the selected filters!"); 
    return; 
  }

  sessionIncorrect = {}; 
  activeSeed1 = Math.floor(Date.now() / 1000); 
  activeSeed2 = new Date().getMilliseconds();  

  const quizType  = parseInt(document.getElementById('qTypeSelect')?.value || "0");
  const order     = parseInt(document.getElementById('qOrderSelect')?.value || "1");
  quizTimeLimit   = parseInt(document.getElementById('qTimerSelect')?.value || "0");

  let finalPool = [...pool];
  if (order === 1) { 
    if (quizType === 0 || quizType === 1) {
      let uniq = [...new Set(pool.map(w => [...w].sort().join('')))].sort();
      let shuffledUniq = shuffleMwc(uniq, activeSeed1, activeSeed2);
      const byAlpha = {};
      pool.forEach(w => { 
        const a = [...w].sort().join(''); 
        (byAlpha[a] = byAlpha[a] || []).push(w); 
      });
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
      if (quizTimeLeft <= 0) { 
        clearInterval(timerInterval); 
        handleCheck(); 
      }
    }, 1000);
  } else {
    const el = document.getElementById('qTimerDisplay'); 
    if (el) el.innerText = "";
  }
  
  setTimeout(() => { 
    const inp = document.getElementById('qAnswerInput'); 
    if (inp) inp.focus(); 
  }, 100);
}

function handleCheck() {
  clearInterval(timerInterval);
  const q = JSON.parse(Module.getCurrentQuestionJson());
  if (q.userIncorrectAnswers) {
    q.userIncorrectAnswers.forEach(w => { 
      if (!sessionIncorrect[w]) sessionIncorrect[w] = 1; 
    });
  }
  Module.checkAnswers();
  
  const updatedQ = JSON.parse(Module.getCurrentQuestionJson());
  const prog = JSON.parse(Module.getProgressJson());
  renderQuizUI(updatedQ, prog);

  setTimeout(() => {
    const inp = document.getElementById('qAnswerInput');
    if (inp) inp.focus();
  }, 50);
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

// ─── QUIZ UI RENDERING ────────────────────────────────────────────────
function renderQuizUI(q, prog) {
  const pane = document.getElementById('qEnginePane');
  if (!pane) return;
  
  let tilesHtml = "";
  for (const ch of q.questionText) tilesHtml += `<div class="quiz-tile">${ch}</div>`;
  const pct = (prog.currentQuestion / prog.totalQuestions) * 100;

  const inputPlaceholder = q.checked ? "COMPLETED — PRESS ENTER FOR NEXT SET →" : "TYPE ANSWER & PRESS ENTER";
  const inputAction = q.checked ? "handleNext()" : "submitUserAnswer()";
  const inputModifiers = q.checked 
    ? "readonly style='text-transform:uppercase; text-align:center; font-size:18px; font-weight:600; cursor:pointer;' onclick='handleNext()'" 
    : "style='text-transform:uppercase; text-align:center; font-size:18px; font-weight:600;'";

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
          placeholder="${inputPlaceholder}"
          ${inputModifiers}
          oninput="${q.checked ? '' : 'onQuizInput()'}"
          onkeydown="if(event.key==='Enter') ${inputAction}">
      </div>
      <div class="quiz-history-pane" style="flex:1; min-height:180px; max-height:250px; margin-bottom:16px;">
        <div id="qAnswersList" style="display:flex; flex-direction:column; gap:8px;">${renderAnswersList(q)}</div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn" style="flex:1; min-width:60px;" onclick="quitQuiz()">Quit</button>
        <button class="btn" style="flex:1; min-width:70px; color:var(--orange);" onclick="saveCurrentZzq()">Save 💾</button>
        <button class="btn" style="flex:1; min-width:70px; color:#0A84FF;">Analyze</button>
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
        <button class="btn-not" onclick="toggleSavedWord('${ans.word}', this)" style="border:none; background:none; color:${star?'var(--orange)':'var(--text2)'}; font-size:16px; cursor:pointer; padding:0 4px;">${star?'★':'☆'}</button>
      </div>
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

function submitUserAnswer() {
  const inp = document.getElementById('qAnswerInput');
  if (!inp) return;
  const val = inp.value.trim().toUpperCase();
  if (!val) return;

  const q = JSON.parse(Module.getCurrentQuestionJson());
  const quizType = parseInt(document.getElementById('qTypeSelect')?.value || "0");
  const expectedLen = q.questionText.length + (quizType === 2 ? 1 : 0);
  
  if (val.length !== expectedLen) {
    inp.classList.remove('shake-input'); void inp.offsetWidth; inp.classList.add('shake-input');
    setTimeout(() => inp.classList.remove('shake-input'), 350);
    return;
  }

  inp.value = "";
  Module.submitAnswer(val);

  const updatedQ = JSON.parse(Module.getCurrentQuestionJson());
  const prog = JSON.parse(Module.getProgressJson());
  renderQuizUI(updatedQ, prog);
  document.getElementById('qAnswerInput')?.focus();
}

// ─── SAVE FUNCTION (.ZZQ GENERATOR) ──────────────────────────────────
function saveCurrentZzq() {
  if (!cppInitialized || currentQuizPool.length === 0) {
    toast("No active quiz session to save!");
    return;
  }

  let prog = { currentQuestion: 0, totalQuestions: 0, totalCorrect: 0 };
  let q = { checked: false, userCorrectAnswers: [], userIncorrectAnswers: [] };
  try {
    prog = JSON.parse(Module.getProgressJson());
    q = JSON.parse(Module.getCurrentQuestionJson());
  } catch (e) { console.error("Error fetching WASM progress states", e); }

  const qType = document.getElementById('qTypeSelect')?.value || "0";
  let typeStr = "Anagrams";
  if (qType === "1") typeStr = "Hooks";
  if (qType === "2") typeStr = "Build";

  let xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n`;
  xml += `<!DOCTYPE zyzzyva-quiz SYSTEM 'http://boshvark.com/dtd/zyzzyva-quiz.dtd'>\n`;
  xml += `<zyzzyva-quiz type="${typeStr}" question-order="Random" method="Standard" lexicon="CSW24">\n`;
  xml += ` <question-source type="search">\n`;
  xml += `  <zyzzyva-search version="1">\n`;
  xml += `   <conditions>\n`;
  xml += `    <and>\n`;

  qFilters.forEach(f => {
    let neg = f.not ? ' negated="1"' : ' negated="0"';
    if (f.type === 'length') {
      xml += `     <condition type="Length" max="${f.v2}" min="${f.v1}"${neg}/>\n`;
    } else if (f.type === 'point_value') {
      xml += `     <condition type="Point Value" max="${f.v2}" min="${f.v1}"${neg}/>\n`;
    } else if (f.type === 'begins') {
      xml += `     <condition type="Begins With" string="${f.v1.toUpperCase()}"${neg}/>\n`;
    } else if (f.type === 'ends') {
      xml += `     <condition type="Ends With" string="${f.v1.toUpperCase()}"${neg}/>\n`;
    } else if (f.type === 'includes') {
      xml += `     <condition type="Includes Letters" string="${f.v1.toUpperCase()}"${neg}/>\n`;
    }
  });

  xml += `    </and>\n`;
  xml += `   </conditions>\n`;
  xml += `  </zyzzyva-search>\n`;
  xml += ` </question-source>\n`;
  xml += ` <randomizer seed="${activeSeed1}" algorithm="1" seed2="${activeSeed2}"/>\n`;
  
  const qComp = q.checked ? "true" : "false";
  xml += ` <progress question="${prog.currentQuestion}" total-questions="${prog.totalQuestions}" correct="${prog.totalCorrect}" question-complete="${qComp}" correct-questions="${prog.totalCorrect}">\n`;
  
  if (q.userCorrectAnswers && q.userCorrectAnswers.length > 0) {
    xml += `  <question-correct-responses>\n`;
    q.userCorrectAnswers.forEach(w => { xml += `   <response word="${w}"/>\n`; });
    xml += `  </question-correct-responses>\n`;
  }
  
  if (q.userIncorrectAnswers && q.userIncorrectAnswers.length > 0) {
    xml += `  <incorrect-responses>\n`;
    q.userIncorrectAnswers.forEach(w => { xml += `   <response word="${w}"/>\n`; });
    xml += `  </incorrect-responses>\n`;
  }

  xml += ` </progress>\n`;
  xml += `</zyzzyva-quiz>\n`;

  const blob = new Blob([xml], { type: "text/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Zyzzylu_Quiz_${activeSeed1}.zzq`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("Quiz Session saved successfully! 💾");
}

// ─── LOAD FUNCTION ───────────────────────────────────────────────────
function loadZzq(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const content = e.target.result.trim();
    try {
      if (!content.startsWith("<?xml")) return;

      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(content, "text/xml");
      const quizNode = xmlDoc.querySelector('zyzzyva-quiz');
      if (!quizNode) return;

      const typeAttr = quizNode.getAttribute('type') || "Anagrams";
      let typeVal = "0";
      if (typeAttr.toLowerCase().includes("hook")) typeVal = "1";
      else if (typeAttr.toLowerCase().includes("build")) typeVal = "2";
      document.getElementById('qTypeSelect').value = typeVal;

      const rNode = xmlDoc.getElementsByTagName("randomizer")[0];
      activeSeed1 = parseInt(rNode?.getAttribute("seed") || "1");
      activeSeed2 = parseInt(rNode?.getAttribute("seed2") || "1");

      const condNodes = xmlDoc.querySelectorAll('condition');
      let pool = [];
      if (condNodes.length > 0) {
        qFilters.length = 0;
        condNodes.forEach(cond => {
          const negated = (cond.getAttribute('negated') === '1');
          const typeRaw = cond.getAttribute('type') || '';
          const typeN = typeRaw.replace(/\s+/g, '').toLowerCase();
          let ft = '', v1 = '', v2 = '';

          if      (typeN === 'length')           { ft='length';      v1=cond.getAttribute('min'); v2=cond.getAttribute('max'); }
          else if (typeN === 'pointvalue')       { ft='point_value'; v1=cond.getAttribute('min'); v2=cond.getAttribute('max'); }
          else if (typeN === 'beginswith')       { ft='begins';      v1=cond.getAttribute('string'); }
          else if (typeN === 'endswith')         { ft='ends';        v1=cond.getAttribute('string'); }
          else if (typeN === 'includesletters')  { ft='includes';    v1=cond.getAttribute('string'); }

          if (ft) { fId++; qFilters.push({ id: fId, type: ft, v1, v2, not: negated }); }
        });
        renderFilters('Q');
        if (typeof dict !== 'undefined' && dict.length > 0) {
          pool = dict.filter(w => matchFilters(w, qFilters));
          pool = applyLimitFilters(pool, qFilters);
        }
      }

      if (!pool.length) return;

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
      Module.generateQuiz(parseInt(typeVal), orderedWords.join(' '), 3);

      const progressNode = xmlDoc.querySelector('progress');
      if (progressNode) {
        const savedQIdx      = parseInt(progressNode.getAttribute('question') || '0');
        const savedCorrect   = parseInt(progressNode.getAttribute('correct') || '0');
        const savedQComplete = progressNode.getAttribute('question-complete') === 'true';
        const savedCQ        = parseInt(progressNode.getAttribute('correct-questions') || '0');

        let userCorrect = [], userIncorrect = [];
        progressNode.querySelector('question-correct-responses')?.querySelectorAll('response').forEach(r => userCorrect.push(r.getAttribute('word').toUpperCase()));
        progressNode.querySelector('incorrect-responses')?.querySelectorAll('response').forEach(r => userIncorrect.push(r.getAttribute('word').toUpperCase()));

        Module.restoreProgress(savedQIdx, savedCorrect, 0, 0, savedCQ, userCorrect.join(' '), userIncorrect.join(' '), savedQComplete);
      }

      document.getElementById('qSettingsPane').style.display = 'none';
      document.getElementById('qEnginePane').style.display  = 'block';
      loadCurrentQuestion();
    } catch(err) { console.error("Error reading file .zzq", err); }
  };
  reader.readAsText(file);
}

function updateQuizButtonText() {
  const inp = document.getElementById('qAnswerInput');
  const btn = document.getElementById('qActionButton');
  if (!inp || !btn) return;
  if (inp.value.trim()) { btn.innerText = "Submit"; btn.onclick = submitUserAnswer; }
  else { btn.innerText = "Check Answers ✓"; btn.onclick = handleCheck; }
}

function onQuizInput() {
  updateQuizButtonText();
}

function updateTimerDisplay() {
  const el = document.getElementById('qTimerDisplay'); if (!el) return;
  const m = Math.floor(quizTimeLeft/60), s = quizTimeLeft%60;
  el.innerText = `⏱ ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

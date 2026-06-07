let qState = { 
  pool: [], rawWords: [], rack: '', sol: [], 
  correctAnswers: [], incorrectAttempts: [],
  userSkipped: false, setsDone: 0,
  analysis: null 
};

function startQuiz() {
  let p = dict.filter(w => matchFilters(w, qFilters));
  if (!p.length) { alert("No pools found matching criteria"); return; }
  qState.rawWords = p; 
  let uniquePool = Array.from(new Set(p.map(w => [...w].sort().join('')))); 
  
  qState.pool = standardShuffle(uniquePool); // สุ่มอิสระทันทีแบบกระจายตัว
  qState.setsDone = 0;
  qState.analysis = null; 
  document.getElementById('qSettingsPane').style.display = 'none'; 
  document.getElementById('qEnginePane').style.display = 'block';
  nextQ();
}

function quitQuiz() {
  qState.rawWords = []; qState.pool = []; qState.setsDone = 0; qState.analysis = null;
  document.getElementById('qEnginePane').style.display = 'none'; 
  document.getElementById('qSettingsPane').style.display = 'block';
}

function nextQ() {
  qState.correctAnswers = []; qState.incorrectAttempts = []; qState.userSkipped = false;
  let currentRack = qState.pool[qState.setsDone]; 
  qState.rack = currentRack;
  qState.sol = dict.filter(w => w.length === currentRack.length && [...w].sort().join('') === currentRack);
  renderQuiz();
}

function updateQuizButton() {
  let inp = document.getElementById('qInp');
  let btn = document.getElementById('qActionBtn');
  if (!inp || !btn) return;
  let isComplete = (qState.correctAnswers.length === qState.sol.length) || qState.userSkipped;
  let isLast = (qState.setsDone === qState.pool.length - 1);
  if (isComplete) btn.innerText = isLast ? "Analyze" : "Next";
  else btn.innerText = inp.value.trim() ? "Submit" : "Check Answer";
}

function renderQuiz() {
  let isComplete = (qState.correctAnswers.length === qState.sol.length) || qState.userSkipped;
  let isLast = (qState.setsDone === qState.pool.length - 1);
  let actionText = isComplete ? (isLast ? "Analyze" : "Next") : "Check Answer";

  let historyHtml = qState.correctAnswers.map(w => {
    let hk = getHooksAndDots(w);
    return `<div class="mono" style="font-size:14px; color:var(--accent); padding:2px 0;">✓ (${hk.f}) <b>${w}</b> (${hk.b})</div>`;
  }).join('');

  let revealHtml = qState.userSkipped ? qState.sol.filter(w => !qState.correctAnswers.includes(w)).map(w => {
    let hk = getHooksAndDots(w);
    return `<div class="mono" style="font-size:14px; color:var(--orange); padding:2px 0;">• (${hk.f}) <b>${w}</b> (${hk.b}) [Missed]</div>`;
  }).join('') : "";

  document.getElementById('qEnginePane').innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
      <div class="mono" style="font-size:12px; color:var(--text2)">POOL: ${qState.setsDone + 1} / ${qState.pool.length}</div>
      <div class="mono" style="font-size:14px; color:var(--accent); font-weight:700;">${qState.correctAnswers.length} / ${qState.sol.length}</div>
    </div>
    <div class="mono" style="font-size:34px; font-weight:700; text-align:center; margin:12px 0; letter-spacing:5px;">${qState.rack}</div>
    <div class="q-clean-layout">
      <div class="quiz-history-pane" id="qHistBox" style="${(qState.correctAnswers.length || qState.userSkipped) ? '' : 'display:none;'}">
        ${historyHtml}${revealHtml}
      </div>
      <input type="text" id="qInp" class="input-field mono" style="text-align:center;" placeholder="${isComplete ? 'Press Next to proceed...' : 'Type answer...'}" ${isComplete ? 'disabled' : ''} oninput="updateQuizButton()" onkeydown="if(event.key==='Enter')handleQuizAction()">
      <div style="display:flex; gap:8px;">
        <button class="btn btn-p" id="qActionBtn" style="flex:1; color:#fff;" onclick="handleQuizAction()">${actionText}</button>
        <button class="btn" style="flex:1; color:var(--orange);" onclick="analyzeQuizSet(false)">ANALYZE</button>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn" style="flex:1; color:var(--orange);" onclick="saveCurrentZzq()">💾 SAVE</button>
        <button class="btn" style="flex:1; color:var(--danger);" onclick="quitQuiz()">❌ QUIT</button>
      </div>
    </div>
  `;
  if (!isComplete) setTimeout(() => document.getElementById('qInp').focus(), 50);
}

function handleQuizAction() {
  let isComplete = (qState.correctAnswers.length === qState.sol.length) || qState.userSkipped;
  let isLast = (qState.setsDone === qState.pool.length - 1);
  if (isComplete) { if (isLast) analyzeQuizSet(true); else { qState.setsDone++; nextQ(); } return; }

  let inp = document.getElementById('qInp');
  let v = inp.value.trim().toUpperCase();
  if (!v) { qState.userSkipped = true; toast("Revealing Pool..."); renderQuiz(); return; }
  
  if (qState.sol.includes(v)) { if (!qState.correctAnswers.includes(v)) qState.correctAnswers.push(v); } 
  else { if (!qState.incorrectAttempts.includes(v)) qState.incorrectAttempts.push(v); }
  inp.value = ''; renderQuiz();
}

function analyzeQuizSet(isGameOver = false) {
  let corrected = [], skipped = [], invalidated = [];
  qState.sol.forEach(w => {
    if (qState.correctAnswers.includes(w)) { if (qState.incorrectAttempts.length > 0) invalidated.push(w); else corrected.push(w); } 
    else skipped.push(w);
  });

  let correctHtml = corrected.map(w => `<div style="color:var(--accent)">✓ ${w}</div>`).join('') || '<div>None</div>';
  let skippedHtml = skipped.map(w => `<div style="color:var(--orange)">• ${w}</div>`).join('') || '<div>None</div>';
  let incorrectHtml = qState.incorrectAttempts.map(w => `<div style="color:var(--danger)">✕ ${w}</div>`).join('') + invalidated.map(w => `<div style="color:var(--danger)">⚠ ${w} (Invalidated)</div>`).join('');

  let legacyHistoryHtml = (qState.analysis && qState.analysis.incorrectHistory.length > 0) ? `
    <div style="margin-top:10px; border-top:1px dashed var(--border); padding-top:10px;">
      <div style="color:var(--danger); font-weight:700;">INCORRECT HISTORY:</div>
      ${qState.analysis.incorrectHistory.map(h => `<div style="color:var(--text2)">⚠️ ${h.word} (${h.count} times)</div>`).join('')}
    </div>` : "";

  let footerBtnHtml = isGameOver ? `<button class="btn" style="width:100%; margin-top:14px; color:var(--danger); border-color:var(--danger);" onclick="quitQuiz()">GAME OVER — QUIT</button>` : `<button class="btn btn-p" style="width:100%; margin-top:14px;" onclick="renderQuiz()">BACK TO QUIZ</button>`;

  document.getElementById('qEnginePane').innerHTML = `
    <h3 class="mono" style="font-size:15px; margin-bottom:12px; border-bottom:1px solid var(--border); padding-bottom:6px;">Review Grid Analysis</h3>
    <div class="mono" style="font-size:12px; display:flex; flex-direction:column; gap:12px; max-height:280px; overflow-y:auto; background:#000; padding:10px; border-radius:6px;">
      <div><div style="color:var(--text2); font-weight:700;">CORRECT:</div>${correctHtml}</div>
      <div><div style="color:var(--text2); font-weight:700;">MISSED:</div>${skippedHtml}</div>
      <div><div style="color:var(--text2); font-weight:700;">ERRORS:</div>${incorrectHtml || '<div>None</div>'}</div>
      ${legacyHistoryHtml}
    </div>${footerBtnHtml}
  `;
}

function saveCurrentZzq() {
  if (!qState.rawWords.length) return;
  let fName = prompt("ชื่อไฟล์ควิซ:", "zyzzylu_quiz"); if (fName === null) return;
  fName = fName.trim() || "zyzzylu_quiz"; if (!fName.toLowerCase().endsWith(".zzq")) fName += ".zzq";
  let totalW = qState.rawWords.length;
  let xml = [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<!DOCTYPE zyzzyva-quiz SYSTEM \'http://boshvark.com/dtd/zyzzyva-quiz.dtd\'>',
    '<zyzzyva-quiz method="Standard" lexicon="CSW24" question-order="Random" type="Anagrams">',
    ' <question-source type="search"><zyzzyva-search version="1"><conditions><and><condition max="15" min="2" type="Length"/></and></conditions></zyzzyva-search></question-source>',
    ' <randomizer algorithm="1" seed="1725958103" seed2="244"/>',
    ` <progress question-complete="true" correct-questions="${totalW}" total-questions="${totalW}" correct="${totalW}" question="${totalW}"><question-correct-responses>`
  ];
  qState.rawWords.forEach(w => xml.push(`   <response word="${w}"/>`));
  xml.push('  </question-correct-responses></progress></zyzzyva-quiz>');

  let blob = new Blob([xml.join("\r\n")], { type: "application/octet-stream" });
  let a = document.createElement("a"); a.download = fName; a.href = window.URL.createObjectURL(blob);
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  toast(`Saved ${fName}`);
}

function createSeedableRandom(s1, s2) {
  let seed1 = Number(s1) || 0, seed2 = Number(s2) || 0;
  return () => { seed1 = (Math.imul(seed1, 1664525) + 1013904223) >>> 0; seed2 = (Math.imul(seed2, 1103515245) + 12345) >>> 0; return ((seed1 ^ seed2) >>> 0) / 4294967296; };
}
function shuffleWithSeed(array, s1, s2) {
  let rnd = createSeedableRandom(s1, s2), shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) { let j = Math.floor(rnd() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  return shuffled;
}
function standardShuffle(array) {
  let shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) { let j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  return shuffled;
}

function loadZzq(e) {
  let f = e.target.files[0]; if (!f) return;
  let r = new FileReader();
  r.onload = (x) => {
    try {
      let content = x.target.result.trim();
      if (!content.startsWith("<?xml")) {
        let loaded = content.split(/\r?\n/).map(w => w.trim().toUpperCase()).filter(w => dictSet.has(w));
        if (!loaded.length) return;
        qState.rawWords = loaded;
        qState.pool = standardShuffle(Array.from(new Set(loaded.map(w => [...w].sort().join('')))));
        qState.setsDone = 0; qState.analysis = null;
        document.getElementById('qSettingsPane').style.display = 'none'; document.getElementById('qEnginePane').style.display = 'block';
        nextQ(); toast(` Loaded Plain Words`); return;
      }
      let xmlDoc = (new DOMParser()).parseFromString(content, "text/xml");
      let conditions = xmlDoc.getElementsByTagName("condition");
      if (conditions.length > 0) {
        qFilters = [];
        for (let i = 0; i < conditions.length; i++) {
          let cond = conditions[i], zType = cond.getAttribute("type"), item = { id: i+1, type: "", v1: "", v2: "", not: cond.getAttribute("negated") === "1" };
          if (zType === "Length") { item.type = "length"; item.v1 = cond.getAttribute("min"); item.v2 = cond.getAttribute("max"); }
          else if (zType === "Includes Letters") { item.type = "includes"; item.v1 = cond.getAttribute("string"); }
          else if (zType === "Begins With") { item.type = "begins"; item.v1 = cond.getAttribute("string"); }
          else if (zType === "Ends With") { item.type = "ends"; item.v1 = cond.getAttribute("string"); }
          else continue;
          qFilters.push(item);
        }
        renderFilters('Q');
      }
      let matched = dict.filter(w => matchFilters(w, qFilters));
      let progressNode = xmlDoc.getElementsByTagName("progress")[0];
      qState.analysis = { pastCorrectCount: progressNode ? parseInt(progressNode.getAttribute("correct")) : 0, incorrectHistory: [] };
      let rNode = xmlDoc.getElementsByTagName("randomizer")[0];
      let s1 = rNode ? rNode.getAttribute("seed") : null, s2 = rNode ? rNode.getAttribute("seed2") : null;
      qState.rawWords = matched;
      let uniquePool = Array.from(new Set(matched.map(w => [...w].sort().join(''))));
      qState.pool = (s1 && s2) ? shuffleWithSeed(uniquePool, s1, s2) : standardShuffle(uniquePool);
      qState.setsDone = 0;
      document.getElementById('qSettingsPane').style.display = 'none'; document.getElementById('qEnginePane').style.display = 'block';
      nextQ(); toast(` Loaded .zzq Quiz`);
    } catch (err) { alert("XML Error"); }
  };
  r.readAsText(f);
}

// quiz.js
let qState = { 
  pool: [], rawWords: [], rack: '', sol: [], 
  correctAnswers: [], incorrectAttempts: [],
  userSkipped: false, setsDone: 0,
  analysis: null,
  lastFeedback: null,
  incorrectHistory: {},  // { word: count } สะสมข้าม pool ทั้ง session
  zzqSeed1: null, zzqSeed2: null  // seed จากไฟล์ .zzq ที่โหลดมา
};

function startQuiz() {
  let p = dict.filter(w => matchFilters(w, qFilters));
  if (!p.length) { alert("No pools found matching criteria"); return; }
  qState.rawWords = p; 
  let uniquePool = Array.from(new Set(p.map(w => [...w].sort().join('')))); 
  
  qState.pool = standardShuffle(uniquePool); 
  qState.setsDone = 0;
  qState.analysis = null;
  qState.incorrectHistory = {};
  qState.zzqSeed1 = null; qState.zzqSeed2 = null;
  document.getElementById('qSettingsPane').style.display = 'none'; 
  document.getElementById('qEnginePane').style.display = 'block';
  nextQ();
}

function quitQuiz() {
  qState.rawWords = []; qState.pool = []; qState.setsDone = 0; qState.analysis = null; qState.lastFeedback = null; qState.incorrectHistory = {}; qState.zzqSeed1 = null; qState.zzqSeed2 = null;
  document.getElementById('qEnginePane').style.display = 'none'; 
  document.getElementById('qSettingsPane').style.display = 'block';
}

function nextQ() {
  // สะสม incorrectAttempts ของ pool ที่เพิ่งจบลงใน incorrectHistory ก่อน reset
  qState.incorrectAttempts.forEach(w => {
    qState.incorrectHistory[w] = (qState.incorrectHistory[w] || 0) + 1;
  });
  qState.correctAnswers = []; qState.incorrectAttempts = []; qState.userSkipped = false;
  qState.lastFeedback = null; 
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

  let feedbackHtml = qState.lastFeedback 
    ? `<div class="mono" style="font-size: 11px; color: ${qState.lastFeedback.color}; text-align: center; margin-top: 4px; font-weight: 500;">${qState.lastFeedback.text}</div>` 
    : `<div style="height: 16px;"></div>`;

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
      <div>
        <input type="text" id="qInp" class="input-field mono" style="text-align:center;" placeholder="${isComplete ? 'Press Next to proceed...' : 'Type answer...'}" ${isComplete ? 'disabled' : ''} oninput="updateQuizButton()" onkeydown="if(event.key==='Enter')handleQuizAction()">
        ${feedbackHtml}
      </div>
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
  if (!v) { qState.userSkipped = true; qState.lastFeedback = null; toast("Revealing Pool..."); renderQuiz(); return; }
  
  if (qState.sol.includes(v)) { 
    if (!qState.correctAnswers.includes(v)) {
      qState.correctAnswers.push(v);
      qState.lastFeedback = { text: `✓ "${v}" is Correct`, color: 'var(--accent)' };
    } else {
      qState.lastFeedback = { text: `ℹ️ "${v}" was already found`, color: 'var(--orange)' };
    }
  } 
  else { 
    if (!qState.incorrectAttempts.includes(v)) qState.incorrectAttempts.push(v); 
    qState.lastFeedback = { text: `✕ "${v}" is Incorrect`, color: 'var(--danger)' };
  }
  inp.value = ''; 
  renderQuiz();
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

  let lengths = qState.rawWords.map(w => w.length);
  let minL = lengths.length ? Math.min(...lengths) : 2;
  let maxL = lengths.length ? Math.max(...lengths) : 15;

  // ใช้ seed เดิมที่โหลดมา เพื่อให้ Zyzzyva shuffle ลำดับ pool เดิมได้พอดี
  let seed1 = qState.zzqSeed1 || Math.floor(Date.now() / 1000);
  let seed2 = qState.zzqSeed2 || 244;

  let totalQuestions = qState.pool.length;
  let correctQuestions = qState.setsDone;
  let correctWords = qState.correctAnswers.length;

  // รวม incorrect history: สะสมข้าม pool + pool ปัจจุบัน
  let allIncorrect = { ...(qState.incorrectHistory || {}) };
  qState.incorrectAttempts.forEach(w => { allIncorrect[w] = (allIncorrect[w] || 0) + 1; });

  let xml = [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<!DOCTYPE zyzzyva-quiz SYSTEM \'http://boshvark.com/dtd/zyzzyva-quiz.dtd\'>',
    `<!-- zyzzylu-pool-order: ${qState.pool.join(',')} -->`,
    '<zyzzyva-quiz method="Standard" lexicon="CSW24" question-order="Random" type="Anagrams">',
    ` <question-source type="search"><zyzzyva-search version="1"><conditions><and><condition min="${minL}" max="${maxL}" type="Length"/></and></conditions></zyzzyva-search></question-source>`,
    ` <randomizer algorithm="1" seed="${seed1}" seed2="${seed2}"/>`,
    ` <progress correct-questions="${correctQuestions}" question="${correctQuestions}" correct="${correctWords}" question-complete="false" total-questions="${totalQuestions}">`
  ];

  // <incorrect-responses> คำผิดสะสมทั้งหมด พร้อม count
  let incorrectEntries = Object.entries(allIncorrect);
  if (incorrectEntries.length > 0) {
    xml.push('  <incorrect-responses>');
    incorrectEntries.forEach(([w, cnt]) => xml.push(`   <response word="${w}" count="${cnt}"/>`));
    xml.push('  </incorrect-responses>');
  }

  // <question-correct-responses> เฉพาะคำถูกใน pool ปัจจุบันเท่านั้น
  if (qState.correctAnswers.length > 0) {
    xml.push('  <question-correct-responses>');
    qState.correctAnswers.forEach(w => xml.push(`   <response word="${w}"/>`));
    xml.push('  </question-correct-responses>');
  }

  xml.push(' </progress>');
  xml.push('</zyzzyva-quiz>');

  let blob = new Blob([xml.join("\r\n")], { type: "application/octet-stream" });
  let a = document.createElement("a"); a.download = fName; a.href = window.URL.createObjectURL(blob);
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  toast(`Saved ${fName} (pool ${correctQuestions + 1}/${totalQuestions})`);
}

// Marsaglia MWC (Multiply-With-Carry) — ตรงกับ Rand.cpp ของ Zyzzyva
function zyzzyvaRng(z, w) {
  z = ((36969 * (z & 0xFFFF) + (z >>> 16)) >>> 0);
  w = ((18000 * (w & 0xFFFF) + (w >>> 16)) >>> 0);
  return { z, w, val: (((z << 16) >>> 0) + w) >>> 0 };
}
function zyzzyvaRand(z, w, maxVal) {
  let r = zyzzyvaRng(z, w);
  if (maxVal === 0) return { z: r.z, w: r.w, result: 0 };
  // Zyzzyva: randnum / ((0xFFFFFFFF / (max+1)) + 1)
  let result = Math.floor(r.val / (Math.floor(0xFFFFFFFF / (maxVal + 1)) + 1));
  return { z: r.z, w: r.w, result };
}
// Shuffle แบบ Zyzzyva: forward (i=0→n-2), swap arr[i] กับ arr[i+randnum]
function shuffleWithSeed(array, s1, s2) {
  let shuffled = [...array];
  let z = (Number(s1) >>> 0), w = (Number(s2) >>> 0);
  let n = shuffled.length;
  for (let i = 0; i < n - 1; i++) {
    let r = zyzzyvaRand(z, w, n - i - 1);
    z = r.z; w = r.w;
    let rnum = i + r.result;
    [shuffled[i], shuffled[rnum]] = [shuffled[rnum], shuffled[i]];
  }
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
      
      // ดึงคำ wordlist จาก <question-source> ผ่าน <question-correct-responses> ระดับบนสุดเท่านั้น
      // ต้องแยกออกจาก <incorrect-responses> และ <question-correct-responses> ใน <progress>
      // ไฟล์จากเว็บของเราจะไม่มี explicit word list → ใช้ fallback กรองจาก dictionary
      // ไฟล์เก่าที่ยัดคำทั้งหมดไว้ → ดึงจาก <question-correct-responses> นอก <progress> เท่านั้น
      let explicitWords = [];
      let progressNode0 = xmlDoc.getElementsByTagName("progress")[0];
      // หา <question-correct-responses> ที่เป็น direct child ของ root (ไม่ใช่ใน <progress>)
      let allQcr = xmlDoc.getElementsByTagName("question-correct-responses");
      for (let qi = 0; qi < allQcr.length; qi++) {
        if (allQcr[qi].parentNode === progressNode0) continue; // ข้ามที่อยู่ใน <progress>
        let rr = allQcr[qi].getElementsByTagName("response");
        for (let i = 0; i < rr.length; i++) {
          let w = rr[i].getAttribute("word");
          if (w) { w = w.trim().toUpperCase(); if (dictSet.has(w)) explicitWords.push(w); }
        }
      }
      
      // ถ้าในไฟล์ไม่มีคำล็อกใน response ค่อยสลับไปใช้ระบบกรองคำตามเงื่อนไข (Fallback)
      if (explicitWords.length === 0) {
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
        explicitWords = dict.filter(w => matchFilters(w, qFilters));
      }
      
      if (!explicitWords.length) { alert("No valid words found in this quiz file."); return; }

      let progressNode = progressNode0;  // reuse — already fetched above
      let rNode = xmlDoc.getElementsByTagName("randomizer")[0];
      let s1 = rNode ? rNode.getAttribute("seed") : null, s2 = rNode ? rNode.getAttribute("seed2") : null;

      // เก็บ seed ไว้ เพื่อให้ตอน save ใช้ seed เดิม → Zyzzyva shuffle ลำดับเดิม
      qState.zzqSeed1 = s1 ? Number(s1) : null;
      qState.zzqSeed2 = s2 ? Number(s2) : null;

      // restore progress
      let savedQuestion = progressNode ? parseInt(progressNode.getAttribute("question")) || 0 : 0;
      let savedCorrectWords = progressNode ? parseInt(progressNode.getAttribute("correct")) || 0 : 0;

      // restore incorrect history จาก <incorrect-responses>
      let incorrectHistory = {};
      let incNodes = xmlDoc.getElementsByTagName("incorrect-responses");
      if (incNodes.length > 0) {
        let incResponses = incNodes[0].getElementsByTagName("response");
        for (let i = 0; i < incResponses.length; i++) {
          let w = incResponses[i].getAttribute("word");
          let cnt = parseInt(incResponses[i].getAttribute("count")) || 1;
          if (w) incorrectHistory[w.toUpperCase()] = cnt;
        }
      }

      // restore คำถูกใน pool ปัจจุบัน จาก <question-correct-responses> (child ของ progress)
      let currentCorrectAnswers = [];
      if (progressNode) {
        let qcrNodes = progressNode.getElementsByTagName("question-correct-responses");
        if (qcrNodes.length > 0) {
          let qcrResponses = qcrNodes[0].getElementsByTagName("response");
          for (let i = 0; i < qcrResponses.length; i++) {
            let w = qcrResponses[i].getAttribute("word");
            if (w && dictSet.has(w.toUpperCase())) currentCorrectAnswers.push(w.toUpperCase());
          }
        }
      }

      qState.rawWords = explicitWords;
      let uniquePool = Array.from(new Set(explicitWords.map(w => [...w].sort().join(''))));

      // ลอง restore pool order จาก comment ที่เว็บฝังไว้ก่อน
      // ถ้าไม่มี (ไฟล์มาจาก Zyzzyva โดยตรง) ค่อย shuffle ตาม seed
      let poolOrderComment = content.match(/<!--\s*zyzzylu-pool-order:\s*([A-Z,]+)\s*-->/);
      if (poolOrderComment) {
        let savedPool = poolOrderComment[1].split(',').filter(rack => uniquePool.includes(rack));
        // เติมส่วนที่หายไป (ถ้า dict เปลี่ยน) ต่อท้าย
        let missing = uniquePool.filter(r => !savedPool.includes(r));
        qState.pool = [...savedPool, ...missing];
      } else {
        qState.pool = (s1 && s2) ? shuffleWithSeed(uniquePool, s1, s2) : standardShuffle(uniquePool);
      }
      qState.setsDone = Math.min(savedQuestion, qState.pool.length - 1);
      qState.incorrectHistory = incorrectHistory;
      qState.analysis = { pastCorrectCount: savedCorrectWords, incorrectHistory: Object.entries(incorrectHistory).map(([word, count]) => ({ word, count })) };

      document.getElementById('qSettingsPane').style.display = 'none';
      document.getElementById('qEnginePane').style.display = 'block';

      // โหลด pool ปัจจุบัน พร้อม restore คำที่ตอบถูกไปแล้ว
      qState.correctAnswers = currentCorrectAnswers;
      qState.incorrectAttempts = [];
      qState.userSkipped = false;
      qState.lastFeedback = null;
      let currentRack = qState.pool[qState.setsDone];
      qState.rack = currentRack;
      qState.sol = dict.filter(w => w.length === currentRack.length && [...w].sort().join('') === currentRack);
      renderQuiz();

      let resumeMsg = savedQuestion > 0 ? ` (ต่อจาก pool ${savedQuestion + 1}/${qState.pool.length})` : '';
      toast(`Loaded .zzq Quiz (${explicitWords.length} Words)${resumeMsg}`);
    } catch (err) { alert("XML Error"); }
  };
  r.readAsText(f);
}

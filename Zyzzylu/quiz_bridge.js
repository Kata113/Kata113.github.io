// quiz_bridge.js
let cppInitialized = false;
let timerInterval = null;
let quizTimeLimit = 0; // 0 means no timer
let quizTimeLeft = 0;
let currentQuizPool = []; // Stores the active list of words for saving
let activeSeed1 = 0;
let activeSeed2 = 0;
let sessionIncorrectAnswers = []; // Accumulates wrong guesses across ALL questions in this session

// Listen for WebAssembly runtime initialized
if (typeof Module !== 'undefined') {
  Module.onRuntimeInitialized = () => {
    console.log("WASM Runtime initialized");
    tryInitCppEngine();
  };
}

// Check if we can initialize C++ dictionary
async function tryInitCppEngine() {
  if (typeof Module !== 'undefined' && Module.loadDictionary && dict && dict.length > 0 && !cppInitialized) {
    console.log("Loading dictionary into C++ WASM engine...");
    document.getElementById('wCnt').innerText = "Loading WASM...";
    
    // Pass the entire dictionary as a newline-separated string
    const dictString = dict.join('\n');
    Module.loadDictionary(dictString);
    
    cppInitialized = true;
    document.getElementById('wCnt').innerText = dict.length.toLocaleString() + " Words (WASM Active)";
    console.log("C++ WASM Engine initialized successfully.");
  }
}

// Hook into core.js window.onload completion
const oldOnload = window.onload;
window.onload = async () => {
  if (oldOnload) await oldOnload();
  tryInitCppEngine();
};

// Seedable Random and Shuffler logic from quiz1.js
function createSeedableRandom(s1, s2) {
  let seed1 = Number(s1) || 0, seed2 = Number(s2) || 0;
  return () => {
    seed1 = (Math.imul(seed1, 1664525) + 1013904223) >>> 0;
    seed2 = (Math.imul(seed2, 1103515245) + 12345) >>> 0;
    return ((seed1 ^ seed2) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed(array, s1, s2) {
  let rnd = createSeedableRandom(s1, s2);
  let shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    let j = Math.floor(rnd() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function standardShuffle(array) {
  let shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Seedable Random and Shuffler logic matching Zyzzyva MWC (George Marsaglia Multiply-with-carry)
function createMwcRandom(s1, s2) {
  let z = Number(s1) >>> 0;
  let w = Number(s2) >>> 0;
  if (z === 0) z = 1;
  if (w === 0) w = 1;
  return () => {
    z = (36969 * (z & 65535) + (z >>> 16)) >>> 0;
    w = (18000 * (w & 65535) + (w >>> 16)) >>> 0;
    return ((z << 16) + w) >>> 0;
  };
}

function shuffleMwc(array, s1, s2) {
  let nextRand = createMwcRandom(s1, s2);
  let shuffled = [...array];
  let n = shuffled.length;
  for (let i = 0; i < n - 1; i++) {
    let limit = n - i;
    let val = nextRand();
    let j = i + Math.floor((val * limit) / 4294967296);
    let temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }
  return shuffled;
}

// Start a quiz session
function startQuiz() {
  if (!cppInitialized) {
    toast("WASM Engine is still initializing. Please wait...");
    return;
  }

  // Filter dictionary based on quiz filters
  let pool = dict.filter(w => matchFilters(w, qFilters));
  pool = applyLimitFilters(pool, qFilters);
  if (pool.length === 0) {
    toast("No words match the selected filters!");
    return;
  }

  sessionIncorrectAnswers = []; // Reset session wrong-guess list on new quiz
  activeSeed1 = Math.floor(Date.now() / 1000);
  activeSeed2 = Math.floor(Math.random() * 65535) + 1;

  const quizType = parseInt(document.getElementById('qTypeSelect')?.value || "0");
  const order = parseInt(document.getElementById('qOrderSelect')?.value || "1");
  quizTimeLimit = parseInt(document.getElementById('qTimerSelect')?.value || "0");

  let finalPool = [...pool];
  let finalOrder = order;

  if (order === 1) { // Random
    if (quizType === 0 || quizType === 1) {
      let uniquePool = Array.from(new Set(pool.map(w => [...w].sort().join(''))));
      uniquePool.sort(); // Sort alphabetically to match Zyzzyva before shuffling
      let shuffledUnique = shuffleMwc(uniquePool, activeSeed1, activeSeed2);
      
      let wordsByAlphagram = {};
      pool.forEach(w => {
        let alphaG = [...w].sort().join('');
        if (!wordsByAlphagram[alphaG]) {
          wordsByAlphagram[alphaG] = [];
        }
        wordsByAlphagram[alphaG].push(w);
      });
      
      let orderedWords = [];
      shuffledUnique.forEach(alphaG => {
        let matches = wordsByAlphagram[alphaG];
        if (matches) {
          orderedWords.push(...matches);
        }
      });
      finalPool = orderedWords;
    } else { // Build quiz shuffles base words directly
      finalPool = shuffleMwc(pool, activeSeed1, activeSeed2);
    }
    finalOrder = 3; // PreserveOrder in C++
  }

  // Save active pool
  currentQuizPool = finalPool;

  // Call C++ to generate quiz
  Module.generateQuiz(quizType, finalPool.join(' '), finalOrder);

  // Switch UI panels
  document.getElementById('qSettingsPane').style.display = 'none';
  document.getElementById('qEnginePane').style.display = 'block';

  loadCurrentQuestion();
}

// Load and render current question
function loadCurrentQuestion() {
  clearInterval(timerInterval);
  
  const qJsonStr = Module.getCurrentQuestionJson();
  if (qJsonStr === "{}" || !qJsonStr) {
    endQuiz();
    return;
  }
  
  const q = JSON.parse(qJsonStr);
  const prog = JSON.parse(Module.getProgressJson());
  
  renderQuizUI(q, prog);
  
  // Start timer if applicable
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
    const timerEl = document.getElementById('qTimerDisplay');
    if (timerEl) timerEl.innerText = "";
  }
  
  // Focus on input
  setTimeout(() => {
    const inp = document.getElementById('qAnswerInput');
    if (inp) inp.focus();
  }, 100);
}

// Render the interactive quiz panel
function renderQuizUI(q, prog) {
  const pane = document.getElementById('qEnginePane');
  if (!pane) return;
  
  // Format question text (alphagram tiles or word)
  let tilesHtml = "";
  for (let i = 0; i < q.questionText.length; i++) {
    tilesHtml += `<div class="quiz-tile">${q.questionText[i]}</div>`;
  }
  
  const progressPercent = (prog.currentQuestion / prog.totalQuestions) * 100;
  
  pane.innerHTML = `
    <div class="q-clean-layout">
      <!-- Top header bar: Progress, Timer, Stats -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 10px;">
        <span class="mono" style="font-size: 13px; color: var(--text2)">
          Question ${prog.currentQuestion}/${prog.totalQuestions}
        </span>
        <div style="display: flex; gap: 14px; align-items: center;">
          <span class="mono" id="qTimerDisplay" style="font-weight: 700; color: var(--orange); font-size: 14px;"></span>
          <span class="mono" style="font-size: 13px; color: var(--accent); font-weight: 600;">
            ${q.correctAnswersCount}/${q.totalAnswers} found
          </span>
        </div>
      </div>
      
      <!-- Progress Bar -->
      <div style="height: 4px; width: 100%; background: var(--surface2); border-radius: 2px; overflow: hidden; margin-bottom: 15px;">
        <div style="height: 100%; width: ${progressPercent}%; background: var(--accent); transition: width 0.3s ease;"></div>
      </div>
      
      <!-- Alphagram Tiles -->
      <div style="display: flex; justify-content: center; gap: 8px; margin: 20px 0; flex-wrap: wrap;">
        ${tilesHtml}
      </div>
      
      <!-- Input Panel -->
      <div style="margin-bottom: 16px;">
        <input type="text" id="qAnswerInput" class="input-field mono" 
               style="text-transform: uppercase; text-align: center; font-size: 18px; font-weight: 600; letter-spacing: 1px;" 
               placeholder="${q.checked ? (q.correctAnswersCount === q.totalAnswers ? 'ALL ANSWERS FOUND!' : 'QUESTION CHECKED') : 'TYPE ANSWER & PRESS ENTER'}" 
               ${q.checked ? 'disabled' : ''} 
               oninput="onQuizInput()"
               onkeydown="if(event.key==='Enter') submitUserAnswer()">
      </div>
      
      <!-- Answers & Feedback List -->
      <div class="quiz-history-pane" style="flex: 1; min-height: 180px; max-height: 250px; margin-bottom: 16px;">
        <div id="qAnswersList" style="display: flex; flex-direction: column; gap: 8px;">
          ${renderAnswersList(q)}
        </div>
      </div>
      
      <!-- Control Buttons -->
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button class="btn" style="flex: 1; min-width: 60px;" onclick="quitQuiz()">Quit</button>
        <button class="btn" style="flex: 1; min-width: 70px; color: var(--orange);" onclick="saveCurrentZzq()">Save 💾</button>
        <button class="btn" style="flex: 1; min-width: 70px; color: #0A84FF;" onclick="showAnalysis()">Analyze</button>
        ${q.checked ? 
          `<button class="btn btn-p" style="flex: 2; min-width: 150px;" onclick="handleNext()">Next Question →</button>` :
          `<button class="btn btn-p" id="qActionButton" style="flex: 2; min-width: 150px;" onclick="handleCheck()">Check Answers ✓</button>`
        }
      </div>
    </div>
  `;
}

// Render answer items list (green for correct, red for missed, orange for incorrect guesses)
function renderAnswersList(q) {
  if (!q.checked) {
    if (q.userCorrectAnswers.length === 0 && q.userIncorrectAnswers.length === 0) {
      return `<p style="text-align: center; color: var(--text2); padding: 20px 0;">No answers submitted yet.</p>`;
    }
    
    let html = "";
    q.userCorrectAnswers.forEach(word => {
      const isSaved = saved.includes(word);
      html += `
        <div class="item-row" style="border-bottom: 1px solid rgba(58, 58, 60, 0.3); padding: 8px 4px;">
          <span class="mono" style="color: var(--accent); font-weight: 600;">✓ ${word}</span>
          <button class="btn-not" onclick="toggleSavedWord('${word}', this)" style="border: none; background: none; color: ${isSaved ? 'var(--orange)' : 'var(--text2)'}; font-size: 16px; cursor: pointer; padding: 0 4px;">
            ${isSaved ? '★' : '☆'}
          </button>
        </div>
      `;
    });
    
    q.userIncorrectAnswers.forEach(word => {
      html += `
        <div class="item-row" style="border-bottom: 1px solid rgba(58, 58, 60, 0.3); padding: 8px 4px; opacity: 0.8;">
          <span class="mono" style="color: var(--danger); text-decoration: line-through;">✕ ${word}</span>
          <span style="color: var(--text2); font-size: 11px;">Incorrect</span>
        </div>
      `;
    });
    
    return html;
  }
  
  let checkResults = { answers: [], incorrectAnswers: [] };
  try {
    const resStr = Module.checkAnswers();
    if (resStr && resStr !== "{}") {
      checkResults = JSON.parse(resStr);
    }
  } catch (e) {
    console.error("Failed to parse check results in renderAnswersList:", e);
  }
  if (!checkResults.answers) checkResults.answers = [];
  if (!checkResults.incorrectAnswers) checkResults.incorrectAnswers = [];
  
  let html = "";
  
  checkResults.answers.forEach(ans => {
    const isSaved = saved.includes(ans.word);
    const isCorrect = ans.status === 'correct';
    
    html += `
      <div class="item-row" style="border-bottom: 1px solid rgba(58, 58, 60, 0.3); padding: 8px 4px;">
        <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
          <span style="color: ${isCorrect ? 'var(--accent)' : 'var(--danger)'}; font-weight: 700; width: 18px;">
            ${isCorrect ? '✓' : '⊘'}
          </span>
          <span class="mono hook-box" style="font-size: 11px;">${ans.front || '-'}</span>
          <span class="mono" style="font-weight: 700; font-size: 16px; color: ${isCorrect ? 'var(--text)' : 'rgba(255, 59, 48, 0.8)'};">
            ${ans.word}
          </span>
          <span class="mono hook-box" style="font-size: 11px;">${ans.back || '-'}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 11px; color: var(--text2);">${isCorrect ? 'Correct' : 'Missed'}</span>
          <button class="btn-not" onclick="toggleSavedWord('${ans.word}', this)" style="border: none; background: none; color: ${isSaved ? 'var(--orange)' : 'var(--text2)'}; font-size: 16px; cursor: pointer; padding: 0 4px;">
            ${isSaved ? '★' : '☆'}
          </button>
        </div>
      </div>
    `;
  });
  
  checkResults.incorrectAnswers.forEach(word => {
    html += `
      <div class="item-row" style="border-bottom: 1px solid rgba(58, 58, 60, 0.3); padding: 8px 4px; opacity: 0.7;">
        <span class="mono" style="color: var(--danger); text-decoration: line-through;">✕ ${word}</span>
        <span style="color: var(--text2); font-size: 11px;">Incorrect</span>
      </div>
    `;
  });
  
  return html;
}

// Toggle saved bookmark word inside quiz
function toggleSavedWord(word, btnEl) {
  toggleSave(word);
  const isSaved = saved.includes(word);
  btnEl.style.color = isSaved ? 'var(--orange)' : 'var(--text2)';
  btnEl.innerText = isSaved ? '★' : '☆';
}

// Handle answer submission
function submitUserAnswer() {
  const inp = document.getElementById('qAnswerInput');
  if (!inp) return;
  
  const val = inp.value.trim();
  if (!val) return;
  
  const cleanVal = val.toUpperCase().trim();
  let targetWord = cleanVal;
  const firstColon = cleanVal.indexOf(':');
  if (firstColon !== -1) {
    const secondColon = cleanVal.indexOf(':', firstColon + 1);
    if (secondColon !== -1) {
      targetWord = cleanVal.substring(firstColon + 1, secondColon);
    }
  }
  
  const q = JSON.parse(Module.getCurrentQuestionJson());
  const quizType = parseInt(document.getElementById('qTypeSelect')?.value || "0");
  const expectedLen = q.questionText.length + (quizType === 2 ? 1 : 0);
  
  if (targetWord.length !== expectedLen) {
    inp.classList.remove('shake-input');
    void inp.offsetWidth; // force reflow
    inp.classList.add('shake-input');
    setTimeout(() => inp.classList.remove('shake-input'), 350);
    toast(`⚠️ Answer must be exactly ${expectedLen} letters!`, '');
    return;
  }
  
  // Snapshot incorrect count before submitting to detect new wrong answers
  const prevIncorrectCount = q.userIncorrectAnswers ? q.userIncorrectAnswers.length : 0;
  
  inp.value = "";
  
  const isNewCorrect = Module.submitAnswer(val);
  if (isNewCorrect) {
    toast("Correct!", "success");
  } else {
    // Check if a new wrong word was added (not just a duplicate correct)
    const afterQ = JSON.parse(Module.getCurrentQuestionJson());
    const newIncorrectCount = afterQ.userIncorrectAnswers ? afterQ.userIncorrectAnswers.length : 0;
    if (newIncorrectCount > prevIncorrectCount) {
      if (cleanVal && !sessionIncorrectAnswers.includes(cleanVal)) {
        sessionIncorrectAnswers.push(cleanVal);
      }
    }
  }
  
  const updatedQ = JSON.parse(Module.getCurrentQuestionJson());
  const prog = JSON.parse(Module.getProgressJson());
  renderQuizUI(updatedQ, prog);
  
  document.getElementById('qAnswerInput')?.focus();
}

// Handle click on "Check Answers"
function handleCheck() {
  clearInterval(timerInterval);
  const checkResultsJson = Module.checkAnswers();
  
  const q = JSON.parse(Module.getCurrentQuestionJson());
  const prog = JSON.parse(Module.getProgressJson());
  renderQuizUI(q, prog);
}

// Handle click on "Next"
function handleNext() {
  const hasNext = Module.nextQuestion();
  if (hasNext) {
    loadCurrentQuestion();
  } else {
    endQuiz();
  }
}

// Quit quiz session
function quitQuiz() {
  clearInterval(timerInterval);
  document.getElementById('qEnginePane').style.display = 'none';
  document.getElementById('qSettingsPane').style.display = 'block';
}

// End of quiz stats screen
function endQuiz() {
  clearInterval(timerInterval);
  const prog = JSON.parse(Module.getProgressJson());
  const pane = document.getElementById('qEnginePane');
  if (!pane) return;
  
  const totalGuesses = prog.totalCorrect + prog.totalMissed;
  const accuracy = totalGuesses > 0 ? Math.round((prog.totalCorrect / totalGuesses) * 100) : 0;
  
  pane.innerHTML = `
    <div class="q-clean-layout" style="text-align: center; padding: 20px 0;">
      <h2 style="font-size: 24px; color: var(--accent); margin-bottom: 20px;">Quiz Complete!</h2>
      
      <div style="background: var(--surface2); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 24px; display: flex; flex-direction: column; gap: 12px;">
        <div style="display: flex; justify-content: space-between;">
          <span style="color: var(--text2);">Total Questions:</span>
          <span class="mono" style="font-weight: 700;">${prog.totalQuestions}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: var(--accent);">Correct Answers:</span>
          <span class="mono" style="font-weight: 700; color: var(--accent);">${prog.totalCorrect}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: var(--danger);">Missed Answers:</span>
          <span class="mono" style="font-weight: 700; color: var(--danger);">${prog.totalMissed}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: var(--orange);">Incorrect Guesses:</span>
          <span class="mono" style="font-weight: 700; color: var(--orange);">${prog.totalIncorrect}</span>
        </div>
        <div style="display: flex; justify-content: space-between; border-top: 1px solid var(--border); padding-top: 12px; margin-top: 4px;">
          <span style="font-weight: 600;">Accuracy Rate:</span>
          <span class="mono" style="font-weight: 700; color: var(--orange);">${accuracy}%</span>
        </div>
      </div>
      
      <button class="btn btn-p" style="width: 100%; padding: 14px;" onclick="quitQuiz()">Back to Settings</button>
    </div>
  `;
}

// Update timer text and color
function updateTimerDisplay() {
  const timerEl = document.getElementById('qTimerDisplay');
  if (!timerEl) return;
  
  const min = Math.floor(quizTimeLeft / 60);
  const sec = quizTimeLeft % 60;
  const timeStr = `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  timerEl.innerText = `⏱ ${timeStr}`;
  
  if (quizTimeLeft <= 10) {
    timerEl.style.color = 'var(--danger)';
    timerEl.style.textShadow = '0 0 8px rgba(255, 59, 48, 0.4)';
  } else {
    timerEl.style.color = 'var(--orange)';
    timerEl.style.textShadow = 'none';
  }
}

// Save current quiz back into Zyzzyva .zzq format
function saveCurrentZzq() {
  if (!currentQuizPool || !currentQuizPool.length) {
    toast("No active word pool to save!");
    return;
  }
  let fName = prompt("ชื่อไฟล์ควิซ:", "zyzzylu_quiz");
  if (fName === null) return;
  fName = fName.trim() || "zyzzylu_quiz";
  if (!fName.toLowerCase().endsWith(".zzq")) fName += ".zzq";
  
  const prog = JSON.parse(Module.getProgressJson());
  const q = JSON.parse(Module.getCurrentQuestionJson());
  
  let totalW = prog.totalQuestions;
  let lengths = currentQuizPool.map(w => w.length);
  let minL = lengths.length ? Math.min(...lengths) : 2;
  let maxL = lengths.length ? Math.max(...lengths) : 15;
  
  const isComplete = q.checked;
  const currentIdx = prog.currentQuestion - 1;
  const correctQuestions = prog.fullyCorrectQuestions || 0;
  const correctCount = prog.totalCorrect;
  
  let xml = [];
  xml.push('<?xml version="1.0" encoding="ISO-8859-1"?>');
  xml.push('<!DOCTYPE zyzzyva-quiz SYSTEM \'http://boshvark.com/dtd/zyzzyva-quiz.dtd\'>');
  xml.push(`<zyzzyva-quiz method="Standard" lexicon="CSW24" type="Anagrams" question-order="Random">`);
  xml.push(' <question-source type="search">');
  xml.push('  <zyzzyva-search version="1">');
  xml.push('   <conditions>');
  xml.push('    <and>');
  
  if (qFilters && qFilters.length > 0) {
    qFilters.forEach(f => {
      let negatedVal = f.not ? '1' : '0';
      if (f.type === 'length') {
        xml.push(`     <condition min="${f.v1}" max="${f.v2}" type="Length"/>`);
      } else if (f.type === 'point_value') {
        xml.push(`     <condition min="${f.v1}" max="${f.v2}" type="Point Value"/>`);
      } else if (f.type === 'begins') {
        xml.push(`     <condition string="${f.v1}" type="Begins With" negated="${negatedVal}"/>`);
      } else if (f.type === 'ends') {
        xml.push(`     <condition string="${f.v1}" type="Ends With" negated="${negatedVal}"/>`);
      } else if (f.type === 'includes') {
        xml.push(`     <condition string="${f.v1}" type="Includes Letters" negated="${negatedVal}"/>`);
      } else if (f.type === 'probability_order') {
        xml.push(`     <condition min="${f.v1}" max="${f.v2}" type="Probability"/>`);
      } else if (f.type === 'limit_probability_order') {
        xml.push(`     <condition min="${f.v1}" max="${f.v2}" type="LimitByProbabilityOrder"/>`);
      } else if (f.type === 'anagram_match') {
        xml.push(`     <condition string="${f.v1}" type="Anagram Match" negated="${negatedVal}"/>`);
      }
    });
  } else {
    xml.push(`     <condition min="${minL}" max="${maxL}" type="Length"/>`);
  }
  
  xml.push('    </and>');
  xml.push('   </conditions>');
  xml.push('  </zyzzyva-search>');
  xml.push(' </question-source>');
  xml.push(` <randomizer seed="${activeSeed1}" algorithm="1" seed2="${activeSeed2}"/>`);
  xml.push(` <progress correct-questions="${correctQuestions}" question="${currentIdx}" correct="${correctCount}" question-complete="${isComplete ? 'true' : 'false'}" total-questions="${totalW}">`);
  
  if (isComplete) {
    xml.push('  <question-correct-responses>');
    q.userCorrectAnswers.forEach(word => {
      xml.push(`   <response word="${word}"/>`);
    });
    xml.push('  </question-correct-responses>');
  } else {
    if (q.userCorrectAnswers && q.userCorrectAnswers.length > 0) {
      xml.push('  <question-correct-responses>');
      q.userCorrectAnswers.forEach(word => {
        xml.push(`   <response word="${word}"/>`);
      });
      xml.push('  </question-correct-responses>');
    }
    if (q.userIncorrectAnswers && q.userIncorrectAnswers.length > 0) {
      xml.push('  <incorrect-responses>');
      q.userIncorrectAnswers.forEach(word => {
        xml.push(`   <response word="${word}" count="1"/>`);
      });
      xml.push('  </incorrect-responses>');
    }
  }
  
  xml.push(' </progress>');
  
  // Zyzylu-specific: save all session wrong guesses across all questions
  if (sessionIncorrectAnswers.length > 0) {
    xml.push(' <zyzzylu-session>');
    xml.push('  <all-incorrect-responses>');
    sessionIncorrectAnswers.forEach(word => {
      xml.push(`   <response word="${word}"/>`);
    });
    xml.push('  </all-incorrect-responses>');
    xml.push(' </zyzzylu-session>');
  }
  
  xml.push('</zyzzyva-quiz>');
  
  let blob = new Blob([xml.join("\r\n")], { type: "application/octet-stream" });
  let a = document.createElement("a");
  a.download = fName;
  a.href = window.URL.createObjectURL(blob);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast(`Saved ${fName}`);
}

// Parse Zyzzyva .zzq quiz file or plain words text file
function loadZzq(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const content = e.target.result.trim();
    try {
      // 1. Check if plain text file
      if (!content.startsWith("<?xml")) {
        const loaded = content.split(/\r?\n/).map(w => w.trim().toUpperCase()).filter(w => dictSet.has(w));
        if (!loaded.length) {
          toast("No valid words found in the plain text file.");
          return;
        }
        
        sessionIncorrectAnswers = [];
        currentQuizPool = loaded;
        activeSeed1 = Math.floor(Date.now() / 1000);
        activeSeed2 = 244;
        
        const quizType = parseInt(document.getElementById('qTypeSelect')?.value || "0");
        quizTimeLimit = parseInt(document.getElementById('qTimerSelect')?.value || "0");
        
        const poolString = loaded.join(' ');
        Module.generateQuiz(quizType, poolString, 3);
        
        document.getElementById('qSettingsPane').style.display = 'none';
        document.getElementById('qEnginePane').style.display = 'block';
        loadCurrentQuestion();
        
        toast(` Loaded Plain Words (${loaded.length} words)`);
        return;
      }
      
      // 2. Parse XML (.zzq)
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(content, "text/xml");
      
      const quizNode = xmlDoc.querySelector('zyzzyva-quiz');
      if (!quizNode) {
        toast("Invalid .zzq file structure!");
        return;
      }
      
      const typeAttr = quizNode.getAttribute('type') || "Anagrams";
      
      let typeVal = "0";
      if (typeAttr.toLowerCase().includes("hook")) {
        typeVal = "1";
      } else if (typeAttr.toLowerCase().includes("build")) {
        typeVal = "2";
      }
      
      const typeSelect = document.getElementById('qTypeSelect');
      if (typeSelect) typeSelect.value = typeVal;
      
      // Extract randomizer seeds
      let rNode = xmlDoc.getElementsByTagName("randomizer")[0];
      let s1 = rNode ? rNode.getAttribute("seed") : null;
      let s2 = rNode ? rNode.getAttribute("seed2") : null;
      
      activeSeed1 = s1 ? parseInt(s1) : Math.floor(Date.now() / 1000);
      activeSeed2 = s2 ? parseInt(s2) : 244;
      
      // Parse search conditions to reconstruct the word pool
      const conditionNodes = xmlDoc.querySelectorAll('condition');
      let pool = [];
      if (conditionNodes.length > 0) {
        qFilters.length = 0;
        conditionNodes.forEach(cond => {
          const parentTag = cond.parentNode.tagName.toLowerCase();
          const not = (parentTag === 'not' || cond.getAttribute('negated') === '1');
          
          let filterType = "";
          let v1 = "";
          let v2 = "";
          
          const type = cond.getAttribute('type');
          if (!type) return;
          const typeNorm = type.replace(/\s+/g, '').toLowerCase();
          
          if (typeNorm === 'length') {
            filterType = 'length';
            v1 = cond.getAttribute('min') || '2';
            v2 = cond.getAttribute('max') || '8';
          } else if (typeNorm === 'pointvalue') {
            filterType = 'point_value';
            v1 = cond.getAttribute('min') || '2';
            v2 = cond.getAttribute('max') || '8';
          } else if (typeNorm === 'beginswith' || typeNorm === 'begins') {
            filterType = 'begins';
            v1 = cond.getAttribute('text') || cond.getAttribute('string') || '';
          } else if (typeNorm === 'endswith' || typeNorm === 'ends') {
            filterType = 'ends';
            v1 = cond.getAttribute('text') || cond.getAttribute('string') || '';
          } else if (typeNorm === 'includesletters' || typeNorm === 'contains' || typeNorm === 'includes') {
            filterType = 'includes';
            v1 = cond.getAttribute('text') || cond.getAttribute('string') || '';
          } else if (typeNorm === 'probability') {
            filterType = 'probability_order';
            v1 = cond.getAttribute('min') || '1';
            v2 = cond.getAttribute('max') || '1000';
          } else if (typeNorm === 'limitbyprobabilityorder') {
            filterType = 'limit_probability_order';
            v1 = cond.getAttribute('min') || '1';
            v2 = cond.getAttribute('max') || '100';
          } else if (typeNorm === 'anagrammatch') {
            filterType = 'anagram_match';
            v1 = cond.getAttribute('text') || cond.getAttribute('string') || '';
          }
          
          if (filterType) {
            fId++;
            qFilters.push({
              id: fId,
              type: filterType,
              v1: v1,
              v2: v2,
              not: not
            });
          }
        });
        
        renderFilters('Q');
        pool = dict.filter(w => matchFilters(w, qFilters));
        pool = applyLimitFilters(pool, qFilters);
      } else {
        // Fallback: If no search conditions, check response nodes
        let responseNodes = xmlDoc.getElementsByTagName("response");
        let explicitWords = [];
        for (let i = 0; i < responseNodes.length; i++) {
          let w = responseNodes[i].getAttribute("word");
          if (w) {
            w = w.trim().toUpperCase();
            if (dictSet.has(w)) explicitWords.push(w);
          }
        }
        pool = explicitWords;
      }
      
      if (!pool.length) {
        alert("No valid words found matching this quiz file.");
        return;
      }
      
      // Shuffle pool using seeds
      let orderedWords = [];
      if (typeVal === "2") { // Build quiz shuffles words directly
        orderedWords = (s1 && s2) ? shuffleMwc(pool, activeSeed1, activeSeed2) : standardShuffle(pool);
      } else { // Anagrams / Hooks shuffles unique alphagrams
        let uniquePool = Array.from(new Set(pool.map(w => [...w].sort().join(''))));
        uniquePool.sort(); // Sort alphabetically to match Zyzzyva before shuffling
        let shuffledUnique = (s1 && s2) ? shuffleMwc(uniquePool, activeSeed1, activeSeed2) : standardShuffle(uniquePool);
        
        let wordsByAlphagram = {};
        pool.forEach(w => {
          let alphaG = [...w].sort().join('');
          if (!wordsByAlphagram[alphaG]) {
            wordsByAlphagram[alphaG] = [];
          }
          wordsByAlphagram[alphaG].push(w);
        });
        
        shuffledUnique.forEach(alphaG => {
          let matches = wordsByAlphagram[alphaG];
          if (matches) {
            orderedWords.push(...matches);
          }
        });
      }
      
      currentQuizPool = orderedWords;
      quizTimeLimit = parseInt(document.getElementById('qTimerSelect')?.value || "0");
      
      const orderSelect = document.getElementById('qOrderSelect');
      if (orderSelect) {
        orderSelect.value = "1"; 
      }
      
      // Generate the quiz in C++ preserving the order we established
      Module.generateQuiz(parseInt(typeVal), orderedWords.join(' '), 3);
      
      // Restore progress if it exists in the XML
      const progressNode = xmlDoc.querySelector('progress');
      if (progressNode) {
        let savedCorrectQuestions = parseInt(progressNode.getAttribute('correct-questions') || '0');
        let savedQuestionIndex = parseInt(progressNode.getAttribute('question') || '0');
        let savedCorrect = parseInt(progressNode.getAttribute('correct') || '0');
        let savedQuestionComplete = progressNode.getAttribute('question-complete') === 'true';
        
        let userCorrect = [];
        let userIncorrect = [];
        
        const correctNode = progressNode.querySelector('question-correct-responses');
        if (correctNode) {
          const respNodes = correctNode.querySelectorAll('response');
          respNodes.forEach(node => {
            let w = node.getAttribute('word');
            if (w) userCorrect.push(w.trim().toUpperCase());
          });
        }
        
        const incorrectNode = progressNode.querySelector('incorrect-responses');
        if (incorrectNode) {
          const respNodes = incorrectNode.querySelectorAll('response');
          respNodes.forEach(node => {
            let w = node.getAttribute('word');
            if (w) userIncorrect.push(w.trim().toUpperCase());
          });
        }
        
        Module.restoreProgress(
          savedQuestionIndex,
          savedCorrect,
          0,                          // totalMissedVal
          0,                          // totalIncorrectVal (not stored per-question in .zzq)
          savedCorrectQuestions,      // fullyCorrectVal
          userCorrect.join(' '),
          userIncorrect.join(' '),
          savedQuestionComplete
        );
      }
      
      // Restore session incorrect answers from Zyzylu-specific data
      sessionIncorrectAnswers = [];
      const sessionNode = xmlDoc.querySelector('zyzzylu-session all-incorrect-responses');
      if (sessionNode) {
        sessionNode.querySelectorAll('response').forEach(r => {
          const w = r.getAttribute('word');
          if (w) sessionIncorrectAnswers.push(w.trim().toUpperCase());
        });
      }
      
      document.getElementById('qSettingsPane').style.display = 'none';
      document.getElementById('qEnginePane').style.display = 'block';
      loadCurrentQuestion();
      
      toast(` Loaded .zzq Quiz (${pool.length} Words)`);
      
    } catch(err) {
      console.error(err);
      toast("Error parsing quiz file.");
    }
  };
  reader.readAsText(file);
}

// Dynamic button text swapping based on input
function updateQuizButtonText() {
  const inp = document.getElementById('qAnswerInput');
  const btn = document.getElementById('qActionButton');
  if (!inp || !btn) return;
  if (inp.value.trim()) {
    btn.innerText = "Submit";
    btn.onclick = submitUserAnswer;
  } else {
    btn.innerText = "Check Answers ✓";
    btn.onclick = handleCheck;
  }
}

// Validate quiz input — only allow letters present in the current alphagram
function onQuizInput() {
  updateQuizButtonText();
  
  const inp = document.getElementById('qAnswerInput');
  if (!inp || !cppInitialized) return;
  
  const quizType = parseInt(document.getElementById('qTypeSelect')?.value || "0");
  if (quizType !== 0) return; // Strict tile validation only for standard Anagrams
  
  const qJsonStr = Module.getCurrentQuestionJson();
  if (!qJsonStr || qJsonStr === '{}') return;
  const q = JSON.parse(qJsonStr);
  if (q.checked) return;
  
  const typed = inp.value.toUpperCase();
  if (!typed) return;
  
  // Count available letters from alphagram tiles
  const alphagram = q.questionText || '';
  let available = {};
  for (let c of alphagram) {
    available[c] = (available[c] || 0) + 1;
  }
  
  // Check each letter typed against available tiles
  let used = {};
  for (let c of typed) {
    used[c] = (used[c] || 0) + 1;
    if ((used[c]) > (available[c] || 0)) {
      // Invalid — remove last character and shake
      inp.value = typed.slice(0, -1);
      inp.classList.remove('shake-input');
      void inp.offsetWidth; // force reflow
      inp.classList.add('shake-input');
      setTimeout(() => inp.classList.remove('shake-input'), 350);
      toast(`⚠️ "${c}" not in tiles!`, '');
      updateQuizButtonText();
      return;
    }
  }
}

// Display Analyze Review Grid
function showAnalysis() {
  const qJsonStr = Module.getCurrentQuestionJson();
  if (qJsonStr === "{}" || !qJsonStr) return;
  const q = JSON.parse(qJsonStr);
  
  if (!q.checked) {
    const confirmProceed = confirm("⚠️ Viewing analysis will reveal all answers and finalize this question. Do you want to proceed?");
    if (!confirmProceed) return;
    clearInterval(timerInterval);
  }
  
  const resultsStr = Module.checkAnswers();
  if (!resultsStr || resultsStr === "{}") {
    toast("No analysis available.");
    return;
  }
  
  let checkResults;
  try {
    checkResults = JSON.parse(resultsStr);
  } catch (e) {
    console.error("Failed to parse check results JSON:", e);
    toast("Error loading analysis data.");
    return;
  }
  
  if (!checkResults || !checkResults.answers) {
    toast("No analysis data available.");
    return;
  }
  
  const pane = document.getElementById('qEnginePane');
  if (!pane) return;
  
  // Compute session-wide stats
  const prog = JSON.parse(Module.getProgressJson());
  const sessTotal = prog.totalCorrect + prog.totalMissed;
  const sessAccuracy = sessTotal > 0 ? Math.round(prog.totalCorrect / sessTotal * 100) : 0;
  const curTotal = (checkResults.answers || []).length;
  const curCorrectCount = curTotal > 0 ? (checkResults.answers.filter(a => a && a.status === 'correct').length) : 0;
  const curAccuracy = curTotal > 0 ? Math.round(curCorrectCount / curTotal * 100) : 0;
  
  const statColor = (pct) => pct >= 70 ? 'var(--accent)' : pct >= 40 ? 'var(--orange)' : 'var(--danger)';
  const statsHtml = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px;">
      <div style="background:var(--surface2); border:1px solid var(--border); border-radius:8px; padding:10px; text-align:center;">
        <div style="font-size:10px; color:var(--text2); text-transform:uppercase; font-weight:700; margin-bottom:4px;">Current Q</div>
        <div style="font-size:26px; font-weight:800; color:${statColor(curAccuracy)}">${curAccuracy}%</div>
        <div style="font-size:11px; color:var(--text2);">${curCorrectCount}/${curTotal} found</div>
      </div>
      <div style="background:var(--surface2); border:1px solid var(--border); border-radius:8px; padding:10px; text-align:center;">
        <div style="font-size:10px; color:var(--text2); text-transform:uppercase; font-weight:700; margin-bottom:4px;">Session Total</div>
        <div style="font-size:26px; font-weight:800; color:${statColor(sessAccuracy)}">${sessAccuracy}%</div>
        <div style="font-size:11px; color:var(--text2);">${prog.totalCorrect}/${sessTotal} correct</div>
      </div>
    </div>
  `;
  
  const missed = checkResults.answers
    .filter(ans => ans && ans.status === 'missed')
    .map(ans => ans.word);
    
  const correct = checkResults.answers
    .filter(ans => ans && ans.status === 'correct')
    .map(ans => ans.word);
    
  // Also add current question's wrong guesses to session list (catches auto-checked questions)
  const currentIncorrect = checkResults.incorrectAnswers || [];
  currentIncorrect.forEach(w => {
    if (w && !sessionIncorrectAnswers.includes(w)) sessionIncorrectAnswers.push(w);
  });
  
  let invalidated = [];
  if (sessionIncorrectAnswers.length > 0) {
    invalidated = correct;
  }
  
  let topHtml = "";
  missed.forEach(w => {
    topHtml += `<div class="mono" style="color: var(--orange); font-size: 15px; padding: 2px 0;">• ${w} (Missed)</div>`;
  });
  invalidated.forEach(w => {
    topHtml += `<div class="mono" style="color: var(--danger); font-size: 15px; padding: 2px 0;">⚠️ ${w} (Invalidated)</div>`;
  });
  
  if (!topHtml) {
    topHtml = `<div class="mono" style="color: var(--text2); text-align: center; padding: 10px 0;">None</div>`;
  }
  
  let bottomHtml = "";
  sessionIncorrectAnswers.forEach(w => {
    bottomHtml += `<div class="mono" style="color: var(--danger); font-size: 15px; padding: 2px 0;">✕ ${w}</div>`;
  });
  
  if (!bottomHtml) {
    bottomHtml = `<div class="mono" style="color: var(--text2); text-align: center; padding: 10px 0;">None</div>`;
  }
  
  pane.innerHTML = `
    <div class="q-clean-layout">
      <h3 class="mono" style="font-size: 16px; margin-bottom: 8px; border-bottom: 1px solid var(--border); padding-bottom: 6px;">Review Grid Analysis</h3>
      
      ${statsHtml}
      
      <!-- Top Box: Missed / Invalidated words -->
      <div style="background: rgba(10, 132, 255, 0.15); border: 1px solid rgba(10, 132, 255, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 12px; min-height: 60px; max-height: 180px; overflow-y: auto;">
        <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #0A84FF; margin-bottom: 6px;">Missed / Invalidated — Current Question</div>
        ${topHtml}
      </div>
      
      <!-- Bottom Box: All session incorrect attempts -->
      <div style="background: rgba(255, 59, 48, 0.05); border: 1px solid rgba(255, 59, 48, 0.2); border-radius: 8px; padding: 12px; min-height: 60px; max-height: 180px; overflow-y: auto;">
        <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--danger); margin-bottom: 6px;">All Incorrect Attempts — Entire Session (${sessionIncorrectAnswers.length})</div>
        ${bottomHtml}
      </div>
      
      <button class="btn btn-p" style="width: 100%; margin-top: 14px;" onclick="renderActiveQuiz()">Back to Quiz</button>
    </div>
  `;
}

function renderActiveQuiz() {
  const qJsonStr = Module.getCurrentQuestionJson();
  if (qJsonStr === "{}" || !qJsonStr) return;
  const q = JSON.parse(qJsonStr);
  const prog = JSON.parse(Module.getProgressJson());
  renderQuizUI(q, prog);
}

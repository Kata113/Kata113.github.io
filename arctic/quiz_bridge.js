// ── STATE ──────────────────────────────────────────────────────────────
let cppInitialized = false;
let timerInterval  = null;
let quizTimeLimit  = 0;
let quizTimeLeft   = 0;
let currentQuizPool = [];
let activeSeed1 = 0;
let activeSeed2 = 0;
let quizHistory = []; // { word, status } for end-screen review
let quizRackQuestionKey = '';
let quizRackLetters = [];
let quizRackDragState = null;
let activeQuizSessionId = '';
let isQuizSaved = true;
let pendingQuitAfterSave = false;
let rackCycleTimer = null;
let rackCycleIndex = 0;
let rackCycleWords = [];
let rackCycleQuestionKey = '';

// seed2 mirrors Zyzzyva's getPid() — constant per process/session
// Linux PIDs are quint16 range (1–65535); generated once per page load
const SESSION_SEED2 = Math.floor(Math.random() * 65534) + 1;

// Session-wide wrong-guess tracking { word: count }
// Persisted in localStorage keyed by active quiz session ID (unique per file/save)
let sessionIncorrect = {};

// ── ZYZZYVA QUIZ ANALYZE ENGINE ──────────────────────────────────────────
/**
 * Zyzzyva Quiz Analyze Engine (100% Native Compatible)
 */
class ZyzzyvaQuizAnalyzer {
  constructor() {
    this.reset();
  }
  reset() {
    this.totalWords = 0;       // [QuizEngine+0x70]: ผลรวมจำนวนคำเฉลยทั้งหมดของข้อที่เปิดมาแล้ว
    this.correctCount = 0;     // [QuizEngine+0x74]: จำนวนคำที่ตอบถูกสะสม
    this.incorrectCount = 0;   // [QuizEngine+0x78]: จำนวนครั้งที่เดาผิดสะสม
    
    // สำหรับแสดงผลในตาราง Analyze (Unique Words)
    this.missedWords = new Set();
    this.incorrectWords = new Set();
    
    // สำหรับเก็บสถิติความถี่ลง .zzq XML (<missed-responses>, <incorrect-responses>)
    this.missedFrequency = new Map();     // word -> count
    this.incorrectFrequency = new Map();  // word -> count

    this.preparedQuestionKeys = new Set();
    this.completedQuestionKeys = new Set();
  }
  /**
   * เรียกเมื่อเปิดข้อใหม่ (ตรงกับ QuizEngine::prepareQuestion)
   * @param {string[]} questionAnswers รายการคำเฉลยทั้งหมดของข้อนั้น
   */
  onPrepareQuestion(questionAnswers) {
    if (Array.isArray(questionAnswers)) {
      this.totalWords += questionAnswers.length;
    }
  }
  /**
   * เรียกเมื่อผู้ใช้พิมพ์ตอบถูก 1 คำ (ตรงกับ QuizEngine::addQuestionCorrect)
   * @param {string} word 
   */
  onWordCorrect(word) {
    this.correctCount++;
    // ถ้าคำนี้เคยถูก Mark ว่า Missed มาก่อน ให้เอาออกจากตาราง Missed
    this.missedWords.delete(word.toUpperCase());
  }
  /**
   * เรียกเมื่อผู้ใช้พิมพ์ตอบผิด (ตรงกับ QuizEngine::addQuestionIncorrect)
   * @param {string} word 
   */
  onWordIncorrect(word) {
    const w = word.toUpperCase();
    this.incorrectCount++;
    this.incorrectWords.add(w);
    this.incorrectFrequency.set(w, (this.incorrectFrequency.get(w) || 0) + 1);
  }
  /**
   * เรียกเมื่อจบข้อ / กดยืนยันข้อนั้น (ตรงกับ QuizEngine::nextQuestion / checkResponse)
   * @param {string[]} allAnswers คำเฉลยทั้งหมดของข้อนี้
   * @param {Set<string>|string[]} userCorrectWords คำที่ผู้ใช้ตอบถูกในข้อนี้
   */
  onCompleteQuestion(allAnswers, userCorrectWords) {
    const userCorrectSet = new Set(Array.from(userCorrectWords).map(w => w.toUpperCase()));
    for (const ans of allAnswers) {
      const w = ans.toUpperCase();
      if (!userCorrectSet.has(w)) {
        this.missedWords.add(w);
        this.missedFrequency.set(w, (this.missedFrequency.get(w) || 0) + 1);
      }
    }
  }
  /**
   * เรียกเมื่อผู้ใช้กด "Mark Correct" (ตรงกับ QuizFunction::markCorrect)
   * @param {string[]} allAnswers คำเฉลยทั้งหมดของข้อนี้
   * @param {string[]} userCorrectWords คำที่ผู้ใช้ตอบถูกไปแล้ว
   * @param {string[]} userIncorrectWords คำที่ผู้ใช้ตอบผิดในข้อนี้
   */
  onMarkQuestionCorrect(allAnswers, userCorrectWords, userIncorrectWords) {
    // 1. คืนค่า incorrect attempts ของข้อนี้
    this.incorrectCount -= userIncorrectWords.length;
    for (const w of userIncorrectWords) {
      this.incorrectWords.delete(w.toUpperCase());
    }
    // 2. ปรับคำที่เหลือในข้อนี้ให้เป็นถูกทั้งหมด
    const userCorrectSet = new Set(userCorrectWords.map(w => w.toUpperCase()));
    for (const ans of allAnswers) {
      const w = ans.toUpperCase();
      if (!userCorrectSet.has(w)) {
        this.correctCount++;
        this.missedWords.delete(w);
      }
    }
  }
  /**
   * คำนวณสตริงสถิติตามฟอร์แมตของ Zyzzyva percentString(int, int)
   */
  _formatPercentString(n, d) {
    let pct = 0.0;
    if (d > 0) {
      pct = (n * 100.0) / d;
    }
    // Zyzzyva ใช้ทศนิยม 1 ตำแหน่ง (%.1f) เสมอ
    return `${n} / ${d} (${pct.toFixed(1)}%)`;
  }
  /**
   * ส่งออกสถิติสำหรับหน้า UI Analyze Tab (ตรงกับ AnalyzeQuizFunction properties)
   */
  getStats() {
    const totalAttempts = this.correctCount + this.incorrectCount;
    return {
      // 1. Recall
      recallPercent: this.totalWords > 0 ? (this.correctCount * 100.0) / this.totalWords : 0.0,
      recallText: `Recall: ${this._formatPercentString(this.correctCount, this.totalWords)}`,
      
      // 2. Precision
      precisionPercent: totalAttempts > 0 ? (this.correctCount * 100.0) / totalAttempts : 0.0,
      precisionText: `Precision: ${this._formatPercentString(this.correctCount, totalAttempts)}`,
      // 3. Counts & Word Lists
      missedCount: this.missedWords.size,
      missedText: `Missed: ${this.missedWords.size} word(s)`,
      missedWords: Array.from(this.missedWords).sort(),
      incorrectCount: this.incorrectWords.size,
      incorrectText: `Incorrect: ${this.incorrectWords.size} word(s)`,
      incorrectWords: Array.from(this.incorrectWords).sort(),
      // Raw counters
      raw: {
        totalWords: this.totalWords,
        correctCount: this.correctCount,
        incorrectCount: this.incorrectCount,
        totalAttempts: totalAttempts,
      }
    };
  }
  /**
   * แปลงเป็น XML Nodes สำหรับใส่ลงในไฟล์ .zzq
   */
  toZzqXmlSections() {
    const lines = [];
    if (this.incorrectFrequency.size > 0) {
      lines.push('  <incorrect-responses>');
      for (const [w, cnt] of this.incorrectFrequency.entries()) {
        lines.push(`   <response word="${w}" count="${cnt}"/>`);
      }
      lines.push('  </incorrect-responses>');
    }
    if (this.missedFrequency.size > 0) {
      lines.push('  <missed-responses>');
      for (const [w, cnt] of this.missedFrequency.entries()) {
        lines.push(`   <response word="${w}" count="${cnt}"/>`);
      }
      lines.push('  </missed-responses>');
    }
    return lines.join('\n');
  }
}

const quizAnalyzer = new ZyzzyvaQuizAnalyzer();
if (typeof window !== 'undefined') {
  window.ZyzzyvaQuizAnalyzer = ZyzzyvaQuizAnalyzer;
  window.quizAnalyzer = quizAnalyzer;
}

function getQuestionAllAnswers(q) {
  if (!q || !q.questionText) return [];
  const qType = sel('qTypeSelect');
  const txt = q.questionText.toUpperCase();
  if (qType === 0 || qType === 1) {
    const sorted = [...txt].sort().join('');
    const matches = (wordsByL[txt.length] || []).filter(w => [...w].sort().join('') === sorted);
    if (matches.length) return matches;
  } else if (qType === 2) {
    const txtChars = {};
    for (const c of txt) txtChars[c] = (txtChars[c] || 0) + 1;
    const matches = (wordsByL[txt.length + 1] || []).filter(w => {
      const wChars = {};
      for (const c of w) wChars[c] = (wChars[c] || 0) + 1;
      let diff = 0;
      for (const c in wChars) {
        if (wChars[c] > (txtChars[c] || 0)) diff += wChars[c] - (txtChars[c] || 0);
        if (diff > 1) return false;
      }
      return diff === 1;
    });
    if (matches.length) return matches;
  }
  return new Array(q.totalAnswers || 1).fill('');
}

// ── WASM INIT ──────────────────────────────────────────────────────────
if (typeof Module !== 'undefined')
  Module.onRuntimeInitialized = () => tryInitCppEngine();

const _coreOnload = window.onload;
window.onload = async () => { if (_coreOnload) await _coreOnload(); tryInitCppEngine(); };

function tryInitCppEngine() {
  if (!cppInitialized && typeof Module !== 'undefined'
      && Module.loadDictionary && dict?.length) {
    document.getElementById('wCnt').innerText = 'preparing quiz…';
    Module.loadDictionary(dict.join('\n'));
    cppInitialized = true;
    document.getElementById('wCnt').innerText = dict.length.toLocaleString() + ' words';
    const startButton = document.getElementById('qStartBtn');
    if (startButton) startButton.disabled = false;
    const readyHint = document.getElementById('qReadyHint');
    if (readyHint) readyHint.innerText = 'Ready when you are. You can leave the timer off.';
  }
}

// ── MWC PRNG ตาม Zyzzyva (Rand::znew, Rand::wnew, Rand::mwc, Rand::rand) ──
function createMwcRandom(s1, s2) {
  let z = (Number(s1) >>> 0) || 1;
  let w = (Number(s2) >>> 0) || 1;
  function mwc() {
    z = ((36969 * (z & 0xffff)) + (z >>> 16)) >>> 0;
    w = ((18000 * (w & 0xffff)) + (w >>> 16)) >>> 0;
    // ไม่มี & 0xffff ครอบ w: นำ 32-bit ทั้งหมดมาบวกกัน
    return (((z << 16) >>> 0) + w) >>> 0;
  }
  // Zyzzyva Rand::rand(unsigned int max) -> สุ่ม [0..max] แบบ Bucket Division
  function rand(max) {
    if (max <= 0) return 0;
    const raw = mwc();
    const n = (max + 1) >>> 0;
    const bucket = Math.floor(0xffffffff / n) + 1;
    return Math.floor(raw / bucket);
  }
  return { mwc, rand };
}

// Fisher-Yates shuffle ตรงตาม QuizEngine::newQuiz
function shuffleMwc(arr, s1, s2) {
  const rng = createMwcRandom(s1, s2);
  const a = [...arr];
  let remaining = a.length - 1;
  let i = 0;
  while (remaining > 0) {
    const offset = rng.rand(remaining);
    const j = i + offset;
    if (j !== i) {
      const temp = a[i];
      a[i] = a[j];
      a[j] = temp;
    }
    i++;
    remaining--;
  }
  return a;
}

// ── SESSION STORAGE (localStorage keyed by isolated session/file ID) ──
function sessionKey() {
  if (activeQuizSessionId) {
    return `zzlu_si_${activeQuizSessionId}`;
  }
  return activeSeed1 ? `zzlu_si_${activeSeed1}_${activeSeed2}` : '';
}

function saveSessionIncorrect() {
  const k = sessionKey();
  if (!k) return;
  if (Object.keys(sessionIncorrect).length) {
    localStorage.setItem(k, JSON.stringify(sessionIncorrect));
  } else {
    localStorage.removeItem(k);
  }
}

function loadSessionIncorrect() {
  const k = sessionKey();
  if (!k) return;
  try {
    const raw = localStorage.getItem(k);
    if (raw) {
      const stored = JSON.parse(raw);
      for (const [w, c] of Object.entries(stored)) {
        sessionIncorrect[w] = Math.max(sessionIncorrect[w] || 0, Number(c) || 1);
      }
    }
  } catch(_) {}
}

function trackWrongGuess(w) {
  if (!w) return;
  sessionIncorrect[w] = (sessionIncorrect[w] || 0) + 1;
  saveSessionIncorrect();
}

// ── QUIZ RACK ─────────────────────────────────────────────────────────
function stopRackCycleTimer() {
  if (rackCycleTimer !== null) {
    clearInterval(rackCycleTimer);
    rackCycleTimer = null;
  }
  rackCycleWords = [];
  rackCycleQuestionKey = '';
  const rack = document.getElementById('quizRack');
  if (rack) rack.classList.remove('is-solved');
}

function startRackCycle(words, qKey) {
  if (!Array.isArray(words) || words.length === 0) return;

  // If already cycling this exact question with the same words, avoid restarting timer
  if (rackCycleQuestionKey === qKey && rackCycleWords.join('|') === words.join('|') && rackCycleTimer !== null) {
    return;
  }

  stopRackCycleTimer();
  rackCycleWords = words;
  rackCycleQuestionKey = qKey;
  rackCycleIndex = 0;

  // Initial wave animation on the first word
  triggerRackWaveAnimation();

  // If there's more than 1 word, start the continuous loop
  if (words.length > 1) {
    rackCycleTimer = setInterval(() => {
      const rack = document.getElementById('quizRack');
      const enginePane = document.getElementById('qEnginePane');
      if (!rack || !enginePane || enginePane.style.display === 'none') {
        stopRackCycleTimer();
        return;
      }

      rackCycleIndex = (rackCycleIndex + 1) % rackCycleWords.length;
      const nextWord = rackCycleWords[rackCycleIndex];
      quizRackLetters = [...nextWord];
      rack.innerHTML = renderQuizRackTiles();
      rack.classList.add('is-solved');
      triggerRackWaveAnimation();
      announceQuizRack();
    }, 2000);
  }
}

function triggerRackWaveAnimation() {
  const rack = document.getElementById('quizRack');
  if (!rack) return;
  rack.classList.add('is-solved');
  const tiles = rack.querySelectorAll('.quiz-tile');
  tiles.forEach((t, i) => {
    t.style.animation = 'none';
    t.offsetHeight; // force reflow
    t.style.animation = `tileWaveFlip 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) ${i * 0.05}s both`;
  });
}

function syncQuizRack(questionText, questionNumber) {
  const nextKey = `${activeSeed1}:${questionNumber}:${questionText}`;
  if (quizRackQuestionKey !== nextKey) {
    clearQuizTileDrag();
    quizRackQuestionKey = nextKey;
    quizRackLetters = [...questionText];
  }
}

function quizTileHtml(letter, index) {
  const score = letterScores[letter] || 0;
  const pointsLabel = score === 1 ? 'point' : 'points';
  return `<button type="button" class="quiz-tile" data-rack-index="${index}"
    data-letter="${letter}" data-score="${score}"
    aria-label="${letter}, ${score} ${pointsLabel}. Position ${index + 1} of ${quizRackLetters.length}"
    aria-describedby="quizRackHint"
    onpointerdown="beginQuizTileDrag(event)"
    onlostpointercapture="endQuizTileDrag(event)"
    onkeydown="handleQuizTileKey(event)">
      <span class="quiz-tile-letter">${letter}</span>
      <span class="quiz-tile-score" aria-hidden="true">${score}</span>
  </button>`;
}

function renderQuizRackTiles() {
  return quizRackLetters.map(quizTileHtml).join('');
}

function announceQuizRack() {
  const status = document.getElementById('quizRackStatus');
  if (status) status.textContent = `Tile order: ${quizRackLetters.join(' ')}`;
}

function updateQuizRackFromDom(rack) {
  const tiles = [...rack.querySelectorAll('.quiz-tile')];
  quizRackLetters = tiles.map(tile => tile.dataset.letter);
  tiles.forEach((tile, index) => {
    tile.dataset.rackIndex = index;
    const score = Number(tile.dataset.score) || 0;
    tile.setAttribute(
      'aria-label',
      `${tile.dataset.letter}, ${score} ${score === 1 ? 'point' : 'points'}. Position ${index + 1} of ${tiles.length}`
    );
  });
}

function beginQuizTileDrag(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const tile = event.currentTarget;
  const rack = tile.closest('.quiz-rack');
  if (!rack || rack.classList.contains('is-solved')) return;

  clearQuizTileDrag();

  const rect = tile.getBoundingClientRect();
  const grabOffsetX = event.clientX - rect.left;
  const grabOffsetY = event.clientY - rect.top;

  // Create floating drag clone
  const floating = tile.cloneNode(true);
  floating.classList.add('is-floating');
  floating.removeAttribute('id');
  floating.setAttribute('aria-hidden', 'true');
  floating.style.width = `${rect.width}px`;
  floating.style.height = `${rect.height}px`;
  floating.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0) scale(1.08) rotate(1.5deg)`;
  document.body.appendChild(floating);

  tile.classList.add('is-placeholder');
  rack.classList.add('is-dragging');

  tile.setPointerCapture?.(event.pointerId);

  quizRackDragState = {
    pointerId: event.pointerId,
    tile,
    rack,
    floating,
    grabOffsetX,
    grabOffsetY,
    startX: event.clientX,
    startY: event.clientY,
    hasMoved: false
  };

  window.addEventListener('pointermove', moveQuizTileDrag, { passive: false });
  window.addEventListener('pointerup', endQuizTileDrag);
  window.addEventListener('pointercancel', endQuizTileDrag);
  event.preventDefault();
}

function moveQuizTileDrag(event) {
  const state = quizRackDragState;
  if (!state || state.pointerId !== event.pointerId) return;

  const dist = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
  if (dist > 3) state.hasMoved = true;

  const x = event.clientX - state.grabOffsetX;
  const y = event.clientY - state.grabOffsetY;
  if (state.floating) {
    state.floating.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1.08) rotate(1.5deg)`;
  }

  const siblings = [...state.rack.querySelectorAll('.quiz-tile:not(.is-floating)')];
  let target = null;
  let insertAfter = false;

  for (const sibling of siblings) {
    if (sibling === state.tile) continue;
    const r = sibling.getBoundingClientRect();
    if (event.clientX >= r.left && event.clientX <= r.right &&
        event.clientY >= r.top - 50 && event.clientY <= r.bottom + 50) {
      target = sibling;
      insertAfter = event.clientX > r.left + r.width / 2;
      break;
    }
  }

  if (!target && siblings.length > 1) {
    const firstSibling = siblings.find(s => s !== state.tile);
    const lastSibling = [...siblings].reverse().find(s => s !== state.tile);
    if (firstSibling) {
      const rFirst = firstSibling.getBoundingClientRect();
      if (event.clientX < rFirst.left && event.clientY >= rFirst.top - 50 && event.clientY <= rFirst.bottom + 50) {
        target = firstSibling;
        insertAfter = false;
      }
    }
    if (!target && lastSibling) {
      const rLast = lastSibling.getBoundingClientRect();
      if (event.clientX > rLast.right && event.clientY >= rLast.top - 50 && event.clientY <= rLast.bottom + 50) {
        target = lastSibling;
        insertAfter = true;
      }
    }
  }

  if (target) {
    const isAlreadyBefore = target.previousElementSibling === state.tile;
    const isAlreadyAfter = target.nextElementSibling === state.tile;
    const needsMove = (insertAfter && !isAlreadyAfter) || (!insertAfter && !isAlreadyBefore);

    if (needsMove) {
      const siblingTiles = siblings.filter(s => s !== state.tile);
      const firstRects = new Map(siblingTiles.map(s => [s, s.getBoundingClientRect()]));

      if (insertAfter) target.after(state.tile);
      else target.before(state.tile);

      siblingTiles.forEach(s => {
        const first = firstRects.get(s);
        const last = s.getBoundingClientRect();
        const dx = first.left - last.left;
        if (Math.abs(dx) > 0.5) {
          s.style.transition = 'none';
          s.style.transform = `translateX(${dx}px)`;
          s.offsetHeight;
          s.style.transition = 'transform 0.18s cubic-bezier(0.2, 0, 0, 1)';
          s.style.transform = '';
          const onEnd = () => {
            s.removeEventListener('transitionend', onEnd);
            s.style.transition = '';
          };
          s.addEventListener('transitionend', onEnd);
        }
      });

      updateQuizRackFromDom(state.rack);
    }
  }

  event.preventDefault();
}

function endQuizTileDrag(event) {
  const state = quizRackDragState;
  if (!state || (event.pointerId != null && state.pointerId !== event.pointerId)) return;

  window.removeEventListener('pointermove', moveQuizTileDrag);
  window.removeEventListener('pointerup', endQuizTileDrag);
  window.removeEventListener('pointercancel', endQuizTileDrag);

  if (state.tile.hasPointerCapture?.(state.pointerId)) {
    try { state.tile.releasePointerCapture(state.pointerId); } catch (_) {}
  }

  const floating = state.floating;
  const tile = state.tile;
  const rack = state.rack;

  if (floating && state.hasMoved) {
    const targetRect = tile.getBoundingClientRect();
    floating.style.transition = 'transform 0.16s cubic-bezier(0.2, 0, 0, 1), opacity 0.16s ease';
    floating.style.transform = `translate3d(${targetRect.left}px, ${targetRect.top}px, 0) scale(1) rotate(0deg)`;

    setTimeout(() => {
      if (floating.parentNode) floating.remove();
      tile.classList.remove('is-placeholder', 'is-dragging');
      rack.classList.remove('is-dragging');
      updateQuizRackFromDom(rack);
      announceQuizRack();
    }, 160);
  } else {
    if (floating && floating.parentNode) floating.remove();
    tile.classList.remove('is-placeholder', 'is-dragging');
    rack.classList.remove('is-dragging');
    updateQuizRackFromDom(rack);
    announceQuizRack();
  }

  quizRackDragState = null;
}

function clearQuizTileDrag() {
  const state = quizRackDragState;
  if (state) {
    if (state.floating && state.floating.parentNode) state.floating.remove();
    if (state.tile) {
      state.tile.classList.remove('is-placeholder', 'is-dragging');
      state.tile.style.transform = '';
      state.tile.style.transition = '';
    }
    if (state.rack) state.rack.classList.remove('is-dragging');
  }
  document.querySelectorAll('.quiz-tile.is-floating').forEach(el => el.remove());
  document.querySelectorAll('.quiz-tile.is-placeholder').forEach(el => el.classList.remove('is-placeholder'));
  window.removeEventListener('pointermove', moveQuizTileDrag);
  window.removeEventListener('pointerup', endQuizTileDrag);
  window.removeEventListener('pointercancel', endQuizTileDrag);
  quizRackDragState = null;
}

function handleQuizTileKey(event) {
  const rack = document.getElementById('quizRack');
  if (rack && rack.classList.contains('is-solved')) return;

  const fromIndex = Number(event.currentTarget.dataset.rackIndex);
  let toIndex = fromIndex;
  if (event.key === 'ArrowLeft') toIndex = Math.max(0, fromIndex - 1);
  else if (event.key === 'ArrowRight') toIndex = Math.min(quizRackLetters.length - 1, fromIndex + 1);
  else if (event.key === 'Home') toIndex = 0;
  else if (event.key === 'End') toIndex = quizRackLetters.length - 1;
  else return;

  event.preventDefault();
  if (toIndex === fromIndex) return;
  const [letter] = quizRackLetters.splice(fromIndex, 1);
  quizRackLetters.splice(toIndex, 0, letter);
  if (!rack) return;
  rack.innerHTML = renderQuizRackTiles();
  requestAnimationFrame(() => rack.querySelector(`[data-rack-index="${toIndex}"]`)?.focus());
  announceQuizRack();
}

// ── QUIZ LIFECYCLE ─────────────────────────────────────────────────────
function startQuiz() {
  if (!cppInitialized) { toast('WASM engine initialising — please wait'); return; }

  let pool = dict.filter(w => matchFilters(w, qFilters));
  pool = applyLimitFilters(pool, qFilters);
  if (!pool.length) { toast('No words match the selected filters!'); return; }

  stopRackCycleTimer();
  isQuizSaved = false;
  pendingQuitAfterSave = false;

  // Zyzzyva: seed = QDateTime::currentDateTime().toTime_t()  (Unix seconds)
  //          seed2 = Auxil::getPid()  (process ID, constant per session)
  activeSeed1 = Math.floor(Date.now() / 1000);
  activeSeed2 = SESSION_SEED2;
  activeQuizSessionId = `new_${activeSeed1}_${activeSeed2}_${Date.now()}`;
  sessionIncorrect = {};
  quizHistory = [];
  quizAnalyzer.reset();
  saveSessionIncorrect();

  const quizType  = sel('qTypeSelect');
  const order     = sel('qOrderSelect');
  quizTimeLimit   = sel('qTimerSelect');

  currentQuizPool = buildOrderedPool(pool, quizType, order, activeSeed1, activeSeed2);
  // Random and probability pools are already ordered in JavaScript. Preserve
  // that order so the WASM engine cannot reshuffle or re-rank them.
  Module.generateQuiz(quizType, currentQuizPool.join(' '), (order === 1 || order === 2) ? 3 : order);
  showQuizPane();
  loadCurrentQuestion();
}

// สร้าง Question Pool ตรงตามลำดับของ Zyzzyva 100%
function buildOrderedPool(pool, quizType, order, s1, s2) {
  if (order === 2) {
    // Probability order
    return [...pool].sort((a, b) => {
      const ra = probRankMap[a] || 9999999;
      const rb = probRankMap[b] || 9999999;
      return ra !== rb ? ra - rb : (a < b ? -1 : 1);
    });
  }
  if (order === 0) return [...pool].sort(); // Alphabetical
  if (quizType === 2) return shuffleMwc([...pool].sort(), s1, s2); // Build quiz

  // 1. จัดกลุ่มคำตาม Alphagram
  const byAlpha = {};
  for (const w of pool) {
    const a = [...w].sort().join('');
    (byAlpha[a] = byAlpha[a] || []).push(w);
  }
  // คำในแต่ละ Alphagram ต้องเรียงตามตัวอักษร
  for (const a in byAlpha) {
    byAlpha[a].sort();
  }
  // 2. ดึง Unique Alphagrams และ "SORT ตามตัวอักษร" ก่อนสับ (ตรงตาม std::sort ใน Zyzzyva)
  const sortedAlphagrams = Object.keys(byAlpha).sort();
  // 3. สับลำดับ Alphagram ด้วย MWC + Fisher-Yates
  const shuffledAlphagrams = shuffleMwc(sortedAlphagrams, s1, s2);
  // 4. ขยายกลับเป็นลิสต์คำศัพท์ส่งให้ Engine
  return shuffledAlphagrams.flatMap(a => byAlpha[a]);
}

function loadCurrentQuestion() {
  stopTimer();
  stopRackCycleTimer();
  const q = parseQ();
  if (!q) { endQuiz(); return; }

  const prog = parseProg();
  const qKey = `${activeSeed1}:${prog.currentQuestion}:${q.questionText}`;
  if (!quizAnalyzer.preparedQuestionKeys.has(qKey)) {
    quizAnalyzer.preparedQuestionKeys.add(qKey);
    const answers = getQuestionAllAnswers(q);
    quizAnalyzer.onPrepareQuestion(answers.length ? answers : new Array(q.totalAnswers || 1));
  }

  renderQuizUI(q, prog);
  if (!q.checked) startTimer();
  setTimeout(() => document.getElementById('qAnswerInput')?.focus(), 80);
}

function handleCheck() {
  stopTimer();
  stopRackCycleTimer();
  isQuizSaved = false;
  const qBefore = parseQ();
  qBefore?.userIncorrectAnswers?.forEach(w => {
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

      const prog = parseProg();
      const qKey = `${activeSeed1}:${prog.currentQuestion}:${cr.questionText || qBefore?.questionText}`;
      if (!quizAnalyzer.completedQuestionKeys.has(qKey)) {
        quizAnalyzer.completedQuestionKeys.add(qKey);
        const allAnswers = (cr.answers || []).map(a => a.word);
        const userCorrectWords = (cr.answers || []).filter(a => a.status === 'correct').map(a => a.word);
        quizAnalyzer.onCompleteQuestion(allAnswers, userCorrectWords);
      }
    }
  } catch(_) {}
  renderQuizUI(parseQ(), parseProg());
}

function handleNext() {
  stopRackCycleTimer();
  isQuizSaved = false;
  Module.nextQuestion() ? loadCurrentQuestion() : endQuiz();
}

function quitQuiz() {
  if (!isQuizSaved && currentQuizPool?.length) {
    showQuitConfirmModal();
    return;
  }
  forceQuitQuiz();
}

function forceQuitQuiz() {
  stopTimer();
  stopRackCycleTimer();
  isQuizSaved = true;
  pendingQuitAfterSave = false;
  document.getElementById('qEnginePane').style.display   = 'none';
  document.getElementById('qSettingsPane').style.display = 'block';
}

function showQuitConfirmModal() {
  stopTimer();
  const content = `
    <div class="zyz-modal-header">
      <div style="display:flex;align-items:center;gap:10px">
        <h3 class="zyz-modal-title" style="color:var(--orange)">⚠️ ยังไม่ได้บันทึกแบบฝึกหัด</h3>
      </div>
      <button type="button" class="zyz-modal-close-btn" aria-label="Close" onclick="closeStorageModal()">✕</button>
    </div>
    <div class="zyz-modal-body">
      <p style="font-size:14px;color:var(--text);margin:4px 0 16px;line-height:1.5;">
        คุณยังไม่ได้บันทึกความคืบหน้าของแบบฝึกหัดนี้ หากออกจากแบบฝึกหัด ข้อมูลการตอบคำถามล่าสุดอาจสูญหายได้
      </p>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button type="button" class="zyz-choice-btn" id="zyzQuitSaveFirstBtn" style="border-color:var(--orange);background:rgba(255,149,0,0.06)">
          <div class="zyz-choice-icon" style="color:var(--orange)">💾</div>
          <div class="zyz-choice-content">
            <div class="zyz-choice-title" style="color:var(--orange)">บันทึกก่อนออก (Save & Exit)</div>
            <div class="zyz-choice-desc">บันทึกความคืบหน้าลงในเครื่องหรือดาวน์โหลดไฟล์ .zzq ก่อนออกจากแบบฝึกหัด</div>
          </div>
        </button>
        <button type="button" class="zyz-choice-btn" id="zyzQuitForceBtn" style="border-color:rgba(255,59,48,0.3);background:rgba(255,59,48,0.04)">
          <div class="zyz-choice-icon" style="color:var(--danger)">🚪</div>
          <div class="zyz-choice-content">
            <div class="zyz-choice-title" style="color:var(--danger)">ออกโดยไม่บันทึก (Quit without saving)</div>
            <div class="zyz-choice-desc">ละทิ้งความคืบหน้าล่าสุดและกลับไปยังหน้าตั้งค่าแบบฝึกหัด</div>
          </div>
        </button>
        <button type="button" class="btn" id="zyzQuitCancelBtn" style="width:100%;padding:12px;margin-top:4px;font-size:14px">
          ทำแบบฝึกหัดต่อ (Resume Quiz)
        </button>
      </div>
    </div>
  `;
  openStorageModal(content, (card) => {
    card.querySelector('#zyzQuitSaveFirstBtn')?.addEventListener('click', () => {
      pendingQuitAfterSave = true;
      showSaveChoiceModal();
    });
    card.querySelector('#zyzQuitForceBtn')?.addEventListener('click', () => {
      closeStorageModal();
      forceQuitQuiz();
    });
    card.querySelector('#zyzQuitCancelBtn')?.addEventListener('click', () => {
      closeStorageModal();
    });
  });
}

function endQuiz() {
  stopTimer();
  stopRackCycleTimer();
  const prog = parseProg();
  const totalIncorrect = Math.max(
    prog.totalIncorrect || 0,
    Object.values(sessionIncorrect).reduce((sum, c) => sum + (Number(c) || 0), 0)
  );
  const totalSubmitted = prog.totalCorrect + totalIncorrect;
  const totalPossible = prog.totalCorrect + prog.totalMissed;
  const precision = totalSubmitted > 0 ? Math.round((prog.totalCorrect / totalSubmitted) * 100) : 100;
  const recall = totalPossible > 0 ? Math.round((prog.totalCorrect / totalPossible) * 100) : 0;
  const fullyCorrect = prog.fullyCorrectQuestions || 0;
  const completedQuestions = Math.min(prog.currentQuestion || 0, prog.totalQuestions || 0);
  const questionAcc = completedQuestions > 0 ? Math.round((fullyCorrect / completedQuestions) * 100) : 0;
  const scoreCol = p => p >= 70 ? 'var(--accent)' : p >= 40 ? 'var(--orange)' : 'var(--danger)';

  // Build word review list with hook + prob layout
  const wordRow = ({ word, status }) => {
    const hk    = getHooksAndDots(word);
    const prob  = probRankMap[word];
    const pos   = typeof formatWordPos === 'function' ? formatWordPos(word) : '';
    const ok    = status === 'correct';
    const col   = ok ? 'var(--accent)' : 'var(--danger)';
    const fH    = hk.f
      ? `<span style="color:var(--accent);letter-spacing:3px;">${hk.f.split('').join(' ')}</span>`
      : '';
    const bH    = hk.b
      ? `<span style="color:var(--accent);letter-spacing:3px;">${hk.b.split('').join(' ')}</span>`
      : '';
    return `<div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:6px;
                        padding:8px 4px;border-bottom:1px solid rgba(58,58,60,.3);">
      <div class="mono" style="text-align:right;font-size:12px;font-weight:700;
                                line-height:1.8;word-break:break-all;min-width:0;">${fH}</div>
      <div style="text-align:center;white-space:nowrap;padding:0 4px;">
        <div style="font-size:10px;color:${col};font-weight:700;margin-bottom:1px;">${ok?'✓':'⊘'}</div>
        <span class="mono" style="font-size:18px;font-weight:700;color:${col};">${word}</span>
        <div style="font-size:10px;color:var(--text2);margin-top:2px;">
          <span style="color:var(--orange);font-weight:600;">${pos}</span>
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
                  padding:18px 20px;margin-bottom:16px;display:flex;flex-direction:column;gap:10px">
        ${statRow('Total Questions', prog.totalQuestions, 'var(--text2)')}
        ${statRow('Completed Questions', completedQuestions, 'var(--text2)')}
        ${statRow('Fully Correct Questions', `${fullyCorrect} (${questionAcc}%)`, 'var(--accent)')}
        ${statRow('Correct Answers', prog.totalCorrect, 'var(--accent)')}
        ${statRow('Missed Answers', prog.totalMissed, 'var(--danger)')}
        ${statRow('Wrong Guesses', totalIncorrect, 'var(--orange)')}
        ${statRow('Total Words Submitted', totalSubmitted, 'var(--text2)')}
        ${statRow('Total Possible Words', totalPossible, 'var(--text2)')}
        <div style="border-top:1px solid var(--border);padding-top:10px;margin-top:2px;display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;justify-content:space-between">
            <span style="font-weight:600">1. Precision (ความแม่นยำ)</span>
            <span class="mono" style="font-weight:700;color:${scoreCol(precision)}">${prog.totalCorrect}/${totalSubmitted} (${precision}%)</span>
          </div>
          <div style="display:flex;justify-content:space-between">
            <span style="font-weight:600">2. Recall (ความระลึกได้)</span>
            <span class="mono" style="font-weight:700;color:${scoreCol(recall)}">${prog.totalCorrect}/${totalPossible} (${recall}%)</span>
          </div>
          <div style="display:flex;justify-content:space-between">
            <span style="font-weight:600">3. Question Accuracy</span>
            <span class="mono" style="font-weight:700;color:${scoreCol(questionAcc)}">${fullyCorrect}/${completedQuestions} (${questionAcc}%)</span>
          </div>
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

  // Fully solved = user found all possible correct words (e.g. 1/1, 2/2, 3/3, 4/4)
  const isFullySolved = (q.totalAnswers > 0) && (q.correctAnswersCount === q.totalAnswers);
  let solvedWords = [];
  if (isFullySolved) {
    if (Array.isArray(q.userCorrectAnswers) && q.userCorrectAnswers.length > 0) {
      solvedWords = [...q.userCorrectAnswers];
    } else {
      try {
        const cr = JSON.parse(Module.checkAnswers());
        if (cr && Array.isArray(cr.answers)) {
          solvedWords = cr.answers.filter(a => a.status === 'correct').map(a => a.word);
        }
      } catch (_) {}
    }
    if (solvedWords.length > 0) {
      const currentWord = (rackCycleWords.length > 0 && rackCycleWords[rackCycleIndex])
        ? rackCycleWords[rackCycleIndex]
        : solvedWords[0];
      quizRackLetters = [...currentWord];
    }
  } else {
    syncQuizRack(q.questionText, prog.currentQuestion);
  }

  const tiles     = renderQuizRackTiles();
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

      <div class="quiz-rack ${isFullySolved ? 'is-solved' : ''}" id="quizRack" aria-label="Rearrangeable letter tiles">
        ${tiles}
      </div>
      <p class="quiz-rack-hint" id="quizRackHint">Drag tiles to rearrange · use Left and Right arrow keys</p>
      <span class="sr-only" id="quizRackStatus" aria-live="polite" aria-atomic="true"></span>

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
          <span style="text-align:center;padding:0 4px;">Word · POS · #Prob</span>
          <span style="text-align:left;">Back</span>
        </div>
        ${renderAnswersList(q)}
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" style="flex:1;min-width:60px"  onclick="quitQuiz()">Quit</button>
        <button class="btn" style="flex:1;min-width:64px;color:var(--orange)"
                onclick="handleSaveQuizClick()">Save</button>
        <button class="btn" style="flex:1;min-width:64px;color:#0A84FF"
                onclick="showAnalysis()">Analyze</button>
        ${isChecked
          ? `<button class="btn btn-p" style="flex:2;min-width:120px"
                     onclick="handleNext()">Next → <small style="opacity:.7">(Enter)</small></button>`
          : `<button class="btn btn-p" id="qActionButton" style="flex:2;min-width:140px"
                     onclick="handleCheck()">Check Answers ✓</button>`}
      </div>
    </div>`;

  if (isFullySolved && solvedWords.length > 0) {
    const qKey = `${activeSeed1}:${prog.currentQuestion}:${q.questionText}`;
    startRackCycle(solvedWords, qKey);
  } else {
    stopRackCycleTimer();
  }

  if (quizTimeLimit > 0) updateTimerDisplay();
}

function renderAnswersList(q) {
  // Shared helper: render one word as 3-column hook row
  const hookRow = (word, statusColor, statusIcon, showStar) => {
    const hk    = getHooksAndDots(word);
    const prob  = probRankMap[word];
    const pos   = typeof formatWordPos === 'function' ? formatWordPos(word) : '';
    const star  = saved.includes(word);
    const fH = hk.f
      ? `<span style="color:var(--accent);letter-spacing:3px;">${hk.f.split('').join(' ')}</span>`
      : '';
    const bH = hk.b
      ? `<span style="color:var(--accent);letter-spacing:3px;">${hk.b.split('').join(' ')}</span>`
      : '';
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
          <span style="color:var(--orange);font-weight:600;">${pos}</span>
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
  const prevCorrect = q.userCorrectAnswers?.length || 0;
  inp.value = '';
  isQuizSaved = false;
  Module.submitAnswer(val);

  const afterQ = parseQ();
  if ((afterQ.userIncorrectAnswers?.length || 0) > prevWrong) {
    trackWrongGuess(val);
    quizAnalyzer.onWordIncorrect(val);
  } else if ((afterQ.userCorrectAnswers?.length || 0) > prevCorrect) {
    quizAnalyzer.onWordCorrect(val);
  }

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
  stopTimer();

  // If question is in-progress, finalize it immediately so all missed words and wrong guesses are evaluated
  if (!q.checked) {
    try {
      Module.checkAnswers();
    } catch (_) {}
  }

  let cr;
  try { cr = JSON.parse(Module.checkAnswers()); } catch(_) {}
  if (!cr?.answers) { toast('No analysis data'); return; }

  const prog = parseProg();
  const qKey = `${activeSeed1}:${prog.currentQuestion}:${cr.questionText || q.questionText}`;
  if (!quizAnalyzer.completedQuestionKeys.has(qKey)) {
    quizAnalyzer.completedQuestionKeys.add(qKey);
    const allAnswers = (cr.answers || []).map(a => a.word);
    const userCorrectWords = (cr.answers || []).filter(a => a.status === 'correct').map(a => a.word);
    quizAnalyzer.onCompleteQuestion(allAnswers, userCorrectWords);
  }

  // Sync any incorrect answers into session tracking immediately
  (cr.incorrectAnswers || []).forEach(w => { if (w && !sessionIncorrect[w]) trackWrongGuess(w); });

  // Track answered and missed words into review history if not already present
  (cr.answers || []).forEach(a => {
    if (a.word && !quizHistory.some(h => h.word === a.word)) {
      quizHistory.push({ word: a.word, status: a.status });
    }
  });

  const stats = quizAnalyzer.getStats();
  const missed = cr.answers.filter(a => a?.status === 'missed').map(a => a.word);
  const wrongQ = cr.incorrectAnswers || [];

  const col = p => p >= 70 ? 'var(--accent)' : p >= 40 ? 'var(--orange)' : 'var(--danger)';
  const sessWords = stats.incorrectWords;
  const allMissed = stats.missedWords;
  const badge = wrongQ.length === 0 && missed.length === 0
    ? `<span style="background:rgba(52,199,89,.15);color:var(--accent);
                    padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">✓ CLEAN</span>`
    : `<span style="background:rgba(255,59,48,.1);color:var(--danger);
                    padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">⚠ HAD ERRORS</span>`;

  document.getElementById('qEnginePane').innerHTML = `
    <div class="q-clean-layout">
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:8px;margin-bottom:12px">
        <h3 class="mono" style="font-size:16px;margin:0">Analysis</h3>
        <div>${badge}</div>
      </div>

      <!-- 1. แถบสถิติหลัก Recall & Precision (ตาม Zyzzyva format) -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <!-- Precision Card -->
        <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 10px;text-align:center">
          <div style="font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">
            Precision (ความแม่นยำ)
          </div>
          <div style="font-size:26px;font-weight:800;color:${col(stats.precisionPercent)};line-height:1.2;margin:3px 0">
            ${stats.precisionPercent.toFixed(1)}%
          </div>
          <div style="font-size:11px;color:var(--text);font-weight:600;margin-top:2px">
            ${stats.precisionText}
          </div>
          <div style="font-size:10px;color:var(--text2);margin-top:3px;line-height:1.3">
            สัดส่วนการตอบถูกจากจำนวนครั้งที่ส่งทั้งหมด
          </div>
        </div>

        <!-- Recall Card -->
        <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 10px;text-align:center">
          <div style="font-size:11px;color:var(--text2);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">
            Recall (ความระลึกได้)
          </div>
          <div style="font-size:26px;font-weight:800;color:${col(stats.recallPercent)};line-height:1.2;margin:3px 0">
            ${stats.recallPercent.toFixed(1)}%
          </div>
          <div style="font-size:11px;color:var(--text);font-weight:600;margin-top:2px">
            ${stats.recallText}
          </div>
          <div style="font-size:10px;color:var(--text2);margin-top:3px;line-height:1.3">
            สัดส่วนคำเฉลยที่ตอบได้จากคำเฉลยทั้งหมด
          </div>
        </div>
      </div>

      <!-- 2. รายการคำที่เดาผิด (Wrong Guesses) -->
      <!-- Wrong This Q -->
      <div style="background:rgba(255,59,48,.05);border:1px solid rgba(255,59,48,.2);
                  border-radius:8px;padding:12px;margin-bottom:8px;max-height:130px;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:11px;text-transform:uppercase;font-weight:700;color:var(--danger)">
            Wrong This Q (${wrongQ.length})
          </span>
          <span style="font-size:10px;color:var(--text2)">คำที่คุณพิมพ์ผิดในข้อปัจจุบัน</span>
        </div>
        ${wrongQ.length ? wrongQ.map(w => `
          <div class="mono" style="color:var(--danger);font-size:15px;padding:2px 0;font-weight:600">
            ✕ ${w}
          </div>
        `).join('') : `<div style="color:var(--text2);text-align:center;padding:6px 0;font-size:12px">ไม่มีคำเดาผิดในข้อนี้</div>`}
      </div>

      <!-- All Session Incorrect -->
      <div style="background:rgba(255,59,48,.03);border:1px solid rgba(255,59,48,.15);
                  border-radius:8px;padding:12px;margin-bottom:8px;max-height:150px;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:11px;text-transform:uppercase;font-weight:700;color:var(--danger)">
            ${stats.incorrectText}
          </span>
          <span style="font-size:10px;color:var(--text2)">คำที่คุณเดาผิดสะสมในเซสชัน</span>
        </div>
        ${sessWords.length ? sessWords.map(w => {
          const cnt = quizAnalyzer.incorrectFrequency.get(w) || sessionIncorrect[w] || 1;
          return `<div class="mono" style="color:var(--danger);font-size:15px;padding:2px 0;font-weight:600">
            ✕ ${w}${cnt > 1 ? ` <span style="color:var(--text2);font-size:12px;font-weight:400">(×${cnt})</span>` : ''}
          </div>`;
        }).join('') : `<div style="color:var(--text2);text-align:center;padding:6px 0;font-size:12px">ไม่มีประวัติคำเดาผิดในเซสชันนี้</div>`}
      </div>

      <!-- All Session Missed Words -->
      ${allMissed.length ? `
      <div style="background:rgba(255,149,0,.08);border:1px solid rgba(255,149,0,.25);
                  border-radius:8px;padding:12px;margin-bottom:8px;max-height:140px;overflow-y:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:11px;text-transform:uppercase;font-weight:700;color:var(--orange)">
            ${stats.missedText}
          </span>
          <span style="font-size:10px;color:var(--text2)">คำเฉลยที่ตกหล่นสะสม</span>
        </div>
        ${allMissed.map(w => {
          const cnt = quizAnalyzer.missedFrequency.get(w) || 1;
          return `<div class="mono" style="color:var(--orange);font-size:15px;padding:2px 0;font-weight:600">
            • ${w}${cnt > 1 ? ` <span style="color:var(--text2);font-size:12px;font-weight:400">(×${cnt})</span>` : ''}
          </div>`;
        }).join('')}
      </div>` : ''}

      <button class="btn btn-p" style="width:100%;margin-top:6px;min-height:44px" onclick="renderActiveQuiz()">Back to Quiz</button>
    </div>`;
}

function renderActiveQuiz() {
  const q = parseQ(); if (!q) return;
  renderQuizUI(q, parseProg());
}

// ── QUIZ STORAGE & SERIALIZATION ──────────────────────────────────────────
// Supports dual-mode saving/loading:
// 1. Local Storage: fast, instant pop-up, isolated metadata vs full XML payload
// 2. .zzq file: 100% Zyzzyva-compatible XML format

const STORAGE_META_KEY = 'zyz_quiz_saves_meta';
const STORAGE_SAVE_PREFIX = 'zyz_quiz_save_';

// ── BUILD .zzq XML — 100% Zyzzyva-compatible XML string ──────────────────
// Extracted to be shared across file downloads and Local Storage saves.
// Note: session data is stored in XML comments to ensure Qt's DOM skips it.
function buildZzqXmlString() {
  if (!currentQuizPool?.length) return null;

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
    `<zyzzyva-quiz type="${quizTypeStr}" question-order="${quizOrderStr}" lexicon="CSW24" method="Standard">`,
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
          lines.push(`     <condition type="Length" min="${f.v1}" max="${f.v2}"/>`); break;
        case 'point_value':
          lines.push(`     <condition type="Point Value" min="${f.v1}" max="${f.v2}"/>`); break;
        case 'num_vowels':
          lines.push(`     <condition type="Number of Vowels" min="${f.v1}" max="${f.v2}"/>`); break;
        case 'begins':
          lines.push(`     <condition type="Begins With" string="${f.v1}" negated="${neg}"/>`); break;
        case 'ends':
          lines.push(`     <condition type="Ends With" string="${f.v1}" negated="${neg}"/>`); break;
        case 'includes':
          lines.push(`     <condition type="Includes Letters" string="${f.v1}" negated="${neg}"/>`); break;
        case 'probability_order':
          lines.push(`     <condition type="Probability Order" min="${f.v1}" max="${f.v2}"/>`); break;
        case 'limit_probability_order':
          // Zyzzyva saves LimitByProbabilityOrder as Probability Order with int="2" bool="true"
          // Confirmed from 7_Letter_Prob_100.zzq reference file
          lines.push(`     <condition int="2" type="Probability Order" max="${f.v2}" bool="true" min="0"/>`); break;
        case 'anagram_match':
          lines.push(`     <condition type="Anagram Match" string="${f.v1}" negated="${neg}"/>`); break;
        case 'subanagram_match':
          lines.push(`     <condition type="Subanagram Match" string="${f.v1}" negated="${neg}"/>`); break;
        case 'pattern_match':
          lines.push(`     <condition type="Pattern Match" string="${f.v1}" negated="${neg}"/>`); break;
      }
    });
  } else {
    // Fallback: infer length range from the pool
    const lens = currentQuizPool.map(w => w.length);
    lines.push(`     <condition type="Length" min="${Math.min(...lens)}" max="${Math.max(...lens)}"/>`);
  }

  lines.push('    </and>', '   </conditions>', '  </zyzzyva-search>', ' </question-source>');

  // Randomizer — algorithm="1" = Marsaglia MWC (QuizSpec::setRandomAlgorithm)
  lines.push(` <randomizer seed="${activeSeed1}" seed2="${activeSeed2}" algorithm="1"/>`);

  // Progress
  const qIdx      = (prog.currentQuestion ?? 1) - 1;
  const correctW  = q?.userCorrectAnswers   || [];
  const incorrectW = isChecked ? (cr?.incorrectAnswers || []) : (q?.userIncorrectAnswers || []);
  const missedW   = isChecked ? (cr?.answers?.filter(a => a.status === 'missed').map(a => a.word) || []) : [];
  const analyzerXml = quizAnalyzer.toZzqXmlSections();
  const hasBody     = correctW.length || analyzerXml || incorrectW.length || missedW.length;

  const progressAttr = [
    `question="${qIdx}"`,
    `total-questions="${prog.totalQuestions}"`,
    `correct="${prog.totalCorrect}"`,
    `correct-questions="${prog.fullyCorrectQuestions || 0}"`,
    `question-complete="${isChecked}"`,
  ].join(' ');

  if (hasBody) {
    lines.push(` <progress ${progressAttr}>`);
    if (correctW.length) {
      lines.push('  <question-correct-responses>');
      correctW.forEach(w => lines.push(`   <response word="${w}"/>`));
      lines.push('  </question-correct-responses>');
    }
    if (analyzerXml) {
      lines.push(analyzerXml);
    } else {
      if (incorrectW.length) {
        lines.push('  <incorrect-responses>');
        incorrectW.forEach(w => lines.push(`   <response word="${w}" count="1"/>`));
        lines.push('  </incorrect-responses>');
      }
      if (missedW.length) {
        lines.push('  <missed-responses>');
        missedW.forEach(w => lines.push(`   <response word="${w}" count="1"/>`));
        lines.push('  </missed-responses>');
      }
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
    lines.push(` <!-- arctic-session: ${sessData} -->`);
  }

  lines.push('</zyzzyva-quiz>');
  return lines.join('\r\n');
}

// ── SAVE HANDLERS ────────────────────────────────────────────────────────
function saveCurrentZzq() {
  if (!currentQuizPool?.length) { toast('No active quiz to save'); return; }
  let name = prompt('ชื่อไฟล์:', 'arctic_quiz');
  if (name === null) return;
  const baseName = (name.trim() || 'arctic_quiz').replace(/\.zzq$/i, '');
  const fileName = baseName + '.zzq';
  const xml = buildZzqXmlString();
  if (!xml) { toast('Failed to build quiz data'); return; }
  downloadBlob(xml, fileName);
  const safeName = baseName.replace(/[^a-zA-Z0-9_\-\u0E00-\u0E7F]/g, '_');
  activeQuizSessionId = `file_${safeName}_${activeSeed1}_${activeSeed2}`;
  saveSessionIncorrect();
  isQuizSaved = true;
  toast(`Saved ${fileName}`);
  if (pendingQuitAfterSave) {
    pendingQuitAfterSave = false;
    closeStorageModal();
    forceQuitQuiz();
    toast('บันทึกและออกจากแบบฝึกหัดเรียบร้อย');
  }
}

function handleSaveQuizClick() {
  if (!currentQuizPool?.length) {
    toast('No active quiz to save');
    return;
  }
  // Pause the quiz timer while the user is choosing save options
  stopTimer();
  showSaveChoiceModal();
}

function handleLoadQuizClick() {
  if (!cppInitialized || !dict?.length) {
    toast('พจนานุกรมกำลังเตรียมความพร้อม กรุณารอสักครู่…');
    return;
  }
  showLoadChoiceModal();
}

// ── LOCAL STORAGE REPOSITORY ──────────────────────────────────────────────
function getLocalSavesMeta() {
  try {
    const raw = localStorage.getItem(STORAGE_META_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.error('Failed to read quiz saves metadata:', e);
    return [];
  }
}

function saveLocalSavesMeta(list) {
  localStorage.setItem(STORAGE_META_KEY, JSON.stringify(list));
}

function saveQuizToLocalStorage(customName) {
  if (!currentQuizPool?.length) {
    toast('No active quiz to save');
    return false;
  }
  const xmlContent = buildZzqXmlString();
  if (!xmlContent) {
    toast('Failed to generate quiz data');
    return false;
  }

  const prog = parseProg();
  const q = parseQ();
  const isChecked = q?.checked ?? false;
  let cr = null;
  if (isChecked) {
    try {
      const s = Module.checkAnswers();
      if (s && s !== '{}') cr = JSON.parse(s);
    } catch (_) {}
  }

  const quizTypeVal = sel('qTypeSelect');
  const typeStr = ['Anagrams', 'Anagrams with Hooks', 'Build Word'][quizTypeVal] || 'Anagrams';
  const totalQuestions = prog.totalQuestions || currentQuizPool.length || 0;
  const currentQuestion = prog.currentQuestion || 1;
  const correct = prog.totalCorrect || 0;
  const missedOnCurrent = isChecked ? (cr?.answers?.filter(a => a.status === 'missed').length || 0) : 0;
  const missed = (prog.totalMissed || 0) + missedOnCurrent;

  const id = 'save_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const defaultName = `${typeStr} · ${totalQuestions} คำ (ข้อ ${currentQuestion})`;
  const name = (customName && customName.trim()) ? customName.trim() : defaultName;

  const metaEntry = {
    id,
    name,
    date: dateStr,
    timestamp: Date.now(),
    totalQuestions,
    currentQuestion,
    typeStr,
    correct,
    missed
  };

  try {
    // 1. Save full XML data payload under isolated key
    localStorage.setItem(STORAGE_SAVE_PREFIX + id, xmlContent);

    // 2. Prepend lightweight metadata header
    const metaList = getLocalSavesMeta();
    metaList.unshift(metaEntry);
    saveLocalSavesMeta(metaList);

    // 3. Switch active session to this new local save and persist session data under its key
    activeQuizSessionId = 'local_' + id;
    saveSessionIncorrect();
    isQuizSaved = true;

    toast('บันทึกลงเครื่องสำเร็จ');
    if (pendingQuitAfterSave) {
      pendingQuitAfterSave = false;
      closeStorageModal();
      forceQuitQuiz();
      toast('บันทึกและออกจากแบบฝึกหัดเรียบร้อย');
    }
    return true;
  } catch (err) {
    console.error('LocalStorage save error:', err);
    try { localStorage.removeItem(STORAGE_SAVE_PREFIX + id); } catch (_) {}
    if (err.name === 'QuotaExceededError' || err.code === 22) {
      alert('พื้นที่จัดเก็บข้อมูลของเบราว์เซอร์เต็ม (Storage quota exceeded) กรุณาลบเซฟเก่าที่ไม่ใช้แล้วออกก่อน');
    } else {
      toast('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    }
    return false;
  }
}

function loadLocalSave(id) {
  try {
    const xmlContent = localStorage.getItem(STORAGE_SAVE_PREFIX + id);
    if (!xmlContent) {
      toast('ไม่พบข้อมูลเซฟ หรือข้อมูลเสียหาย');
      return false;
    }
    return loadXmlZzq(xmlContent, 'local', id);
  } catch (err) {
    console.error('Failed to load save from localStorage:', err);
    toast('เกิดข้อผิดพลาดในการโหลดแบบฝึกหัด');
    return false;
  }
}

function deleteLocalSave(id, name) {
  if (!confirm(`คุณต้องการลบเซฟ "${name || 'นี้'}" ใช่หรือไม่?`)) return false;
  try {
    localStorage.removeItem(STORAGE_SAVE_PREFIX + id);
    localStorage.removeItem('zzlu_si_local_' + id);
    let metaList = getLocalSavesMeta();
    metaList = metaList.filter(s => s.id !== id);
    saveLocalSavesMeta(metaList);
    toast('ลบเซฟเรียบร้อยแล้ว');
    return true;
  } catch (err) {
    console.error('Failed to delete save:', err);
    toast('เกิดข้อผิดพลาดในการลบเซฟ');
    return false;
  }
}

function handleCreateNewLocalSave() {
  if (!currentQuizPool?.length) { toast('No active quiz to save'); return; }

  const prog = parseProg();
  const qType = sel('qTypeSelect');
  const typeStr = ['Anagrams', 'Anagrams with Hooks', 'Build Word'][qType] || 'Anagrams';
  const total = prog.totalQuestions || currentQuizPool?.length || 0;
  const currentQ = prog.currentQuestion || 1;
  const defaultName = `${typeStr} · ${total} คำ (ข้อ ${currentQ})`;

  const saveName = prompt('ตั้งชื่อแบบฝึกหัดใหม่:', defaultName);
  if (saveName === null) return; // User cancelled

  if (saveQuizToLocalStorage(saveName)) {
    closeStorageModal();
  }
}

function overwriteLocalSave(id) {
  if (!currentQuizPool?.length) {
    toast('No active quiz to save');
    return false;
  }
  const metaList = getLocalSavesMeta();
  const targetSave = metaList.find(s => s.id === id);
  if (!targetSave) {
    toast('ไม่พบเซฟที่ต้องการบันทึกทับ');
    return false;
  }
  if (!confirm(`คุณต้องการบันทึกทับ "${targetSave.name}" ใช่หรือไม่?`)) {
    return false;
  }

  const xmlContent = buildZzqXmlString();
  if (!xmlContent) {
    toast('Failed to generate quiz data');
    return false;
  }

  const prog = parseProg();
  const q = parseQ();
  const isChecked = q?.checked ?? false;
  let cr = null;
  if (isChecked) {
    try {
      const s = Module.checkAnswers();
      if (s && s !== '{}') cr = JSON.parse(s);
    } catch (_) {}
  }

  const quizTypeVal = sel('qTypeSelect');
  const typeStr = ['Anagrams', 'Anagrams with Hooks', 'Build Word'][quizTypeVal] || 'Anagrams';
  const totalQuestions = prog.totalQuestions || currentQuizPool.length || 0;
  const currentQuestion = prog.currentQuestion || 1;
  const correct = prog.totalCorrect || 0;
  const missedOnCurrent = isChecked ? (cr?.answers?.filter(a => a.status === 'missed').length || 0) : 0;
  const missed = (prog.totalMissed || 0) + missedOnCurrent;

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  targetSave.date = dateStr;
  targetSave.timestamp = Date.now();
  targetSave.totalQuestions = totalQuestions;
  targetSave.currentQuestion = currentQuestion;
  targetSave.typeStr = typeStr;
  targetSave.correct = correct;
  targetSave.missed = missed;

  try {
    localStorage.setItem(STORAGE_SAVE_PREFIX + id, xmlContent);
    saveLocalSavesMeta(metaList);
    activeQuizSessionId = 'local_' + id;
    saveSessionIncorrect();
    isQuizSaved = true;
    toast(`บันทึกทับ "${targetSave.name}" สำเร็จ`);
    closeStorageModal();
    if (pendingQuitAfterSave) {
      pendingQuitAfterSave = false;
      forceQuitQuiz();
      toast('บันทึกและออกจากแบบฝึกหัดเรียบร้อย');
    }
    return true;
  } catch (err) {
    console.error('LocalStorage overwrite error:', err);
    toast('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    return false;
  }
}

function openLocalSaveModal() {
  if (!currentQuizPool?.length) {
    toast('No active quiz to save');
    return;
  }
  const metaList = getLocalSavesMeta();
  metaList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const currentSaveId = activeQuizSessionId.startsWith('local_') ? activeQuizSessionId.replace(/^local_/, '') : '';
  const currentSaveMeta = currentSaveId ? metaList.find(s => s.id === currentSaveId) : null;

  let existingSavesHtml = '';
  if (metaList.length > 0) {
    existingSavesHtml = `
      <div style="margin-top:8px">
        <div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">
          🔄 เลือกเซฟเดิมที่ต้องการบันทึกทับ (Overwrite)
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;max-height:280px;overflow-y:auto;padding-right:2px">
          ${metaList.map(s => {
            const isCurrent = s.id === currentSaveId;
            return `
              <div class="zyz-save-card" style="${isCurrent ? 'border-color:var(--accent);background:rgba(52,199,89,.04)' : ''}">
                <div class="zyz-save-top">
                  <div class="zyz-save-name">
                    ${escapeHtml(s.name)}
                    ${isCurrent ? `<span class="zyz-badge" style="background:rgba(52,199,89,.15);color:var(--accent);margin-left:6px">● เซฟปัจจุบัน</span>` : ''}
                  </div>
                  <span class="zyz-badge">${escapeHtml(s.typeStr || 'Quiz')}</span>
                </div>
                <div class="zyz-save-meta">
                  <span class="zyz-save-stat">📅 ${escapeHtml(s.date || '')}</span>
                  <span class="zyz-save-stat">📝 ข้อ ${s.currentQuestion || 1}/${s.totalQuestions || 0}</span>
                  <span class="zyz-save-stat" style="color:var(--accent)">✓ ถูก ${s.correct || 0}</span>
                  <span class="zyz-save-stat" style="color:var(--orange)">✕ ตกหล่น ${s.missed || 0}</span>
                </div>
                <div class="zyz-save-actions">
                  <button type="button" class="zyz-btn-overwrite" data-save-id="${s.id}">
                    🔄 เซฟทับอันนี้
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  const content = `
    <div class="zyz-modal-header">
      <div style="display:flex;align-items:center;gap:10px">
        <button type="button" class="zyz-modal-back-btn" id="zyzLocalSaveBackBtn" title="ย้อนกลับ">←</button>
        <h3 class="zyz-modal-title">💾 บันทึกแบบฝึกหัด (Local)</h3>
      </div>
      <button type="button" class="zyz-modal-close-btn" aria-label="Close" onclick="closeStorageModal()">✕</button>
    </div>
    <div class="zyz-modal-body">
      ${currentSaveMeta ? `
        <button type="button" class="zyz-choice-btn" id="zyzOverwriteCurrentBtn" style="border-color:var(--accent);background:rgba(52,199,89,.06)">
          <div class="zyz-choice-icon" style="color:var(--accent)">🔄</div>
          <div class="zyz-choice-content">
            <div class="zyz-choice-title" style="color:var(--accent)">บันทึกทับเซฟปัจจุบัน: ${escapeHtml(currentSaveMeta.name)}</div>
            <div class="zyz-choice-desc">อัปเดตความคืบหน้าล่าสุดลงในเซฟนี้ทันที</div>
          </div>
        </button>
      ` : ''}
      <button type="button" class="zyz-choice-btn" id="zyzCreateNewSaveBtn">
        <div class="zyz-choice-icon">➕</div>
        <div class="zyz-choice-content">
          <div class="zyz-choice-title">สร้างเซฟใหม่ (Create New Save)</div>
          <div class="zyz-choice-desc">บันทึกเป็นแบบฝึกหัดรายการใหม่ โดยไม่ทับข้อมูลเก่า</div>
        </div>
      </button>
      ${existingSavesHtml}
    </div>
  `;

  openStorageModal(content, (card) => {
    card.querySelector('#zyzLocalSaveBackBtn')?.addEventListener('click', () => {
      showSaveChoiceModal();
    });
    card.querySelector('#zyzCreateNewSaveBtn')?.addEventListener('click', () => {
      handleCreateNewLocalSave();
    });
    if (currentSaveMeta) {
      card.querySelector('#zyzOverwriteCurrentBtn')?.addEventListener('click', () => {
        overwriteLocalSave(currentSaveMeta.id);
      });
    }
    card.querySelectorAll('.zyz-btn-overwrite').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-save-id');
        overwriteLocalSave(id);
      });
    });
  });
}

// ── DYNAMIC MODAL DOM & STYLES (No HTML Clutter) ──────────────────────────
function ensureStorageStyles() {
  if (document.getElementById('zyz-storage-styles')) return;
  const style = document.createElement('style');
  style.id = 'zyz-storage-styles';
  style.textContent = `
    .zyz-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 5000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: clamp(14px, 3vw, 28px);
      background: rgba(10, 11, 12, 0.84);
      backdrop-filter: blur(12px);
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .zyz-modal-overlay.open {
      opacity: 1;
      visibility: visible;
    }
    .zyz-modal-card {
      width: min(100%, 540px);
      max-height: min(88vh, 760px);
      display: flex;
      flex-direction: column;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow);
      overflow: hidden;
      transform: scale(0.96) translateY(8px);
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .zyz-modal-overlay.open .zyz-modal-card {
      transform: scale(1) translateY(0);
    }
    .zyz-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      background: var(--surface2);
      border-bottom: 1px solid var(--border);
    }
    .zyz-modal-title {
      margin: 0;
      font-size: 17px;
      font-weight: 700;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .zyz-modal-close-btn,
    .zyz-modal-back-btn {
      background: transparent;
      border: none;
      color: var(--text2);
      font-size: 20px;
      line-height: 1;
      padding: 6px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      min-height: 44px;
      min-width: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
    }
    .zyz-modal-close-btn:hover,
    .zyz-modal-back-btn:hover {
      background: var(--surface3);
      color: var(--text);
    }
    .zyz-modal-body {
      padding: 18px 20px;
      overflow-y: auto;
      overscroll-behavior: contain;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .zyz-choice-btn {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
      width: 100%;
      min-height: 64px;
      text-align: left;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      color: var(--text);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.1s;
    }
    .zyz-choice-btn:hover {
      background: var(--surface3);
      border-color: var(--accent);
      transform: translateY(-1px);
    }
    .zyz-choice-btn:active {
      transform: scale(0.99);
    }
    .zyz-choice-icon {
      font-size: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 46px;
      height: 46px;
      border-radius: var(--radius-sm);
      background: var(--surface);
      border: 1px solid var(--border);
      flex-shrink: 0;
    }
    .zyz-choice-content {
      flex: 1;
      min-width: 0;
    }
    .zyz-choice-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 3px;
    }
    .zyz-choice-desc {
      font-size: 12px;
      color: var(--text2);
      line-height: 1.4;
    }

    /* Saves List Cards */
    .zyz-save-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px 16px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      transition: border-color 0.15s;
    }
    .zyz-save-card:hover {
      border-color: var(--border-strong);
    }
    .zyz-save-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }
    .zyz-save-name {
      font-size: 15px;
      font-weight: 700;
      color: var(--text);
      word-break: break-word;
      line-height: 1.35;
    }
    .zyz-badge {
      display: inline-flex;
      align-items: center;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 6px;
      background: var(--surface3);
      color: var(--accent);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .zyz-save-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      color: var(--text2);
    }
    .zyz-save-stat {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .zyz-save-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 4px;
      padding-top: 10px;
      border-top: 1px solid rgba(255,255,255,0.05);
    }
    .zyz-btn-load {
      min-height: 40px;
      padding: 8px 16px;
      border-radius: var(--radius-sm);
      background: var(--accent);
      color: var(--accent-ink);
      font-weight: 700;
      font-size: 13px;
      border: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: filter 0.15s, transform 0.1s;
    }
    .zyz-btn-load:hover {
      filter: brightness(1.1);
    }
    .zyz-btn-load:active {
      transform: scale(0.97);
    }
    .zyz-btn-delete {
      min-height: 40px;
      padding: 8px 14px;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--danger);
      border: 1px solid rgba(220, 160, 165, 0.3);
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: background 0.15s, border-color 0.15s;
    }
    .zyz-btn-delete:hover {
      background: rgba(220, 160, 165, 0.12);
      border-color: var(--danger);
    }
    .zyz-btn-overwrite {
      min-height: 38px;
      padding: 6px 14px;
      border-radius: var(--radius-sm);
      background: rgba(255, 149, 0, 0.12);
      color: var(--orange);
      font-weight: 700;
      font-size: 13px;
      border: 1px solid rgba(255, 149, 0, 0.35);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.15s, border-color 0.15s, transform 0.1s;
    }
    .zyz-btn-overwrite:hover {
      background: rgba(255, 149, 0, 0.22);
      border-color: var(--orange);
    }
    .zyz-btn-overwrite:active {
      transform: scale(0.97);
    }
    .zyz-empty-state {
      text-align: center;
      padding: 40px 16px;
      color: var(--text2);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .zyz-empty-icon {
      font-size: 42px;
      margin-bottom: 4px;
      opacity: 0.75;
    }
    .zyz-empty-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--text);
    }
    .zyz-empty-sub {
      font-size: 13px;
      max-width: 320px;
      line-height: 1.5;
      color: var(--muted);
    }
    @media (prefers-reduced-motion: reduce) {
      .zyz-modal-overlay,
      .zyz-modal-card,
      .zyz-choice-btn,
      .zyz-btn-load,
      .zyz-btn-delete {
        transition: none !important;
        transform: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function handleStorageModalKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeStorageModal();
  }
}

let storageModalCloseTimer = null;

function closeStorageModal() {
  pendingQuitAfterSave = false;
  const overlay = document.getElementById('zyzStorageModalOverlay');
  if (overlay) {
    overlay.classList.remove('open');
    document.removeEventListener('keydown', handleStorageModalKeydown);
    if (storageModalCloseTimer) clearTimeout(storageModalCloseTimer);
    storageModalCloseTimer = setTimeout(() => {
      storageModalCloseTimer = null;
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }, 200);
  }

  // Resume quiz timer if active and currently unanswered
  try {
    const q = parseQ();
    if (q && !q.checked && document.getElementById('qEnginePane')?.style.display !== 'none') {
      startTimer();
    }
  } catch (_) {}
}

function openStorageModal(htmlContent, bindEvents) {
  ensureStorageStyles();
  if (storageModalCloseTimer) {
    clearTimeout(storageModalCloseTimer);
    storageModalCloseTimer = null;
  }
  let overlay = document.getElementById('zyzStorageModalOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'zyzStorageModalOverlay';
    overlay.className = 'zyz-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('tabindex', '-1');
    overlay.innerHTML = `<div class="zyz-modal-card" role="document"></div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeStorageModal();
    });
  }

  const card = overlay.querySelector('.zyz-modal-card');
  card.innerHTML = htmlContent;
  if (bindEvents) bindEvents(card);

  requestAnimationFrame(() => {
    overlay.classList.add('open');
  });

  document.removeEventListener('keydown', handleStorageModalKeydown);
  document.addEventListener('keydown', handleStorageModalKeydown);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showSaveChoiceModal() {
  const content = `
    <div class="zyz-modal-header">
      <h3 class="zyz-modal-title">💾 บันทึกแบบฝึกหัด (Save)</h3>
      <button type="button" class="zyz-modal-close-btn" aria-label="Close" onclick="closeStorageModal()">✕</button>
    </div>
    <div class="zyz-modal-body">
      <button type="button" class="zyz-choice-btn" id="zyzSaveLocalBtn">
        <div class="zyz-choice-icon">💾</div>
        <div class="zyz-choice-content">
          <div class="zyz-choice-title">บันทึกลงเครื่อง (Local)</div>
          <div class="zyz-choice-desc">บันทึกไว้ใน Local Storage ของเครื่อง ข้อมูลไม่หาย สะดวก ไม่ต้องโหลดไฟล์</div>
        </div>
      </button>
      <button type="button" class="zyz-choice-btn" id="zyzSaveZzqBtn">
        <div class="zyz-choice-icon">📥</div>
        <div class="zyz-choice-content">
          <div class="zyz-choice-title">ดาวน์โหลดไฟล์ (.zzq)</div>
          <div class="zyz-choice-desc">บันทึกเป็นไฟล์ .zzq มาตรฐาน Zyzzyva เพื่อนำไปเปิดในโปรแกรมอื่น</div>
        </div>
      </button>
    </div>
  `;
  openStorageModal(content, (card) => {
    card.querySelector('#zyzSaveLocalBtn')?.addEventListener('click', () => {
      openLocalSaveModal();
    });
    card.querySelector('#zyzSaveZzqBtn')?.addEventListener('click', () => {
      closeStorageModal();
      saveCurrentZzq();
    });
  });
}

function showLoadChoiceModal() {
  const content = `
    <div class="zyz-modal-header">
      <h3 class="zyz-modal-title">📂 โหลดแบบฝึกหัด (Load)</h3>
      <button type="button" class="zyz-modal-close-btn" aria-label="Close" onclick="closeStorageModal()">✕</button>
    </div>
    <div class="zyz-modal-body">
      <button type="button" class="zyz-choice-btn" id="zyzLoadLocalBtn">
        <div class="zyz-choice-icon">💾</div>
        <div class="zyz-choice-content">
          <div class="zyz-choice-title">โหลดจากเครื่อง (Local)</div>
          <div class="zyz-choice-desc">เลือกจากรายการแบบฝึกหัดที่บันทึกไว้ในเครื่องนี้</div>
        </div>
      </button>
      <button type="button" class="zyz-choice-btn" id="zyzLoadZzqBtn">
        <div class="zyz-choice-icon">📂</div>
        <div class="zyz-choice-content">
          <div class="zyz-choice-title">เปิดไฟล์ (.zzq)</div>
          <div class="zyz-choice-desc">เปิดไฟล์แบบฝึกหัด .zzq หรือไฟล์คำศัพท์จากเครื่องของคุณ</div>
        </div>
      </button>
    </div>
  `;
  openStorageModal(content, (card) => {
    card.querySelector('#zyzLoadLocalBtn')?.addEventListener('click', () => {
      openLocalSavesModal();
    });
    card.querySelector('#zyzLoadZzqBtn')?.addEventListener('click', () => {
      closeStorageModal();
      document.getElementById('fInp')?.click();
    });
  });
}

function openLocalSavesModal() {
  const metaList = getLocalSavesMeta();
  renderLocalSavesModal(metaList);
}

function renderLocalSavesModal(metaList) {
  // Sort metadata: newest first
  metaList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  let bodyHtml = '';
  if (!metaList.length) {
    bodyHtml = `
      <div class="zyz-empty-state">
        <div class="zyz-empty-icon">📭</div>
        <div class="zyz-empty-title">ยังไม่มีแบบฝึกหัดในเครื่อง</div>
        <div class="zyz-empty-sub">เมื่อเริ่มทำแบบฝึกหัด คุณสามารถกดปุ่ม Save เพื่อบันทึกความคืบหน้าไว้เล่นต่อภายหลังได้</div>
      </div>
    `;
  } else {
    bodyHtml = metaList.map(s => {
      const qProgress = `ข้อ ${s.currentQuestion || 1}/${s.totalQuestions || 0}`;
      const correctStat = `ถูก ${s.correct ?? 0}`;
      const missedStat = `ตกหล่น ${s.missed ?? 0}`;
      const dateText = s.date || '';
      const safeName = escapeHtml(s.name || 'Untitled Quiz');
      const safeId = escapeHtml(s.id);
      const safeType = escapeHtml(s.typeStr || 'Anagrams');

      return `
        <div class="zyz-save-card" data-save-id="${safeId}">
          <div class="zyz-save-top">
            <span class="zyz-save-name">${safeName}</span>
            <span class="zyz-badge">${safeType}</span>
          </div>
          <div class="zyz-save-meta">
            <span class="zyz-save-stat">🕒 ${escapeHtml(dateText)}</span>
            <span class="zyz-save-stat">🎯 ${escapeHtml(qProgress)}</span>
            <span class="zyz-save-stat" style="color:var(--orange)">✓ ${escapeHtml(correctStat)}</span>
            <span class="zyz-save-stat" style="color:var(--danger)">✗ ${escapeHtml(missedStat)}</span>
          </div>
          <div class="zyz-save-actions">
            <button type="button" class="zyz-btn-delete" data-del-id="${safeId}" aria-label="ลบเซฟ ${safeName}">
              🗑️ ลบ
            </button>
            <button type="button" class="zyz-btn-load" data-load-id="${safeId}" aria-label="โหลดเซฟ ${safeName}">
              ▶️ โหลด (Load)
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  const content = `
    <div class="zyz-modal-header">
      <div style="display:flex;align-items:center;gap:8px;">
        <button type="button" class="zyz-modal-back-btn" id="zyzBackToChoiceBtn" aria-label="Back to load options" title="ย้อนกลับ">←</button>
        <h3 class="zyz-modal-title">
          💾 แบบฝึกหัดในเครื่อง
          <span class="zyz-badge" style="margin-left:4px">${metaList.length} เซฟ</span>
        </h3>
      </div>
      <button type="button" class="zyz-modal-close-btn" aria-label="Close" onclick="closeStorageModal()">✕</button>
    </div>
    <div class="zyz-modal-body" style="max-height:min(65vh, 520px);">
      ${bodyHtml}
    </div>
  `;

  openStorageModal(content, (card) => {
    // Bind back button
    card.querySelector('#zyzBackToChoiceBtn')?.addEventListener('click', () => {
      showLoadChoiceModal();
    });
    // Bind load buttons
    card.querySelectorAll('[data-load-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-load-id');
        if (loadLocalSave(id)) {
          closeStorageModal();
        }
      });
    });

    // Bind delete buttons
    card.querySelectorAll('[data-del-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-del-id');
        const target = metaList.find(s => s.id === id);
        if (target && deleteLocalSave(id, target.name)) {
          const updated = getLocalSavesMeta();
          renderLocalSavesModal(updated);
        }
      });
    });
  });
}

// Attach public API to window
window.handleSaveQuizClick = handleSaveQuizClick;
window.handleLoadQuizClick = handleLoadQuizClick;
window.buildZzqXmlString = buildZzqXmlString;
window.saveCurrentZzq = saveCurrentZzq;
window.openLocalSavesModal = openLocalSavesModal;
window.closeStorageModal = closeStorageModal;
window.quitQuiz = quitQuiz;
window.forceQuitQuiz = forceQuitQuiz;
window.showQuitConfirmModal = showQuitConfirmModal;

// ── LOAD .zzq ──────────────────────────────────────────────────────────
function loadZzq(event) {
  const file = event.target.files[0]; if (!file) return;
  // Reset input so the same file can be reloaded
  event.target.value = '';
  const reader = new FileReader();
  const rawFileName = file.name ? file.name.replace(/\.zzq$/i, '').trim() : 'quiz_file';
  reader.onload = e => {
    try {
      const content = e.target.result.trim();
      content.startsWith('<?xml') ? loadXmlZzq(content, '.zzq', rawFileName) : loadPlainWordList(content, rawFileName);
    } catch(err) {
      console.error(err); toast('Error parsing quiz file');
    }
  };
  reader.readAsText(file);
}

function loadPlainWordList(content, fileName = 'words') {
  const words = content.split(/\r?\n/).map(w => w.trim().toUpperCase()).filter(w => dictSet.has(w));
  if (!words.length) { toast('No valid words in file'); return; }
  activeSeed1 = Math.floor(Date.now() / 1000);
  activeSeed2 = SESSION_SEED2;
  const safeName = (fileName || 'words').replace(/[^a-zA-Z0-9_\-\u0E00-\u0E7F]/g, '_');
  activeQuizSessionId = `plain_${safeName}_${Date.now()}`;
  sessionIncorrect = {};
  saveSessionIncorrect();
  currentQuizPool  = words;
  stopRackCycleTimer();
  isQuizSaved = false;
  pendingQuitAfterSave = false;
  Module.generateQuiz(sel('qTypeSelect'), words.join(' '), 3);
  showQuizPane();
  loadCurrentQuestion();
  toast(`Loaded ${words.length} words`);
}

function loadXmlZzq(content, source = '.zzq', sessionContextId = '') {
  if (!cppInitialized || !dict?.length) {
    toast('พจนานุกรมกำลังเตรียมความพร้อม กรุณารอสักครู่…');
    return false;
  }
  const xml = new DOMParser().parseFromString(content, 'text/xml');
  const quizNode = xml.querySelector('zyzzyva-quiz');
  if (!quizNode) { toast('Invalid .zzq file'); return false; }

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
  if (!rnd) { toast('.zzq missing <randomizer>'); return false; }
  activeSeed1 = parseInt(rnd.getAttribute('seed'))  || Math.floor(Date.now() / 1000);
  activeSeed2 = parseInt(rnd.getAttribute('seed2')) || SESSION_SEED2;

  // Establish isolated activeQuizSessionId BEFORE loading session incorrect data
  if (source === 'local') {
    activeQuizSessionId = 'local_' + (sessionContextId || 'unknown');
  } else {
    const safeName = (sessionContextId || 'file').replace(/[^a-zA-Z0-9_\-\u0E00-\u0E7F]/g, '_');
    activeQuizSessionId = `file_${safeName}_${activeSeed1}_${activeSeed2}`;
  }

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
  if (!pool.length) { alert('No matching words found'); return false; }

  // Clear previous quiz review history so results do not bleed across quizzes
  quizHistory = [];

  // Reproduce Zyzzyva's exact question order using saved seeds
  currentQuizPool = buildOrderedPool(pool, typeVal, orderVal, activeSeed1, activeSeed2);
  quizTimeLimit   = sel('qTimerSelect');
  Module.generateQuiz(typeVal, currentQuizPool.join(' '), (orderVal === 1 || orderVal === 2) ? 3 : orderVal);

  // Restore progress
  quizAnalyzer.reset();
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

    correctWords.forEach(w => {
      if (w && !quizHistory.some(h => h.word === w)) quizHistory.push({ word: w, status: 'correct' });
    });
    incorrectWords.forEach(w => {
      if (w && !quizHistory.some(h => h.word === w)) quizHistory.push({ word: w, status: 'missed' });
    });

    // Populate quizAnalyzer
    quizAnalyzer.correctCount = correct;
    xml.querySelectorAll('incorrect-responses response').forEach(r => {
      const w = r.getAttribute('word')?.trim().toUpperCase();
      const cnt = parseInt(r.getAttribute('count')) || 1;
      if (w) {
        quizAnalyzer.incorrectWords.add(w);
        quizAnalyzer.incorrectFrequency.set(w, cnt);
        quizAnalyzer.incorrectCount += cnt;
      }
    });
    xml.querySelectorAll('missed-responses response').forEach(r => {
      const w = r.getAttribute('word')?.trim().toUpperCase();
      const cnt = parseInt(r.getAttribute('count')) || 1;
      if (w) {
        quizAnalyzer.missedWords.add(w);
        quizAnalyzer.missedFrequency.set(w, cnt);
      }
    });
    let totalMissed = 0;
    for (const cnt of quizAnalyzer.missedFrequency.values()) totalMissed += cnt;
    quizAnalyzer.totalWords = correct + totalMissed;
  }

  // Load session data — from our XML comment (ignored by Zyzzyva)
  sessionIncorrect = {};
  // Walk raw DOM for comment nodes (querySelector can't find comments)
  const walker = document.createTreeWalker(xml, NodeFilter.SHOW_COMMENT, null, false);
  while (walker.nextNode()) {
    const text = walker.currentNode.nodeValue?.trim() || '';
    const m    = text.match(/^(?:arctic|zyzzylu)-session:\s*(.+)$/);
    if (m) {
      m[1].split(',').forEach(pair => {
        const [w, c] = pair.trim().split(':');
        if (w) sessionIncorrect[w.toUpperCase()] = parseInt(c) || 1;
      });
      break;
    }
  }

  // Fallback: if no comment session data, restore from <incorrect-responses> if present
  if (Object.keys(sessionIncorrect).length === 0) {
    xml.querySelectorAll('incorrect-responses response').forEach(r => {
      const w = r.getAttribute('word')?.trim().toUpperCase();
      const cnt = parseInt(r.getAttribute('count')) || 1;
      if (w) sessionIncorrect[w] = cnt;
    });
  }

  // Also merge with any session data in localStorage under this session's isolated key
  loadSessionIncorrect();
  saveSessionIncorrect();

  stopRackCycleTimer();
  isQuizSaved = true;
  pendingQuitAfterSave = false;

  showQuizPane();
  loadCurrentQuestion();
  toast(source === 'local' ? `โหลดแบบฝึกหัดสำเร็จ — ${pool.length} คำ` : `Loaded .zzq — ${pool.length} words`);
  return true;
}

// ── TIMER ──────────────────────────────────────────────────────────────
function stopTimer() {
  if (timerInterval !== null) clearInterval(timerInterval);
  timerInterval = null;
}

function startTimer() {
  const el = document.getElementById('qTimerDisplay');
  stopTimer();
  if (quizTimeLimit <= 0 || parseQ()?.checked) { if (el) el.innerText = ''; return; }
  quizTimeLeft = quizTimeLimit;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    if (parseQ()?.checked) { stopTimer(); return; }
    quizTimeLeft--;
    updateTimerDisplay();
    if (quizTimeLeft <= 0) { stopTimer(); handleCheck(); }
  }, 1000);
}

function updateTimerDisplay() {
  const el = document.getElementById('qTimerDisplay'); if (!el) return;
  const m = Math.floor(quizTimeLeft / 60), s = quizTimeLeft % 60;
  el.innerText   = `⏱ ${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  el.style.color = quizTimeLeft <= 10 ? 'var(--danger)' : 'var(--orange)';
}

// ── HELPERS ────────────────────────────────────────────────────────────
function parseQ() {
  try {
    const s = Module.getCurrentQuestionJson();
    return (!s || s === '{}') ? null : JSON.parse(s);
  } catch(_) {
    return null;
  }
}

function parseProg() {
  try {
    return JSON.parse(Module.getProgressJson());
  } catch(_) {
    return {};
  }
}

function sel(id) {
  return parseInt(document.getElementById(id)?.value || '0', 10);
}

function showQuizPane() {
  const settings = document.getElementById('qSettingsPane');
  const engine = document.getElementById('qEnginePane');
  if (settings) settings.style.display = 'none';
  if (engine) engine.style.display = 'block';
}

function shake(el) {
  if (!el) return;
  el.classList.remove('shake-input');
  void el.offsetWidth;
  el.classList.add('shake-input');
  setTimeout(() => el.classList.remove('shake-input'), 350);
}

function statRow(label, val, col) {
  return `<div style="display:flex;justify-content:space-between">
    <span style="color:${col}">${label}</span>
    <span class="mono" style="font-weight:700;color:${col}">${val}</span></div>`;
}

function downloadBlob(text, filename) {
  const a = document.createElement('a');
  a.download = filename;
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function toggleSavedWord(word, btn) {
  toggleSave(word);
  const s = saved.includes(word);
  btn.style.color = s ? 'var(--orange)' : 'var(--text2)';
  btn.innerText   = s ? '★' : '☆';
}

// ── WORD JUDGE CONTROLLER & SOUND ENGINE ────────────────────────────
// Rapid challenge validator with Web Audio API sound synthesis and IndexedDB custom audio

let judgeReturnFocus = null;

// ── JUDGE SOUND SETTINGS ─────────────────────────────────────────────
const JUDGE_SOUND_DEFAULTS = {
  soundEnabled: true,
  validTone: 'chime',     // 'chime', 'high-ding', 'two-tone', 'custom', 'none'
  invalidTone: 'buzzer'   // 'buzzer', 'thud', 'descending', 'custom', 'none'
};

let judgeSoundSettings = { ...JUDGE_SOUND_DEFAULTS };

function loadJudgeSoundSettings() {
  try {
    const raw = localStorage.getItem('zyz_judge_sound_v1');
    if (raw) judgeSoundSettings = { ...JUDGE_SOUND_DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {}
}

function saveJudgeSoundSettings() {
  try {
    localStorage.setItem('zyz_judge_sound_v1', JSON.stringify(judgeSoundSettings));
  } catch (_) {}
}

loadJudgeSoundSettings();

// ── AUDIO CONTEXT & INDEXEDDB SOUND STORAGE ─────────────────────────
function getJudgeAudioContext() {
  if (typeof getClockAudioContext === 'function') {
    const ctx = getClockAudioContext();
    if (ctx) return ctx;
  }
  if (!window._judgeAudioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) window._judgeAudioCtx = new AudioContextClass();
  }
  if (window._judgeAudioCtx && window._judgeAudioCtx.state === 'suspended') {
    window._judgeAudioCtx.resume().catch(() => {});
  }
  return window._judgeAudioCtx;
}

const JUDGE_AUDIO_DB_NAME = 'ZyzzyluClockAudioDB';
const JUDGE_AUDIO_STORE_NAME = 'custom_sounds';

function openJudgeAudioDB() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const req = indexedDB.open(JUDGE_AUDIO_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(JUDGE_AUDIO_STORE_NAME)) {
        db.createObjectStore(JUDGE_AUDIO_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

let judgeCustomAudioBuffers = {};
let judgeCustomAudioUrls = {};
let judgeCustomAudioMeta = {};

async function initJudgeCustomAudio() {
  try {
    const db = await openJudgeAudioDB();
    if (!db) return;
    const records = await new Promise((resolve) => {
      const tx = db.transaction(JUDGE_AUDIO_STORE_NAME, 'readonly');
      const store = tx.objectStore(JUDGE_AUDIO_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    const ctx = getJudgeAudioContext();
    for (const rec of records) {
      if (rec.id === 'judge_valid' || rec.id === 'judge_invalid') {
        judgeCustomAudioMeta[rec.id] = { name: rec.name, type: rec.type, size: rec.size };
        if (rec.data) {
          try {
            judgeCustomAudioUrls[rec.id] = URL.createObjectURL(new Blob([rec.data], { type: rec.type || 'audio/mpeg' }));
          } catch (_) {}

          if (ctx) {
            try {
              judgeCustomAudioBuffers[rec.id] = await ctx.decodeAudioData(rec.data.slice(0));
            } catch (_) {}
          }
        }
      }
    }
    syncJudgeSoundSettingsUI();
  } catch (err) {
    console.warn('initJudgeCustomAudio error:', err);
  }
}

async function saveJudgeCustomAudio(id, file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const db = await openJudgeAudioDB();
    if (db) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(JUDGE_AUDIO_STORE_NAME, 'readwrite');
        const store = tx.objectStore(JUDGE_AUDIO_STORE_NAME);
        store.put({
          id: id,
          name: file.name,
          type: file.type || 'audio/mpeg',
          size: file.size,
          data: arrayBuffer,
          updatedAt: Date.now()
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    judgeCustomAudioMeta[id] = { name: file.name, type: file.type, size: file.size };
    if (judgeCustomAudioUrls[id]) {
      try { URL.revokeObjectURL(judgeCustomAudioUrls[id]); } catch (_) {}
    }
    try {
      judgeCustomAudioUrls[id] = URL.createObjectURL(new Blob([arrayBuffer], { type: file.type || 'audio/mpeg' }));
    } catch (_) {}

    const ctx = getJudgeAudioContext();
    if (ctx) {
      try {
        judgeCustomAudioBuffers[id] = await ctx.decodeAudioData(arrayBuffer.slice(0));
      } catch (e) {
        console.warn('decodeAudioData error, will use URL fallback:', e);
      }
    }

    if (id === 'judge_valid') judgeSoundSettings.validTone = 'custom';
    else if (id === 'judge_invalid') judgeSoundSettings.invalidTone = 'custom';

    saveJudgeSoundSettings();
    syncJudgeSoundSettingsUI();
    if (typeof toast === 'function') toast(`อัปโหลดเสียง "${file.name}" เรียบร้อย`);
  } catch (err) {
    console.error('Failed to save judge audio:', err);
    if (typeof toast === 'function') toast('ไม่สามารถบันทึกไฟล์เสียงได้');
  }
}

async function deleteJudgeCustomAudio(id) {
  try {
    const db = await openJudgeAudioDB();
    if (db) {
      await new Promise((resolve) => {
        const tx = db.transaction(JUDGE_AUDIO_STORE_NAME, 'readwrite');
        const store = tx.objectStore(JUDGE_AUDIO_STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }

    if (judgeCustomAudioUrls[id]) {
      try { URL.revokeObjectURL(judgeCustomAudioUrls[id]); } catch (_) {}
      delete judgeCustomAudioUrls[id];
    }
    delete judgeCustomAudioBuffers[id];
    delete judgeCustomAudioMeta[id];

    if (id === 'judge_valid' && judgeSoundSettings.validTone === 'custom') {
      judgeSoundSettings.validTone = JUDGE_SOUND_DEFAULTS.validTone;
    } else if (id === 'judge_invalid' && judgeSoundSettings.invalidTone === 'custom') {
      judgeSoundSettings.invalidTone = JUDGE_SOUND_DEFAULTS.invalidTone;
    }

    saveJudgeSoundSettings();
    syncJudgeSoundSettingsUI();
    if (typeof toast === 'function') toast('ลบไฟล์เสียงเรียบร้อย');
  } catch (err) {
    console.error('Failed to delete judge audio:', err);
  }
}

async function judgeHandleUpload(id, input) {
  if (!input || !input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 20 * 1024 * 1024) {
    alert('ขนาดไฟล์ใหญ่เกินไป (กรุณาใช้ไฟล์ไม่เกิน 20MB)');
    input.value = '';
    return;
  }
  await saveJudgeCustomAudio(id, file);
  input.value = '';
}

function playJudgeAudioClip(id) {
  const ctx = getJudgeAudioContext();
  const buffer = judgeCustomAudioBuffers[id];
  if (ctx && buffer) {
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      return;
    } catch (_) {}
  }
  const url = judgeCustomAudioUrls[id];
  if (url) {
    try {
      const audio = new Audio(url);
      audio.play().catch(() => {});
    } catch (_) {}
  }
}

// ── SYNTHETIC SOUND GENERATION (Web Audio API) ───────────────────────
function playJudgeSyntheticTone(tone) {
  const ctx = getJudgeAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  if (tone === 'chime') {
    // Two-stage harmonic pleasant chime (D5 -> A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880, now + 0.08);
    gain2.gain.setValueAtTime(0.35, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.55);
  } else if (tone === 'high-ding') {
    // Pure crystal bell (C6)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046.5, now);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.45);
  } else if (tone === 'two-tone') {
    // Ascending major third (C5 -> E5)
    [523.25, 659.25].forEach((freq, idx) => {
      const t = now + idx * 0.1;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  } else if (tone === 'buzzer') {
    // Classic Scrabble tournament buzzer (sawtooth 140Hz -> 110Hz)
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.linearRampToValueAtTime(110, now + 0.35);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.28);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.38);
  } else if (tone === 'thud') {
    // Low double-thud
    [0, 0.12].forEach(offset => {
      const t = now + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(50, t + 0.15);
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  } else if (tone === 'descending') {
    // Two descending minor tones (440Hz -> 311Hz)
    [440, 311.13].forEach((freq, idx) => {
      const t = now + idx * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }
}

function playJudgeSound(isValid) {
  if (!judgeSoundSettings.soundEnabled) return;
  const tone = isValid ? judgeSoundSettings.validTone : judgeSoundSettings.invalidTone;
  if (!tone || tone === 'none') return;

  if (tone === 'custom') {
    const customId = isValid ? 'judge_valid' : 'judge_invalid';
    if (judgeCustomAudioBuffers[customId] || judgeCustomAudioUrls[customId]) {
      playJudgeAudioClip(customId);
      return;
    }
    // Fallback if custom file missing
    playJudgeSyntheticTone(isValid ? 'chime' : 'buzzer');
    return;
  }

  playJudgeSyntheticTone(tone);
}

function testJudgeSound(type) {
  const isValid = type === 'valid';
  playJudgeSound(isValid);
}

function toggleJudgeSoundEnabled(enabled) {
  judgeSoundSettings.soundEnabled = Boolean(enabled);
  saveJudgeSoundSettings();
}

function onJudgeToneChange(type, value) {
  if (type === 'valid') judgeSoundSettings.validTone = value;
  else if (type === 'invalid') judgeSoundSettings.invalidTone = value;
  saveJudgeSoundSettings();
  syncJudgeSoundSettingsUI();
  testJudgeSound(type);
}

function syncJudgeSoundSettingsUI() {
  const enableBox = document.getElementById('judgeSoundEnabled');
  if (enableBox) enableBox.checked = judgeSoundSettings.soundEnabled !== false;

  const validSel = document.getElementById('judgeValidToneSelect');
  if (validSel) validSel.value = judgeSoundSettings.validTone || 'chime';

  const invalidSel = document.getElementById('judgeInvalidToneSelect');
  if (invalidSel) invalidSel.value = judgeSoundSettings.invalidTone || 'buzzer';

  const validBadge = document.getElementById('judgeValidFileBadge');
  if (validBadge) {
    const meta = judgeCustomAudioMeta['judge_valid'];
    if (meta) {
      validBadge.style.display = 'inline-flex';
      validBadge.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px;">${escapeHtml(meta.name)}</span>
        <button type="button" onclick="deleteJudgeCustomAudio('judge_valid')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:11px;font-weight:700;padding:0 2px;" title="ลบไฟล์เสียง">✕</button>`;
    } else {
      validBadge.style.display = 'none';
      validBadge.innerHTML = '';
    }
  }

  const invalidBadge = document.getElementById('judgeInvalidFileBadge');
  if (invalidBadge) {
    const meta = judgeCustomAudioMeta['judge_invalid'];
    if (meta) {
      invalidBadge.style.display = 'inline-flex';
      invalidBadge.innerHTML = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px;">${escapeHtml(meta.name)}</span>
        <button type="button" onclick="deleteJudgeCustomAudio('judge_invalid')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:11px;font-weight:700;padding:0 2px;" title="ลบไฟล์เสียง">✕</button>`;
    } else {
      invalidBadge.style.display = 'none';
      invalidBadge.innerHTML = '';
    }
  }
}

// ── FULL-SCREEN JUDGE OVERLAY & VALIDATION ───────────────────────────
function chkChal() {
  const inp = document.getElementById('cInp');
  if (!inp) return;
  const val = inp.value.trim().toUpperCase();
  if (!val) return;
  const words = val.split(/\s+/);
  const allValid = words.every(w => dictSet.has(w));

  // Play corresponding sound
  playJudgeSound(allValid);

  const sym = document.getElementById('jSymbol');
  const stat = document.getElementById('jStatus');
  const subList = document.getElementById('jSubList');
  const overlay = document.getElementById('jOverlay');

  if (subList) subList.innerText = words.join(', ');

  if (allValid) {
    if (sym) { sym.innerText = "✓"; sym.style.color = "var(--accent)"; }
    if (stat) { stat.innerText = "VALID"; stat.style.color = "var(--accent)"; }
    overlay.classList.add('is-valid');
    overlay.classList.remove('is-invalid');
  } else {
    if (sym) { sym.innerText = "✕"; sym.style.color = "var(--danger)"; }
    if (stat) { stat.innerText = "NOT VALID"; stat.style.color = "var(--danger)"; }
    overlay.classList.add('is-invalid');
    overlay.classList.remove('is-valid');
  }

  judgeReturnFocus = document.activeElement;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');

  // Dismiss by pressing any key
  window.addEventListener('keydown', handleJudgeGlobalKey);
}

function closeJudgeOverlay() {
  const overlay = document.getElementById('jOverlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  window.removeEventListener('keydown', handleJudgeGlobalKey);

  const returnTarget = judgeReturnFocus || document.getElementById('cInp');
  if (returnTarget && typeof returnTarget.focus === 'function') returnTarget.focus();
  judgeReturnFocus = null;
}

function handleJudgeGlobalKey(e) {
  // Any keypress dismisses the overlay
  closeJudgeOverlay();
}

// Initialize custom audio on document load
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initJudgeCustomAudio();
    });
  } else {
    initJudgeCustomAudio();
  }
}

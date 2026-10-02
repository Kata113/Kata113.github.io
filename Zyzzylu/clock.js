// ── CHESS CLOCK ENGINE & UI CONTROLLER ─────────────────────────────
// Tournament chess clock module for Zyzzylu Scrabble toolkit.

// Standard tournament Scrabble allocates 25 minutes base time per player.
let clockBaseValues = [25 * 60, 25 * 60];
let clockValues = [...clockBaseValues];
let clockActiveSide = -1; // -1 indicates neutral state before any turn starts
let clockRunning = false;
let clockLastTick = 0;
let clockFrame = null;

// ── CHESS CLOCK SOUND ENGINE (Web Audio API + IndexedDB Custom Audio) ──
let clockAudioCtx = null;
let clockContinuousBuzzerSource = null;
let clockContinuousBuzzerGain = null;
let clockContinuousBuzzerHtmlAudio = null;

const CLOCK_SOUND_DEFAULTS = {
  soundEnabled: true,
  tapSoundEnabled: true,
  tapTone: 'click',            // 'click', 'wood-tap', 'digital-beep', 'soft', or 'custom'
  warn10Enabled: true,
  warn10Tone: 'high-beep',     // 'high-beep', 'chime', 'two-tone', or 'custom'
  countdownEnabled: true,
  countdownTone: 'tick',       // 'tick', 'beep', 'click', or 'custom'
  timeoutBuzzerEnabled: true,
  timeoutTone: 'buzzer',       // 'buzzer', 'alarm-siren', or 'custom'
  overtimeAlertEnabled: false, // "แต่ปกติไม่มีเสียง" -> default: false
  overtimeTone: 'double-beep', // 'double-beep', 'triple-beep', 'low-bell', 'pulse', or 'custom'
  overtimeMaxMinutes: 10       // -1 ถึง -10 นาที
};

let clockSoundSettings = { ...CLOCK_SOUND_DEFAULTS };

function loadClockSoundSettings() {
  try {
    const raw = localStorage.getItem('zyz_clock_sound_v1');
    if (raw) clockSoundSettings = { ...CLOCK_SOUND_DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {}
}

function saveClockSoundSettings() {
  try {
    localStorage.setItem('zyz_clock_sound_v1', JSON.stringify(clockSoundSettings));
  } catch (_) {}
}

loadClockSoundSettings();

function getClockAudioContext() {
  if (!clockAudioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) clockAudioCtx = new AudioContextClass();
  }
  if (clockAudioCtx && clockAudioCtx.state === 'suspended') {
    clockAudioCtx.resume().catch(() => {});
  }
  return clockAudioCtx;
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

// ── INDEXEDDB AUDIO STORAGE FOR CUSTOM SOUNDS ────────────────────────
const CLOCK_AUDIO_DB_NAME = 'ZyzzyluClockAudioDB';
const CLOCK_AUDIO_STORE_NAME = 'custom_sounds';

function openClockAudioDB() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const req = indexedDB.open(CLOCK_AUDIO_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(CLOCK_AUDIO_STORE_NAME)) {
        db.createObjectStore(CLOCK_AUDIO_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

let clockCustomAudioBuffers = {}; // id -> AudioBuffer
let clockCustomAudioUrls = {};    // id -> Object URL
let clockCustomAudioMeta = {};    // id -> { name, type, size }

async function initClockCustomAudio() {
  try {
    const db = await openClockAudioDB();
    if (!db) return;
    const records = await new Promise((resolve) => {
      const tx = db.transaction(CLOCK_AUDIO_STORE_NAME, 'readonly');
      const store = tx.objectStore(CLOCK_AUDIO_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    const ctx = getClockAudioContext();
    for (const rec of records) {
      clockCustomAudioMeta[rec.id] = { name: rec.name, type: rec.type, size: rec.size };
      if (rec.data) {
        try {
          clockCustomAudioUrls[rec.id] = URL.createObjectURL(new Blob([rec.data], { type: rec.type || 'audio/mpeg' }));
        } catch (_) {}

        if (ctx) {
          try {
            clockCustomAudioBuffers[rec.id] = await ctx.decodeAudioData(rec.data.slice(0));
          } catch (_) {}
        }
      }
    }
    syncClockSoundSettingsUI();
  } catch (err) {
    console.warn('initClockCustomAudio error:', err);
  }
}

async function saveClockCustomAudio(id, file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const db = await openClockAudioDB();
    if (db) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(CLOCK_AUDIO_STORE_NAME, 'readwrite');
        const store = tx.objectStore(CLOCK_AUDIO_STORE_NAME);
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

    clockCustomAudioMeta[id] = { name: file.name, type: file.type, size: file.size };
    if (clockCustomAudioUrls[id]) {
      try { URL.revokeObjectURL(clockCustomAudioUrls[id]); } catch (_) {}
    }
    try {
      clockCustomAudioUrls[id] = URL.createObjectURL(new Blob([arrayBuffer], { type: file.type || 'audio/mpeg' }));
    } catch (_) {}

    const ctx = getClockAudioContext();
    if (ctx) {
      try {
        clockCustomAudioBuffers[id] = await ctx.decodeAudioData(arrayBuffer.slice(0));
      } catch (e) {
        console.warn('decodeAudioData error, will use URL fallback:', e);
      }
    }

    // Automatically switch the setting to custom
    if (id === 'tap') clockSoundSettings.tapTone = 'custom';
    else if (id === 'warn10') clockSoundSettings.warn10Tone = 'custom';
    else if (id === 'countdown') clockSoundSettings.countdownTone = 'custom';
    else if (id === 'timeout') clockSoundSettings.timeoutTone = 'custom';
    else if (id === 'overtime') clockSoundSettings.overtimeTone = 'custom';

    saveClockSoundSettings();
    syncClockSoundSettingsUI();
    if (typeof toast === 'function') toast(`อัปโหลดเสียง "${file.name}" เรียบร้อย`);
  } catch (err) {
    console.error('Failed to save custom audio:', err);
    if (typeof toast === 'function') toast('ไม่สามารถบันทึกไฟล์เสียงได้');
  }
}

async function deleteClockCustomAudio(id) {
  try {
    const db = await openClockAudioDB();
    if (db) {
      await new Promise((resolve) => {
        const tx = db.transaction(CLOCK_AUDIO_STORE_NAME, 'readwrite');
        const store = tx.objectStore(CLOCK_AUDIO_STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }

    if (clockCustomAudioUrls[id]) {
      try { URL.revokeObjectURL(clockCustomAudioUrls[id]); } catch (_) {}
      delete clockCustomAudioUrls[id];
    }
    delete clockCustomAudioBuffers[id];
    delete clockCustomAudioMeta[id];

    // Revert settings to default presets if was set to custom
    if (id === 'tap' && clockSoundSettings.tapTone === 'custom') {
      clockSoundSettings.tapTone = CLOCK_SOUND_DEFAULTS.tapTone;
    } else if (id === 'warn10' && clockSoundSettings.warn10Tone === 'custom') {
      clockSoundSettings.warn10Tone = CLOCK_SOUND_DEFAULTS.warn10Tone;
    } else if (id === 'countdown' && clockSoundSettings.countdownTone === 'custom') {
      clockSoundSettings.countdownTone = CLOCK_SOUND_DEFAULTS.countdownTone;
    } else if (id === 'timeout' && clockSoundSettings.timeoutTone === 'custom') {
      clockSoundSettings.timeoutTone = CLOCK_SOUND_DEFAULTS.timeoutTone;
    } else if (id === 'overtime' && clockSoundSettings.overtimeTone === 'custom') {
      clockSoundSettings.overtimeTone = CLOCK_SOUND_DEFAULTS.overtimeTone;
    }

    saveClockSoundSettings();
    syncClockSoundSettingsUI();
    if (typeof toast === 'function') toast('ลบไฟล์เสียงเรียบร้อย');
  } catch (err) {
    console.error('Failed to delete custom audio:', err);
  }
}

async function clockHandleUpload(id, input) {
  if (!input || !input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 20 * 1024 * 1024) {
    alert('ขนาดไฟล์ใหญ่เกินไป (กรุณาใช้ไฟล์ไม่เกิน 20MB)');
    input.value = '';
    return;
  }
  await saveClockCustomAudio(id, file);
  input.value = '';
}

function playAudioClip(id, loop = false) {
  const ctx = getClockAudioContext();
  const buffer = clockCustomAudioBuffers[id];

  if (ctx && buffer) {
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = loop;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.85, ctx.currentTime);
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
      return { source, gain };
    } catch (_) {}
  }

  // Fallback to HTMLAudioElement
  const url = clockCustomAudioUrls[id];
  if (url) {
    try {
      const audio = new Audio(url);
      audio.loop = loop;
      audio.play().catch(() => {});
      return { htmlAudio: audio };
    } catch (_) {}
  }
  return null;
}

// 0. เสียงกดสลับเวลา (Clock Tap / Switch Sound)
function playClockTapSound(tone) {
  if (!clockSoundSettings.soundEnabled || !clockSoundSettings.tapSoundEnabled) return;

  if (tone === 'custom' || clockSoundSettings.tapTone === 'custom') {
    if (playAudioClip('tap', false)) return;
  }

  const ctx = getClockAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  if (tone === 'wood-tap') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(650, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.045);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  } else if (tone === 'digital-beep') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1350, now);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.035);
  } else if (tone === 'soft') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(900, now);
    osc.frequency.exponentialRampToValueAtTime(250, now + 0.022);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.022);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.025);
  } else {
    // Default: 'click' - authentic mechanical chess clock switch sound
    const oscLow = ctx.createOscillator();
    const gainLow = ctx.createGain();
    oscLow.type = 'triangle';
    oscLow.frequency.setValueAtTime(240, now);
    oscLow.frequency.exponentialRampToValueAtTime(70, now + 0.038);
    gainLow.gain.setValueAtTime(0.35, now);
    gainLow.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    oscLow.connect(gainLow);
    gainLow.connect(ctx.destination);
    oscLow.start(now);
    oscLow.stop(now + 0.045);

    const oscHigh = ctx.createOscillator();
    const gainHigh = ctx.createGain();
    oscHigh.type = 'sine';
    oscHigh.frequency.setValueAtTime(2200, now);
    oscHigh.frequency.exponentialRampToValueAtTime(450, now + 0.018);
    gainHigh.gain.setValueAtTime(0.28, now);
    gainHigh.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
    oscHigh.connect(gainHigh);
    gainHigh.connect(ctx.destination);
    oscHigh.start(now);
    oscHigh.stop(now + 0.025);
  }
}

// 1. เสียงเตือนตอน 10 วิ
function play10sWarning(tone) {
  if (tone === 'custom' || clockSoundSettings.warn10Tone === 'custom') {
    if (playAudioClip('warn10', false)) return;
  }

  const ctx = getClockAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  if (tone === 'chime') {
    [1046.5, 1318.5].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.22, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.36);
    });
  } else if (tone === 'two-tone') {
    [800, 1150].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.1);
      gain.gain.setValueAtTime(0.25, now + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.09);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.1);
      osc.stop(now + idx * 0.1 + 0.1);
    });
  } else {
    // Default High Beep
    [980, 980].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);
      gain.gain.setValueAtTime(0.28, now + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 0.09);
    });
  }
}

// 2. เสียงนับถอยหลัง 00:05 ถึง 00:01 วิ
function playCountdownTick(second, tone) {
  if (tone === 'custom' || clockSoundSettings.countdownTone === 'custom') {
    if (playAudioClip('countdown', false)) return;
  }

  const ctx = getClockAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  if (tone === 'click') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1100, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.035);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  } else if (tone === 'beep') {
    const freq = second <= 2 ? 880 : 720;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.075);
  } else {
    // Default Tick
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(second === 1 ? 840 : 660, now);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  }
}

// 3. เสียงหมดเวลา 00:00 วิ ลากยาว (Continuous Timeout Buzzer)
function startContinuousBuzzer(tone) {
  stopContinuousBuzzer();

  if (tone === 'custom' || clockSoundSettings.timeoutTone === 'custom') {
    const res = playAudioClip('timeout', true);
    if (res) {
      if (res.source) {
        clockContinuousBuzzerSource = res.source;
        clockContinuousBuzzerGain = res.gain;
      }
      if (res.htmlAudio) {
        clockContinuousBuzzerHtmlAudio = res.htmlAudio;
      }
      return;
    }
  }

  const ctx = getClockAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  if (tone === 'alarm-siren') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(520, now);
    gain.gain.setValueAtTime(0.2, now);
    osc.connect(gain);
    gain.connect(ctx.destination);
  } else {
    // Sawtooth filtered buzzer
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(340, now);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, now);
    gain.gain.setValueAtTime(0.28, now);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
  }

  osc.start(now);
  clockContinuousBuzzerSource = osc;
  clockContinuousBuzzerGain = gain;
}

// 4. หยุดเสียงลากยาวทันทีเมื่อกดข้ามฝั่ง หรือเวลา -00:01 วินาที
function stopContinuousBuzzer() {
  if (clockContinuousBuzzerHtmlAudio) {
    try {
      clockContinuousBuzzerHtmlAudio.pause();
      clockContinuousBuzzerHtmlAudio.currentTime = 0;
    } catch (_) {}
    clockContinuousBuzzerHtmlAudio = null;
  }

  if (clockContinuousBuzzerSource) {
    try {
      const ctx = getClockAudioContext();
      if (ctx && clockContinuousBuzzerGain) {
        const now = ctx.currentTime;
        clockContinuousBuzzerGain.gain.setValueAtTime(clockContinuousBuzzerGain.gain.value, now);
        clockContinuousBuzzerGain.gain.linearRampToValueAtTime(0.001, now + 0.03);
      }
      setTimeout(() => {
        try {
          clockContinuousBuzzerSource?.stop();
          clockContinuousBuzzerSource?.disconnect();
        } catch (_) {}
        clockContinuousBuzzerSource = null;
        clockContinuousBuzzerGain = null;
      }, 35);
    } catch (_) {
      try { clockContinuousBuzzerSource?.stop(); } catch (__) {}
      clockContinuousBuzzerSource = null;
      clockContinuousBuzzerGain = null;
    }
  }
}

// 5. ฟีเจอร์พิเศษเมื่อติดลบถึงนาทีถัดไป (-1 ถึง -10 นาที)
function playOvertimeSound(minute, tone) {
  // Check if minute-specific custom audio exists (e.g. overtime_1, overtime_2)
  const minKey = `overtime_${minute}`;
  if (clockCustomAudioMeta[minKey] && playAudioClip(minKey, false)) {
    return;
  }

  // Check general overtime custom audio
  if ((tone === 'custom' || clockSoundSettings.overtimeTone === 'custom') && playAudioClip('overtime', false)) {
    return;
  }

  const ctx = getClockAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  if (tone === 'triple-beep') {
    [620, 620, 780].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.1);
      gain.gain.setValueAtTime(0.26, now + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.1);
      osc.stop(now + idx * 0.1 + 0.09);
    });
  } else if (tone === 'low-bell') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(293.66, now);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.72);
  } else if (tone === 'pulse') {
    [480, 0, 480, 0].forEach((freq, idx) => {
      if (freq === 0) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);
      gain.gain.setValueAtTime(0.28, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.065);
    });
  } else {
    // Default Double Beep
    [580, 580].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      gain.gain.setValueAtTime(0.28, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.11);
    });
  }
}

function clockTestSound(type, minute) {
  getClockAudioContext();
  if (type === 'tap') {
    playClockTapSound(clockSoundSettings.tapTone);
  } else if (type === '10s') {
    play10sWarning(clockSoundSettings.warn10Tone);
  } else if (type === 'countdown') {
    playCountdownTick(3, clockSoundSettings.countdownTone);
  } else if (type === 'timeout') {
    startContinuousBuzzer(clockSoundSettings.timeoutTone);
    setTimeout(() => stopContinuousBuzzer(), 1500);
  } else if (type === 'overtime') {
    playOvertimeSound(minute || 1, clockSoundSettings.overtimeTone);
  }
}

function clockUpdateSoundSetting(key, value) {
  clockSoundSettings[key] = value;
  saveClockSoundSettings();
  syncClockSoundSettingsUI();
}

function syncAlertRowUI(id, toggleId, selectId, badgeId, uploadTextId, enableKey, toneKey, defaultOptions) {
  if (toggleId && enableKey) {
    const toggle = document.getElementById(toggleId);
    if (toggle) toggle.checked = !!clockSoundSettings[enableKey];
  }

  const select = document.getElementById(selectId);
  const badge = document.getElementById(badgeId);
  const uploadText = document.getElementById(uploadTextId);
  const customMeta = clockCustomAudioMeta[id];

  if (select) {
    const currentVal = clockSoundSettings[toneKey];
    let html = defaultOptions.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
    if (customMeta) {
      html += `<option value="custom">🎵 ${escapeHtml(customMeta.name)}</option>`;
    }
    select.innerHTML = html;
    if (customMeta && currentVal === 'custom') {
      select.value = 'custom';
    } else {
      select.value = currentVal || defaultOptions[0].value;
    }
  }

  if (badge) {
    if (customMeta) {
      badge.style.display = 'inline-flex';
      badge.innerHTML = `🎵 <span title="${escapeHtml(customMeta.name)}" style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(customMeta.name)}</span>
        <button type="button" onclick="clockDeleteCustomAudio('${id}')" title="ลบไฟล์เสียงนี้">✕</button>`;
    } else {
      badge.style.display = 'none';
      badge.innerHTML = '';
    }
  }

  if (uploadText) {
    uploadText.innerText = customMeta ? 'เปลี่ยนเสียง' : 'อัปโหลด';
  }
}

function renderOvertimeMinuteList() {
  const container = document.getElementById('clockOvertimePerMinuteList');
  if (!container) return;
  const maxM = clockSoundSettings.overtimeMaxMinutes || 10;
  let html = '';
  for (let m = 1; m <= 10; m++) {
    const minKey = `overtime_${m}`;
    const meta = clockCustomAudioMeta[minKey];
    const isWithinRange = m <= maxM;
    html += `
      <div style="background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:6px 8px; display:flex; flex-direction:column; gap:4px; opacity:${isWithinRange ? '1' : '0.5'};">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="mono" style="font-weight:700; font-size:11px; color:${isWithinRange ? 'var(--danger)' : 'var(--text2)'};">-${String(m).padStart(2,'0')}:00</span>
          <button type="button" class="btn" style="padding:1px 5px; font-size:10px;" onclick="clockTestSound('overtime', ${m})" title="ทดสอบเสียงนาทีนี้">▶</button>
        </div>
        ${meta ? `
          <div class="clock-file-badge" style="max-width:100%; font-size:10px; padding:1px 4px;">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🎵 ${escapeHtml(meta.name)}</span>
            <button type="button" onclick="clockDeleteCustomAudio('${minKey}')" title="ลบ">✕</button>
          </div>
        ` : `
          <label class="btn" style="padding:2px 4px; font-size:10px; cursor:pointer; text-align:center;">
            📁 อัปโหลด
            <input type="file" accept="audio/*" style="display:none" onchange="clockHandleUpload('${minKey}', this)">
          </label>
        `}
      </div>
    `;
  }
  container.innerHTML = html;
}

function syncClockSoundSettingsUI() {
  const master = document.getElementById('clockSoundMasterToggle');
  const wrapper = document.getElementById('clockSoundOptionsWrapper');

  if (master) master.checked = !!clockSoundSettings.soundEnabled;
  if (wrapper) {
    wrapper.style.opacity = clockSoundSettings.soundEnabled ? '1' : '0.45';
    wrapper.style.pointerEvents = clockSoundSettings.soundEnabled ? 'auto' : 'none';
  }

  // 0. Tap / Press Clock
  syncAlertRowUI('tap', 'clockTapToggle', 'clockTapSelect', 'clockTapBadge', 'clockTapUploadText', 'tapSoundEnabled', 'tapTone', [
    { value: 'click', label: 'Mechanical Click' },
    { value: 'wood-tap', label: 'Wood Tap' },
    { value: 'digital-beep', label: 'Digital Beep' },
    { value: 'soft', label: 'Soft Tick' }
  ]);

  // 1. 10s Alert
  syncAlertRowUI('warn10', 'clockWarn10Toggle', 'clockWarn10Select', 'clockWarn10Badge', 'clockWarn10UploadText', 'warn10Enabled', 'warn10Tone', [
    { value: 'high-beep', label: 'High Beep' },
    { value: 'chime', label: 'Chime' },
    { value: 'two-tone', label: 'Two-Tone' }
  ]);

  // 2. Countdown 5s-1s
  syncAlertRowUI('countdown', 'clockCountdownToggle', 'clockCountdownSelect', 'clockCountdownBadge', 'clockCountdownUploadText', 'countdownEnabled', 'countdownTone', [
    { value: 'tick', label: 'Tick' },
    { value: 'beep', label: 'Beep' },
    { value: 'click', label: 'Wood Click' }
  ]);

  // 3. Timeout Buzzer
  syncAlertRowUI('timeout', 'clockTimeoutToggle', 'clockTimeoutSelect', 'clockTimeoutBadge', 'clockTimeoutUploadText', 'timeoutBuzzerEnabled', 'timeoutTone', [
    { value: 'buzzer', label: 'Buzzer' },
    { value: 'alarm-siren', label: 'Siren' }
  ]);

  // 4. Overtime
  const ot = document.getElementById('clockOvertimeToggle');
  const otMax = document.getElementById('clockOvertimeMaxSelect');
  const otWrapper = document.getElementById('clockOvertimeCustomOptions');
  if (ot) ot.checked = !!clockSoundSettings.overtimeAlertEnabled;
  if (otMax) otMax.value = String(clockSoundSettings.overtimeMaxMinutes || 10);
  if (otWrapper) {
    otWrapper.style.opacity = clockSoundSettings.overtimeAlertEnabled ? '1' : '0.45';
    otWrapper.style.pointerEvents = clockSoundSettings.overtimeAlertEnabled ? 'auto' : 'none';
  }

  syncAlertRowUI('overtime', null, 'clockOvertimeToneSelect', 'clockOvertimeBadge', 'clockOvertimeUploadText', null, 'overtimeTone', [
    { value: 'double-beep', label: 'Double Beep' },
    { value: 'triple-beep', label: 'Triple Beep' },
    { value: 'low-bell', label: 'Low Bell' },
    { value: 'pulse', label: 'Alarm Pulse' }
  ]);

  renderOvertimeMinuteList();
}

// Initialize Custom Audio from IndexedDB
if (typeof window !== 'undefined') {
  initClockCustomAudio();
}

let clockTurnTriggeredSeconds = new Set();
let clockBuzzerActive = false;
let clockBuzzerAutoStopped = false;
let clockTurnTriggeredOvertimeMinutes = new Set();

function resetTurnAudioState() {
  stopContinuousBuzzer();
  clockTurnTriggeredSeconds.clear();
  clockBuzzerActive = false;
  clockBuzzerAutoStopped = false;
  clockTurnTriggeredOvertimeMinutes.clear();
}

function clockHaptic() {
  // Vibration is restricted to coarse touch pointers to avoid unexpected behavior on desktop.
  const canHaptic = typeof navigator !== 'undefined'
    && typeof navigator.vibrate === 'function'
    && (navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)').matches);

  if (!canHaptic) return;

  // Short 50ms pulse gives physical confirmation of clock switch without being intrusive.
  try {
    navigator.vibrate(50);
  } catch (_) {
    // Feature policy or permission sandbox may block vibration; silent fallback preserves usability.
  }
}

function clockFormat(seconds) {
  // Overtime counts upward with a '+' prefix to clearly distinguish from remaining time.
  const overtime = seconds < 0;
  const total = Math.max(0, Math.ceil(Math.abs(seconds)));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${overtime ? '+' : ''}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function clockRender() {
  for (let i = 0; i < 2; i++) {
    const side = document.getElementById(`clockSide${i}`);
    const display = document.getElementById(`clockDisplay${i}`);
    if (!side || !display) continue;

    const isActive = clockRunning && clockActiveSide === i;
    display.innerText = clockFormat(clockValues[i]);
    side.classList.toggle('active', isActive);
    side.classList.toggle('overtime', clockValues[i] < 0);

    const playerNum = i + 1;
    const opponentNum = i === 0 ? 2 : 1;
    const timeText = clockFormat(clockValues[i]);
    side.setAttribute(
      'aria-label',
      isActive
        ? `Player ${playerNum}: ${timeText} (เวลากำลังเดิน - กดเพื่อส่งต่อให้ Player ${opponentNum})`
        : `Player ${playerNum}: ${timeText} (กดเพื่อเริ่มตาเดินของ Player ${opponentNum})`
    );
  }

  const pause = document.getElementById('clockPauseBtn');
  if (!pause) return;

  const label = pause.querySelector('.clock-pause-label');
  const running = clockRunning;
  if (label) label.innerText = running ? 'หยุดเวลา' : 'เล่นต่อ';

  pause.classList.toggle('is-running', running);
  pause.classList.toggle('is-paused', !running);
  pause.setAttribute('aria-label', running ? 'หยุดเวลา' : 'เล่นต่อ');

  // Triangle indicates "play/resume" when paused; compact square indicates "stop" when running.
  const icon = pause.querySelector('.clock-pause-icon');
  if (icon) {
    icon.style.width = running ? '12px' : '0';
    icon.style.height = running ? '12px' : '0';
    icon.style.border = running ? '0' : '';
    icon.style.background = running ? 'currentColor' : '';
    icon.style.borderRadius = running ? '2px' : '';
  }
}

function clockTick(now) {
  if (!clockRunning || clockActiveSide < 0) return;

  // Measure actual delta with high-resolution timer to prevent cumulative lag from frame throttling.
  const elapsed = Math.max(0, now - clockLastTick) / 1000;
  clockLastTick = now;
  clockValues[clockActiveSide] -= elapsed;
  const val = clockValues[clockActiveSide];

  // ── SOUND TRIGGERS ──
  if (clockSoundSettings.soundEnabled) {
    // 1. ตอน 10 วิ
    if (clockSoundSettings.warn10Enabled && val <= 10.05 && val > 9.0) {
      if (!clockTurnTriggeredSeconds.has(10)) {
        clockTurnTriggeredSeconds.add(10);
        play10sWarning(clockSoundSettings.warn10Tone);
      }
    }

    // 2. ตอน 00:05 ถึง 00:01 วิ
    if (clockSoundSettings.countdownEnabled && val <= 5.05 && val > 0.0) {
      const sec = Math.ceil(val);
      if (sec >= 1 && sec <= 5 && !clockTurnTriggeredSeconds.has(sec)) {
        clockTurnTriggeredSeconds.add(sec);
        playCountdownTick(sec, clockSoundSettings.countdownTone);
      }
    }

    // 3. ลากยาวตอน 00:00 วิ
    if (clockSoundSettings.timeoutBuzzerEnabled && val <= 0.0 && val > -1.0) {
      if (!clockBuzzerActive && !clockBuzzerAutoStopped) {
        clockBuzzerActive = true;
        startContinuousBuzzer(clockSoundSettings.timeoutTone);
      }
    }

    // 4. หยุดลากยาวเมื่อเวลา -00:01 วินาที (val <= -1.0)
    if (val <= -1.0 && clockBuzzerActive) {
      clockBuzzerActive = false;
      clockBuzzerAutoStopped = true;
      stopContinuousBuzzer();
    }

    // 5. ฟีเจอร์พิเศษ: เมื่อติดลบถึงนาทีถัดไป (-1 ถึง -10 นาที)
    if (clockSoundSettings.overtimeAlertEnabled && val <= -60.0) {
      const absSec = Math.abs(val);
      const min = Math.floor(absSec / 60);
      const secInMin = absSec % 60;
      const maxMins = clockSoundSettings.overtimeMaxMinutes || 10;
      if (min >= 1 && min <= maxMins && secInMin < 1.0 && !clockTurnTriggeredOvertimeMinutes.has(min)) {
        clockTurnTriggeredOvertimeMinutes.add(min);
        playOvertimeSound(min, clockSoundSettings.overtimeTone);
      }
    }
  }

  clockRender();
  clockFrame = requestAnimationFrame(clockTick);
}

function clockStart(side) {
  if (side !== clockActiveSide) {
    resetTurnAudioState();
  }
  clockActiveSide = side;
  clockRunning = true;
  clockLastTick = performance.now();

  // Cancel any pending frame before queuing a new loop to guard against multi-click acceleration.
  cancelAnimationFrame(clockFrame);
  clockFrame = requestAnimationFrame(clockTick);
  clockRender();
}

// Pressing your own clock side completes your turn and starts the opponent's timer.
function clockPressSide(side) {
  resetTurnAudioState();
  playClockTapSound(clockSoundSettings.tapTone);
  clockStart(side === 0 ? 1 : 0);
  clockHaptic();
}

function clockTogglePause() {
  clockHaptic();
  if (clockRunning) {
    clockRunning = false;
    cancelAnimationFrame(clockFrame);
    resetTurnAudioState();
  } else {
    // If not started yet, start Player 1 (side 0), otherwise resume the active side
    playClockTapSound(clockSoundSettings.tapTone);
    clockStart(clockActiveSide >= 0 ? clockActiveSide : 0);
  }
  clockRender();
}

function clockReset() {
  clockHaptic();
  clockRunning = false;
  clockActiveSide = -1;
  cancelAnimationFrame(clockFrame);
  resetTurnAudioState();
  clockValues = [...clockBaseValues];
  clockRender();
}

function clockToggleSettings() {
  const panel = document.getElementById('clockSettings');
  if (!panel) return;

  panel.hidden = !panel.hidden;
  panel.classList.toggle('open', !panel.hidden);
  if (panel.hidden) return;

  // Sync inputs with current base configuration when opening the settings modal.
  for (const i of [0, 1]) {
    const total = Math.max(0, Math.round(clockBaseValues[i]));
    const minuteInput = document.getElementById(`clockMinutes${i}`);
    const secondInput = document.getElementById(`clockSeconds${i}`);
    if (minuteInput) minuteInput.value = String(Math.floor(total / 60));
    if (secondInput) secondInput.value = String(total % 60);
  }

  syncClockSoundSettingsUI();
  document.getElementById('clockMinutes0')?.focus();
}

function clockAdjust(amount) {
  // Clamped between 1 and 180 minutes to keep tournament time presets within practical constraints.
  for (const id of ['clockMinutes0', 'clockMinutes1']) {
    const input = document.getElementById(id);
    if (input) {
      input.value = String(Math.min(180, Math.max(1, (Number(input.value) || 25) + amount)));
    }
  }
}

function clockApplySettings() {
  const minutes = [0, 1].map(i => {
    const minuteInput = document.getElementById(`clockMinutes${i}`);
    const secondInput = document.getElementById(`clockSeconds${i}`);
    const minute = Math.min(180, Math.max(0, Math.round(Number(minuteInput?.value) || 0)));
    const second = Math.min(59, Math.max(0, Math.round(Number(secondInput?.value) || 0)));
    if (minuteInput) minuteInput.value = String(minute);
    if (secondInput) secondInput.value = String(second);
    // Ensure at least 1 second minimum time
    return Math.max(1, minute * 60 + second);
  });

  clockBaseValues = minutes;
  clockReset();

  const panel = document.getElementById('clockSettings');
  if (panel) {
    panel.hidden = true;
    panel.classList.remove('open');
  }
}

// Close settings modal when clicking outside card or pressing Escape
document.addEventListener('click', (e) => {
  const panel = document.getElementById('clockSettings');
  if (panel && (!panel.hidden || panel.classList.contains('open')) && e.target === panel) {
    clockToggleSettings();
  }
});

document.addEventListener('keydown', (e) => {
  const panel = document.getElementById('clockSettings');
  if (panel && !panel.hidden) {
    if (e.key === 'Escape') {
      e.preventDefault();
      clockToggleSettings();
    }
    return;
  }

  // Keyboard shortcut when clock tab is active
  const clockSection = document.getElementById('t4');
  if (!clockSection?.classList.contains('active')) return;

  // Space toggles turns or starts clock
  if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
    if (!clockRunning && clockActiveSide < 0) {
      playClockTapSound(clockSoundSettings.tapTone);
      clockStart(0);
    } else {
      clockPressSide(clockActiveSide >= 0 ? clockActiveSide : 0);
    }
  } else if ((e.key === 'p' || e.key === 'P') && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    clockTogglePause();
  } else if ((e.key === 'r' || e.key === 'R') && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    clockReset();
  }
});

// Synchronize DOM with initial clock state.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', clockRender);
} else {
  clockRender();
}

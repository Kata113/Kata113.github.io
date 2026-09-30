// ── CHESS CLOCK ENGINE & UI CONTROLLER ─────────────────────────────
// Tournament chess clock module for Zyzzylu Scrabble toolkit.

// Standard tournament Scrabble allocates 25 minutes base time per player.
let clockBaseValues = [25 * 60, 25 * 60];
let clockValues = [...clockBaseValues];
let clockActiveSide = -1; // -1 indicates neutral state before any turn starts
let clockRunning = false;
let clockLastTick = 0;
let clockFrame = null;

// ── CHESS CLOCK SOUND ENGINE (Web Audio API) ──────────────────────────
let clockAudioCtx = null;
let clockContinuousBuzzerSource = null;
let clockContinuousBuzzerGain = null;

const CLOCK_SOUND_DEFAULTS = {
  soundEnabled: true,
  warn10Enabled: true,
  warn10Tone: 'high-beep',     // 'high-beep', 'chime', 'two-tone'
  countdownEnabled: true,
  countdownTone: 'tick',       // 'tick', 'beep', 'click'
  timeoutBuzzerEnabled: true,
  timeoutTone: 'buzzer',       // 'buzzer', 'alarm-siren'
  overtimeAlertEnabled: false, // "แต่ปกติไม่มีเสียง" -> default: false
  overtimeTone: 'double-beep', // 'double-beep', 'triple-beep', 'low-bell', 'pulse'
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

// 1. เสียงเตือนตอน 10 วิ
function play10sWarning(tone) {
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
      try { clockContinuousBuzzerSource.stop(); } catch (__) {}
      clockContinuousBuzzerSource = null;
      clockContinuousBuzzerGain = null;
    }
  }
}

// 5. ฟีเจอร์พิเศษเมื่อติดลบถึงนาทีถัดไป (-1 ถึง -10 นาที)
function playOvertimeSound(minute, tone) {
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
    // 'double-beep'
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

function clockTestSound(type) {
  getClockAudioContext();
  if (type === '10s') {
    play10sWarning(clockSoundSettings.warn10Tone);
  } else if (type === 'countdown') {
    playCountdownTick(3, clockSoundSettings.countdownTone);
  } else if (type === 'timeout') {
    startContinuousBuzzer(clockSoundSettings.timeoutTone);
    setTimeout(() => stopContinuousBuzzer(), 900);
  } else if (type === 'overtime') {
    playOvertimeSound(1, clockSoundSettings.overtimeTone);
  }
}

function clockUpdateSoundSetting(key, value) {
  clockSoundSettings[key] = value;
  saveClockSoundSettings();
  syncClockSoundSettingsUI();
}

function syncClockSoundSettingsUI() {
  const master = document.getElementById('clockSoundMasterToggle');
  const w10 = document.getElementById('clockWarn10Toggle');
  const w10Sel = document.getElementById('clockWarn10Select');
  const cd = document.getElementById('clockCountdownToggle');
  const cdSel = document.getElementById('clockCountdownSelect');
  const to = document.getElementById('clockTimeoutToggle');
  const toSel = document.getElementById('clockTimeoutSelect');
  const ot = document.getElementById('clockOvertimeToggle');
  const otTone = document.getElementById('clockOvertimeToneSelect');
  const otMax = document.getElementById('clockOvertimeMaxSelect');
  const wrapper = document.getElementById('clockSoundOptionsWrapper');
  const otWrapper = document.getElementById('clockOvertimeCustomOptions');

  if (master) master.checked = !!clockSoundSettings.soundEnabled;
  if (wrapper) {
    wrapper.style.opacity = clockSoundSettings.soundEnabled ? '1' : '0.45';
    wrapper.style.pointerEvents = clockSoundSettings.soundEnabled ? 'auto' : 'none';
  }

  if (w10) w10.checked = !!clockSoundSettings.warn10Enabled;
  if (w10Sel) w10Sel.value = clockSoundSettings.warn10Tone || 'high-beep';

  if (cd) cd.checked = !!clockSoundSettings.countdownEnabled;
  if (cdSel) cdSel.value = clockSoundSettings.countdownTone || 'tick';

  if (to) to.checked = !!clockSoundSettings.timeoutBuzzerEnabled;
  if (toSel) toSel.value = clockSoundSettings.timeoutTone || 'buzzer';

  if (ot) ot.checked = !!clockSoundSettings.overtimeAlertEnabled;
  if (otTone) otTone.value = clockSoundSettings.overtimeTone || 'double-beep';
  if (otMax) otMax.value = String(clockSoundSettings.overtimeMaxMinutes || 10);
  if (otWrapper) {
    otWrapper.style.opacity = clockSoundSettings.overtimeAlertEnabled ? '1' : '0.45';
    otWrapper.style.pointerEvents = clockSoundSettings.overtimeAlertEnabled ? 'auto' : 'none';
  }
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
  if (panel) panel.hidden = true;
}

// Close settings modal when clicking outside card or pressing Escape
document.addEventListener('click', (e) => {
  const panel = document.getElementById('clockSettings');
  if (panel && !panel.hidden && e.target === panel) {
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

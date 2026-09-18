// ── CHESS CLOCK ENGINE & UI CONTROLLER ─────────────────────────────
// Tournament chess clock module for Zyzzylu Scrabble toolkit.

// Standard tournament Scrabble allocates 25 minutes base time per player.
let clockBaseValues = [25 * 60, 25 * 60];
let clockValues = [...clockBaseValues];
let clockActiveSide = -1; // -1 indicates neutral state before any turn starts
let clockRunning = false;
let clockLastTick = 0;
let clockFrame = null;

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
  clockRender();
  clockFrame = requestAnimationFrame(clockTick);
}

function clockStart(side) {
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
  clockStart(side === 0 ? 1 : 0);
  clockHaptic();
}

function clockTogglePause() {
  clockHaptic();
  if (clockRunning) {
    clockRunning = false;
    cancelAnimationFrame(clockFrame);
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

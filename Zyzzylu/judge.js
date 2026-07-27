let judgeReturnFocus = null;

function chkChal() {
  let val = document.getElementById('cInp').value.trim().toUpperCase(); if (!val) return;
  let words = val.split(/\s+/), allValid = words.every(w => dictSet.has(w));
  let sym = document.getElementById('jSymbol'), stat = document.getElementById('jStatus');
  
  document.getElementById('jSubList').innerText = words.join(', ');
  if (allValid) {
    sym.innerText = "✓"; sym.style.color = "var(--accent)";
    stat.innerText = "Valid"; stat.style.color = "var(--accent)";
  } else {
    sym.innerText = "✕"; sym.style.color = "var(--danger)";
    stat.innerText = "Not valid"; stat.style.color = "var(--danger)";
  }
  const overlay = document.getElementById('jOverlay');
  judgeReturnFocus = document.activeElement;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => overlay.focus());
}

function closeJudgeOverlay(event) {
  const overlay = document.getElementById('jOverlay');
  if (event && event.target !== event.currentTarget) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  const returnTarget = judgeReturnFocus || document.getElementById('cInp');
  if (returnTarget && typeof returnTarget.focus === 'function') returnTarget.focus();
  judgeReturnFocus = null;
}

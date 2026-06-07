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
  document.getElementById('jOverlay').classList.add('open');
  document.getElementById('cInp').value = '';
}

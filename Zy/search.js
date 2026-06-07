function setSearchMode(mode) {
  activeSearchMode = mode;
  document.querySelectorAll('.capsule-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('sm-' + mode).classList.add('active');
  document.getElementById('sInp').placeholder = mode === 'pattern' ? "Use . (1 char) or * (multi)..." : "Enter letters...";
}

function highlightPatternMatches(word, query) {
  if (!query.includes('.')) return word;
  let res = "";
  for (let i = 0; i < word.length; i++) {
    if (query[i] === '.') res += `<mark>${word[i]}</mark>`;
    else res += word[i];
  }
  return res;
}

function search() {
  let q = document.getElementById('sInp').value.trim().toUpperCase();
  let res = [];
  if (!q) return;

  if (activeSearchMode === 'anagram') {
    let sq = [...q].sort().join('');
    res = dict.filter(w => w.length === q.length && [...w].sort().join('') === sq && matchFilters(w, sFilters));
  } else if (activeSearchMode === 'subanagram') {
    res = dict.filter(w => {
      let r = [...q];
      return [...w].every(c => { let i = r.indexOf(c); if (i > -1) { r.splice(i, 1); return true; } return false; }) && matchFilters(w, sFilters);
    });
  } else if (activeSearchMode === 'pattern') {
    let rx = new RegExp("^" + q.replace(/\./g, '.').replace(/\*/g, '.*') + "$");
    res = dict.filter(w => rx.test(w) && matchFilters(w, sFilters));
  }

  currentResultsList = res.slice(0, 100);
  document.getElementById('sRes').innerHTML = currentResultsList.map((w, idx) => {
    let hk = getHooksAndDots(w);
    let showW = activeSearchMode === 'pattern' ? highlightPatternMatches(w, q) : w;
    return `
      <div class="item-row">
        <div style="display:flex; align-items:center; gap:8px; flex:1; overflow:hidden;">
          <div class="mono hook-box">${hk.f}</div>
          <div class="mono" style="white-space:nowrap; display:flex; align-items:center;">
            <span class="dot-indicator">${hk.dotF}</span>
            <span class="word-core" onclick="openUlu(${idx})">${showW}</span>
            <span class="dot-indicator">${hk.dotB}</span>
          </div>
          <div class="mono hook-box">${hk.b}</div>
        </div>
        <div class="mono score-badge">
          <span style="font-size:10px; color:var(--text2); margin-right:4px;">${w.length}L</span>${getWordScore(w)}
        </div>
      </div>
    `;
  }).join('') || '<p style="text-align:center; color:var(--text2); padding-top:20px;">No results found</p>';
      }
    

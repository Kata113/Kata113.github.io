// search.js
function setSearchMode(mode) {
  activeSearchMode = mode;
  document.querySelectorAll('.capsule-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('sm-' + mode).classList.add('active');
  document.getElementById('sInp').placeholder = mode === 'pattern' ? "Use . (1 char) or * (multi)..." : "Enter letters (use . for blanks)...";
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

// Returns array of booleans: true at each position that required a blank tile
function getBlankPositions(word, query) {
  let rackLetters = [...query.replace(/\./g, '')];
  let tempRack = [...rackLetters];
  let usedBlank = new Array(word.length).fill(false);
  for (let i = 0; i < word.length; i++) {
    let idx = tempRack.indexOf(word[i]);
    if (idx > -1) {
      tempRack.splice(idx, 1);
    } else {
      usedBlank[i] = true;
    }
  }
  return usedBlank;
}

function search() {
  let q = document.getElementById('sInp').value.trim().toUpperCase();
  let res = [];
  if (!q) return;

  if (activeSearchMode === 'pattern') {
    let rx = new RegExp("^" + q.replace(/\./g, '.').replace(/\*/g, '.*') + "$");
    res = dict.filter(w => rx.test(w) && matchFilters(w, sFilters));
  } 
  else if (activeSearchMode === 'anagram' || activeSearchMode === 'subanagram') {
    let blanksCount = (q.match(/\./g) || []).length;
    let rackLetters = [...q.replace(/\./g, '')];

    res = dict.filter(w => {
      if (activeSearchMode === 'anagram' && w.length !== q.length) return false;
      
      let tempRack = [...rackLetters];
      let neededBlanks = 0;

      for (let char of w) {
        let idx = tempRack.indexOf(char);
        if (idx > -1) {
          tempRack.splice(idx, 1);
        } else {
          neededBlanks++;
        }
      }

      return neededBlanks <= blanksCount && matchFilters(w, sFilters);
    });
  }

  res = applyLimitFilters(res, sFilters);
  currentResultsList = res.slice(0, 100);
  const hasBlanks = q.includes('.');
  document.getElementById('sRes').innerHTML = currentResultsList.map((w, idx) => {
    let hk = getHooksAndDots(w);
    let showW;
    if (activeSearchMode === 'pattern') {
      showW = highlightPatternMatches(w, q);
    } else if (hasBlanks) {
      const blankPos = getBlankPositions(w, q);
      showW = [...w].map((char, i) => blankPos[i] ? `<mark>${char}</mark>` : char).join('');
    } else {
      showW = w;
    }
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

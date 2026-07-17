function setSearchMode(mode) {
  activeSearchMode = mode;
  document.querySelectorAll('.capsule-btn').forEach(button => {
    const active = button.id === 'sm-' + mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  document.getElementById('sInp').placeholder =
    mode === 'pattern' ? 'Use . for one letter or * for many…' : 'Enter letters (use . for blanks)…';
}

function highlightPatternMatches(word, query) {
  let res = '';
  for (let i = 0; i < word.length; i++)
    res += query[i] === '.' ? `<mark>${word[i]}</mark>` : word[i];
  return res;
}

function getBlankPositions(word, query) {
  let rack = [...query.replace(/\./g, '')];
  let blanks = new Array(word.length).fill(false);
  for (let i = 0; i < word.length; i++) {
    let idx = rack.indexOf(word[i]);
    if (idx > -1) rack.splice(idx, 1); else blanks[i] = true;
  }
  return blanks;
}

function search() {
  const q = document.getElementById('sInp').value.trim().toUpperCase();
  if (!q) return;
  let res = [];

  if (activeSearchMode === 'pattern') {
    const rx = new RegExp('^' + q.replace(/\./g, '.').replace(/\*/g, '.*') + '$');
    res = dict.filter(w => rx.test(w) && matchFilters(w, sFilters));
  } else {
    const blanks = (q.match(/\./g) || []).length;
    const rack   = [...q.replace(/\./g, '')];
    res = dict.filter(w => {
      if (activeSearchMode === 'anagram' && w.length !== q.length) return false;
      let tmp = [...rack], need = 0;
      for (const c of w) { const i = tmp.indexOf(c); if (i > -1) tmp.splice(i, 1); else need++; }
      return need <= blanks && matchFilters(w, sFilters);
    });
  }

  res = applyLimitFilters(res, sFilters);
  currentResultsList = res;
  const hasBlanks = q.includes('.');

  const count = currentResultsList.length;
  const countLine = count > 0
    ? `<div class="mono result-count">
        ${count} result${count !== 1 ? 's' : ''}
       </div>`
    : '';

  document.getElementById('sRes').innerHTML = count === 0
    ? '<p class="empty-state">No matches this time. Try fewer letters, a blank tile, or a wider filter.</p>'
    : countLine + currentResultsList.map((w, idx) => {
        const hk = getHooksAndDots(w);
        const score = getWordScore(w);
        const prob  = probRankMap[w];

        let showW;
        if (activeSearchMode === 'pattern') {
          showW = highlightPatternMatches(w, q);
        } else if (hasBlanks) {
          const bp = getBlankPositions(w, q);
          showW = [...w].map((c, i) => bp[i] ? `<mark>${c}</mark>` : c).join('');
        } else {
          showW = w;
        }

        // Front hooks: space-separated letters, or em-dash if none
        const fHooks = hk.f !== '-'
          ? `<span style="color:var(--accent);letter-spacing:3px;">${hk.f.split('').join(' ')}</span>`
          : `<span style="color:var(--muted);">—</span>`;
        const bHooks = hk.b !== '-'
          ? `<span style="color:var(--accent);letter-spacing:3px;">${hk.b.split('').join(' ')}</span>`
          : `<span style="color:var(--muted);">—</span>`;

        // Dot indicators: show only if front/back extension exists
        const dotF = hk.dotF.trim() === '•'
          ? `<span class="word-dot">●</span>` : '';
        const dotB = hk.dotB.trim() === '•'
          ? `<span class="word-dot">●</span>` : '';

        return `
          <button type="button" class="word-result" aria-label="Open details for ${w}" onclick="openUlu(${idx})">

            <!-- Front hooks (right-aligned) -->
            <span class="mono hook-column front">${fHooks}</span>

            <!-- Word (center) -->
            <span class="word-result-core">
              ${dotF}<span class="mono word-core">${showW}</span>${dotB}
              <span class="word-meta">
                <span class="word-score">${score}</span> pts
                ${prob ? `<span style="margin-left:5px;">#${prob}</span>` : ''}
              </span>
            </span>

            <!-- Back hooks (left-aligned) -->
            <span class="mono hook-column back">${bHooks}</span>

          </button>`;
      }).join('');
}

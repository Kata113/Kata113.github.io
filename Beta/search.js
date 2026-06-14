function setSearchMode(mode) {
  activeSearchMode = mode;
  document.querySelectorAll('.capsule-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('sm-' + mode).classList.add('active');
  document.getElementById('sInp').placeholder =
    mode === 'pattern' ? 'Use . (1 char) or * (multi)...' : 'Enter letters (use . for blanks)...';
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
  currentResultsList = res.slice(0, 200);
  const hasBlanks = q.includes('.');

  const count = currentResultsList.length;
  const total = res.length;
  const countLine = total > 0
    ? `<div class="mono" style="font-size:11px;color:var(--text2);text-align:right;padding:4px 6px 6px;">
        ${count < total ? `Showing ${count} of ${total}` : `${total} result${total !== 1 ? 's' : ''}`}
       </div>`
    : '';

  document.getElementById('sRes').innerHTML = count === 0
    ? '<p style="text-align:center;color:var(--text2);padding-top:20px;">No results found</p>'
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
          : `<span style="color:var(--border);">—</span>`;
        const bHooks = hk.b !== '-'
          ? `<span style="color:var(--accent);letter-spacing:3px;">${hk.b.split('').join(' ')}</span>`
          : `<span style="color:var(--border);">—</span>`;

        // Dot indicators: show only if front/back extension exists
        const dotF = hk.dotF.trim() === '•'
          ? `<span style="color:var(--danger);font-size:10px;margin-right:3px;">●</span>` : '';
        const dotB = hk.dotB.trim() === '•'
          ? `<span style="color:var(--danger);font-size:10px;margin-left:3px;">●</span>` : '';

        return `
          <div style="
            display:grid;
            grid-template-columns:1fr auto 1fr;
            align-items:center;
            gap:6px;
            padding:9px 6px;
            border-bottom:1px solid rgba(58,58,60,.4);
            cursor:pointer;
          " onclick="openUlu(${idx})">

            <!-- Front hooks (right-aligned) -->
            <div class="mono" style="
              text-align:right;
              font-size:12px;
              font-weight:700;
              line-height:1.8;
              word-break:break-all;
              min-width:0;
            ">${fHooks}</div>

            <!-- Word (center) -->
            <div style="text-align:center; white-space:nowrap; padding:0 4px;">
              ${dotF}<span class="mono word-core" style="
                font-size:20px;
                font-weight:700;
                letter-spacing:.5px;
                vertical-align:middle;
              ">${showW}</span>${dotB}
              <div style="
                font-size:10px;
                color:var(--text2);
                margin-top:1px;
                letter-spacing:.3px;
              ">
                <span style="color:var(--orange);font-weight:700;">${score}</span>pts
                ${prob ? `<span style="margin-left:5px;">#${prob}</span>` : ''}
              </div>
            </div>

            <!-- Back hooks (left-aligned) -->
            <div class="mono" style="
              text-align:left;
              font-size:12px;
              font-weight:700;
              line-height:1.8;
              word-break:break-all;
              min-width:0;
            ">${bHooks}</div>

          </div>`;
      }).join('');
}

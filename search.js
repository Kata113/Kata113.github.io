const SEARCH_OVERSCAN = 5;
let searchJobId = 0;
let lastSearchContext = null;
let virtualStart = -1;
let virtualEnd = -1;
let virtualScrollFrame = 0;
let virtualResizeObserver = null;

function setSearchMode(mode) {
  activeSearchMode = mode;
  searchJobId++;
  setSearchBusy(false);
  destroyVirtualSearchList();
  const progress = document.querySelector('#sRes .search-progress');
  if (progress) progress.remove();
  document.querySelectorAll('.capsule-btn').forEach(button => {
    const active = button.id === 'sm-' + mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  document.getElementById('sInp').placeholder =
    mode === 'pattern' ? 'Use . for one letter or * for many…' : 'Enter letters (use . for blanks)…';
}

function highlightPatternMatches(word, query) {
  if (query.includes('*')) return word;
  let result = '';
  for (let i = 0; i < word.length; i++)
    result += query[i] === '.' ? `<mark>${word[i]}</mark>` : word[i];
  return result;
}

function getBlankPositions(word, query) {
  const rack = [...query.replace(/\./g, '')];
  const blanks = new Array(word.length).fill(false);
  for (let i = 0; i < word.length; i++) {
    const idx = rack.indexOf(word[i]);
    if (idx > -1) rack.splice(idx, 1); else blanks[i] = true;
  }
  return blanks;
}

function getSearchCandidates(query, mode) {
  if (mode === 'anagram' || (mode === 'pattern' && !query.includes('*')))
    return wordsByL[query.length] || [];

  if (mode === 'subanagram') {
    const candidates = [];
    for (let length = 1; length <= query.length; length++) {
      const bucket = wordsByL[length];
      if (bucket) {
        for (const word of bucket) candidates.push(word);
      }
    }
    return candidates;
  }

  return dict;
}

function createRackMatcher(query) {
  const available = new Uint8Array(26);
  const used = new Uint8Array(26);
  const touched = new Uint8Array(26);
  const blanks = (query.match(/\./g) || []).length;

  for (const char of query.replace(/\./g, '')) available[char.charCodeAt(0) - 65]++;

  return word => {
    let needed = 0;
    let touchedCount = 0;

    for (let i = 0; i < word.length; i++) {
      const index = word.charCodeAt(i) - 65;
      if (used[index] === 0) touched[touchedCount++] = index;
      used[index]++;
      if (used[index] > available[index] && ++needed > blanks) {
        for (let j = 0; j < touchedCount; j++) used[touched[j]] = 0;
        return false;
      }
    }

    for (let i = 0; i < touchedCount; i++) used[touched[i]] = 0;
    return true;
  };
}

function setSearchBusy(busy) {
  const button = document.getElementById('sBtn');
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('is-loading', busy);
  button.innerText = busy ? '…' : '→';
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function search() {
  const input = document.getElementById('sInp');
  const query = input.value.trim().toUpperCase();
  if (!query) return;

  const valid = activeSearchMode === 'pattern' ? /^[A-Z.*]+$/.test(query) : /^[A-Z.]+$/.test(query);
  if (!valid) {
    destroyVirtualSearchList();
    document.getElementById('sRes').innerHTML =
      '<p class="empty-state" role="status">Use letters and dots only. Pattern mode also accepts *.</p>';
    return;
  }

  const mode = activeSearchMode;
  const jobId = ++searchJobId;
  setSearchBusy(true);
  destroyVirtualSearchList();
  document.getElementById('sRes').innerHTML =
    '<p class="search-progress mono" role="status">Searching the dictionary…</p>';

  requestAnimationFrame(() => setTimeout(() => {
    if (jobId !== searchJobId) return;
    try {
      runSearch(query, mode);
    } finally {
      if (jobId === searchJobId) setSearchBusy(false);
    }
  }, 0));
}

function runSearch(query, mode) {
  const candidates = getSearchCandidates(query, mode);
  let results;

  if (mode === 'pattern') {
    const pattern = '^' + query.replace(/\./g, '.').replace(/\*/g, '.*') + '$';
    const regex = new RegExp(pattern);
    results = candidates.filter(word => regex.test(word) && matchFilters(word, sFilters));
  } else {
    const fitsRack = createRackMatcher(query);
    results = candidates.filter(word => fitsRack(word) && matchFilters(word, sFilters));
  }

  currentResultsList = applyLimitFilters(results, sFilters);
  lastSearchContext = {
    query,
    mode,
    hasBlanks:query.includes('.')
  };
  renderSearchResults(true);
}

function createWordResultHtml(word, index) {
  const hooks = getHooksAndDots(word);
  const score = getWordScore(word);
  const probability = probRankMap[word];
  const { query, mode, hasBlanks } = lastSearchContext;

  let shownWord;
  if (mode === 'pattern') {
    shownWord = highlightPatternMatches(word, query);
  } else if (hasBlanks) {
    const blankPositions = getBlankPositions(word, query);
    shownWord = [...word].map((char, charIndex) =>
      blankPositions[charIndex] ? `<mark>${char}</mark>` : char
    ).join('');
  } else {
    shownWord = word;
  }

  const frontHooks = hooks.f !== '-'
    ? `<span style="color:var(--accent);letter-spacing:3px;">${hooks.f.split('').join(' ')}</span>`
    : '<span style="color:var(--muted);">—</span>';
  const backHooks = hooks.b !== '-'
    ? `<span style="color:var(--accent);letter-spacing:3px;">${hooks.b.split('').join(' ')}</span>`
    : '<span style="color:var(--muted);">—</span>';
  const frontDot = hooks.dotF.trim() === '•' ? '<span class="word-dot">●</span>' : '';
  const backDot = hooks.dotB.trim() === '•' ? '<span class="word-dot">●</span>' : '';

  return `
    <button type="button" class="word-result" data-result-index="${index}" aria-label="Open details for ${word}" onclick="openUlu(${index})" onkeydown="handleVirtualResultKey(event, ${index})">
      <span class="mono hook-column front">${frontHooks}</span>
      <span class="word-result-core">
        ${frontDot}<span class="mono word-core">${shownWord}</span>${backDot}
        <span class="word-meta">
          <span class="word-score">${score}</span> pts
          ${probability ? `<span style="margin-left:5px;">#${probability}</span>` : ''}
        </span>
      </span>
      <span class="mono hook-column back">${backHooks}</span>
    </button>`;
}

function destroyVirtualSearchList() {
  if (virtualScrollFrame) cancelAnimationFrame(virtualScrollFrame);
  virtualScrollFrame = 0;
  if (virtualResizeObserver) virtualResizeObserver.disconnect();
  virtualResizeObserver = null;
  virtualStart = -1;
  virtualEnd = -1;
}

function getVirtualRowHeight(viewport) {
  return parseFloat(getComputedStyle(viewport).getPropertyValue('--virtual-row-height')) || 76;
}

function scheduleVirtualSearchRender(force = false) {
  if (virtualScrollFrame) return;
  virtualScrollFrame = requestAnimationFrame(() => {
    virtualScrollFrame = 0;
    renderVirtualSearchWindow(force);
  });
}

function renderVirtualSearchWindow(force = false) {
  const viewport = document.getElementById('sViewport');
  const rows = document.getElementById('sRows');
  const status = document.getElementById('sVirtualStatus');
  if (!viewport || !rows || !currentResultsList.length) return;

  const rowHeight = getVirtualRowHeight(viewport);
  const visibleCount = Math.ceil((viewport.clientHeight || rowHeight * 6) / rowHeight);
  const start = Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - SEARCH_OVERSCAN);
  const end = Math.min(currentResultsList.length, start + visibleCount + SEARCH_OVERSCAN * 2);
  if (!force && start === virtualStart && end === virtualEnd) return;

  virtualStart = start;
  virtualEnd = end;
  const topHeight = start * rowHeight;
  const bottomHeight = (currentResultsList.length - end) * rowHeight;
  const visibleRows = currentResultsList
    .slice(start, end)
    .map((word, offset) => createWordResultHtml(word, start + offset))
    .join('');

  rows.innerHTML = `
    <div class="virtual-spacer" aria-hidden="true" style="height:${topHeight}px"></div>
    ${visibleRows}
    <div class="virtual-spacer" aria-hidden="true" style="height:${bottomHeight}px"></div>`;
  status.textContent = `Viewing ${start + 1}–${end} of ${currentResultsList.length.toLocaleString()}`;
}

function focusVirtualResult(index) {
  const viewport = document.getElementById('sViewport');
  if (!viewport || !currentResultsList.length) return;
  const target = Math.max(0, Math.min(index, currentResultsList.length - 1));
  const rowHeight = getVirtualRowHeight(viewport);
  viewport.scrollTop = Math.max(0, target * rowHeight - (viewport.clientHeight - rowHeight) / 2);
  renderVirtualSearchWindow(true);
  requestAnimationFrame(() => {
    const result = document.querySelector(`[data-result-index="${target}"]`);
    if (result) result.focus({ preventScroll:true });
  });
}

function handleVirtualResultKey(event, index) {
  const viewport = document.getElementById('sViewport');
  if (!viewport) return;
  const pageSize = Math.max(1, Math.floor(viewport.clientHeight / getVirtualRowHeight(viewport)) - 1);
  const targets = {
    ArrowDown:index + 1,
    ArrowUp:index - 1,
    PageDown:index + pageSize,
    PageUp:index - pageSize,
    Home:0,
    End:currentResultsList.length - 1
  };
  if (!(event.key in targets)) return;
  event.preventDefault();
  focusVirtualResult(targets[event.key]);
}

function renderSearchResults(reset = false) {
  const container = document.getElementById('sRes');
  const total = currentResultsList.length;

  if (!total) {
    destroyVirtualSearchList();
    container.innerHTML =
      '<p class="empty-state" role="status">No matches this time. Try fewer letters, a blank tile, or a wider filter.</p>';
    return;
  }

  if (reset) {
    destroyVirtualSearchList();
    container.innerHTML = `
      <div class="result-summary" role="status" aria-live="polite">
        <span class="mono result-count">${total.toLocaleString()} result${total !== 1 ? 's' : ''}</span>
        <span class="mono result-guide">Scroll to explore · use arrow keys to move</span>
      </div>
      <div id="sViewport" class="virtual-results" tabindex="0" aria-label="${total.toLocaleString()} search results" onscroll="scheduleVirtualSearchRender()">
        <div id="sRows" class="virtual-results-track"></div>
      </div>
      <div id="sVirtualStatus" class="results-footer mono" aria-hidden="true"></div>`;
    const viewport = document.getElementById('sViewport');
    if (window.ResizeObserver) {
      virtualResizeObserver = new ResizeObserver(() => scheduleVirtualSearchRender(true));
      virtualResizeObserver.observe(viewport);
    }
  }
  renderVirtualSearchWindow(true);
}

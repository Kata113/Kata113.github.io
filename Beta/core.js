// --- GLOBAL STATES ---\nlet dict = [], dictSet = new Set(), wordsByL = {};
let saved = JSON.parse(localStorage.getItem('zyz_sv') || '[]');
let sFilters = [], qFilters = [], fId = 0;
let currentResultsList = [], currentWordIndex = -1;
let activeSearchMode = 'subanagram';

const letterScores = { A:1,E:1,I:1,O:1,U:1,L:1,N:1,S:1,T:1,R:1, D:2,G:2, B:3,C:3,M:3,P:3, F:4,H:4,V:4,W:4,Y:4, K:5, J:8,X:8, Q:10,Z:10 };
const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const VOWELS = \"AEIOU\";

const letterFrequencies = {
  A:9,B:2,C:2,D:4,E:12,F:2,G:3,H:2,I:9,J:1,K:1,L:4,
  M:2,N:6,O:8,P:2,Q:1,R:6,S:4,T:6,U:4,V:2,W:2,X:1,Y:2,Z:1
};

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  if (k > n / 2) k = n - k;
  let res = 1;
  for (let i = 1; i <= k; i++) res = res * (n - k + i) / i;
  return Math.round(res);
}

// ─── FILTER EVALUATOR CORE ───────────────────────────────────────────
function matchFilters(word, filters) {
  if (!filters || filters.length === 0) return true;
  for (let f of filters) {
    let match = false;
    if (f.type === 'length') {
      const len = word.length;
      match = (len >= parseInt(f.v1) && len <= parseInt(f.v2));
    } else if (f.type === 'point_value') {
      let score = 0;
      for (let ch of word) score += letterScores[ch] || 0;
      match = (score >= parseInt(f.v1) && score <= parseInt(f.v2));
    } else if (f.type === 'begins') {
      match = word.startsWith(f.v1.toUpperCase());
    } else if (f.type === 'ends') {
      match = word.endsWith(f.v1.toUpperCase());
    } else if (f.type === 'includes') {
      match = word.includes(f.v1.toUpperCase());
    }
    if (f.not) match = !match;
    if (!match) return false;
  }
  return true;
}

function applyLimitFilters(pool, filters) {
  return pool; 
}

function toast(msg) {
  const el = document.getElementById('tst');
  if(!el) return;
  el.innerText = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ─── MODAL ULU VIEW CONTROL ──────────────────────────────────────────
function openUlu(index) {
  if (index < 0 || index >= currentResultsList.length) return;
  currentWordIndex = index;
  const w = currentResultsList[index];
  
  document.getElementById('mWord').innerText = w;
  const score = [...w].reduce((a,c) => a + (letterScores[c]||0), 0);
  document.getElementById('mScore').innerText = `${score} pts`;

  if (typeof judgeWord === 'function') {
    const meta = judgeWord(w);
    document.getElementById('mDefinition').innerText = meta.definition || 'No definition available.';
    document.getElementById('mPrefixExt').innerHTML = meta.frontHooks || '-';
    document.getElementById('mSuffixExt').innerHTML = meta.backHooks || '-';
    document.getElementById('mAnagrams').innerText    = meta.anagrams || 'None';
    document.getElementById('mInflections').innerText = meta.inflections || 'None';
  }
  document.getElementById('uluModal').classList.add('open');
}

const closeUlu = () => document.getElementById('uluModal').classList.remove('open');
function navWord(dir){let n=currentWordIndex+dir;if(n>=0&&n<currentResultsList.length)openUlu(n);}

function favWord(){
  let w=currentResultsList[currentWordIndex];
  if(!w) return;
  saved=saved.includes(w)?saved.filter(x=>x!==w):[...saved,w];
  localStorage.setItem('zyz_sv',JSON.stringify(saved));
  renderSaved();
  const btn = document.getElementById('mFavBtn');
  if(btn) btn.innerText = saved.includes(w) ? '★' : '⭐';
}

// ─── BOOKMARKS ────────────────────────────────────────────────────────
function renderSaved(){
  const el = document.getElementById('bList');
  if(!el) return;
  el.innerHTML=saved.map(w=>`
    <div class="item-row" style="display:flex; justify-content:space-between; align-items:center; padding:8px 4px; border-bottom:1px solid var(--border);">
      <span class="mono" style="font-size:18px;font-weight:700;">${w}</span>
      <button class="btn" style="padding:4px 8px;color:var(--danger);border-color:transparent;" onclick="toggleSave('${w}')">🗑️</button>
    </div>`).join('')||'<p style="text-align:center;color:var(--text2);padding-top:16px;">No saved items</p>';
}

function toggleSave(w){
  saved = saved.filter(x=>x!==w);
  localStorage.setItem('zyz_sv',JSON.stringify(saved));
  renderSaved();
}

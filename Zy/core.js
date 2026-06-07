// --- GLOBAL STATES (แชร์ให้ทุกไฟล์เข้าถึงได้) ---
let dict = [], dictSet = new Set(), wordsByL = {};
let saved = JSON.parse(localStorage.getItem('zyz_sv') || '[]');
let sFilters = [], qFilters = [], fId = 0;
let currentResultsList = [], currentWordIndex = -1;
let activeSearchMode = 'subanagram';

const letterScores = { A:1,E:1,I:1,O:1,U:1,L:1,N:1,S:1,T:1,R:1, D:2,G:2, B:3,C:3,M:3,P:3, F:4,H:4,V:4,W:4,Y:4, K:5, J:8,X:8, Q:10,Z:10 };
const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// --- CORE UTILITIES ---
const getWordScore = w => [...w].reduce((a, c) => a + (letterScores[c] || 0), 0);

function getHooksAndDots(w) {
  let f = '', b = '';
  for (let i = 0; i < 26; i++) {
    if (dictSet.has(alpha[i] + w)) f += alpha[i];
    if (dictSet.has(w + alpha[i])) b += alpha[i];
  }
  return { 
    f: f || '-', b: b || '-', 
    dotF: (w.length > 2 && dictSet.has(w.substring(1))) ? '•' : '&nbsp;', 
    dotB: (w.length > 2 && dictSet.has(w.substring(0, w.length - 1))) ? '•' : '&nbsp;' 
  };
}

function getWordMetadata(w) {
  let ana = dict.filter(x => x.length === w.length && x !== w && [...x].sort().join('') === [...w].sort().join(''));
  let inf = ['S','ES','ED','ING'].filter(s => dictSet.has(w + s)).map(s => w + s);
  let p = "n.";
  if (w.endsWith('ED') || w.endsWith('ING')) p = "v.";
  else if (w.endsWith('LY')) p = "adv.";
  else if (w.endsWith('ABLE') || w.endsWith('FUL')) p = "adj.";
  return { pos: p, def: "", anagrams: ana.join(', ') || 'None', inflections: inf.join(', ') || 'None' };
}

// --- INITIALIZATION ---
window.onload = async () => {
  try {
    let r = await fetch('CSW24.txt');
    dict = (await r.text()).split(/\r?\n/).map(w => w.trim().toUpperCase()).filter(w => w.length > 0);
    dictSet = new Set(dict);
    dict.forEach(w => { (wordsByL[w.length] = wordsByL[w.length] || []).push(w); });
    document.getElementById('wCnt').innerText = dict.length.toLocaleString() + " Words";
  } catch(e) { document.getElementById('wCnt').innerText = "Sandbox Mode"; }
  document.getElementById('loadingScreen').style.display = 'none';
  renderSaved();
};

// --- COMMON UI MANAGEMENT ---
function tab(idx, b) {
  document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active')); 
  b.classList.add('active');
  document.querySelectorAll('.section').forEach((s, i) => s.classList.toggle('active', i === idx));
}

function toast(m, cls = '') {
  let t = document.getElementById('tst'); t.innerText = m; t.className = 'toast show ' + cls;
  setTimeout(() => t.classList.remove('show'), 2000);
}

// --- FILTER INFRASTRUCTURE ---
function addFilter(mode) {
  fId++; 
  let type = document.getElementById(mode === 'S' ? 'sFType' : 'qFType').value;
  let isR = (type === 'length' || type === 'point_value');
  let item = { id: fId, type, v1: isR ? '2' : '', v2: isR ? '8' : '', not: false };
  if (mode === 'S') { sFilters.push(item); renderFilters('S'); } else { qFilters.push(item); renderFilters('Q'); }
}
function toggleNot(mode, id) {
  let arr = mode === 'S' ? sFilters : qFilters;
  let f = arr.find(x => x.id === id); if (f) f.not = !f.not; renderFilters(mode);
}
function deleteFilter(mode, id) {
  if (mode === 'S') { sFilters = sFilters.filter(x => x.id !== id); renderFilters('S'); } 
  else { qFilters = qFilters.filter(x => x.id !== id); renderFilters('Q'); }
}
function updateFilterVal(mode, id, field, val) {
  let arr = mode === 'S' ? sFilters : qFilters;
  let f = arr.find(x => x.id === id); if (f) f[field] = val.toUpperCase();
}
function renderFilters(mode) {
  let arr = mode === 'S' ? sFilters : qFilters;
  document.getElementById(mode === 'S' ? 'sStack' : 'qStack').innerHTML = arr.map(f => {
    let isR = (f.type === 'length' || f.type === 'point_value');
    return `
      <div class="f-item">
        <div style="display:flex; gap:6px; align-items:center; flex:1;">
          <button class="btn-not ${f.not ? 'active' : ''}" onclick="toggleNot('${mode}', ${f.id})">NOT</button>
          <span class="mono" style="color:var(--accent); font-size:11px;">${f.type.toUpperCase()}</span>
          ${isR ? 
            `<input type="number" style="width:44px; background:var(--bg); color:#fff; border:1px solid var(--border); padding:2px;" value="${f.v1}" onchange="updateFilterVal('${mode}', ${f.id}, 'v1', this.value)"> - <input type="number" style="width:44px; background:var(--bg); color:#fff; border:1px solid var(--border); padding:2px;" value="${f.v2}" onchange="updateFilterVal('${mode}', ${f.id}, 'v2', this.value)">`
            : `<input type="text" style="flex:1; background:var(--bg); color:#fff; border:1px solid var(--border); padding:2px;" value="${f.v1}" oninput="updateFilterVal('${mode}', ${f.id}, 'v1', this.value)">`
          }
        </div>
        <span style="cursor:pointer; color:var(--danger);" onclick="deleteFilter('${mode}', ${f.id})">✕</span>
      </div>
    `;
  }).join('');
}

function matchFilters(w, arr) {
  for (let f of arr) {
    let m = true, v1 = f.v1.trim().toUpperCase();
    if (f.type === 'length') m = (w.length >= parseInt(f.v1) && w.length <= parseInt(f.v2));
    else if (f.type === 'point_value') { let s = getWordScore(w); m = (s >= parseInt(f.v1) && s <= parseInt(f.v2)); }
    else if (f.type === 'begins') m = w.startsWith(v1);
    else if (f.type === 'ends') m = w.endsWith(v1);
    else if (f.type === 'includes') m = [...v1].every(c => w.includes(c));
    if (f.not) m = !m; if (!m) return false;
  }
  return true;
}

// --- WORD WINDOW OVERLAY (MODAL) ---
function openUlu(idx) {
  if (idx < 0 || idx >= currentResultsList.length) return;
  currentWordIndex = idx;
  let w = currentResultsList[idx], hk = getHooksAndDots(w), meta = getWordMetadata(w);

  document.getElementById('mWord').innerText = w;
  document.getElementById('mPos').innerText = meta.pos;
  document.getElementById('mScore').innerText = getWordScore(w);
  document.getElementById('mDef').innerText = meta.def;
  document.getElementById('mFHooks').innerText = hk.f;
  document.getElementById('mBHooks').innerText = hk.b;
  document.getElementById('mAnagrams').innerText = meta.anagrams;
  document.getElementById('mInflections').innerText = meta.inflections;

  let btn = document.getElementById('mFavBtn');
  btn.innerText = saved.includes(w) ? "⭐" : "☆";
  document.getElementById('uluModal').classList.add('open');
}
const closeUlu = () => document.getElementById('uluModal').classList.remove('open');
function navWord(dir) { let n = currentWordIndex + dir; if (n >= 0 && n < currentResultsList.length) openUlu(n); }
function favWord() {
  let w = currentResultsList[currentWordIndex];
  if (saved.includes(w)) saved = saved.filter(x => x !== w); else saved.push(w);
  localStorage.setItem('zyz_sv', JSON.stringify(saved)); renderSaved(); openUlu(currentWordIndex);
}

// --- BOOKMARKS (SAVED) MANAGEMENT ---
function renderSaved() {
  document.getElementById('bList').innerHTML = saved.map(w => `
    <div class="item-row">
      <span class="mono" style="font-size:18px; font-weight:700;">${w}</span>
      <button class="btn" style="padding:4px 8px; color:var(--danger); border-color:transparent;" onclick="toggleSave('${w}')">🗑️</button>
    </div>
  `).join('') || '<p style="text-align:center; color:var(--text2); padding-top:16px;">No saved items</p>';
}
function toggleSave(w) {
  saved = saved.includes(w) ? saved.filter(x => x !== w) : [...saved, w];
  localStorage.setItem('zyz_sv', JSON.stringify(saved)); renderSaved();
}
function clearSaved() { if (confirm("Purge all stored words?")) { saved = []; localStorage.setItem('zyz_sv', '[]'); renderSaved(); } }

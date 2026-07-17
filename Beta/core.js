// --- GLOBAL STATES ---
const DICTIONARY_URL = './CSW24.txt';
let dict = [], dictSet = new Set(), wordsByL = {}, wordMetadata = new Map();
let lexiconMetadataCache = new Map(), anagramCache = new Map(), wordExtensionCache = new Map();
let saved = JSON.parse(localStorage.getItem('zyz_sv') || '[]');
let sFilters = [], qFilters = [], fId = 0;
let currentResultsList = [], currentWordIndex = -1;
let activeSearchMode = 'subanagram';
let modalReturnFocus = null;
let toastTimer = null;

const letterScores = { A:1,E:1,I:1,O:1,U:1,L:1,N:1,S:1,T:1,R:1, D:2,G:2, B:3,C:3,M:3,P:3, F:4,H:4,V:4,W:4,Y:4, K:5, J:8,X:8, Q:10,Z:10 };
const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const VOWELS = "AEIOU";

const letterFrequencies = {
  A:9,B:2,C:2,D:4,E:12,F:2,G:3,H:2,I:9,J:1,K:1,L:4,
  M:2,N:6,O:8,P:2,Q:1,R:6,S:4,T:6,U:4,V:2,W:2,X:1,Y:2,Z:1
};

function choose(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  if (k > n / 2) k = n - k;
  let r = 1;
  for (let i = 1; i <= k; i++) r = r * (n-i+1) / i;
  return r;
}
function getProbabilityScore(w) {
  let c = {};
  for (let ch of w) c[ch] = (c[ch]||0)+1;
  let s = 1;
  for (let ch in c) s *= choose(letterFrequencies[ch]||0, c[ch]);
  return s;
}

let probCache = {}, probRankMap = {};
function initProbabilityCache() {
  probCache = {}; probRankMap = {};
  const sc = {};
  for (let w of dict) sc[w] = getProbabilityScore(w);
  for (let w of dict) { let l=w.length; (probCache[l]=probCache[l]||[]).push(w); }
  for (let l in probCache) {
    let wl = probCache[l];
    wl.sort((a,b) => sc[b]!==sc[a] ? sc[b]-sc[a] : (a<b?-1:1));
    for (let i=0; i<wl.length; i++) probRankMap[wl[i]] = i+1;
  }
}

const getWordScore  = w => [...w].reduce((a,c) => a+(letterScores[c]||0), 0);
const countVowels   = w => [...w].filter(c => VOWELS.includes(c)).length;

function getHooksAndDots(w) {
  let f='', b='';
  for (let i=0;i<26;i++) {
    if (dictSet.has(alpha[i]+w)) f+=alpha[i];
    if (dictSet.has(w+alpha[i])) b+=alpha[i];
  }
  return { f:f||'-', b:b||'-',
    dotF:(w.length>2&&dictSet.has(w.slice(1)))?'•':'&nbsp;',
    dotB:(w.length>2&&dictSet.has(w.slice(0,-1)))?'•':'&nbsp;' };
}

// Full words formed by single-letter front/back hooks
function getFullHookWords(w) {
  const front = [], back = [];
  for (let i = 0; i < 26; i++) {
    if (dictSet.has(alpha[i] + w)) front.push(alpha[i] + w);
    if (dictSet.has(w + alpha[i])) back.push(w + alpha[i]);
  }
  return { front, back };
}

// Multi-letter extensions: words = (2-5 letters) + W  or  W + (2-5 letters)
function getWordExtensions(w) {
  if (wordExtensionCache.has(w)) return wordExtensionCache.get(w);

  const prefix = [], suffix = [];
  for (let length = w.length + 2; length <= w.length + 5; length++) {
    for (const x of wordsByL[length] || []) {
      if (x.endsWith(w))   prefix.push(x);
      if (x.startsWith(w)) suffix.push(x);
    }
  }
  const byLen = (a, b) => a.length !== b.length ? a.length - b.length : (a < b ? -1 : 1);
  const result = {
    prefix: prefix.sort(byLen).slice(0, 20),
    suffix: suffix.sort(byLen).slice(0, 20)
  };
  wordExtensionCache.set(w, result);
  return result;
}

function getLexiconMetadata(w) {
  if (lexiconMetadataCache.has(w)) return lexiconMetadataCache.get(w);

  const raw = wordMetadata.get(w) || '';
  if (!raw) return { definition:'', pos:'' };

  const partsOfSpeech = [...raw.matchAll(/\[([^\]]+)\]/g)]
    .map(match => match[1].trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
  const definition = raw
    .replace(/\s*\[[^\]]+\]/g, '')
    .replace(/\s+\/\s+/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const result = { definition, pos:partsOfSpeech.join(' · ') };
  lexiconMetadataCache.set(w, result);
  return result;
}

function getWordMetadata(w) {
  const signature = [...w].sort().join('');
  if (!anagramCache.has(signature)) {
    anagramCache.set(signature, (wordsByL[w.length] || []).filter(
      candidate => [...candidate].sort().join('') === signature
    ));
  }
  const ana = anagramCache.get(signature).filter(candidate => candidate !== w);
  const inf = ['S','ES','ED','ING'].filter(s=>dictSet.has(w+s)).map(s=>w+s);
  const lexicon = getLexiconMetadata(w);
  let p="n.";
  if(w.endsWith('ED')||w.endsWith('ING'))p="v.";
  else if(w.endsWith('LY'))p="adv.";
  else if(w.endsWith('ABLE')||w.endsWith('FUL'))p="adj.";
  return {
    pos:lexicon.pos || p,
    def:lexicon.definition,
    anagrams:ana.join(', ')||'None',
    inflections:inf.join(', ')||'None'
  };
}

// ─── Dictionary loading ───────────────────────────────────────────────
async function processDictText(text) {
  const nextDict = [];
  const nextMetadata = new Map();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const splitAt = line.search(/\s/);
    const word = (splitAt === -1 ? line : line.slice(0, splitAt)).trim().toUpperCase();
    const metadata = splitAt === -1 ? '' : line.slice(splitAt).trim();
    if (!word) continue;

    nextDict.push(word);
    if (metadata) nextMetadata.set(word, metadata);
  }

  dict = nextDict;
  wordMetadata = nextMetadata;
  lexiconMetadataCache = new Map();
  anagramCache = new Map();
  wordExtensionCache = new Map();
  dictSet = new Set(dict);
  wordsByL = {};
  dict.forEach(w => { (wordsByL[w.length]=wordsByL[w.length]||[]).push(w); });
  initProbabilityCache();
  document.getElementById('wCnt').innerText = dict.length.toLocaleString() + " words";
  document.body.classList.add('is-ready');
  document.getElementById('loadingScreen').style.display = 'none';
  renderSaved();
  if (typeof tryInitCppEngine === 'function') tryInitCppEngine();
}

function showDictFallback(reason) {
  const ls = document.getElementById('loadingScreen');
  ls.innerHTML = `
    <div style="text-align:center; padding:24px; max-width:320px;">
      <div style="font-size:32px; margin-bottom:12px;">📖</div>
      <div class="mono" style="font-size:14px; color:var(--text); margin-bottom:8px; font-weight:700;">
        ไม่พบไฟล์พจนานุกรม
      </div>
      <div class="mono" style="font-size:12px; color:var(--text2); margin-bottom:20px; line-height:1.6;">
        ${reason}<br><br>
        กรุณาตรวจว่า <strong style="color:var(--accent);">CSW24.txt</strong> อยู่ในโฟลเดอร์เดียวกับ index.html<br>
        แล้วเปิดผ่าน web server<br><br>
        <em>หรือโหลดไฟล์เองด้านล่าง:</em>
      </div>
      <label style="
        display:inline-block; cursor:pointer;
        background:var(--accent); color:#000; font-weight:700;
        padding:12px 24px; border-radius:10px; font-size:14px;
        font-family:'JetBrains Mono',monospace;">
        📂 เลือก CSW24.txt
        <input type="file" accept=".txt" style="display:none"
          onchange="loadDictFromFile(event)">
      </label>
      <div class="mono" style="font-size:11px; color:var(--text2); margin-top:16px;">
        ไฟล์จะไม่ถูกอัปโหลดไปที่ใด — โหลดในเบราว์เซอร์เท่านั้น
      </div>
    </div>`;
}

async function loadDictFromFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const ls = document.getElementById('loadingScreen');
  ls.innerHTML = `
    <div class="spinner"></div>
    <div class="mono" id="loadingStatus">กำลังอ่านพจนานุกรม…</div>`;
  try {
    const text = await file.text();
    await processDictText(text);
  } catch(e) {
    showDictFallback("อ่านไฟล์ไม่ได้: " + e.message);
  }
}

window.onload = async () => {
  try {
    const resp = await fetch(DICTIONARY_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const total  = parseInt(resp.headers.get('content-length')||'0');
    const reader = resp.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      const s = document.getElementById('loadingStatus');
      if (s) s.innerText = total > 0
        ? `Loading dictionary · ${Math.min(100,Math.round(loaded/total*100))}%`
        : `Loading dictionary · ${Math.round(loaded/1024)} KB`;
    }
    const s = document.getElementById('loadingStatus');
    if (s) s.innerText = "Preparing the word index…";
    await processDictText(await new Blob(chunks).text());

  } catch(e) {
    console.warn(`fetch('${DICTIONARY_URL}') failed:`, e.message);
    // Could be file:// restriction, wrong path, or missing file
    showDictFallback(
      window.location.protocol === 'file:'
        ? "เปิดผ่าน file:// ไม่สามารถโหลดอัตโนมัติได้"
        : "โหลด CSW24.txt ไม่สำเร็จ"
    );
  }
};

// ─── COMMON UI ────────────────────────────────────────────────────────
function tab(idx, b) {
  document.querySelectorAll('.nav-item').forEach((item, itemIdx) => {
    const active = itemIdx === idx;
    item.classList.toggle('active', active);
    item.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.querySelectorAll('.section').forEach((section, sectionIdx) => {
    const active = sectionIdx === idx;
    section.classList.toggle('active', active);
    section.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
  if (b) b.blur();
  window.scrollTo({ top:0, behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function toggleSearchFilters(button) {
  const drawer = document.getElementById('sDrw');
  const open = drawer.classList.toggle('open');
  drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function toast(m, cls='') {
  let t=document.getElementById('tst'); t.innerText=m; t.className='toast show '+cls;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'),2600);
}

// ─── FILTER INFRASTRUCTURE ────────────────────────────────────────────
const RANGE_TYPES = new Set(['length','point_value','probability_order','limit_probability_order','num_vowels']);

function addFilter(mode) {
  fId++;
  const type = document.getElementById(mode==='S'?'sFType':'qFType').value;
  const defaults = {
    length:{v1:'2',v2:'8'}, point_value:{v1:'1',v2:'50'},
    probability_order:{v1:'1',v2:'1000'}, limit_probability_order:{v1:'1',v2:'100'},
    num_vowels:{v1:'2',v2:'4'},
    anagram_match:{v1:'AEINRST',v2:''}, subanagram_match:{v1:'AEINRST.',v2:''},
    pattern_match:{v1:'A...E',v2:''}, begins:{v1:'',v2:''}, ends:{v1:'',v2:''}, includes:{v1:'',v2:''},
  };
  const d = defaults[type] || {v1:'',v2:''};
  const arr = mode==='S' ? sFilters : qFilters;
  arr.push({id:fId, type, v1:d.v1, v2:d.v2, not:false});
  renderFilters(mode);
}
function toggleNot(mode, id) {
  const arr = mode==='S' ? sFilters : qFilters;
  const f = arr.find(x => x.id === id); if (f) f.not = !f.not;
  renderFilters(mode);
}
function deleteFilter(mode, id) {
  if (mode==='S') { sFilters = sFilters.filter(x => x.id !== id); renderFilters('S'); }
  else            { qFilters = qFilters.filter(x => x.id !== id); renderFilters('Q'); }
}
function updateFilterVal(mode, id, field, val) {
  const arr = mode==='S' ? sFilters : qFilters;
  const f = arr.find(x => x.id === id); if (f) f[field] = val.toUpperCase();
}

// Detect logical impossibility when the same filter type is used multiple times.
// Returns a tooltip string if impossible, null if valid.
//
// Rules per type:
//   range (length/point_value/num_vowels/probability_order/limit_probability_order):
//     two positive instances with non-overlapping ranges → impossible
//     (two NOTs, or one NOT + one positive → always valid)
//
//   begins / ends:
//     two positive instances where neither string is a prefix/suffix of the other → impossible
//     e.g. "RE" AND "UN" → impossible; "RE" AND "REAL" → valid (REAL implies RE)
//
//   includes:
//     always valid — AND of letter requirements only adds more specificity
//
//   anagram_match:
//     two positive instances with different alphagrams → impossible
//     (a word has exactly one alphagram, so it cannot match two different ones)
//
//   subanagram_match:
//     always valid — word must fit into BOTH racks (intersection of letter pools)
//
//   pattern_match:
//     warn if two positive patterns have different fixed lengths (e.g. A...E vs B....E)
//     but patterns with wildcards (*) are too complex to analyse → no warning
function detectConflict(f, arr) {
  // Only check conflicts between two positive (non-NOT) instances of same type
  const peers = arr.filter(x => x.id !== f.id && x.type === f.type && !x.not && !f.not);
  if (!peers.length || f.not) return null;

  switch (f.type) {
    case 'length':
    case 'point_value':
    case 'num_vowels':
    case 'probability_order':
    case 'limit_probability_order': {
      const conflict = peers.find(x => +x.v2 < +f.v1 || +x.v1 > +f.v2);
      return conflict
        ? `Ranges [${f.v1}–${f.v2}] and [${conflict.v1}–${conflict.v2}] do not overlap → empty result`
        : null;
    }

    case 'begins': {
      const a = f.v1.trim().toUpperCase();
      const conflict = peers.find(x => {
        const b = x.v1.trim().toUpperCase();
        // One must be a prefix of the other; otherwise no word can start with both
        return a && b && !a.startsWith(b) && !b.startsWith(a);
      });
      return conflict
        ? `"${f.v1}" and "${conflict.v1}" — no word can start with both → empty result`
        : null;
    }

    case 'ends': {
      const a = f.v1.trim().toUpperCase();
      const conflict = peers.find(x => {
        const b = x.v1.trim().toUpperCase();
        return a && b && !a.endsWith(b) && !b.endsWith(a);
      });
      return conflict
        ? `"${f.v1}" and "${conflict.v1}" — no word can end with both → empty result`
        : null;
    }

    case 'anagram_match': {
      const alphaOf = s => [...s.replace(/\./g,'')].sort().join('');
      const a = alphaOf(f.v1.trim().toUpperCase());
      const conflict = peers.find(x => {
        const b = alphaOf(x.v1.trim().toUpperCase());
        return a !== b; // different alphagrams = impossible
      });
      return conflict
        ? `"${f.v1}" and "${conflict.v1}" have different letter sets — a word can only match one alphagram`
        : null;
    }

    case 'pattern_match': {
      // Warn if both patterns specify a fixed length (no * wildcard) but lengths differ
      const lenOf = s => s.includes('*') ? null : s.trim().length;
      const la = lenOf(f.v1), conflict = peers.find(x => {
        const lb = lenOf(x.v1);
        return la !== null && lb !== null && la !== lb;
      });
      return conflict
        ? `Patterns "${f.v1}" (${lenOf(f.v1)} chars) and "${conflict.v1}" (${lenOf(conflict.v1)} chars) imply different lengths → empty result`
        : null;
    }

    // includes: always valid (must contain letters from all — additive constraint)
    // subanagram_match: always valid (intersection of racks)
    default: return null;
  }
}

function renderFilters(mode) {
  const arr = mode==='S' ? sFilters : qFilters;
  const ph  = {
    anagram_match:'e.g. AEINRST', subanagram_match:'e.g. AEINRST.', pattern_match:'e.g. A...E',
    begins:'e.g. RE', ends:'e.g. ING', includes:'e.g. QU'
  };
  const lbl = {
    length:'LENGTH', point_value:'POINT VALUE', probability_order:'PROBABILITY ORDER',
    limit_probability_order:'LIMIT BY PROB', num_vowels:'NO. OF VOWELS',
    anagram_match:'ANAGRAM', subanagram_match:'SUBANAGRAM', pattern_match:'PATTERN',
    begins:'BEGINS WITH', ends:'ENDS WITH', includes:'INCLUDES LETTERS'
  };

  document.getElementById(mode==='S'?'sStack':'qStack').innerHTML = arr.map(f => {
    const isR    = RANGE_TYPES.has(f.type);
    const warn   = detectConflict(f, arr);
    const badge  = warn
      ? `<span title="${warn.replace(/"/g,"'")}"
               style="color:var(--danger);font-size:11px;font-weight:700;
                      margin-left:3px;cursor:help;">⚠</span>`
      : '';

    return `<div class="f-item" data-fid="${f.id}"
              style="${warn ? 'border-color:rgba(255,59,48,.5);' : ''}">
      <div style="display:flex;gap:6px;align-items:center;flex:1;min-width:0;">
        <button class="btn-not ${f.not?'active':''}"
                type="button"
                aria-pressed="${f.not ? 'true' : 'false'}"
                onclick="toggleNot('${mode}',${f.id})">NOT</button>
        <span class="mono" style="color:var(--accent);font-size:11px;white-space:nowrap;">
          ${lbl[f.type]||f.type}</span>${badge}
        ${isR
          ? `<input type="number"
               aria-label="Minimum ${lbl[f.type]||f.type}"
               style="width:52px;background:var(--bg);color:#fff;border:1px solid var(--border);padding:2px;"
               value="${f.v1}"
               oninput="updateFilterVal('${mode}',${f.id},'v1',this.value)">
             <span style="color:var(--text2)">–</span>
             <input type="number"
               aria-label="Maximum ${lbl[f.type]||f.type}"
               style="width:52px;background:var(--bg);color:#fff;border:1px solid var(--border);padding:2px;"
               value="${f.v2}"
               oninput="updateFilterVal('${mode}',${f.id},'v2',this.value)">`
          : `<input type="text" placeholder="${ph[f.type]||''}"
               aria-label="${lbl[f.type]||f.type}"
               style="flex:1;min-width:0;background:var(--bg);color:#fff;
                      border:1px solid var(--border);padding:2px;"
               value="${f.v1}"
               oninput="updateFilterVal('${mode}',${f.id},'v1',this.value)">`
        }
      </div>
      <button type="button" class="filter-delete"
              aria-label="Remove ${lbl[f.type]||f.type} filter"
              onclick="deleteFilter('${mode}',${f.id})">×</button>
    </div>`;
  }).join('');
}

function matchFilters(w, arr) {
  for (let f of arr) {
    let m=true, v1=(f.v1+'').trim().toUpperCase();
    switch(f.type) {
      case 'length':       m=w.length>=+f.v1&&w.length<=+f.v2; break;
      case 'point_value':  {let s=getWordScore(w); m=s>=+f.v1&&s<=+f.v2; break;}
      case 'begins':       m=w.startsWith(v1); break;
      case 'ends':         m=w.endsWith(v1); break;
      case 'includes':     m=[...v1].every(c=>w.includes(c)); break;
      case 'num_vowels':   {let vc=countVowels(w); m=vc>=+f.v1&&vc<=+f.v2; break;}
      case 'probability_order': {let r=probRankMap[w]||9999999; m=r>=+f.v1&&r<=+f.v2; break;}
      case 'limit_probability_order': m=true; break;
      case 'anagram_match':
        if(w.length!==v1.length){m=false;break;}
        {const bl=(v1.match(/\./g)||[]).length,rack=[...v1.replace(/\./g,'')];let nb=0;
         for(const c of w){const i=rack.indexOf(c);if(i>-1)rack.splice(i,1);else nb++;}
         m=nb<=bl;break;}
      case 'subanagram_match':
        {const bl=(v1.match(/\./g)||[]).length,rack=[...v1.replace(/\./g,'')];let nb=0;
         for(const c of w){const i=rack.indexOf(c);if(i>-1)rack.splice(i,1);else nb++;}
         m=nb<=bl;break;}
      case 'pattern_match':
        try{m=new RegExp('^'+v1.replace(/\./g,'.').replace(/\*/g,'.*')+'$').test(w);}catch(e){m=false;} break;
    }
    if(f.not)m=!m; if(!m)return false;
  }
  return true;
}

function applyLimitFilters(res, filters) {
  const lfs = filters.filter(f => f.type === 'limit_probability_order');
  if (!lfs.length) return res;

  // Sort by probability rank once (ascending = best first)
  res = [...res].sort((a, b) => {
    const d = (probRankMap[a] || 9999999) - (probRankMap[b] || 9999999);
    return d !== 0 ? d : (a < b ? -1 : 1);
  });

  // Apply each limit filter in order — each one further restricts the set
  for (const lf of lfs) {
    const start = Math.max(0, +lf.v1 - 1);
    const end   = Math.max(0, +lf.v2);
    const slice = res.slice(start, end);
    if (lf.not) {
      const excluded = new Set(slice);
      res = res.filter(w => !excluded.has(w));
    } else {
      res = slice;
    }
  }
  return res;
}

// ─── WORD MODAL ───────────────────────────────────────────────────────
function openUlu(idx) {
  if(idx<0||idx>=currentResultsList.length)return;
  currentWordIndex=idx;
  const modal = document.getElementById('uluModal');
  if (!modal.classList.contains('open')) modalReturnFocus = document.activeElement;
  const w   = currentResultsList[idx];
  const hk  = getHooksAndDots(w);
  const meta= getWordMetadata(w);
  const hw  = getFullHookWords(w);
  const ext = getWordExtensions(w);

  document.getElementById('mWord').innerText   = w;
  document.getElementById('mWordCenter').innerText = w;   // center of hook grid
  document.getElementById('mPos').innerText    = meta.pos;
  document.getElementById('mScore').innerText  = getWordScore(w);
  document.getElementById('mDef').innerText    = meta.def || '—';
  const favButton = document.getElementById('mFavBtn');
  const isSaved = saved.includes(w);
  favButton.innerText = isSaved ? '★' : '☆';
  favButton.setAttribute('aria-label', isSaved ? 'Remove saved word' : 'Save word');
  favButton.title = isSaved ? 'Remove saved word' : 'Save word';

  // Hook letters (single-letter, compact)
  document.getElementById('mFHooks').innerText = hk.f !== '-' ? hk.f.split('').join(' ') : '—';
  document.getElementById('mBHooks').innerText = hk.b !== '-' ? hk.b.split('').join(' ') : '—';

  // Full hook words
  document.getElementById('mFHookWords').innerText = hw.front.length ? hw.front.join('  ') : '—';
  document.getElementById('mBHookWords').innerText = hw.back.length  ? hw.back.join('  ')  : '—';

  // Multi-letter prefix / suffix extensions
  const fmtExt = (arr) => arr.length
    ? arr.map(x => `<span style="color:var(--text2)">${x.slice(0, x.length - w.length)}</span><strong>${w}</strong>` ).join('  ')
    : '—';
  const fmtSfx = (arr) => arr.length
    ? arr.map(x => `<strong>${w}</strong><span style="color:var(--text2)">${x.slice(w.length)}</span>`).join('  ')
    : '—';

  document.getElementById('mPrefixExt').innerHTML = fmtExt(ext.prefix);
  document.getElementById('mSuffixExt').innerHTML = fmtSfx(ext.suffix);

  // Anagrams & inflections
  document.getElementById('mAnagrams').innerText    = meta.anagrams;
  document.getElementById('mInflections').innerText = meta.inflections;

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => modal.focus());
}

function closeUlu() {
  const modal = document.getElementById('uluModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (modalReturnFocus && typeof modalReturnFocus.focus === 'function') modalReturnFocus.focus();
  modalReturnFocus = null;
}

function handleModalBackdrop(event) {
  if (event.target === event.currentTarget) closeUlu();
}

function trapOverlayFocus(event, overlay) {
  const focusable = [...overlay.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(element => element.offsetParent !== null);
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (document.activeElement === overlay) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

document.addEventListener('keydown', event => {
  const overlay = document.querySelector('.modal-overlay.open, .judge-overlay.open');
  if (!overlay) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (overlay.id === 'uluModal') closeUlu();
    else if (typeof closeJudgeOverlay === 'function') closeJudgeOverlay();
  } else if (event.key === 'Tab') {
    trapOverlayFocus(event, overlay);
  }
});

function navWord(dir){let n=currentWordIndex+dir;if(n>=0&&n<currentResultsList.length)openUlu(n);}
function favWord(){
  let w=currentResultsList[currentWordIndex];
  saved=saved.includes(w)?saved.filter(x=>x!==w):[...saved,w];
  localStorage.setItem('zyz_sv',JSON.stringify(saved));renderSaved();openUlu(currentWordIndex);
}

// ─── BOOKMARKS ────────────────────────────────────────────────────────
function renderSaved(){
  document.getElementById('bList').innerHTML=saved.map(w=>`
    <div class="item-row">
      <span class="mono" style="font-size:18px;font-weight:700;">${w}</span>
      <button type="button" class="btn destructive-action" aria-label="Remove ${w} from saved words" onclick="toggleSave('${w}')">Remove</button>
    </div>`).join('')||'<p class="empty-state">No saved words yet. Save one from a search result whenever it feels useful.</p>';
}
function toggleSave(w){
  saved=saved.includes(w)?saved.filter(x=>x!==w):[...saved,w];
  localStorage.setItem('zyz_sv',JSON.stringify(saved));renderSaved();
}
function clearSaved(){
  if(confirm("Purge all stored words?")){saved=[];localStorage.setItem('zyz_sv','[]');renderSaved();}
}

// --- GLOBAL STATES ---
let dict = [], dictSet = new Set(), wordsByL = {};
let saved = JSON.parse(localStorage.getItem('zyz_sv') || '[]');
let sFilters = [], qFilters = [], fId = 0;
let currentResultsList = [], currentWordIndex = -1;
let activeSearchMode = 'subanagram';

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
function getWordMetadata(w) {
  let ana = dict.filter(x=>x.length===w.length&&x!==w&&[...x].sort().join('')===[...w].sort().join(''));
  let inf = ['S','ES','ED','ING'].filter(s=>dictSet.has(w+s)).map(s=>w+s);
  let p="n.";
  if(w.endsWith('ED')||w.endsWith('ING'))p="v.";
  else if(w.endsWith('LY'))p="adv.";
  else if(w.endsWith('ABLE')||w.endsWith('FUL'))p="adj.";
  return {pos:p,def:"",anagrams:ana.join(', ')||'None',inflections:inf.join(', ')||'None'};
}

// ─── Dictionary loading ───────────────────────────────────────────────
async function processDictText(text) {
  dict    = text.split(/\r?\n/).map(w=>w.trim().toUpperCase()).filter(w=>w.length>0);
  dictSet = new Set(dict);
  dict.forEach(w => { (wordsByL[w.length]=wordsByL[w.length]||[]).push(w); });
  initProbabilityCache();
  document.getElementById('wCnt').innerText = dict.length.toLocaleString() + " Words";
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
        ไม่พบ CSW24.txt
      </div>
      <div class="mono" style="font-size:12px; color:var(--text2); margin-bottom:20px; line-height:1.6;">
        ${reason}<br><br>
        วางไฟล์ <strong style="color:var(--accent);">CSW24.txt</strong> ไว้ในโฟลเดอร์เดียวกับ index.html<br>
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
    <div class="mono" id="loadingStatus" style="font-size:13px; color:var(--text2)">กำลังโหลด...</div>`;
  try {
    const text = await file.text();
    await processDictText(text);
  } catch(e) {
    showDictFallback("อ่านไฟล์ไม่ได้: " + e.message);
  }
}

window.onload = async () => {
  try {
    const resp = await fetch('CSW24.txt');
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
        ? `Downloading Dictionary (${Math.min(100,Math.round(loaded/total*100))}%)`
        : `Downloading Dictionary (${Math.round(loaded/1024)} KB)`;
    }
    const s = document.getElementById('loadingStatus');
    if (s) s.innerText = "Processing Dictionary...";
    await processDictText(await new Blob(chunks).text());

  } catch(e) {
    console.warn("fetch('CSW24.txt') failed:", e.message);
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
  document.querySelectorAll('.nav-item').forEach(t=>t.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('.section').forEach((s,i)=>s.classList.toggle('active',i===idx));
}
function toast(m, cls='') {
  let t=document.getElementById('tst'); t.innerText=m; t.className='toast show '+cls;
  setTimeout(()=>t.classList.remove('show'),2000);
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
  const d = defaults[type]||{v1:'',v2:''};
  const item = {id:fId,type,v1:d.v1,v2:d.v2,not:false};
  if(mode==='S'){sFilters.push(item);renderFilters('S');}
  else          {qFilters.push(item);renderFilters('Q');}
}
function toggleNot(mode,id) {
  let a=mode==='S'?sFilters:qFilters, f=a.find(x=>x.id===id); if(f)f.not=!f.not; renderFilters(mode);
}
function deleteFilter(mode,id) {
  if(mode==='S'){sFilters=sFilters.filter(x=>x.id!==id);renderFilters('S');}
  else          {qFilters=qFilters.filter(x=>x.id!==id);renderFilters('Q');}
}
function updateFilterVal(mode,id,field,val) {
  let a=mode==='S'?sFilters:qFilters, f=a.find(x=>x.id===id); if(f)f[field]=val.toUpperCase();
}

function renderFilters(mode) {
  const arr = mode==='S'?sFilters:qFilters;
  const ph = {anagram_match:'e.g. AEINRST',subanagram_match:'e.g. AEINRST.',pattern_match:'e.g. A...E',begins:'e.g. RE',ends:'e.g. ING',includes:'e.g. QU'};
  const lbl= {length:'LENGTH',point_value:'POINT VALUE',probability_order:'PROBABILITY ORDER',limit_probability_order:'LIMIT BY PROB',num_vowels:'NO. OF VOWELS',anagram_match:'ANAGRAM',subanagram_match:'SUBANAGRAM',pattern_match:'PATTERN',begins:'BEGINS WITH',ends:'ENDS WITH',includes:'INCLUDES LETTERS'};
  document.getElementById(mode==='S'?'sStack':'qStack').innerHTML = arr.map(f => {
    const isR = RANGE_TYPES.has(f.type);
    return `<div class="f-item">
      <div style="display:flex;gap:6px;align-items:center;flex:1;">
        <button class="btn-not ${f.not?'active':''}" onclick="toggleNot('${mode}',${f.id})">NOT</button>
        <span class="mono" style="color:var(--accent);font-size:11px;">${lbl[f.type]||f.type}</span>
        ${isR
          ? `<input type="number" style="width:55px;background:var(--bg);color:#fff;border:1px solid var(--border);padding:2px;" value="${f.v1}" onchange="updateFilterVal('${mode}',${f.id},'v1',this.value)">
             &ndash;
             <input type="number" style="width:55px;background:var(--bg);color:#fff;border:1px solid var(--border);padding:2px;" value="${f.v2}" onchange="updateFilterVal('${mode}',${f.id},'v2',this.value)">`
          : `<input type="text" placeholder="${ph[f.type]||''}" style="flex:1;background:var(--bg);color:#fff;border:1px solid var(--border);padding:2px;" value="${f.v1}" oninput="updateFilterVal('${mode}',${f.id},'v1',this.value)">`
        }
      </div>
      <span style="cursor:pointer;color:var(--danger);" onclick="deleteFilter('${mode}',${f.id})">✕</span>
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
  let lf=filters.find(f=>f.type==='limit_probability_order'); if(!lf)return res;
  res.sort((a,b)=>{let d=(probRankMap[a]||9999999)-(probRankMap[b]||9999999);return d||a<b?-1:1;});
  let start=Math.max(0,+lf.v1-1), end=Math.max(0,+lf.v2);
  let sl=res.slice(start,end);
  if(lf.not){let ss=new Set(sl);return res.filter(w=>!ss.has(w));}
  return sl;
}

// ─── WORD MODAL ───────────────────────────────────────────────────────
function openUlu(idx) {
  if(idx<0||idx>=currentResultsList.length)return;
  currentWordIndex=idx;
  let w=currentResultsList[idx],hk=getHooksAndDots(w),meta=getWordMetadata(w);
  document.getElementById('mWord').innerText=w;
  document.getElementById('mPos').innerText=meta.pos;
  document.getElementById('mScore').innerText=getWordScore(w);
  document.getElementById('mDef').innerText=meta.def;
  document.getElementById('mFHooks').innerText=hk.f;
  document.getElementById('mBHooks').innerText=hk.b;
  document.getElementById('mAnagrams').innerText=meta.anagrams;
  document.getElementById('mInflections').innerText=meta.inflections;
  document.getElementById('mFavBtn').innerText=saved.includes(w)?'⭐':'☆';
  document.getElementById('uluModal').classList.add('open');
}
const closeUlu = () => document.getElementById('uluModal').classList.remove('open');
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
      <button class="btn" style="padding:4px 8px;color:var(--danger);border-color:transparent;" onclick="toggleSave('${w}')">🗑️</button>
    </div>`).join('')||'<p style="text-align:center;color:var(--text2);padding-top:16px;">No saved items</p>';
}
function toggleSave(w){
  saved=saved.includes(w)?saved.filter(x=>x!==w):[...saved,w];
  localStorage.setItem('zyz_sv',JSON.stringify(saved));renderSaved();
}
function clearSaved(){
  if(confirm("Purge all stored words?")){saved=[];localStorage.setItem('zyz_sv','[]');renderSaved();}
}

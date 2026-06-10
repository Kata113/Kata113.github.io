// Global Dictionary State
window.lexicon = new Set();
window.lexiconOrder = []; // To preserve index-based/probability order if needed
window.definitions = new Map();
window.hooks = new Map(); // word -> { f: "front", b: "back" }
window.inflections = new Map();

// UI Elements for Loading
const loadingScreen = document.getElementById('loadingScreen');
const wCnt = document.getElementById('wCnt');

// Restore the robust stream-loading mechanism from the old core
window.onload = async () => {
  try {
    const response = await fetch('CSW24.txt');
    if (!response.ok) throw new Error("Network response was not ok");

    const reader = response.body.getReader();
    // Use the fallback total from old core if Content-Length is missing (GitHub Pages gzip issue)
    const contentLength = response.headers.get('Content-Length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 6000000; 
    
    let receivedBytes = 0;
    let chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.length;
      
      // Update loading status text with percentage
      const pct = Math.min(99, Math.floor((receivedBytes / totalBytes) * 100));
      const statusEl = document.getElementById('loadingStatus') || document.querySelector('#loadingScreen .mono');
      if (statusEl) {
        statusEl.innerText = `DOWNLOADING DICTIONARY... ${pct}%`;
      }
    }

    const statusEl = document.getElementById('loadingStatus') || document.querySelector('#loadingScreen .mono');
    if (statusEl) statusEl.innerText = "PROCESSING CORE LEXICON...";

    // Combine chunks and decode
    let allChunks = new Uint8Array(receivedBytes);
    let position = 0;
    for (let chunk of chunks) {
      allChunks.set(chunk, position);
      position += chunk.length;
    }
    
    const text = new TextDecoder("utf-8").decode(allChunks);
    const lines = text.split(/\r?\n/);

    // Parse Dictionary Lines
    for (let line of lines) {
      if (!line.trim()) continue;
      // Format expected: WORD [tab] DEFINITION
      const parts = line.split('\t');
      const word = parts[0].trim().toUpperCase();
      const def = parts[1] ? parts[1].trim() : "";

      window.lexicon.add(word);
      window.lexiconOrder.push(word);
      if (def) {
        window.definitions.set(word, def);
      }
    }

    // Post-processing: Generate Hooks & Inflections (Preserving logic from new core)
    if (statusEl) statusEl.innerText = "GENERATING HOOK MAPS...";
    await generateHookMaps();

    // Update Word Count Badge
    if (wCnt) {
      wCnt.innerText = `${window.lexicon.size.toLocaleString()} Words`;
    }

    // Hide Loading Screen
    if (loadingScreen) {
      loadingScreen.style.display = 'none';
    }

    // Trigger initial search if there is existing input
    if (typeof search === 'function' && document.getElementById('sInp')?.value) {
      search();
    }

  } catch (err) {
    console.error("Critical failure loading dictionary:", err);
    const statusEl = document.getElementById('loadingStatus') || document.querySelector('#loadingScreen .mono');
    if (statusEl) {
      statusEl.innerText = "ERROR LOADING LEXICON. REFRESH?";
      statusEl.style.color = "var(--danger)";
    }
  }
};

// Helper function to build hooks efficiently
async function generateHookMaps() {
  for (const word of window.lexicon) {
    let fHooks = "";
    let bHooks = "";

    // Front hooks (A-Z)
    for (let i = 65; i <= 90; i++) {
      const char = String.fromCharCode(i);
      if (window.lexicon.has(char + word)) {
        fHooks += char;
      }
    }

    // Back hooks (A-Z)
    for (let i = 65; i <= 90; i++) {
      const char = String.fromCharCode(i);
      if (window.lexicon.has(word + char)) {
        bHooks += char;
      }
    }

    if (fHooks || bHooks) {
      window.hooks.set(word, { f: fHooks || "-", b: bHooks || "-" });
    }
  }
}

// Universal Tab Router
window.tab = function(index, btn) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  
  btn.classList.add('active');
  const targetSection = document.getElementById(`t${index}`);
  if (targetSection) targetSection.classList.add('active');
};

// Toast Notification System
window.showToast = function(msg) {
  const t = document.getElementById('tst');
  if (!t) return;
  t.innerText = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
};

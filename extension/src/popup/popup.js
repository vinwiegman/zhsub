// Display preferences live in sync storage so they follow you between machines.
const SYNC_DEFAULTS = {
  enabled: true,
  showHanzi: true,
  showPinyin: true,
  showEnglish: true,
  fontSize: 28,
  useHelper: true,
  helperUrl: 'http://127.0.0.1:8787',
  translator: 'free',
};

// The API key is a credential, so it stays on this machine. sync storage
// replicates through the signed-in Google account, which is the wrong place
// for a secret.
const LOCAL_DEFAULTS = { anthropicKey: '' };

function bind(area, defaults) {
  area.get(defaults, (stored) => {
    for (const key of Object.keys(defaults)) {
      const el = document.getElementById(key);
      if (!el) continue; // helperUrl has no control; it is read-only here
      if (el.type === 'checkbox') el.checked = !!stored[key];
      else el.value = stored[key];

      el.addEventListener('change', () => {
        const value =
          el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
        area.set({ [key]: value });
      });
    }
    if (defaults.helperUrl) checkHelper(stored.helperUrl);
  });
}

async function checkHelper(url) {
  const out = document.getElementById('helper');
  try {
    const res = await fetch(`${url}/health`);
    const data = await res.json();
    out.textContent = `running (${data.model || 'whisper'})`;
    out.style.color = '#137333';
  } catch {
    out.textContent = 'not running';
    out.style.color = '#b3261e';
  }
}

bind(chrome.storage.sync, SYNC_DEFAULTS);
bind(chrome.storage.local, LOCAL_DEFAULTS);

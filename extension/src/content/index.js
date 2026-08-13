import { tokensCached } from '../lib/ruby.js';
import { cueAt } from '../lib/cues.js';
import * as yt from '../lib/platforms/youtube.js';
import * as bili from '../lib/platforms/bilibili.js';

const DEFAULTS = {
  enabled: true,
  showPinyin: true,
  showEnglish: true,
  showHanzi: true,
  fontSize: 28,
  useHelper: true,
  helperUrl: 'http://127.0.0.1:8787',
};

let settings = { ...DEFAULTS };
let cues = [];
let hint = 0;
let overlay = null;
let host = null;
let rafId = 0;
let currentKey = '';
let statusText = '';

/* ---------- page probe (talks to the MAIN-world bridge) ---------- */

function probe() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ platform: null }), 2000);
    window.addEventListener(
      'zhsub:probe-result',
      (e) => {
        clearTimeout(timer);
        resolve(e.detail || { platform: null });
      },
      { once: true }
    );
    window.dispatchEvent(new Event('zhsub:probe'));
  });
}

const site = () => (location.hostname.endsWith('bilibili.com') ? bili : yt);

/* ---------- overlay ---------- */

function mount() {
  const root = site().playerRoot();
  if (!root) return false;
  if (host && root.contains(host)) return true;

  host = document.createElement('div');
  host.className = 'zhsub-host';
  overlay = document.createElement('div');
  overlay.className = 'zhsub-overlay';
  host.appendChild(overlay);
  root.appendChild(host);

  // Our overlay replaces the native caption box; showing both is unreadable.
  document.documentElement.classList.add('zhsub-active');
  applyStyleVars();
  return true;
}

function applyStyleVars() {
  if (!host) return;
  host.style.setProperty('--zhsub-size', `${settings.fontSize}px`);
}

function unmount() {
  host?.remove();
  host = null;
  overlay = null;
  document.documentElement.classList.remove('zhsub-active');
}

function renderCue(cue) {
  if (!overlay) return;
  overlay.textContent = '';
  if (!cue) return;

  const box = document.createElement('div');
  box.className = 'zhsub-cue';

  if (settings.showHanzi || settings.showPinyin) {
    const line = document.createElement('div');
    line.className = 'zhsub-zh';
    for (const tok of tokensCached(cue.zh)) {
      const w = document.createElement('span');
      w.className = tok.han ? 'zhsub-word' : 'zhsub-word zhsub-plain';
      if (tok.punct) w.classList.add(`zhsub-punct-${tok.punct}`);
      if (settings.showPinyin && tok.pinyin) {
        const p = document.createElement('span');
        p.className = 'zhsub-py';
        p.textContent = tok.pinyin;
        w.appendChild(p);
      }
      if (settings.showHanzi) {
        const h = document.createElement('span');
        h.className = 'zhsub-hz';
        h.textContent = tok.text;
        w.appendChild(h);
      }
      line.appendChild(w);
    }
    box.appendChild(line);
  }

  if (settings.showEnglish && cue.en) {
    const en = document.createElement('div');
    en.className = 'zhsub-en';
    en.textContent = cue.en;
    box.appendChild(en);
  }

  overlay.appendChild(box);
}

function renderStatus(text) {
  statusText = text;
  if (!overlay) return;
  overlay.textContent = '';
  if (!text) return;
  const s = document.createElement('div');
  s.className = 'zhsub-status';
  s.textContent = text;
  overlay.appendChild(s);
}

/* ---------- playback loop ---------- */

function startLoop() {
  cancelAnimationFrame(rafId);
  let lastIdx = -2;
  const tick = () => {
    rafId = requestAnimationFrame(tick);
    const video = site().videoElement();
    if (!video || !cues.length) return;
    const idx = cueAt(cues, video.currentTime, hint);
    if (idx === lastIdx) return;
    lastIdx = idx;
    if (idx >= 0) hint = idx;
    renderCue(idx >= 0 ? cues[idx] : null);
  };
  rafId = requestAnimationFrame(tick);
}

/* ---------- background bridge ---------- */

function ask(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (r) => {
        void chrome.runtime.lastError;
        resolve(r || { ok: false });
      });
    } catch {
      resolve({ ok: false });
    }
  });
}

/** Fill in English for cues that have none, in batches, via the worker. */
async function ensureEnglish() {
  const missing = cues.filter((c) => !c.en);
  if (!missing.length) return;
  const size = 40;
  for (let i = 0; i < missing.length; i += size) {
    const batch = missing.slice(i, i + size);
    const r = await ask({ type: 'translate', lines: batch.map((c) => c.zh) });
    if (!r?.ok || !Array.isArray(r.lines)) return;
    batch.forEach((c, k) => {
      if (r.lines[k]) c.en = r.lines[k];
    });
  }
}

/* ---------- resolution: caption track, else local ASR ---------- */

async function resolveCues(info) {
  if (info.platform === 'youtube') {
    const track = yt.pickTrack(info.tracks);
    if (track) {
      try {
        return { cues: await yt.loadCues(track), source: track.kind === 'asr' ? 'auto CC' : 'CC' };
      } catch {
        /* fall through to the helper */
      }
    }
  } else if (info.platform === 'bilibili') {
    try {
      const sub = bili.pickSubtitle(await bili.listSubtitles(info));
      if (sub) return { cues: await bili.loadCues(sub), source: 'CC' };
    } catch {
      /* fall through */
    }
  }

  if (!settings.useHelper) {
    throw new Error('No Chinese caption track. Start the local helper to transcribe.');
  }
  return { cues: await transcribeViaHelper(info), source: 'Whisper' };
}

/**
 * No caption track — hand the video off to the local helper, which pulls the
 * audio and runs Whisper. This is the path for burned-in-subtitle videos.
 */
async function transcribeViaHelper(info) {
  const key = `${info.platform}:${info.videoId || info.bvid || info.cid}`;
  const cached = await ask({ type: 'helper', path: `/cues/${encodeURIComponent(key)}` });
  if (cached?.ok && cached.data?.cues?.length) return cached.data.cues;

  renderStatus('zhsub: no caption track — transcribing locally…');
  const started = await ask({
    type: 'helper',
    method: 'POST',
    path: '/jobs',
    body: { key, url: location.href, title: info.title || document.title },
  });
  if (!started?.ok) {
    throw new Error('Local helper unreachable. Run: python helper/server.py');
  }

  const jobId = started.data.jobId;
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await ask({ type: 'helper', path: `/jobs/${jobId}` });
    if (!st?.ok) throw new Error('Helper stopped responding.');
    const d = st.data;
    if (d.status === 'done') return d.cues;
    if (d.status === 'error') throw new Error(d.error || 'Transcription failed.');
    renderStatus(`zhsub: ${d.status}${d.progress ? ` ${Math.round(d.progress * 100)}%` : ''}…`);
  }
}

/* ---------- lifecycle ---------- */

async function activate() {
  const info = await probe();
  if (!info.platform) return;
  const key = `${info.platform}:${info.videoId || info.cid || location.pathname}`;
  if (key === currentKey) return;
  currentKey = key;

  cues = [];
  hint = 0;
  if (!settings.enabled) return unmount();

  // The player element appears asynchronously after SPA navigation.
  for (let i = 0; i < 40 && !mount(); i++) await new Promise((r) => setTimeout(r, 250));
  if (!overlay) return;

  renderStatus('zhsub: looking for subtitles…');
  try {
    const result = await resolveCues(info);
    if (currentKey !== key) return; // navigated away mid-load
    cues = result.cues;
    renderStatus(`zhsub: ${cues.length} lines from ${result.source} — translating…`);
    await ensureEnglish();
    if (currentKey !== key) return;
    renderStatus('');
    startLoop();
  } catch (err) {
    renderStatus(`zhsub: ${err.message}`);
  }
}

function watchNavigation() {
  window.addEventListener('yt-navigate-finish', () => activate());
  let last = location.href;
  setInterval(() => {
    if (location.href !== last) {
      last = location.href;
      activate();
    }
  }, 800);
}

chrome.storage?.sync.get(DEFAULTS, (stored) => {
  settings = { ...DEFAULTS, ...stored };
  activate();
  watchNavigation();
});

chrome.storage?.onChanged.addListener((changes, area) => {
  // Only display preferences live in sync. Ignoring other areas keeps the API
  // key out of this script's memory entirely — it is the worker's business.
  if (area !== 'sync') return;
  for (const [k, v] of Object.entries(changes)) settings[k] = v.newValue;
  applyStyleVars();
  if (!settings.enabled) {
    cancelAnimationFrame(rafId);
    unmount();
  } else if (!host) {
    currentKey = '';
    activate();
  } else if (!statusText) {
    hint = 0;
    startLoop();
  }
});

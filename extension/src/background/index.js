// The service worker owns everything that must escape the page's origin:
// machine translation and the localhost helper.

const SYNC_SETTINGS = {
  helperUrl: 'http://127.0.0.1:8787',
  translator: 'free', // 'free' | 'claude'
};

// Kept out of sync storage: that replicates to every Chrome signed into the
// same Google account, which is not where a credential belongs.
const LOCAL_SETTINGS = { anthropicKey: '' };

async function settings() {
  const [sync, local] = await Promise.all([
    new Promise((r) => chrome.storage.sync.get(SYNC_SETTINGS, r)),
    new Promise((r) => chrome.storage.local.get(LOCAL_SETTINGS, r)),
  ]);
  return { ...sync, ...local };
}

/** Move a key written by an earlier build out of sync storage. */
async function migrateKeyToLocal() {
  const stale = await new Promise((r) => chrome.storage.sync.get({ anthropicKey: '' }, r));
  if (!stale.anthropicKey) return;
  await chrome.storage.local.set({ anthropicKey: stale.anthropicKey });
  await chrome.storage.sync.remove('anthropicKey');
}

chrome.runtime.onInstalled.addListener(() => {
  migrateKeyToLocal().catch(() => {});
});

/* ---------- translation ---------- */

const SEP = '\n@@\n';

/** Free endpoint, no key. Batched, because per-line requests get rate-limited. */
async function translateFree(lines) {
  const out = new Array(lines.length).fill('');
  // Keep each request under the endpoint's practical query limit.
  let batch = [];
  let batchStart = 0;
  let size = 0;

  const flush = async () => {
    if (!batch.length) return;
    const q = batch.join(SEP);
    const url =
      'https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=' +
      encodeURIComponent(q);
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const joined = (data?.[0] || []).map((seg) => seg[0]).join('');
        const parts = joined.split(/\s*@@\s*/);
        batch.forEach((_, i) => {
          out[batchStart + i] = (parts[i] || '').trim();
        });
      }
    } catch {
      /* leave blank; the overlay simply omits the English line */
    }
    batchStart += batch.length;
    batch = [];
    size = 0;
  };

  for (const line of lines) {
    if (size + line.length > 1200 && batch.length) await flush();
    batch.push(line);
    size += line.length + 4;
  }
  await flush();
  return out;
}

/** Optional higher-quality path: whole batch in one prompt, context preserved. */
async function translateClaude(lines, key) {
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system:
        'Translate each numbered Chinese subtitle line into natural English. ' +
        'These are consecutive lines from one video, so use the surrounding lines for context. ' +
        'Reply with the same numbering, one line each, and nothing else.',
      messages: [{ role: 'user', content: numbered }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = await res.json();
  const text = data?.content?.[0]?.text || '';
  const out = new Array(lines.length).fill('');
  for (const row of text.split('\n')) {
    const m = row.match(/^\s*(\d+)[.)]\s*(.+)$/);
    if (m) {
      const i = Number(m[1]) - 1;
      if (i >= 0 && i < out.length) out[i] = m[2].trim();
    }
  }
  return out;
}

async function translate(lines) {
  const s = await settings();
  if (s.translator === 'claude' && s.anthropicKey) {
    try {
      return await translateClaude(lines, s.anthropicKey);
    } catch {
      /* fall back rather than showing nothing */
    }
  }
  return translateFree(lines);
}

/* ---------- localhost helper proxy ---------- */

async function helper({ method = 'GET', path, body }) {
  const s = await settings();
  const res = await fetch(`${s.helperUrl}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`helper ${res.status}`);
  return res.json();
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  (async () => {
    try {
      if (msg.type === 'translate') {
        respond({ ok: true, lines: await translate(msg.lines) });
      } else if (msg.type === 'helper') {
        respond({ ok: true, data: await helper(msg) });
      } else {
        respond({ ok: false, error: 'unknown message' });
      }
    } catch (err) {
      respond({ ok: false, error: String(err.message || err) });
    }
  })();
  return true; // keep the channel open for the async reply
});

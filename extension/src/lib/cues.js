// A cue is { start, end, zh, en }. Times in seconds.

/** YouTube's json3 caption format. */
export function fromJson3(data) {
  const events = data?.events || [];
  const cues = [];
  for (const ev of events) {
    if (!ev.segs) continue;
    const zh = ev.segs.map((s) => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
    if (!zh) continue;
    const start = (ev.tStartMs || 0) / 1000;
    const dur = (ev.dDurationMs || 0) / 1000;
    cues.push({ start, end: start + (dur || 2), zh, en: '' });
  }
  return merge(cues);
}

/** Bilibili's bcc format: { body: [{ from, to, content }] }. */
export function fromBcc(data) {
  const body = data?.body || [];
  return merge(
    body
      .filter((b) => b && b.content)
      .map((b) => ({
        start: Number(b.from) || 0,
        end: Number(b.to) || 0,
        zh: String(b.content).replace(/\n/g, ' ').trim(),
        en: '',
      }))
  );
}

export function fromSrt(text) {
  const cues = [];
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  const stamp = /(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/;
  for (const block of blocks) {
    const m = block.match(stamp);
    if (!m) continue;
    const secs = (h, mi, s, ms) => +h * 3600 + +mi * 60 + +s + +ms / 1000;
    const lines = block
      .split('\n')
      .filter((l) => !stamp.test(l) && !/^\d+$/.test(l.trim()))
      .join(' ')
      .trim();
    if (!lines) continue;
    cues.push({
      start: secs(m[1], m[2], m[3], m[4]),
      end: secs(m[5], m[6], m[7], m[8]),
      zh: lines,
      en: '',
    });
  }
  return merge(cues);
}

/**
 * Auto-generated tracks arrive as a rolling word-by-word stream where each cue
 * repeats the previous partial line. Collapse overlapping fragments so we show
 * a stable sentence instead of a flicker.
 */
function merge(cues) {
  const sorted = cues.slice().sort((a, b) => a.start - b.start);
  const out = [];
  for (const cue of sorted) {
    const prev = out[out.length - 1];
    if (prev && cue.zh === prev.zh) {
      prev.end = Math.max(prev.end, cue.end);
      continue;
    }
    if (prev && prev.end > cue.start) prev.end = cue.start;
    if (cue.end <= cue.start) cue.end = cue.start + 2;
    out.push(cue);
  }
  return out;
}

/** Index of the cue covering `t`, or -1. Binary search — this runs per frame. */
export function cueAt(cues, t, hint = 0) {
  if (!cues.length) return -1;
  // The playhead usually advances into the same or next cue.
  if (hint >= 0 && hint < cues.length) {
    const c = cues[hint];
    if (t >= c.start && t < c.end) return hint;
    const n = cues[hint + 1];
    if (n && t >= n.start && t < n.end) return hint + 1;
  }
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t < cues[mid].start) hi = mid - 1;
    else if (t >= cues[mid].end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

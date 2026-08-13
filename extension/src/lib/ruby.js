import { pinyin } from 'pinyin-pro';

// Chinese has no spaces, so "one pinyin syllable per character" produces an
// unreadable wall. We segment into words first and keep each word's syllables
// together, which is how learner material actually sets pinyin.

const HAN = /\p{Script=Han}/u;

// Punctuation is laid out as its own flex item, so without this it floats in
// the middle of the inter-word gap instead of hugging the text it belongs to.
const CLOSE_PUNCT = /^[，。！？；：、）］｝」』》】…,.!?;:)\]}]+$/u;
const OPEN_PUNCT = /^[（［｛「『《【([{]+$/u;

function punctSide(word) {
  if (CLOSE_PUNCT.test(word)) return 'close';
  if (OPEN_PUNCT.test(word)) return 'open';
  return null;
}

let segmenter = null;
function getSegmenter() {
  if (segmenter === null) {
    try {
      segmenter = new Intl.Segmenter('zh-Hans', { granularity: 'word' });
    } catch {
      segmenter = false; // not available; fall back to per-character
    }
  }
  return segmenter;
}

/**
 * pinyin-pro returns one entry per character when type:'all'. We ask it to
 * segment the *whole line* first so polyphones resolve from context — 银行
 * becomes yín háng, not yín xíng. Then we re-group by word for display.
 */
function readingsFor(text) {
  let out;
  try {
    out = pinyin(text, {
      type: 'all',
      toneType: 'symbol',
      segment: true,
      nonZh: 'consecutive',
    });
  } catch {
    out = null;
  }
  if (!Array.isArray(out)) return null;

  // Normalise: we want a lookup from character index -> syllable.
  // pinyin-pro collapses runs of non-Chinese into single entries, so walk
  // both sequences together rather than trusting index alignment.
  const map = new Array(text.length).fill('');
  let i = 0;
  for (const entry of out) {
    const origin = entry && typeof entry === 'object' ? entry.origin ?? '' : String(entry ?? '');
    if (!origin) continue;
    const at = text.indexOf(origin, i);
    if (at === -1) continue;
    const isZh = entry.isZh ?? HAN.test(origin);
    if (isZh && origin.length === 1) {
      map[at] = entry.pinyin || '';
    }
    i = at + origin.length;
  }
  return map;
}

function segmentWords(text) {
  const seg = getSegmenter();
  if (!seg) {
    // Degrade to runs of Han vs non-Han.
    const parts = [];
    let buf = '';
    let bufHan = null;
    for (const ch of text) {
      const isHan = HAN.test(ch);
      if (bufHan === null || isHan === bufHan) {
        buf += ch;
        bufHan = isHan;
      } else {
        parts.push(buf);
        buf = ch;
        bufHan = isHan;
      }
    }
    if (buf) parts.push(buf);
    return parts;
  }
  return [...seg.segment(text)].map((s) => s.segment);
}

/**
 * Turn a subtitle line into display tokens.
 * @returns {Array<{text: string, pinyin: string, han: boolean}>}
 */
export function toTokens(text) {
  const line = (text || '').replace(/\s+/g, ' ').trim();
  if (!line) return [];

  const readings = readingsFor(line);
  const words = segmentWords(line);

  const tokens = [];
  let cursor = 0;
  for (const word of words) {
    const start = line.indexOf(word, cursor);
    const at = start === -1 ? cursor : start;
    cursor = at + word.length;

    if (!HAN.test(word)) {
      tokens.push({ text: word, pinyin: '', han: false, punct: punctSide(word) });
      continue;
    }

    const syllables = [];
    for (let k = 0; k < word.length; k++) {
      const syl = readings ? readings[at + k] : '';
      if (syl) syllables.push(syl);
    }
    tokens.push({ text: word, pinyin: syllables.join(' '), han: true });
  }
  return tokens;
}

/** Cache tokenisation — the same cue is re-rendered on every seek. */
const cache = new Map();
export function tokensCached(text) {
  if (cache.has(text)) return cache.get(text);
  const t = toTokens(text);
  if (cache.size > 2000) cache.clear();
  cache.set(text, t);
  return t;
}

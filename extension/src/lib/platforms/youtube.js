import { fromJson3 } from '../cues.js';

const CHINESE = /^zh/i;

export function pickTrack(tracks) {
  if (!tracks?.length) return null;
  // Prefer a human-made Chinese track, then auto-generated Chinese, then any
  // Chinese at all. Never fall back to a non-Chinese track — translating an
  // English track into pinyin is nonsense.
  const zh = tracks.filter((t) => CHINESE.test(t.lang || ''));
  if (!zh.length) return null;
  return zh.find((t) => t.kind !== 'asr') || zh[0];
}

function withParams(baseUrl, params) {
  const u = new URL(baseUrl, location.origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** Fetch the Chinese track, plus YouTube's own English translation of it. */
export async function loadCues(track) {
  const res = await fetch(withParams(track.baseUrl, { fmt: 'json3' }), {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`timedtext ${res.status}`);
  const cues = fromJson3(await res.json());
  if (!cues.length) throw new Error('empty caption track');

  // YouTube will machine-translate the same track server-side, already timed
  // to the same cues. Free, and it saves a round of MT requests.
  try {
    const tr = await fetch(withParams(track.baseUrl, { fmt: 'json3', tlang: 'en' }), {
      credentials: 'include',
    });
    if (tr.ok) {
      const en = fromJson3(await tr.json());
      alignInto(cues, en);
    }
  } catch {
    /* fall through to the MT path in the background worker */
  }
  return cues;
}

/** Copy English text onto the Chinese cues by time overlap. */
function alignInto(cues, en) {
  let j = 0;
  for (const cue of cues) {
    while (j < en.length && en[j].end <= cue.start) j++;
    const cand = en[j];
    if (cand && cand.start < cue.end) cue.en = cand.zh;
  }
}

export function videoElement() {
  return document.querySelector('#movie_player video, video.html5-main-video');
}

export function playerRoot() {
  return document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
}

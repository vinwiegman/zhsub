import { fromBcc } from '../cues.js';

/**
 * Bilibili keeps subtitle metadata behind the player API. The plain /x/player/v2
 * endpoint still answers for most videos when called with session cookies; the
 * wbi variant is the newer signed one, so we try both before giving up.
 */
export async function listSubtitles({ aid, bvid, cid }) {
  if (!cid) return [];
  const qs = new URLSearchParams({ cid: String(cid) });
  if (bvid) qs.set('bvid', bvid);
  else if (aid) qs.set('aid', String(aid));

  for (const path of ['/x/player/wbi/v2', '/x/player/v2']) {
    try {
      const res = await fetch(`https://api.bilibili.com${path}?${qs}`, {
        credentials: 'include',
      });
      if (!res.ok) continue;
      const json = await res.json();
      const subs = json?.data?.subtitle?.subtitles || [];
      if (subs.length) return subs;
    } catch {
      /* try the next endpoint */
    }
  }
  return [];
}

export function pickSubtitle(subs) {
  if (!subs?.length) return null;
  // ai-zh is Bilibili's auto transcript; a human zh-Hans track beats it.
  const zh = subs.filter((s) => /^(zh|ai-zh)/i.test(s.lan || ''));
  if (!zh.length) return null;
  return zh.find((s) => !/^ai/i.test(s.lan)) || zh[0];
}

export async function loadCues(sub) {
  const url = sub.subtitle_url?.startsWith('//') ? `https:${sub.subtitle_url}` : sub.subtitle_url;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`bcc ${res.status}`);
  return fromBcc(await res.json());
}

export function videoElement() {
  return document.querySelector('#bilibili-player video, .bpx-player-video-wrap video, video');
}

export function playerRoot() {
  return (
    document.querySelector('.bpx-player-video-area') ||
    document.querySelector('#bilibili-player') ||
    document.querySelector('#playerWrap')
  );
}

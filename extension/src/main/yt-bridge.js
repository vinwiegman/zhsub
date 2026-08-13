// Runs in the PAGE world. Its only job is to hand the isolated content script
// the player's own caption metadata, which is not reachable from an extension
// world. Everything else stays out of here.

function playerResponse() {
  const el = document.querySelector('#movie_player');
  try {
    const r = el && typeof el.getPlayerResponse === 'function' ? el.getPlayerResponse() : null;
    if (r) return r;
  } catch {
    /* player not ready */
  }
  return window.ytInitialPlayerResponse || null;
}

function biliState() {
  const s = window.__INITIAL_STATE__;
  if (!s) return null;
  const bvid = s.bvid || s.videoData?.bvid || null;
  const aid = s.aid || s.videoData?.aid || null;
  // Multi-part videos: the active page carries the cid we need.
  const pages = s.videoData?.pages || [];
  const p = Number(new URLSearchParams(location.search).get('p') || 1);
  const cid = s.cid || pages[p - 1]?.cid || pages[0]?.cid || null;
  return { bvid, aid, cid };
}

window.addEventListener('zhsub:probe', () => {
  let detail = { platform: null };
  if (location.hostname.endsWith('youtube.com')) {
    const r = playerResponse();
    const list = r?.captions?.playerCaptionsTracklistRenderer;
    detail = {
      platform: 'youtube',
      videoId: r?.videoDetails?.videoId || null,
      title: r?.videoDetails?.title || '',
      durationSec: Number(r?.videoDetails?.lengthSeconds) || 0,
      tracks: (list?.captionTracks || []).map((t) => ({
        baseUrl: t.baseUrl,
        lang: t.languageCode,
        kind: t.kind || '',
        name: t.name?.simpleText || t.name?.runs?.[0]?.text || '',
      })),
      canTranslate: !!(list?.translationLanguages || []).length,
    };
  } else if (location.hostname.endsWith('bilibili.com')) {
    detail = { platform: 'bilibili', ...(biliState() || {}) };
  }
  window.dispatchEvent(new CustomEvent('zhsub:probe-result', { detail }));
});

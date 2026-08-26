# zhsub

Three line subtitles (characters, pinyin, English) on all YouTube and Bilibili videos, including videos without live captions

Existing extensions fail on the common case: a Chinese video with **burned-in** subtitles
and no machine-readable caption track. zhsub falls back to local Whisper transcription for
those, so coverage isn't limited to a curated video list.

## How a video gets subtitles

| Source | Used when | Cost | Speed |
|---|---|---|---|
| YouTube CC / auto-CC, Bilibili CC | A Chinese track exists | free | instant |
| Local Whisper (`helper/`) | No track — burned-in subs, music, vlogs | free, your CPU/GPU | ~1 min per 10 min of video, cached |

Translation is YouTube's own English track when available, else a free MT endpoint, else
Claude if you supply an API key (better with idiom and context).

## Install the extension

```bash
cd ~/projects/zhsub && npm install && npm run build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select the `extension/` folder. That covers every video that has a caption track.

## Install the helper (only for videos with no caption track)

```bash
pip install -r ~/projects/zhsub/helper/requirements.txt
```

```bash
python ~/projects/zhsub/helper/server.py
```

Also needs **ffmpeg** on the machine (`winget install Gyan.FFmpeg`), which the helper uses to
decode audio.

First run downloads the Whisper model (~500 MB for `small`). Transcripts are cached in
`helper/cache/`, so each video is only transcribed once.

- `--model medium` — better Mandarin accuracy, worth it if you have working CUDA
- `--model base` — faster, noticeably weaker on Mandarin
- `--device cuda` / `--device cpu` — override the automatic choice

Measured on a 24.8-minute episode, `small` on CPU with `int8`: **~8x realtime**, so about
3.4 minutes for the whole episode, once. The extension shows helper status in its popup and
falls back gracefully when it isn't running.

The helper picks CUDA when it can and falls back to CPU on its own, so no configuration is
needed either way.

## Layout

```
extension/
  src/lib/ruby.js         hanzi -> word-grouped pinyin (the core quality piece)
  src/lib/cues.js         json3 / bcc / srt parsing, per-frame cue lookup
  src/lib/platforms/      youtube.js, bilibili.js
  src/main/yt-bridge.js   page-world shim for player caption metadata
  src/content/index.js    orchestration + overlay rendering
  src/background/         translation, localhost helper proxy
helper/server.py          yt-dlp + faster-whisper transcription service
demo/                     overlay preview harness (npm run build, then serve)
```

## Why word-grouped pinyin

Per-character pinyin lookup gets polyphones wrong, which quietly teaches you the wrong
readings. zhsub segments each line into words first, so context resolves the reading:

```bash
node ~/projects/zhsub/test-ruby.mjs
```

| Line | Reading | |
|---|---|---|
| 我去**银行**取钱 | yín **háng** | ✅ not *yín xíng* |
| 他**长**大了 | **zhǎng** dà | ✅ not *cháng* |
| **重**要 / **重**复 | **zhòng** / **chóng** | ✅ |
| 音**乐** / 快**乐** | **yuè** / **lè** | ✅ |
| 我还没**还**钱 | hái | ❌ should be *huán* |

The last one is a known limitation: segmentation can't always disambiguate 还 as a verb.
Rare in practice, and it never affects the hanzi or the English line.

## Known gaps

- **OCR of burned-in text** is not implemented. Whisper reads the *audio*, which is what you
  want when the audio is Mandarin. A video whose burned-in subs differ from its audio
  (dialect speech, song lyrics) would need the OCR path — the helper is structured to take it
  as a second job type.
- Bilibili's subtitle API needs you to be logged in for some videos; without cookies the
  helper path takes over.
- Word-level hover definitions (CC-CEDICT) aren't wired up yet.

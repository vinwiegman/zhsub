"""End-to-end check of the no-caption-track path on a short slice.

Exercises the real functions from server.py: yt-dlp download, ffmpeg decode
(the PyAV-free path), and Whisper transcription.
"""
import sys, time, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "helper"))
import server

URL = "https://www.youtube.com/watch?v=jZgiLMYllkY"
SECONDS = 90

work = Path(tempfile.mkdtemp(prefix="zhsub-test-"))
t0 = time.time()
print("ffmpeg:", server.find_ffmpeg())

audio_file = server.download_audio(URL, work)
print(f"downloaded {audio_file.name} ({audio_file.stat().st_size/1e6:.1f} MB) in {time.time()-t0:.0f}s")

t1 = time.time()
audio = server.decode_audio(audio_file)
print(f"decoded {len(audio)/16000:.0f}s of audio in {time.time()-t1:.0f}s  (no PyAV)")

clip = audio[: 16000 * SECONDS]
t2 = time.time()
model = server.get_model()
print(f"model loaded in {time.time()-t2:.0f}s")

t3 = time.time()
segments, info = model.transcribe(
    clip, language="zh", vad_filter=True, beam_size=5,
    initial_prompt="以下是普通话的句子，请使用简体中文。",
    condition_on_previous_text=False,
)
cues = [{"start": round(s.start, 2), "end": round(s.end, 2), "zh": s.text.strip()} for s in segments]
print(f"transcribed {SECONDS}s in {time.time()-t3:.0f}s -> {len(cues)} cues\n")

# Report shape and timing rather than dumping the transcript itself.
for c in cues[:5]:
    print(f"  [{c['start']:>6.2f} - {c['end']:>6.2f}]  {len(c['zh']):>3} chars")

han = sum(1 for c in cues for ch in c["zh"] if "一" <= ch <= "鿿")
trad = sum(1 for c in cues for ch in c["zh"] if ch in "們這來個時後樣經過發覺說話還沒會愛學國")
gaps = sum(1 for a, b in zip(cues, cues[1:]) if b["start"] < a["end"])
print(f"\n  {len(cues)} cues | {han} han chars | {trad} traditional-only chars "
      f"| {gaps} overlapping | avg {sum(c['end']-c['start'] for c in cues)/max(len(cues),1):.1f}s/cue")

# The whole point of the pinyin layer — check it resolves against real output.
import subprocess, json
sample = " ".join(c["zh"] for c in cues[:3])[:60]
print(f"  sample tokenises to: ", end="")
r = subprocess.run(["node", "-e",
    "import('./extension/src/lib/ruby.js').then(m=>{const t=m.toTokens(process.argv[1]);"
    "console.log(t.length+' tokens, '+t.filter(x=>x.pinyin).length+' with pinyin')})",
    sample], capture_output=True, text=True, cwd=str(Path(__file__).parent))
print(r.stdout.strip() or r.stderr.strip()[:200])

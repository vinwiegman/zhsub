"""Is the VAD filter discarding real dialogue?

Transcribes a mid-episode slice (guaranteed dialogue, not opening theme) with
VAD on and off, and compares coverage. Reports shape only, never transcript text.
"""
import sys, time, os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "helper"))
import server

SCRATCH = Path(os.environ.get("SCRATCH", Path(__file__).parent / ".scratch"))
SCRATCH.mkdir(exist_ok=True)
URL = "https://www.youtube.com/watch?v=jZgiLMYllkY"

cached = list(SCRATCH.glob("audio.*"))
if cached:
    audio_file = cached[0]
    print(f"reusing {audio_file.name}")
else:
    audio_file = server.download_audio(URL, SCRATCH)
    print(f"downloaded {audio_file.name}")

audio = server.decode_audio(audio_file)
print(f"full length {len(audio)/16000/60:.1f} min\n")

START, LEN = 600, 120  # 10:00-12:00, mid-episode dialogue
clip = audio[16000 * START : 16000 * (START + LEN)]
model = server.get_model()

for vad in (True, False):
    t = time.time()
    segments, _ = model.transcribe(
        clip, language="zh", vad_filter=vad, beam_size=5,
        initial_prompt="以下是普通话的句子，请使用简体中文。",
        condition_on_previous_text=False,
    )
    cues = [(s.start, s.end, s.text.strip()) for s in segments]
    elapsed = time.time() - t
    covered = sum(e - s for s, e, _ in cues)
    chars = sum(len(t) for _, _, t in cues)
    print(f"vad_filter={str(vad):<5} {len(cues):>3} cues | "
          f"{covered:>5.1f}s of {LEN}s covered ({covered/LEN*100:.0f}%) | "
          f"{chars:>4} chars | {elapsed:.0f}s to run ({LEN/max(elapsed,.01):.1f}x realtime)")

print(f"\nfull episode estimate on CPU: "
      f"~{len(audio)/16000/ (LEN/max(elapsed,.01)) / 60:.1f} min")

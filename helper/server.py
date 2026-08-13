"""zhsub local helper.

Transcribes videos that have no caption track. The extension hands over a URL,
this pulls the audio with yt-dlp and runs faster-whisper over it, then returns
timed Chinese cues. Everything is cached on disk by video key, so a video is
only ever transcribed once.

    pip install -r requirements.txt
    python server.py
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8787
CACHE = Path(__file__).parent / "cache"
CACHE.mkdir(exist_ok=True)

# tiny/base are fast but weak on Mandarin; small is the sweet spot on CPU,
# medium if you have a CUDA GPU. Override with: python server.py --model medium
MODEL_NAME = "small"
DEVICE = "auto"

JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
_model = None
_model_lock = threading.Lock()


def log(*a):
    print("[zhsub]", *a, flush=True)


def _build_model(device: str, compute_type: str):
    """Build and warm up. A broken CUDA install constructs fine and only fails
    on the first encode, so force that failure here rather than mid-job."""
    import numpy as np
    from faster_whisper import WhisperModel

    model = WhisperModel(MODEL_NAME, device=device, compute_type=compute_type)
    segments, _ = model.transcribe(np.zeros(16000, dtype=np.float32), language="zh")
    list(segments)
    return model


def get_model():
    """Load Whisper once, lazily — startup is slow and most requests hit cache."""
    global _model
    with _model_lock:
        if _model is not None:
            return _model

        attempts = (
            [("cuda", "float16"), ("cpu", "int8")]
            if DEVICE == "auto"
            else [(DEVICE, "float16" if DEVICE == "cuda" else "int8")]
        )
        errors = []
        for device, compute_type in attempts:
            try:
                log(f"loading whisper '{MODEL_NAME}' on {device} ({compute_type})…")
                _model = _build_model(device, compute_type)
                log(f"model ready on {device}")
                return _model
            except Exception as exc:
                # Missing cuBLAS/cuDNN is the common case on a fresh Windows box.
                log(f"{device} unavailable: {str(exc).splitlines()[0][:120]}")
                errors.append(f"{device}: {exc}")
        raise RuntimeError("could not load Whisper — " + " | ".join(errors))


def cache_path(key: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", key)
    return CACHE / f"{safe}.json"


def find_ffmpeg() -> str | None:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    # WinGet installs land outside PATH for non-login shells.
    matches = sorted(
        (Path.home() / "AppData/Local/Microsoft/WinGet/Packages").glob("*FFmpeg*/**/ffmpeg.exe")
    )
    return str(matches[0]) if matches else None


def decode_audio(path: Path) -> "object":
    """Decode to 16 kHz mono float32 via ffmpeg.

    faster-whisper would normally decode with PyAV, but PyAV ships unsigned
    DLLs that Windows Smart App Control blocks outright. Handing transcribe()
    a numpy array instead skips PyAV entirely, and ffmpeg is already required
    by yt-dlp for most formats anyway.
    """
    import numpy as np

    exe = find_ffmpeg()
    if not exe:
        raise RuntimeError(
            "ffmpeg not found. Install it (winget install Gyan.FFmpeg) — it is needed "
            "because PyAV's decoder is blocked by Smart App Control."
        )
    proc = subprocess.run(
        [exe, "-nostdin", "-threads", "0", "-i", str(path),
         "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000", "-"],
        capture_output=True,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(f"ffmpeg decode failed: {proc.stderr.decode(errors='replace')[-400:]}")
    return np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def download_audio(url: str, workdir: Path) -> Path:
    """yt-dlp handles both YouTube and Bilibili; grab audio only."""
    out = workdir / "audio.%(ext)s"
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "-f", "bestaudio/best",
        "--no-playlist",
        "--quiet", "--no-warnings",
        "-o", str(out),
        url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {proc.stderr.strip()[:400]}")
    files = [p for p in workdir.iterdir() if p.stem == "audio"]
    if not files:
        raise RuntimeError("yt-dlp produced no audio file")
    return files[0]


def transcribe(path: Path, job: dict) -> list[dict]:
    model = get_model()
    audio = decode_audio(path)
    duration = len(audio) / 16000.0
    segments, info = model.transcribe(
        audio,
        language="zh",
        task="transcribe",
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400},
        beam_size=5,
        # Whisper drifts into traditional characters for Chinese unless the
        # prompt anchors it to simplified Mandarin.
        initial_prompt="以下是普通话的句子，请使用简体中文。",
        condition_on_previous_text=False,
    )

    total = duration or float(getattr(info, "duration", 0) or 0)
    cues = []
    for seg in segments:
        text = (seg.text or "").strip()
        if text:
            cues.append({"start": round(seg.start, 3), "end": round(seg.end, 3),
                         "zh": text, "en": ""})
        if total:
            job["progress"] = min(0.99, seg.end / total)
    return cues


def run_job(job_id: str, key: str, url: str):
    job = JOBS[job_id]
    workdir = Path(tempfile.mkdtemp(prefix="zhsub-"))
    try:
        job["status"] = "downloading"
        audio = download_audio(url, workdir)

        job["status"] = "transcribing"
        cues = transcribe(audio, job)
        if not cues:
            raise RuntimeError("Whisper returned no speech — is there Mandarin audio?")

        cache_path(key).write_text(
            json.dumps({"key": key, "cues": cues}, ensure_ascii=False), encoding="utf-8"
        )
        job.update(status="done", cues=cues, progress=1.0)
        log(f"{key}: {len(cues)} cues")
    except Exception as exc:  # surfaced to the overlay verbatim
        traceback.print_exc()
        job.update(status="error", error=str(exc))
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        path = self.path.split("?")[0]

        if path == "/health":
            return self._send(200, {"ok": True, "model": MODEL_NAME})

        if path.startswith("/cues/"):
            from urllib.parse import unquote

            p = cache_path(unquote(path[len("/cues/"):]))
            if p.exists():
                return self._send(200, json.loads(p.read_text(encoding="utf-8")))
            return self._send(404, {"error": "not cached"})

        if path.startswith("/jobs/"):
            job = JOBS.get(path[len("/jobs/"):])
            if not job:
                return self._send(404, {"error": "no such job"})
            out = {k: v for k, v in job.items() if k != "cues"}
            if job.get("status") == "done":
                out["cues"] = job["cues"]
            return self._send(200, out)

        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.split("?")[0] != "/jobs":
            return self._send(404, {"error": "not found"})

        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"error": "bad json"})

        key, url = body.get("key"), body.get("url")
        if not key or not url:
            return self._send(400, {"error": "key and url required"})

        cached = cache_path(key)
        if cached.exists():
            data = json.loads(cached.read_text(encoding="utf-8"))
            job_id = uuid.uuid4().hex[:12]
            JOBS[job_id] = {"status": "done", "progress": 1.0, "cues": data["cues"]}
            return self._send(200, {"jobId": job_id, "status": "done"})

        with JOBS_LOCK:
            # Two tabs on the same video should share one transcription.
            for jid, job in JOBS.items():
                if job.get("key") == key and job["status"] not in ("error",):
                    return self._send(200, {"jobId": jid, "status": job["status"]})
            job_id = uuid.uuid4().hex[:12]
            JOBS[job_id] = {"status": "queued", "progress": 0.0, "key": key}

        log(f"job {job_id}: {body.get('title') or url}")
        threading.Thread(target=run_job, args=(job_id, key, url), daemon=True).start()
        self._send(200, {"jobId": job_id, "status": "queued"})


def main():
    global MODEL_NAME, DEVICE
    args = sys.argv[1:]
    if "--model" in args:
        MODEL_NAME = args[args.index("--model") + 1]
    if "--device" in args:
        DEVICE = args[args.index("--device") + 1]

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    log(f"listening on http://{HOST}:{PORT}  (model={MODEL_NAME}, cache={CACHE})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("bye")


if __name__ == "__main__":
    main()

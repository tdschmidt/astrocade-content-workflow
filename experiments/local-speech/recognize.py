"""Recognize an actual waveform locally, retaining real word timestamps."""
import argparse
from dataclasses import asdict
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import numpy as np

os.environ.setdefault("HF_HOME", str(Path("data/experiments/local-speech/hf-cache").resolve()))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
from faster_whisper import WhisperModel

parser = argparse.ArgumentParser()
parser.add_argument("audio", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=False)
model = WhisperModel("small.en", device="cpu", compute_type="int8", cpu_threads=4,
                     download_root="data/experiments/local-speech/models/whisper")
ffmpeg = os.environ.get("FFMPEG_PATH", "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg")
pcm = subprocess.run([ffmpeg, "-v", "error", "-i", str(args.audio), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"], check=True, capture_output=True).stdout
waveform = np.frombuffer(pcm, dtype=np.float32)
segments, info = model.transcribe(waveform, beam_size=5, language="en", word_timestamps=True,
                                  condition_on_previous_text=False, vad_filter=False)
segments = list(segments)
record = {"provider": "Local faster-whisper / small.en", "audioSha256": hashlib.sha256(args.audio.read_bytes()).hexdigest(),
          "audioPath": str(args.audio.resolve()), "packageVersion": importlib.metadata.version("faster-whisper"),
          "model": "Systran/faster-whisper-small.en", "modelSource": "https://huggingface.co/Systran/faster-whisper-small.en",
          "language": info.language, "durationSeconds": info.duration, "scriptProvidedToRecognizer": False,
          "text": " ".join(s.text.strip() for s in segments),
          "words": [{"text": w.word.strip(), "startSeconds": w.start, "endSeconds": w.end, "probability": w.probability}
                    for s in segments for w in (s.words or [])]}
(args.output / "raw-segments.json").write_text(json.dumps([asdict(s) for s in segments], indent=2) + "\n")
(args.output / "transcript.json").write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps({"transcript": str((args.output / "transcript.json").resolve()), "text": record["text"], "wordCount": len(record["words"])}))

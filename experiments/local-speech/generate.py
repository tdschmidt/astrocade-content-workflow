"""Generate local Kokoro WAVs for reviewed story or chapter drafts.

Use the isolated runtime documented in README.md. Output is new-only, and
actual recognition/caption timing remains the downstream narrate.ts stage.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
from datetime import datetime, timezone

import soundfile as sf
import onnxruntime as ort
from kokoro_onnx import Kokoro

ort.disable_telemetry_events()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


parser = argparse.ArgumentParser()
parser.add_argument("draft", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--voice", default="af_heart")
parser.add_argument("--models", type=Path, default=Path("data/experiments/local-speech/models"))
args = parser.parse_args()
draft = json.loads(args.draft.read_text())
chapters = draft.get("chapters", [{"id": "story", "narration": draft.get("narration")}])
if not chapters or any(not isinstance(c.get("narration"), str) or not c["narration"].strip() for c in chapters):
    raise ValueError("Expected a reviewed narration or chapter draft")
if any(not isinstance(c.get("id"), str) or not c["id"].replace("-", "").replace("_", "").isalnum() for c in chapters):
    raise ValueError("Unsafe chapter id")
args.output.mkdir(parents=True, exist_ok=False)
model = args.models / "kokoro-v1.0.onnx"
voices = args.models / "voices-v1.0.bin"
engine = Kokoro(str(model), str(voices))
provenance = {
    "createdAt": datetime.now(timezone.utc).isoformat(),
    "provider": "Local Kokoro ONNX", "model": "Kokoro-82M v1.0",
    "voice": args.voice, "speed": 1.0, "postSynthesisTempo": 1.0,
    "packageVersion": importlib.metadata.version("kokoro-onnx"),
    "draftPath": str(args.draft.resolve()), "draftSha256": digest(args.draft),
    "modelSha256": digest(model), "voicesSha256": digest(voices),
    "modelSource": "https://huggingface.co/hexgrad/Kokoro-82M",
    "runtimeSource": "https://github.com/thewh1teagle/kokoro-onnx",
    "modelFilesRelease": "https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1",
    "synthesisNetworkRequests": False,
    "captionTiming": "Separate recognition of generated waveform; not estimated from text",
    "chapters": [],
}
for chapter in chapters:
    folder = args.output / chapter["id"]
    folder.mkdir()
    waveform, rate = engine.create(chapter["narration"], voice=args.voice, speed=1.0, lang="en-us")
    path = folder / "input-narration.wav"
    sf.write(path, waveform, rate, subtype="PCM_16")
    item = {"id": chapter["id"], "script": chapter["narration"], "path": str(path.resolve()),
            "sha256": digest(path), "sampleRate": rate, "durationSeconds": len(waveform) / rate}
    provenance["chapters"].append(item)
    (args.output / "synthesis.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(json.dumps({"id": item["id"], "durationSeconds": item["durationSeconds"], "path": item["path"]}), flush=True)

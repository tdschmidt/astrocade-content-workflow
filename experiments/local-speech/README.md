# Local narration fallback

Kokoro generates real new narration locally when the configured cloud speech quota is unavailable. This is a separate editing experiment and does not change the main pipeline's provider. Both the voice and the WAV hashes are recorded; it must not be described as Gemini speech.

The upstream [Kokoro-82M model](https://huggingface.co/hexgrad/Kokoro-82M) uses Apache-2.0 weights; [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) is MIT-licensed. The checked setup uses Python 3.12, kokoro-onnx 0.6.1, soundfile 0.14.0 and the full-precision `kokoro-v1.0.onnx` plus `voices-v1.0.bin` from the runtime's `model-files-v1.1` release. Downloads and the isolated environment stay under ignored `data/experiments/local-speech/`.

```sh
PYTHON312 -m venv data/experiments/local-speech/.venv
data/experiments/local-speech/.venv/bin/python -m pip install kokoro-onnx==0.6.1 soundfile==0.14.0
# Download the two named model files from the upstream release into models/.
data/experiments/local-speech/.venv/bin/python experiments/local-speech/generate.py REVIEWED_DRAFT.json NEW_SYNTHESIS_DIR
```

The input accepts the story `narration` field or overview `chapters` array. Each chapter gets a WAV at its native 1× pace, with no time stretching. `synthesis.json` records the exact input, runtime, model/voice hashes and generated waveform provenance. Use `af_heart` for clear American English; `--voice` allows another bundled preset.

Then pass each WAV to `story-background/narrate.ts --audio`, with `--audio-label 'Local Kokoro-82M v1.0 / af_heart'`. That stage recognizes the actual audio with the configured transcription provider and rejects material script mismatches. Real timestamps determine captions and picture duration. This preserves the existing quality gate without retrying a quota-limited speech endpoint. The recognizer and visual editing agent still make their usual authorized remote requests.

## Local recognition when transcription is also quota-limited

[Faster Whisper](https://github.com/SYSTRAN/faster-whisper) supplies actual word timestamps using its `small.en` model. The recognizer receives the waveform, not the expected script. `recognize.py` preserves the raw model segments and word probabilities. It decodes through FFmpeg because PyAV 19 removed the `metadata_errors` argument used by faster-whisper 1.2.1.

```sh
data/experiments/local-speech/.venv/bin/python -m pip install faster-whisper==1.2.1
data/experiments/local-speech/.venv/bin/python experiments/local-speech/recognize.py NARRATION.wav NEW_ASR_DIR
node --import tsx experiments/story-background/narrate.ts DRAFT.json NEW_VALIDATED_VOICE_DIR \
  --audio NARRATION.wav --audio-label 'Local Kokoro-82M v1.0 / af_heart' \
  --transcript NEW_ASR_DIR/transcript.json --phrase-timing
```

The first recognition downloads public model weights into the ignored local model cache; inference is local. Importing its transcript requires an exact SHA-256 match with the final waveform and passes the same script, number, negation and timing checks as cloud recognition. A local transcript cannot silently be reused after retiming or regenerating audio. Caption records name the real recognition provider. No cloud credentials are required when both audio and transcript are supplied. A waveform-mismatch check was exercised against the real Cannonbolt WAV and correctly rejected the unrelated transcript hash before creating captions.

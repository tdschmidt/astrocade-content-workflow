# Story-over-gameplay renderer

This isolated renderer combines selected gameplay with a measured narration recording and supplied word timestamps. The story and gameplay are separate media; the renderer makes no claim that gameplay depicts the story. It never loops footage, estimates word timings from text length, calls a voice provider, or publishes a result.

```sh
node --import tsx experiments/story-background/render.ts PLAN.json OUTPUT.mp4
node --import tsx --test experiments/story-background/render.test.ts
npx tsc --ignoreConfig --noEmit --target ES2023 --module ESNext --moduleResolution Bundler --strict --esModuleInterop --skipLibCheck --types node experiments/story-background/schema.ts experiments/story-background/render.ts experiments/story-background/render.test.ts
```

`schema.ts` defines the closed plan contract. Output filenames must be new `.mp4` paths; existing videos and manifests are never overwritten. FFmpeg with libass is required. Homebrew `ffmpeg-full` is detected locally; `FFMPEG_PATH`, `FFPROBE_PATH`, `FONT_PATH`, and `FONT_FAMILY` can override tool/font defaults. The repository's Noto Sans font is the default.

## Required plan shape

```json
{
  "version": 1,
  "id": "story-example",
  "title": "The wrong attachment",
  "source": {
    "path": "/absolute/path/gameplay.webm",
    "windows": [{"start": 4, "end": 55, "speed": 1}]
  },
  "narration": {
    "path": "/absolute/path/narration.wav",
    "script": "The exact words that were spoken in the recording.",
    "voiceLabel": "The chosen voice",
    "alignmentMethod": "Name and version of the aligner or timing source",
    "words": [
      {"text": "The", "start": 0.10, "end": 0.22},
      {"text": "exact", "start": 0.24, "end": 0.48}
    ]
  },
  "story": {
    "kind": "reddit",
    "title": "Original story title",
    "permalink": "https://www.reddit.com/r/example/comments/example/story/",
    "attribution": "Reddit story • retold"
  },
  "caption": {"position": "upper-middle", "wordsPerGroup": 4, "mode": "highlight"},
  "rationale": "Explain why this traversal is readable background and document the adaptation."
}
```

The snippet abbreviates the word list. Supply all actually spoken words with genuine provider timestamps or forced alignment against the final audio. Times must be finite, ordered, nonoverlapping, and within the measured recording. The renderer checks timing bounds but cannot prove the supplied alignment matches speech; listen to the final result. `script`, `voiceLabel`, `alignmentMethod`, and the complete word array remain in the output manifest. `story.kind` is `reddit`, `information`, `original`, or `game-overview`; Reddit retellings require an HTTPS primary-source permalink. The renderer does not fetch it or grant reuse rights.

## Footage and duration

Supply chronological, nonoverlapping windows from one local video, with speeds from 0.5× to 2×. Source bounds are verified against the actual recording. Repeated windows are rejected. The renderer uses only enough selected footage to cover the actual narration duration plus a 0.3-second ending fade, rounded up to a complete 30 fps frame. Extra selected footage is trimmed; insufficient footage is an error. The renderer adds no synthetic gameplay, freeze padding, or hidden loops. A source→output timeline records each used window and its effective end.

Output is 720×1280, 30 fps, H.264/AAC MP4 with faststart. Gameplay audio is muted. An optional reviewed `source.crop` supplies integer x/y/width/height and is checked against actual source dimensions; use it to remove app chrome while retaining gameplay. Otherwise portrait sources fit without a new crop. Landscape sources fit over a blurred background; aspect ratio remains intact. The agent must still select a source whose action/HUD does not conflict with caption placement.

## Dynamic captions

The default uses 2–5-word phrases, grouped around punctuation and pauses with a target of four words. Captions are bold white with a thick black outline, at 25% of frame height. `casing: "upper"` uses ALL CAPS (default); `casing: "sentence"` preserves the recognized word case for overview narration. `position: "middle"` instead places them at 46%; `"lower-middle"` at75% is available when reviewed action occupies the upper frame. `mode: "highlight"` colors only the currently spoken word yellow during its supplied start/end interval. During gaps, the phrase stays white. `mode: "phrase"` displays white phrase captions without word highlighting. Line breaks remain fixed as highlights change; long phrases wrap, with overly wide text rejected before rendering.

Attribution and game titles are metadata only. The renderer never burns them into video frames; they appear separately on the combined review page. No added logos, credit watermarks, fake post screenshots, or fabricated comments are generated.

## Audio and validation

Narration is measured before rendering, normalized with a measured loudnorm pass targeting −16 LUFS and −2 dBTP, and limited before AAC encoding. The encoded result is measured again; true peaks above −1 dBTP fail. The manifest reports actual integrated loudness, rather than assuming the target was reached.

Every result is decoded and checked for dimensions, codec, frame rate, duration, and stereo 48 kHz AAC audio. The adjacent `.manifest.json` contains the full plan, actual source/narration media properties, script/story metadata and primary permalink, exact source-window mapping, phrase groups, tool versions, and loudness results. Visual and listening review remain explicitly outstanding because technical validation cannot assess narration quality, alignment accuracy, gameplay smoothness, story adaptation, or caption obstruction.

For phrase captions only, zero-length word spans caused by provider timestamp quantization may be retained when each phrase has a positive measured span. The narration CLI requires explicit `--phrase-timing` for that acceptance; highlighted words still require positive spans. No timestamps are stretched or invented. The delivered overview v2 retains one quantized article in its acid chapter under this explicit phrase-only policy; its review evidence records the original timestamp and all phrase spans remain positive.

# Astrocade gameplay-to-video pipeline

A local TypeScript CLI that discovers Astrocade games, learns their visible controls, explores and records native gameplay, and asks an editorial agent to turn the footage into short portrait videos. It preserves the source, observations, exact model requests, edit plans and media checks beside each result.

The current scope ends at local candidate videos. There is no GUI, account creation, email integration, publishing service or background job queue. A local review gallery is an optional way to watch generated artifacts. Earlier results and design history remain in [docs](docs/acceptance.md) and the [decision log](docs/design-decisions.md).

## Setup

Use Node.js 24+, a desktop session, FFmpeg with libass, and the matching Playwright Chromium. Native capture is tested on macOS.

```sh
npm ci
npm run browser:install
brew install ffmpeg-full # macOS
codex login             # sign in with ChatGPT
npm run doctor
```

The default inference provider is Codex, using the existing signed-in CLI and `gpt-5.6-sol`; `--model` can select another available model. The adapter refuses API-key authentication. It sends bounded gameplay frames and prompts, uses isolated tool-free requests, and records returned decisions without credentials or private reasoning. Alternatively use `--provider gemini` with `GEMINI_API_KEY` in ignored `.env`. The new editorial planners use Codex; Gemini remains available for capture/analysis and optional speech.

FFmpeg/ffprobe are detected at the standard Apple Silicon Homebrew full-build location; elsewhere set `FFMPEG_PATH` and `FFPROBE_PATH` or put them on PATH. The caption font and license are bundled.

Meme edits need the real [audio catalog](experiments/meme-audio/README.md). Acquire its files from the recorded sources into their `relativePath` destinations and run `python3 experiments/meme-audio/build-catalog.py`. Binaries stay in ignored `data/`; source credits, hashes and individual usage restrictions stay in metadata. Several soundboard effects are preview-only.

Narrated formats default to local Kokoro speech and Faster Whisper recognition at native voice speed. Follow [local speech setup](experiments/local-speech/README.md) once. The Python environment and model weights stay under ignored `data/experiments/local-speech/`; `LOCAL_SPEECH_PYTHON` can select another compatible interpreter. `--narration gemini` uses configured cloud speech and transcription instead. Missing assets or quota failures stop explicitly; providers are never silently relabeled.

## Run the whole pipeline

```sh
# Discover candidates, explore, analyze, generate an agent edit and render a meme video.
npm run pipeline

# Explore a particular game thoroughly, then edit it.
npm run pipeline -- --game PUBLIC_ASTROCADE_GAME_URL --play feedback \
  --capture-seconds 600 --capture-goal "Pursue visible progression, record choices and their actual effects."

# Different formats use the same source capture and evidence pipeline.
npm run pipeline -- --game PUBLIC_ASTROCADE_GAME_URL --format overview
npm run pipeline -- --game PUBLIC_ASTROCADE_GAME_URL --format story \
  --story-source REVIEWED_FACT_LEDGER.json
```

| Format | Editorial contract |
| --- | --- |
| `meme` (default) | 15–25 seconds of meaningful setup, escalation and consequence. The agent chooses troll-freeze, ironic-fail or velocity. Phonk edits synchronize the main music/visual treatment to the observed climax, then keep at least four seconds of payoff including two seconds of moving aftermath. |
| `overview` | Roughly 30–45 seconds explaining the game's premise, choices and appeal. Three ranked hook proposals, whole-game evidence, independent script review, real speech and measured caption timings. Relevant gameplay supports the explanation without literal play-by-play. |
| `story` | Sourced narration over sustained gameplay progression. A required fact ledger grounds the story. Independent review rejects repeated failed sections even if deaths were edited away. Inadequate footage stops before speech generation. |
| `legacy` | The earlier silent highlight editor, retained to reproduce and resume historical runs. |

Meme `--style auto|troll-freeze|ironic-fail|velocity` chooses a specific treatment. Credits stay off the video; native game HUD remains when needed for meaning. Reaction faces attach only to an observed head during a frozen frame. Neither technical validation nor a model's approval predicts audience performance.

## Continue or revise

```sh
# Save source first; capture includes discovery and learning.
npm run pipeline -- --game PUBLIC_ASTROCADE_GAME_URL --stage capture

# Analyze without drafting or rendering.
npm run pipeline -- --from-run data/runs/SOURCE_RUN --stage analyze

# Generate a new version through the same pipeline, preserving the original.
npm run pipeline -- --from-run data/runs/SOURCE_RUN --format meme
npm run pipeline -- --from-run data/runs/SOURCE_RUN --format overview --narration local

# Concrete editorial correction, optionally with independently reviewed candidate windows.
npm run pipeline -- --from-run data/runs/SOURCE_RUN --format meme \
  --edit-feedback REVIEW.txt --source-windows SOURCE_WINDOWS.json

# Continue an interrupted run using its saved configuration.
npm run pipeline -- --resume data/runs/RUN_DIRECTORY
```

`--stage discover|capture|analyze|edit|all` controls the stopping point. `--candidates 1-5` defaults to three. `--play auto` chooses a tested timed profile where suitable, otherwise assesses screenshot feedback before timed fallback. `--brief` supplies an audience/voice JSON; `--help` describes all options. A new explicit capture goal is limited to 800 characters.

Each run is locked against concurrent resume. `--from-run` verifies and references the saved recordings without modifying them. `--resume` preserves its brief, format, source windows, feedback and story source; changing an input or media hash fails instead of silently mixing versions. Failed editor attempts remain on disk. Narrated stages retain exact waveforms for recognition/validation recovery. A completed run validates and reuses its final video without generating another plan.

Source-review windows are candidate evidence, not final cuts. The [window contract](experiments/category-batch/README.md) binds them to a source hash; each is decoded again and the editorial agent selects the actual edit. The eight-category handoff and portable exploration goals live in [category-batch](experiments/category-batch/games.json).

## Gameplay and evidence

The agent uses only visible game controls and ordinary native browser inputs. It first tests a control, then practices and pursues attainable features, upgrades, choices and later stages. Opening a menu, pressing a key or claiming success does not prove gameplay progress. Capture preserves full choice → change → use sequences for alternative narratives.

New exploration profiles allow up to ten minutes and forty decisions; wall time includes inference. Fresh frames taken immediately before input distinguish autonomous game changes from action effects. During-action samples help find brief abilities. Screenshots capture the full viewport and crop locally to avoid Chromium's cross-origin screenshot/input offset bug. Hidden DOM text is filtered; visible frames still determine terminal states.

This is sparse visual feedback, not a reflex player. Moving hazards and short timers can defeat it while inference runs. A long recording is not proof of thorough play. Traces distinguish completed, partial and rejected attempts, and source analysis can reject a game with no useful consequence.

A finished run contains `report.md`, `run.json`, `trace.jsonl`, source recordings, source-frame evidence, the generated plan, `caption.txt`, and the final MP4 under `editing-*`. The integrated renderers produce 720×1280 H.264/30 fps with AAC audio. Inspect the actual output at phone size and with sound. Media and provider artifacts stay in ignored `data/` and are not included in GitHub clones.

## Code and checks

- `src/core`: CLI, selection, stage orchestration, evidence and resume.
- `src/editing`: integrated meme/overview/story orchestration and input contracts.
- `src/server/games`: discovery, visible inspection, native controls and recording.
- `src/server/media` and `providers`: media primitives and bounded inference.
- `experiments`: reusable versioned editorial schemas, prompts, renderers and historical examples. The category adapter delegates to the production meme editor.

```sh
npm run check
npm run check:editing

# Native browser/media fixtures, with no live provider calls or publishing.
RUN_BROWSER_TESTS=1 RUN_BROWSER_MEDIA_TESTS=1 RUN_RENDER_TESTS=1 RUN_FRAME_TESTS=1 \
node --import tsx --test --test-concurrency=1 'src/**/*.test.ts'
```

CI runs core and editing checks. The decision log records scope changes and observed failures. Keep `.env`, local credentials, model weights and unselected run data private; hand over the source, lockfile, setup instructions and selected output/evidence artifacts.

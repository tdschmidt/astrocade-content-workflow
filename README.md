# Astrocade gameplay-to-short pipeline

A local TypeScript CLI that finds Astrocade games, inspects their controls, plays and records supported games, and edits the strongest observed moment into a portrait short. It saves the source footage and evidence behind each choice alongside the finished video.

**Current scope:** discover → learn/play/capture → edit. The user's latest clarification makes account creation and publication manual. This branch contains the CLI workflow; the previous GUI/account/research implementation remains on `main`. [PLAN.md](PLAN.md) is the current scope and design reference. The [acceptance record](docs/acceptance.md) tracks live results; older research describes the earlier, broader assignment.

**Improved play:** Car Wash reached a Perfect three-star first-customer result in three fresh captures after two model-guided plan revisions. Screenshot feedback completed two independently shuffled 20-item Sort It Out boards, including recovery from a mismatch. These are measured examples, not a broad win-rate claim.

**Earlier end-to-end baseline:** a live run discovered 30 games, nominated and captured three, rejected two recordings without a useful payoff, and produced an inspected **3.77-second Crowd Pier Run highlight**. The video clearly shows a +5 gate taking the crowd from 8 to 13; hook and caption match. After Flash reached the test project's daily quota, an explicit Flash Lite resume reused completed sources/analysis. A fresh Codex-backed run also found 30 games and produced a verified **3.23-second 10→20 Crowd Pier Run highlight** without Gemini calls. These runs demonstrate the workflow and truthful shorts, not viral performance. See [acceptance evidence](docs/acceptance.md).

## Install and configure

Use Node.js 24+, a local desktop session, the pinned Playwright Chromium, and FFmpeg with libass. Native capture has been tested on macOS; other platforms need the same capture checks.

```sh
npm ci
npm run browser:install
# macOS
brew install ffmpeg-full
```

Create an ignored `.env` containing `GEMINI_API_KEY=your-key`, using your own [Google AI Studio key](https://ai.google.dev/gemini-api/docs/api-key). The default CLI model is `gemini-3.5-flash`; access and quota are checked when used. HTTP 429/503 responses receive at most three total attempts within a 120-second model-operation budget, honoring `Retry-After`. A live request succeeded on attempt three after two instructed 30-second waits; persistent outages still stop with saved progress.

To use your ChatGPT/Codex allowance instead of Gemini, install the official Codex CLI (tested with `0.149.1`), run `codex login`, and sign in with ChatGPT:

```sh
npm install -g @openai/codex@0.149.1
codex login
npm run pipeline -- --provider codex --candidates 1
```

This provider checks for ChatGPT login before each request and refuses API-key authentication. It uses the account's Codex allowance/eligible credits, not separate Platform API billing. It does not buy credits or change billing settings. The tested default is `gpt-5.6-sol`; `--model` can select another available Codex model. `CODEX_PATH` can point to a local CLI executable. Requests run in an isolated temporary directory with read-only permissions and disabled tools/plugins. Gameplay is sampled locally into JPEGs with actual frame timestamps; only those images, catalog text, and decision prompts go to Codex. Sampling is bounded to 360 frames and never silently reduces the requested rate. Each request has a 180-second total deadline, including preparation, and a maximum 120-second CLI inference; failures preserve run progress for explicit resume. Traces retain token totals and decisions, not raw CLI reasoning or credentials.

The standard Apple Silicon Homebrew `ffmpeg-full` path is detected. Elsewhere, put FFmpeg/ffprobe on PATH or set `FFMPEG_PATH` and `FFPROBE_PATH`. The licensed Noto Sans font is bundled. `npm run doctor` checks Chromium, FFmpeg/libass, the bundled font and Gemini configuration.

## Run

```sh
# Default: nominate up to three games, try supported controls, edit the best footage
npm run pipeline
# npm start runs the same pipeline

# Stop after discovery and provisional selection
npm run pipeline -- --stage discover --candidates 3

# Try a particular ID or slug from discovery.json (or an explicit public game URL)
npm run pipeline -- --stage capture --game crowd-pier-run

# Play an untimed game with screenshot feedback instead of replayed coordinates
npm run pipeline -- --provider codex --play feedback --game https://www.astrocade.com/games/sort-it-out/01M2RV0JGG7W601TBGTK614CR9

# Continue a saved run; edit requires an existing recording
npm run pipeline -- --resume data/runs/RUN_DIRECTORY --stage edit

# Explicit fallback after a model-specific quota/access failure
npm run pipeline -- --resume data/runs/RUN_DIRECTORY --stage edit --model gemini-3.5-flash-lite
```

Options: `--provider gemini|codex` (default `gemini`), `--stage discover|capture|edit|all` (default `all`), `--game ID_OR_SLUG_OR_URL`, `--play timed|feedback` (default `timed`), `--candidates 1-5` (default `3`), `--model MODEL`, and `--resume data/runs/RUN_DIRECTORY`. Capture includes discovery/learning when missing; editing uses saved recordings. `--help` prints the command reference.

Each command prints its run directory. Resume reuses completed source footage, analysis and script, including the provider/model recorded for each artifact. A provider or model override affects unfinished work; start a new run to reconsider completed decisions or change the shortlist. Flash Lite recovered the demonstrated quota failure, but another model is not a guarantee of access or content accuracy. Ctrl-C preserves completed artifacts. Source/output hashes prevent silently reusing externally modified media, and a run lock prevents two processes resuming the same run together. Completed runs validate and reuse their output without retrying failed candidates or requiring a model key. A saved script resumes rendering without rerunning capture/analysis; missing final caption text is reconstructed.

## Inspect the result

Open `report.md`, watch the final MP4, and read `caption.txt`. A run directory contains:

| Artifact | Purpose |
| --- | --- |
| `report.md`, `run.json`, `trace.jsonl` | Human-readable report, resumable state, and dated observations/actions/results/decision summaries; no private internal reasoning |
| `discovery.json`, `shortlist.json` | Live catalog evidence and provisional hook/control hypotheses |
| `game-*/inspection-*/` | Before/after screenshots, observed instructions and controls, inspection JSON and learned proposal when needed |
| `controls-*.json`, `capture-*.json`, `game-*/*.webm` | Bounded action profile, capture manifest and finalized original gameplay |
| `game-*/feedback-*/report.md`, `decision-*.{jpg,json}` | Current-session screenshots, observed outcomes, corrective lessons and bounded action batches |
| `analysis-*.json`, `edit.json` | Observed source intervals, uncertainties, selection rationale, hook and cut |
| `highlight-*.mp4`, `caption.txt` | Finished 1080×1920 H.264/30 fps short and posting copy |

The shortlist is a hypothesis, not a popularity ranking: unlabeled counters remain unknown. The default learner uses visible instructions and before/after inspection, then proposes simple timed inputs. It skips uncertain controls and randomized puzzles whose answers cannot survive a fresh browser. `--play feedback` instead learns the mechanics, tests one reversible move in a fresh session, compares before/current screenshots, and adapts small action batches to the current board. It keeps recent observed lessons, stops on completion or repeated no progress, and saves every decision image. Canvas Play/intro buttons can be inspected through a bounded visual fallback. Feedback is restricted to input-paced games: the game keeps running during inference, so a 45-second shift or reflex runner is not suitable. Each attempt has at most ten decisions, a 175-second recording budget, and a 30-second per-decision deadline. The last decision is evaluation-only. Provider failures after useful play preserve partial footage; model statements of success still need visual review. Actual captured action determines the winner. A highlight selects one to three connected verified events, preserving before/action/result context. Overlapping intervals merge without repeated frames; gaps remain cuts, and the combined edit is bounded to 40 seconds. Brief earned result panels are valid payoffs when supported by the footage. Recordings up to 45 seconds receive one full 8 FPS analysis with absolute timestamps. The final caption copies the selected observed outcome rather than adding another creative description. There is no minimum duration or filler. A fixed header/footer preserves the complete game view. Current highlights are silent.

Account creation and publishing are manual handoff steps for now. Review the video and caption before uploading. A future publishing integration can consume these finished artifacts. This branch does not create accounts or post videos.

## Code and verification

- `src/core`: CLI, stage orchestration, provisional selection, run evidence and resume.
- `src/server/games`: public-page discovery, live inspection/learning, game profiles and bounded native input.
- `src/server/media`: native VP9 tab capture, decode validation and FFmpeg portrait rendering.
- `src/server/providers`: validated model calls, footage analysis and edit planning.
- `src/shared`: validated records for the core workflow.

Runtime dependencies are `@google/genai`, `playwright`, `tsx` and `zod`; development dependencies are TypeScript and Node types. `npm run check` runs typechecking and tests. There is no GUI build step.

```sh
npm run check

# Opt-in browser/media tests; fixtures make no live posts or provider calls
RUN_BROWSER_TESTS=1 RUN_BROWSER_MEDIA_TESTS=1 RUN_RENDER_TESTS=1 RUN_FRAME_TESTS=1 \
node --import tsx --test --test-concurrency=1 'src/**/*.test.ts'
```

Standalone media tests use FFmpeg on PATH unless overridden. For the Apple Silicon full build, prefix the test command with `FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`; its sibling ffprobe is detected. Tests cover cut bounds, real decoded render/capture behavior, cleanup, provider contracts and resume. Before the Codex adapter, a clean install, typecheck, doctor and the full retained opt-in suite passed: **79 tests, zero failures/skips**. The Codex changes passed typecheck and **81 tests** with real frame extraction enabled (nine unchanged opt-in browser/render tests skipped), plus fresh live discovery/capture/analysis/render and screenshot-based controls learning. Completed live CLI resume also reused the final output in under one second with no candidate or model calls. Fixtures establish integration behavior; the saved live run establishes actual game and model results.

Hand over the source, lockfile, bundled font/license, these commands and a selected run's evidence/output. Keep `.env` and credentials private; share only the selected run artifacts, not ignored `data/` wholesale. The recipient supplies their own Gemini key or signs in to Codex with their own ChatGPT account. The [decision log](docs/design-decisions.md) preserves tradeoffs and scope changes; older research remains background rather than new requirements.

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
# Try timed controls, falling back to latency-tolerant feedback when unsupported
npm run pipeline -- --provider codex --play auto --candidates 3

# Bound a fresh timed plan to 30 seconds (an upper limit, not a required runtime).
npm run pipeline -- --provider codex --game PUBLIC_ASTROCADE_GAME_URL --capture-seconds 30

# Continue a saved run; edit requires an existing recording
npm run pipeline -- --resume data/runs/RUN_DIRECTORY --stage edit

# Make a new edit of existing footage with another creative brief
npm run pipeline -- --from-run data/runs/RUN_DIRECTORY --brief docs/editorial-brief.example.json

# Optional fictional AI commentator (supply a generated video long enough for the edit)
npm run pipeline -- --from-run data/runs/RUN_DIRECTORY --presenter /absolute/path/host.mp4

# Explicit fallback after a model-specific quota/access failure
npm run pipeline -- --resume data/runs/RUN_DIRECTORY --stage edit --model gemini-3.5-flash-lite
```

Options: `--provider gemini|codex` (default `gemini`), `--stage discover|capture|edit|all` (default `all`), `--game ID_OR_SLUG_OR_URL`, `--play timed|feedback|auto` (default `timed`), `--capture-seconds 5-175`, `--candidates 1-5` (default `3`), `--model MODEL`, `--resume data/runs/RUN_DIRECTORY`, `--from-run data/runs/RUN_DIRECTORY`, `--brief PATH.json`, and `--presenter PATH.mp4`. Capture includes discovery/learning when missing; editing uses saved recordings. An explicit capture duration requests a new bounded control plan; omit it to reuse a matching verified timed profile. `--help` prints the command reference.

Each command prints its run directory. `--from-run` makes a new edit using the saved sources/analysis without modifying the original run or recapturing. It inherits the original brief unless `--brief` supplies another. It cannot be combined with `--resume`. Presenter assets are supplied separately, permanently labeled AI commentator, and never looped/frozen to fill missing duration; normal edits need no video-generation account. Resume reuses completed source footage, analysis and script, including the provider/model recorded for each artifact. A provider or model override affects unfinished work; start a new run to reconsider completed decisions or change the shortlist. Flash Lite recovered the demonstrated quota failure, but another model is not a guarantee of access or content accuracy. Ctrl-C preserves completed artifacts. Source/output hashes prevent silently reusing externally modified media, and a run lock prevents two processes resuming the same run together. Completed runs validate and reuse their output without retrying failed candidates or requiring a model key. A saved script resumes rendering without rerunning capture/analysis; missing final caption text is reconstructed.

## Inspect the result

Open `report.md`, watch the final MP4, and read `caption.txt`. A run directory contains:

| Artifact | Purpose |
| --- | --- |
| `report.md`, `run.json`, `trace.jsonl` | Human-readable report, resumable state, and dated observations/actions/results/decision summaries; no private internal reasoning |
| `discovery.json`, `shortlist.json`, `content-brief.json` | Live catalog evidence, attainable event/rejection hypotheses, saved voice and dated research context |
| `game-*/inspection-*/` | Before/after screenshots, observed instructions and controls, inspection JSON and learned proposal when needed |
| `controls-*.json`, `capture-*.json`, `game-*/*.webm` | Bounded action profile, capture manifest and finalized original gameplay |
| `game-*/feedback-*/report.md`, `decision-*.{jpg,json}` | Current-session screenshots, observed outcomes, corrective lessons, bounded actions and structured proposals retained before validation |
| `analysis-*.json`, `edit.json` | Verified intervals, content rubric, three hook alternatives, selected copy, visual critique, timed overlays and cuts |
| `highlight-*.mp4`, `caption.txt` | Finished 1080×1920 H.264/30 fps short and posting copy |

The shortlist is a hypothesis, not a popularity ranking: unlabeled counters remain unknown. The default learner uses visible instructions and before/after inspection, then proposes simple timed inputs. It skips uncertain controls and randomized puzzles whose answers cannot survive a fresh browser. `--play feedback` instead learns the mechanics, tests one reversible move in a fresh session, compares before/current screenshots, and adapts small action batches to the current board. It keeps recent observed lessons, stops on completion or repeated no progress, and saves every decision image. New inspections use the full game iframe so HTML controls around a canvas remain visible. Bounded menu inspection distinguishes entrances/tutorials from active gameplay choices and retains observed instructions. Native pointer actions support taps, straight drags, continuous paths, and an explicit left or right button; controls still require visible evidence. For observed Mouse Look controls, a separate relative `look` action turns without holding a button. It requires current browser pointer lock and a known native cursor position; clicks under pointer lock preserve the current aim. Feedback is restricted to input-paced games: the game keeps running during inference, so a 45-second shift or reflex runner is not suitable. Each attempt has at most sixteen decisions, a 175-second recording budget, and a 30-second per-decision deadline. The last decision is evaluation-only. Provider failures after useful play preserve partial footage; model statements of success still need visual review.

Actual captured action determines the winner. A content rubric gates unclear, unreadable or missing payoffs, then compares clarity, participation, consequence and distinctiveness. Popularity cannot rescue unsuitable footage. A saved brief provides voice/examples and optional dated trend evidence; the default has no verified current trend. Future/expired signals and observations older than fourteen days are excluded. See [the editorial thesis](docs/content-quality.md) and [example brief](docs/editorial-brief.example.json).

The editor considers three distinct hook concepts, chooses one, and visually reviews actual selected windows for truthful copy, readable setup/payoff and text placement. It can remove repetitive action within verified intervals, preserving causal context. Text-driven dilemmas and consequences need their own reading time. A visually approved hook that fails local layout or reading checks gets one shortening attempt with its cut, position and premise fixed. Gaps remain honest jump cuts; footage is not padded, repeated or frozen. Creative budgets vary by event, with a 40-second ceiling. Short recordings receive one 8 FPS analysis; longer sources use coarse/dense sampling, and the final copy review uses 2 FPS. Brief bold outlined hooks sit directly over nonessential gameplay and disappear before the result. The complete recorded game surface stays visible; there are no reserved title/footer bands. Post captions add a natural reaction and exact game attribution. Current highlights are silent, so music games must also deliver a visible payoff. Watch the actual render at phone size: model approval and tests do not establish audience performance.

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

Standalone media tests use FFmpeg on PATH unless overridden. For the Apple Silicon full build, prefix the test command with `FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`; its sibling ffprobe is detected. Tests cover cut bounds, decoded render/capture behavior, resizing recordings, caption placement, provider contracts and resume. The [acceptance record](docs/acceptance.md) keeps dated test counts and actual game/model evidence. Live tests completed the first Car Wash customer three times and two shuffled Sort It Out boards; subsequent edits compare transformation, mistake, comeback and fictional-commentator formats using those saved recordings. Fixtures establish integration behavior, not model accuracy or audience performance.

Hand over the source, lockfile, bundled font/license, these commands and a selected run's evidence/output. Keep `.env` and credentials private; share only the selected run artifacts, not ignored `data/` wholesale. The recipient supplies their own Gemini key or signs in to Codex with their own ChatGPT account. The [decision log](docs/design-decisions.md) preserves tradeoffs and scope changes; older research remains background rather than new requirements.

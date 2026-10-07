# Astrocade Studio

A local workflow for discovering Astrocade games, recording native browser gameplay, generating portrait videos, reviewing revisions, and publishing approved videos through Instagram's desktop interface.

**Current status:** the application and local integration fixtures are implemented. Live acceptance is incomplete: this machine's router blocks Astrocade, Gemini/Tavily keys are not configured, and no Instagram account or posts have been verified. There are currently **zero verified Astrocade profiles and zero published videos**. See [acceptance evidence](docs/acceptance.md) for the remaining assignment gates.

## Run

Use Node.js 24 or newer and a local desktop session. Instagram opens a visible browser for any verification checkpoint. Native gameplay capture has been tested on macOS with the pinned Playwright Chromium; other platforms need the same integration checks.

```sh
npm ci
npm run browser:install
# macOS; requires a build with libass for captions
brew install ffmpeg-full
npm run doctor
npm start
```

Open **http://127.0.0.1:4310**. FFmpeg's standard Apple Silicon Homebrew path is detected automatically. Elsewhere, put an FFmpeg build with libass on PATH or set `FFMPEG_PATH` and `FFPROBE_PATH`. The licensed Noto Sans caption font is bundled.

The Setup screen saves credentials locally; `.env` is optional. Copy `.env.example` if preferred. Nonempty environment values override saved settings. Credentials, browser sessions, jobs and media live in ignored `data/`; do not send that directory with the source. JSON files are written atomically with private filesystem permissions. This is local storage, not encrypted secret management.

| Setup item | When needed | Get it |
| --- | --- | --- |
| Gemini API key | Footage analysis, scripting, narration, word timings | [Google AI Studio key setup](https://ai.google.dev/gemini-api/docs/api-key) |
| Tavily API key | Explicit research refresh and trend evidence | [Tavily quickstart](https://docs.tavily.com/documentation/quickstart) |
| Instagram identity | Creating the fresh account | Intended handle, display name, password and actual owner's birthday, entered locally |
| Verification inbox | Receiving the registration code | Built-in [Mail.tm](https://docs.mail.tm/) provisioning, or TLS IMAP with password/app password or an existing OAuth access token |
| Workbench password | Sharing the review interface | Choose in Setup before exposing the server |

The model names and voice are configurable in Setup. The code uses `@google/genai`'s Interactions and Files APIs. Having a key does not prove access to every selected model or sufficient quota; provider failures preserve finished artifacts. The application does not activate billing. IMAP access tokens are supplied credentials; this project does not implement a provider OAuth enrollment flow.

## Use

1. **Setup:** enter the keys. Create or verify the project inbox, or configure IMAP. Enter the real owner and desired Instagram account details, then start account creation. Ordinary signup and email-code steps are automated. Unknown screens and identity checks pause in the same browser; complete the checkpoint and resume. Readiness checks verify the intended account, public visibility, and video composer separately.
2. **Research:** explicitly refresh a topic when needed. Saved snapshots contain dated source evidence; text research does not claim to have watched social videos.
3. **Studio:** discover live games. The balanced, popular, visual and trend modes rank available evidence. Missing counters remain unknown. Trend mode can return no match.
4. **Capture profiles:** inspect a game, supply its frame/surface selectors and bounded start/reset/control steps, then run the two-attempt probe. A profile becomes verified only after both recordings contain usable action. The template is a starting point, not a tested game controller. Profile changes invalidate verification. No supported live-game profiles are shipped until access is restored.
5. **Generate:** choose highlights, narrated recommendations, or original fiction/sourced factual storytelling; compare one game or the best fit from a small supported shortlist. The workflow captures, analyzes visible events, writes scripts, synthesizes speech, times captions, and renders automatically. Duration follows usable action. A speech overrun gets one shortening attempt for an original generated draft, then becomes a review issue.
6. **Review:** watch the actual video and inspect the caption. Editing a post caption reuses media; hook edits rerender; narration edits regenerate speech and captions. Every edit creates a revision and requires fresh approval. User edits are not silently shortened on resume.
7. **Publish:** approve the exact finished revision, then publish it. The publisher verifies the account and media hash, uploads the local file, checks caption/crop/disclosure controls, persists intent, and clicks Share once. An uncertain result offers reconciliation instead of a second Share. Reconcile an uncertain publication before editing or publishing another revision of that draft.

The assignment requires two real posts, including at least one game-centered video. These remain explicit live acceptance tasks; test fixtures cannot satisfy them. Browser signup/publishing can encounter unsupported platform screens or rejection. See [Instagram research](docs/research-instagram.md) for the selected route and its platform limitations.

## Architecture

`React → Express → one persistent job lane → small workflow/provider modules`

- `src/server/games`: public-page discovery, evidence-based ranking, bounded native controls and reusable game profiles.
- `src/server/media`: separate recorder tab, native VP9 chunks, flush/decode validation, FFmpeg portrait rendering with ASS captions.
- `src/server/providers`: Google reasoning/speech/transcription and bounded Tavily Search/Extract.
- `src/server/instagram`: mailbox adapters, resumable signup, persistent identity, exact-revision publication and reconciliation.
- `src/server/workflow.ts`: orchestration over immutable media and validated JSON state.
- `src/client`: Studio, Research and Setup over that same server API.

Only one mutation runs at a time; previews and status reads remain available. Cancellation waits for cleanup. A restart marks unfinished jobs interrupted and preserves captures, audio and revisions. Resume uses saved artifacts. Human checkpoints release the lane. A crash around Share is resolved by inspecting the original intent, never by assuming the upload failed.

The source handoff needs no Codex connector, personal browser profile, database, worker cluster, public media bucket or Meta developer enrollment. The recipient configures their own credentials and obtains their own verified game/profile and publishing evidence.

## Verify

```sh
npm run check
```

This runs strict TypeScript checks, unit/local HTTP tests and the production UI build. Browser/media integration tests are opt-in because they launch Chromium and require FFmpeg with libass:

```sh
RUN_BROWSER_TESTS=1 RUN_BROWSER_MEDIA_TESTS=1 RUN_RENDER_TESTS=1 \
INSTAGRAM_BROWSER_FIXTURE=1 \
node --import tsx --test --test-concurrency=1 'src/**/*.test.ts'
```

Tests cover native input/capture cleanup, recorder finalization, playable portrait output, timestamp bounds, email freshness, approval invalidation, lost Share confirmation, restart recovery, local authentication and artifact access. Instagram fixtures intercept requests and make **no live posts**. Google SDK wire-contract fixtures make **no provider requests**. Live provider capacity, game compatibility and Instagram acceptance remain separate checks.

Unlike the application, standalone media tests use `ffmpeg` on PATH unless overridden. On Apple Silicon with Homebrew's keg-only full build, prefix the test command with `FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`; its sibling `ffprobe` is detected. The complete opt-in suite passed **74 tests, with no skips**, on the documented Mac environment.

## Share the workbench

Set a workbench password, follow [ngrok's setup instructions](https://ngrok.com/docs/start), then build and restart in production mode before sharing:

```sh
npm run build
NODE_ENV=production npm start
# In another terminal, with your own ngrok account configured:
ngrok http 4310
```

Give the intended reviewer the HTTPS URL and workbench password. A shared reviewer can change settings, start jobs and approve/publish content; this is one trusted operator interface, not a multi-user permission system. Keep the laptop awake. Stop ngrok to end access. The tunnel serves the interface; Instagram receives a local file upload.

## Design record

The [plan](PLAN.md), [decision log](docs/design-decisions.md), [requirements audit](docs/requirements-audit.md) and focused research documents explain the decisions and rejected alternatives. [Acceptance evidence](docs/acceptance.md) records what is demonstrated versus still blocked. Commits are incremental and the lockfile pins the tested library versions.

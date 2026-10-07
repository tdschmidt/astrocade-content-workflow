# Astrocade Studio

A local workflow for discovering Astrocade games, recording native browser gameplay, generating portrait videos, reviewing revisions, and publishing approved videos through Instagram's desktop interface.

**Current status:** live discovery returned **30 games**, and **Crowd Pier Run now passes repeated native capture**, including the Studio's two-capture check. Its tested preset is included, so Create video is enabled without writing a profile. A manually scripted portrait-render check also succeeded. The first Gemini footage analysis timed out; further uploads await explicit permission after an automatic approval-review block. There is **no end-to-end automatically generated live short, verified fresh Instagram account, or published video** yet. See [acceptance evidence](docs/acceptance.md).

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
| Gemini API key | Analyzing footage and writing the video | [Google AI Studio key setup](https://ai.google.dev/gemini-api/docs/api-key) |
| Instagram identity | Creating the fresh account | Intended handle, display name, password and actual owner's birthday, entered locally |
| Verification inbox | Receiving the registration code | Built-in [Mail.tm](https://docs.mail.tm/) provisioning, or TLS IMAP with password/app password or an existing OAuth access token |

Keys are configured privately on the development machine; the recipient supplies their own. Model access and quota are checked when used. The application does not activate billing. IMAP access tokens are supplied credentials; this project does not implement a provider OAuth enrollment flow.

## Use

1. **Setup:** enter your Gemini key. The core workflow does not require web research, narrated formats, or shared hosting.
2. **Studio:** discover games, then choose **Create video**. The default makes one gameplay highlight with balanced selection. The tested Crowd Pier Run preset is added when absent; existing saved edits are preserved. Generation captures gameplay, sends the footage to Google for analysis/writing, and renders the draft. Profile checks are technical capture checks; content quality is assessed during generation.
3. **Review:** watch the generated video and inspect its caption. Hook edits rerender; post-caption edits reuse the media. Each edit creates a revision requiring fresh approval. A failed provider request preserves completed captures for resume.
4. **Create the fresh Instagram account:** in Setup, prepare the verification inbox and enter the real owner's account details. Start signup. Ordinary signup and matching email-code steps are automated; unknown screens and identity checks pause in the retained browser for a human checkpoint and resume. Verify the intended account and upload readiness.
5. **Publish two videos:** approve each exact finished video/caption, then publish. The system checks the account and file, saves intent before Share, and records the resulting permalink. If confirmation is lost, check the original publication before another attempt. Repeat for a second approved video and verify both posts play.

The assignment is complete only when the system has produced and published two real videos to the fresh account. Local fixtures do not meet that requirement. Browser signup/publishing may encounter platform rejection or unsupported screens; see [Instagram research](docs/research-instagram.md).

Existing optional formats, comparison and selection controls remain under **Options**. Advanced model/voice overrides remain collapsed in Setup for provider access issues. Tavily is only needed for the optional research backend ([Tavily quickstart](https://docs.tavily.com/documentation/quickstart)); none of these extras is a prerequisite for the default highlight workflow.

## Architecture

`React → Express → one persistent job lane → small workflow/provider modules`

- `src/server/games`: public-page discovery, evidence-based ranking, bounded native controls and reusable game profiles.
- `src/server/media`: separate recorder tab, native VP9 chunks, flush/decode validation, FFmpeg portrait rendering with ASS captions.
- `src/server/providers`: Google reasoning/speech/transcription and bounded Tavily Search/Extract.
- `src/server/instagram`: mailbox adapters, resumable signup, persistent identity, exact-revision publication and reconciliation.
- `src/server/workflow.ts`: orchestration over immutable media and validated JSON state.
- `src/client`: Studio and Setup over the same server API; the optional research module is retained outside primary navigation.

Only one mutation runs at a time; previews and status reads remain available. Cancellation waits for cleanup. A restart marks unfinished jobs interrupted and preserves captures, audio and revisions. Resume uses saved artifacts. Human checkpoints release the lane. A crash around Share is resolved by inspecting the original intent, never by assuming the upload failed.

The source handoff needs no Codex connector, personal browser profile, database, worker cluster, public media bucket or Meta developer enrollment. The recipient configures their own credentials. The verified Crowd Pier Run preset is included. A complete automatic live run and the two published results are still required for the final handoff.

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

Unlike the application, standalone media tests use `ffmpeg` on PATH unless overridden. On Apple Silicon with Homebrew's keg-only full build, prefix the test command with `FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`; its sibling `ffprobe` is detected. The final full opt-in run passed **83 tests, with no skips**, including the loading-overlay, provider-bound and preset cases, on the documented Mac environment. Typecheck and the production build also passed. Workflow regression tests also verify that a timed profile requires two successful captures without a Google key or content-analysis call.

## Design record

The [plan](PLAN.md), [decision log](docs/design-decisions.md), [requirements audit](docs/requirements-audit.md) and focused research documents explain the decisions and rejected alternatives. [Acceptance evidence](docs/acceptance.md) records what is demonstrated versus still blocked. Commits are incremental and the lockfile pins the tested library versions.

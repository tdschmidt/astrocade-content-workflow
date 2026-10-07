# Astrocade content workflow implementation plan

Build a local TypeScript application that discovers promising Astrocade games, plays and records them, creates short videos, creates a fresh Instagram account through browser automation, and publishes at least two specifically approved videos to that account. Hand over the complete runnable code and an honest record of supported games, human checkpoints, and published results.

The local implementation now exists, and live discovery returned 30 games. Crowd Pier Run now passes repeatable native capture, including the Studio two-attempt probe; a tested preset is included without overwriting saved edits. Gemini/Tavily keys are configured privately, but the first live Gemini footage analysis timed out. Follow-up uploads await explicit permission after automatic approval review blocked a retry; no new Google upload has run. An 11.7-second portrait-render check using a manually supplied hook passed, but no end-to-end automatically generated live short, fresh Instagram account, or published video is established yet. See [current acceptance evidence](docs/acceptance.md), the [requirements audit](docs/requirements-audit.md), [decision record](docs/design-decisions.md), and research on [Instagram](docs/research-instagram.md), [capture](docs/research-capture.md), [gameplay](docs/research-gameplay.md), and [editing](docs/research-editorial.md).

## Required outcome and boundaries

The brief requires all of the following: live game discovery and selection, repeatable usable gameplay capture, automatic short-video creation, a fresh Instagram account, at least two published videos, and complete code. None is replaced by a manual tutorial, canned recording, mock, or pre-existing social account. The user permits exceptional human verification checkpoints during system-driven signup when full unattended creation is too difficult for v1. Publication requires approval of each exact final version.

The user now prioritizes the simplest working implementation of the initial brief. The default is one gameplay highlight using balanced selection and the same-game setting. Existing research, alternate formats, comparison controls and model overrides are optional tools, not additional acceptance requirements. Shared hosting is outside the current scope. Spend remaining effort on a finished automatically generated real short, fresh-account creation, and two approved posts.

One fresh Instagram account serves the first two posts. Creating an account is an explicit workflow action, not something repeated for every video. There are no required Facebook identities, Meta developer accounts, Graph API apps, OAuth callbacks, public media URLs, or professional-account conversions. Instagram's desktop interface uploads a local file. Browser automation has a documented platform permission/supportability limitation; human checkpoints do not remove it. [Instagram terms](https://help.instagram.com/581066165581870/)

## Architecture and ownership

Use React/Vite, Express, TypeScript, Zod, Playwright, and FFmpeg. Use ordinary functions and small integration modules. Pin tested versions and ship the lockfile. The selected browser baseline is Playwright 1.63.0 with its matching full Chromium distribution, operated in unified headless mode for gameplay and headed mode for Instagram handoffs. A headed browser can still execute unattended.

The server is the sole owner of workflow state. One mutation operation runs at a time, including account setup, research refresh, generation, rerendering, or publication. Reads and previews remain available. A diagnostic CLI may run independently; any mutating CLI calls the server. Edits to an active target wait until its operation finishes or cancellation cleanup completes.

A human checkpoint parks the operation as `needs_attention` after automatic work stops, then releases the active-operation slot so unrelated generation can continue. Retain the Instagram session/profile for the handoff. Resume reacquires the slot and inspects the current page. Parked signup prevents another signup for that identity; an unresolved publication prevents further Share attempts for that publication until reconciliation. A parked checkpoint is not an active background worker.

Store local JSON manifests with atomic replacement and immutable, revision-specific media files. Keep credentials in ignored local settings (mode 0600), with optional environment overrides, and the Instagram session in its own ignored browser profile. Neither enters the code handoff, model prompts, or general traces. The workbench operates locally. Keep its existing backend access boundary without adding sharing setup or deployment work.

Use these narrow data boundaries, validated at external/model inputs:

| Record | Minimum purpose |
| --- | --- |
| Research snapshot and game candidate | Preserve URLs, observation dates, actual metric labels, evidence, and ranking rationale. |
| Game profile and capture attempt | Describe supported controls/start/reset, record attempt outcomes, and identify finalized source footage. |
| Footage analysis and edit plan | Link observed events to source intervals, narration beats, and a fixed composition. |
| Draft revision | Bind editable text to the correct capture, speech, caption timing, and render. |
| Signup attempt | Track the intended new account and resumable verification milestones without logging credentials. |
| Publication attempt | Bind approval to account, immutable video, caption, settings, and the verified published URL. |

No database, distributed queue, generic workflow graph, general browser-agent framework, timeline editor, or growth-measurement service is required.

## Workflow behavior

### Create the Instagram account

Use direct Playwright with a dedicated persistent profile. The setup input supplies an owner-controlled email, actual owner birthday, display name, desired username, and password through local secret configuration. The application must not require an already-created Instagram account.

Inspect the current page on every entry or resume. Fill recognized signup screens, handle validation, submit once, retrieve a fresh matching verification email through one selected inbox adapter, and advance automatically through ordinary onboarding. Unknown screens, identity checks, or unavailable SMS verification become resumable human checkpoints in that same session. Do not restart account creation blindly after a timeout or crash.

The user subsequently requested programmatic mailbox creation, with configurable existing email as a fallback. Implement Mail.tm's documented account/message API and one TLS IMAP adapter. Persist the chosen mailbox credentials before creation; reconcile the same identity after a lost response rather than creating replacements. The first live attempt remains unverified (same-address authentication returned HTTP 401); IMAP setup is available. Filter from a watermark established before requesting the code, parse locally, and bound polling.

Verify the intended username and profile, close/reopen the persistent session, confirm public visibility, and inspect the desktop video composer. Keep account-created and upload-ready milestones separate. Skip optional contact syncing, follows, and profile-picture publication. Professional conversion is optional.

### Discover and play

Discover live candidates from verified public Astrocade pages; retain canonical URLs and source evidence. Use metadata/screenshots for a cheap shortlist, then probe actual play. Distinguish platform access failure, no matching games, unsupported controls, and poor footage. A cached list or a hardcoded final pair does not establish live discovery.

Use balanced selection by default. Existing popular, visual and trend-led modes remain under Options; the optional research backend saves dated Tavily evidence. Missing counters remain unknown, and no credible trend match is a valid result. These options do not block making a gameplay highlight.

Run one app-owned gameplay browser at a time, launching and closing it for each capture attempt. Allocate the unique capture title before launch because the tab-selection flag is fixed for that browser's lifetime. Give the game and local recorder separate isolated contexts; restore game authentication only if actual access requires it. Inspect the actual frame tree and game surface. Verify readiness, focus, and normalized game-relative coordinates before bounded native key/pointer actions. Recompute bounds after layout changes. All held inputs expire and are released during cleanup; delayed model responses cannot act on a superseded attempt.

Start with simple timed interaction and sparse visual decisions for forgiving or turn-based games. Each game profile selects a reusable controller, mappings, start/reset procedure, viewport, and capture objective. New visual detection or strategy is new code, not a supposedly trivial profile. Skip games whose useful play requires an unproven reflex-control subsystem. A technical profile probe must complete two independent captures, including source decode validation, before marking the profile capture-ready. Timed controllers need no Google key for this check. Crowd Pier Run has passed this check in the actual Studio, with moving gameplay and the full HUD visually inspected. Content quality and useful action are assessed during generation. A second game can demonstrate reuse, but the brief does not require two different games.

### Record gameplay

Use native tab capture with MediaRecorder in the dedicated gameplay browser as the selected recording direction. A separate local recorder tab survives game-page changes; a uniquely identified game tab is the only permitted capture target. Supply user activation through the recorder's actual Start control and use the pinned Chromium tab-selection testing switch. Keep this configuration out of the Instagram and personal browsers.

Request a 30 fps video stream, negotiate a supported VP9 media type, inspect the actual resulting codec and dimensions, and transcode the final edit to H.264. Stream ordered media chunks to a temporary local file. Stop, flush pending chunks, end tracks, inspect the file, and only then mark the capture complete. An additional synthetic probe verified ordered incremental writes, final-chunk flush, and cancellation with a write outstanding; a canceled attempt produced no ready file. Keep control screenshots separate from capture timing. Original game audio remains optional and must not block silent-video capture.

Local synthetic comparisons and matching Playwright 1.63.0/Chromium 153 checks demonstrated 180 distinct decoded frames in approximately six seconds and final-chunk flush. A loading overlay initially covered Start; the bounded actionability fix then passed two direct Crowd Pier Run captures (12.799 and 12.732 seconds) and the actual Studio two-attempt probe (12.748 and 12.948 seconds). Sources are 720×1280 VP9 with the game region at x=29, y=0, width=661, height=1176; moving play and the full HUD were inspected. A manually scripted 11.7-second portrait render also passed. Automatic analysis and scripting remain unproven. Keep this single capture implementation.

### Analyze and create videos

Analyze finalized local footage coarsely, then inspect candidate moments more densely. Save observed setup/action/outcome evidence and reject idle, loading, or unsupported claims. Use media-relative source offsets and validate every cut against actual duration. Generate the final hook and narration after identifying a real event.

Produce a gameplay highlight first, using a real observed moment, a short hook, source attribution and a portrait edit. Reuse source captures and one renderer. Let duration follow the content; do not pad to an arbitrary target. Existing narrated recommendations, stories and comparison settings stay optional under Options.

Use Google for footage analysis and writing. The first live analysis timed out, so preserve the real source and resolve that request path before claiming a generated short. The recipient supplies their own key. Optional narrated formats use configurable speech and transcription models with phrase captions; those services are not prerequisites for a silent gameplay highlight. Keep local originals when temporary provider uploads expire and preserve completed work on provider failure.

When narration is selected, measure speech before finalizing the timeline. If it exceeds authentic footage, shorten and regenerate once, then report a draft issue if it still does not fit. Never repeat the payoff or truncate the voice track to hide the mismatch.

Render a fixed portrait layout at 1080 by 1920, 30 fps, H.264 progressive 4:2:0, with AAC stereo at 48 kHz when audio is present. Preserve the meaningful game region, use phrase captions and restrained attribution, and verify readability at phone size. Use a configured FFmpeg build with libass and a bundled licensed font. Generate subtitles as files, invoke processes with argument arrays, normalize cuts, validate temporary output, then promote it to the final revision.

### Review and publish

The primary workbench exposes Setup, Discover games, Create video, progress, previews, edits, approval and publication. Optional creative choices stay collapsed, and research is outside primary navigation. Post-caption edits do not rerender video; hook changes rerender visuals; narration changes regenerate speech/timing/render. Completed source footage is reusable without replaying the game.

Choose the strongest two previews, including at least one game-centered video. Approval binds to account, exact media revision, caption, cover/settings, and any required disclosure. Inspect the actual desktop disclosure controls before relying on synthetic narration publication; an API field or caption text is not an assumed replacement.

Upload the exact local MP4 through the native desktop composer, verify the active username, crop, caption, and settings, persist publication intent, then click Share once. Record and verify the new canonical post URL and playable video. A lost confirmation becomes an unknown outcome and triggers reconciliation against the profile, not another Share. Return an existing publication result on repeat requests for the same revision. Manual publication is not counted as proof that the automated publisher works.

## Proof order and handoff

Live discovery and repeatable native game capture are demonstrated, and the tested preset makes Create video available. After explicit permission for the blocked Google upload, resume footage analysis and produce one complete highlight. The bounded SDK request/upload fix has not yet been validated by a new live upload. Account creation and upload readiness remain separate unproven gates. Do not spend this phase expanding the UI or optional formats.

Complete fresh-account setup, present the exact first preview/caption for approval, publish it through the workflow, and verify the processed post. Produce and approve a second useful video using the proven capture path, publish it, and verify both permalinks. Two different game profiles or narrated variants are not required.

Test the behaviors that can invalidate the assignment: stale email codes, signup resume, wrong account, canceled held inputs, unsupported candidates, invalid event/cut timing, narration overrun, partial render files, quota interruption, restart/resume, duplicate Share requests, and lost publication confirmation. Use sanitized fixtures for failure paths and live checks for platform acceptance. A fixture cannot prove Instagram accepts an account or Astrocade accepts controls.

After restart, mark local running work interrupted and offer explicit Resume from validated artifacts. Capture restarts from a known game state. An interrupted publication is reconciled separately. Preserve raw captures and approved renders; no automatic garbage collector or recovery daemon is needed.

Deliver complete source, lockfile, runtime/browser installation instructions, environment example, preflight checks, exact run commands, supported-profile explanation, decision/research documents, a sample run record, and two real permalinks. The reviewer must not need the author's personal browser profile, a Codex connector, or undisclosed manual gameplay. State every actual human checkpoint and unresolved limitation plainly.

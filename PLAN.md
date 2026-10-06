# Astrocade content workflow implementation plan

Build a local TypeScript application that discovers promising Astrocade games, plays and records them, creates short videos, creates a fresh Instagram account through browser automation, and publishes at least two specifically approved videos to that account. Hand over the complete runnable code and an honest record of supported games, human checkpoints, and published results.

This is an implementation plan backed by research and limited feasibility experiments, not a claim of a working application. The highest remaining risks are live Astrocade access and completing Instagram registration and publication. See the [requirements audit](docs/requirements-audit.md), [decision record](docs/design-decisions.md), and research on [Instagram](docs/research-instagram.md), [capture](docs/research-capture.md), [gameplay](docs/research-gameplay.md), and [editing](docs/research-editorial.md).

## Required outcome and boundaries

The brief requires all of the following: live game discovery and selection, repeatable usable gameplay capture, automatic short-video creation, a fresh Instagram account, at least two published videos, and complete code. None is replaced by a manual tutorial, canned recording, mock, or pre-existing social account. The user permits exceptional human verification checkpoints during system-driven signup when full unattended creation is too difficult for v1. Publication requires approval of each exact final version.

The available implementation budget is one or two focused days. Preserve the agreed selection modes, saved research, three format families, comparison modes, editable drafts, and local web workbench over one shared pipeline. Prove the hard path first; if the budget cannot cover an agreed feature, report that explicitly rather than silently changing the deliverable.

One fresh Instagram account serves the first two posts. Creating an account is an explicit workflow action, not something repeated for every video. There are no required Facebook identities, Meta developer accounts, Graph API apps, OAuth callbacks, public media URLs, or professional-account conversions. Instagram's desktop interface uploads a local file. Browser automation has a documented platform permission/supportability limitation; human checkpoints do not remove it. [Instagram terms](https://help.instagram.com/581066165581870/)

## Architecture and ownership

Use React/Vite, Express, TypeScript, Zod, Playwright, and FFmpeg. Use ordinary functions and small integration modules. Pin tested versions and ship the lockfile. The selected browser baseline is Playwright 1.63.0 with its matching full Chromium distribution, operated in unified headless mode for gameplay and headed mode for Instagram handoffs. A headed browser can still execute unattended.

The server is the sole owner of workflow state. One mutation operation runs at a time, including account setup, research refresh, generation, rerendering, or publication. Reads and previews remain available. A diagnostic CLI may run independently; any mutating CLI calls the server. Edits to an active target wait until its operation finishes or cancellation cleanup completes.

A human checkpoint parks the operation as `needs_attention` after automatic work stops, then releases the active-operation slot so unrelated generation can continue. Retain the Instagram session/profile for the handoff. Resume reacquires the slot and inspects the current page. Parked signup prevents another signup for that identity; an unresolved publication prevents further Share attempts for that publication until reconciliation. A parked checkpoint is not an active background worker.

Store local JSON manifests with atomic replacement and immutable, revision-specific media files. Keep credentials in a local ignored environment file and the Instagram session in its own ignored browser profile. Neither enters the code handoff, model prompts, or general traces. Provide one shared password for the ngrok workbench; ngrok is only the review interface, not the video delivery path to Instagram.

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

Use direct Playwright with a dedicated persistent profile. The setup input supplies an owner-controlled email, actual owner birthday, display name, desired username and approved alternatives, and password through local secret configuration. The application must not require an already-created Instagram account.

Inspect the current page on every entry or resume. Fill recognized signup screens, handle validation, submit once, retrieve a fresh matching verification email through one selected inbox adapter, and advance automatically through ordinary onboarding. Unknown screens, identity checks, or unavailable SMS verification become resumable human checkpoints in that same session. Do not restart account creation blindly after a timeout or crash.

Choose the inbox adapter from the user's existing access: TLS IMAP when working credentials already exist, or an already configured provider API. The provider/access method is still a required input. Do not build multiple mailbox adapters or quietly introduce another account-registration project. Filter from a watermark established before requesting the code, parse locally, and bound polling and resend attempts.

Verify the intended username and profile, close/reopen the persistent session, confirm public visibility, and inspect the desktop video composer. Keep account-created and upload-ready milestones separate. Skip optional contact syncing, follows, and profile-picture publication. Professional conversion is optional.

### Discover and play

Discover live candidates from verified public Astrocade pages; retain canonical URLs and source evidence. Use metadata/screenshots for a cheap shortlist, then probe actual play. Distinguish platform access failure, no matching games, unsupported controls, and poor footage. A cached list or a hardcoded final pair does not establish live discovery.

Retain balanced, popular, visual, and trend-led selection. The modes alter ranking emphasis but share the same capture/readability checks. Explicit research refresh uses bounded Tavily Search and targeted Extract, then saves a dated synthesis. No credible trend match is a valid result.

Run one app-owned gameplay browser at a time, launching and closing it for each capture attempt. Allocate the unique capture title before launch because the tab-selection flag is fixed for that browser's lifetime. Give the game and local recorder separate isolated contexts; restore game authentication only if actual access requires it. Inspect the actual frame tree and game surface. Verify readiness, focus, and normalized game-relative coordinates before bounded native key/pointer actions. Recompute bounds after layout changes. All held inputs expire and are released during cleanup; delayed model responses cannot act on a superseded attempt.

Start with simple timed interaction and sparse visual decisions for forgiving or turn-based games. Each game profile selects a reusable controller, mappings, start/reset procedure, viewport, and capture objective. New visual detection or strategy is new code, not a supposedly trivial profile. Skip games whose useful play requires an unproven reflex-control subsystem. Test reset and useful capture twice, then demonstrate profile reuse on a second game.

### Record gameplay

Use native tab capture with MediaRecorder in the dedicated gameplay browser as the selected recording direction. A separate local recorder tab survives game-page changes; a uniquely identified game tab is the only permitted capture target. Supply user activation through the recorder's actual Start control and use the pinned Chromium tab-selection testing switch. Keep this configuration out of the Instagram and personal browsers.

Request a 30 fps video stream, negotiate a supported VP9 media type, inspect the actual resulting codec and dimensions, and transcode the final edit to H.264. Stream ordered media chunks to a temporary local file. Stop, flush pending chunks, end tracks, inspect the file, and only then mark the capture complete. An additional synthetic probe verified ordered incremental writes, final-chunk flush, and cancellation with a write outstanding; a canceled attempt produced no ready file. Keep control screenshots separate from capture timing. Original game audio remains optional and must not block silent-video capture.

This choice is supported by local synthetic comparisons and a matching Playwright 1.63.0/Chromium 153 confirmation: 180 distinct decoded frames in approximately six seconds, including successful final-chunk flush. It is not yet supported by Astrocade footage. Run the same recording proof on a real game. If tab capture fails that gate, switch the capture implementation to timestamp-preserved Playwright JPEG frames plus FFmpeg. Select one implementation; do not build and maintain two production backends. The built-in Playwright video recorder is a diagnostic option whose measured detail loss and fixed 25 fps make it a poor default for polished gameplay.

### Analyze and create videos

Analyze finalized local footage coarsely, then inspect candidate moments more densely. Save observed setup/action/outcome evidence and reject idle, loading, or unsupported claims. Use media-relative source offsets and validate every cut against actual duration. Generate the final hook and narration after identifying a real event.

Keep the three formats: gameplay highlight, narrated recommendation, and original story or sourced explainer over gameplay. Retain same-game and best-game-per-format comparisons, defaulting to best fit. Use shared captures and one renderer. Let duration follow the content; do not pad to an arbitrary target.

Use configurable Google provider functions for visual reasoning and writing, `gemini-3.8-flash-lite-tts` for one complete narration, and `gemini-3.5-transcribe` for word timing grouped into phrase captions. Pin the tested SDK/schema. Validate transcript differences rather than assuming they prove bad speech. Keep local originals when temporary provider uploads expire. Respect actual free quotas and preserve completed work on provider failure.

Measure speech before finalizing the timeline. If it exceeds the available authentic footage, shorten and regenerate once, then report a draft issue if it still does not fit. Never secretly repeat the payoff or truncate the voice track.

Render a fixed portrait layout at 1080 by 1920, 30 fps, H.264 progressive 4:2:0, with AAC stereo at 48 kHz when audio is present. Preserve the meaningful game region, use phrase captions and restrained attribution, and verify readability at phone size. Use a configured FFmpeg build with libass and a bundled licensed font. Generate subtitles as files, invoke processes with argument arrays, normalize cuts, validate temporary output, then promote it to the final revision.

### Review and publish

The workbench exposes configuration, research snapshots, candidate rationale, stage progress, draft previews, hook/narration/post-caption edits, rerender, and publication. Post-caption edits do not rerender video; hook changes rerender visuals; narration changes regenerate speech/timing/render. Completed source footage is reusable without replaying the game.

Choose the strongest two previews, including at least one game-centered video. Approval binds to account, exact media revision, caption, cover/settings, and any required disclosure. Inspect the actual desktop disclosure controls before relying on synthetic narration publication; an API field or caption text is not an assumed replacement.

Upload the exact local MP4 through the native desktop composer, verify the active username, crop, caption, and settings, persist publication intent, then click Share once. Record and verify the new canonical post URL and playable video. A lost confirmation becomes an unknown outcome and triggers reconciliation against the profile, not another Share. Return an existing publication result on repeat requests for the same revision. Manual publication is not counted as proof that the automated publisher works.

## Proof order and handoff

The first working session must tackle Instagram creation/upload readiness and live Astrocade access/control before broad UI work. These can be investigated independently. If the live game domain remains unreachable, report that dependency explicitly and continue unaffected work; cached pages cannot pass the game gate.

Then produce one actual end-to-end draft, prove a second profile or meaningful capture reuse, and run an approved first publication. Generate the remaining agreed variants over the proven pipeline, select and publish the second video, and verify both permalinks.

Test the behaviors that can invalidate the assignment: stale email codes, signup resume, wrong account, canceled held inputs, unsupported candidates, invalid event/cut timing, narration overrun, partial render files, quota interruption, restart/resume, duplicate Share requests, and lost publication confirmation. Use sanitized fixtures for failure paths and live checks for platform acceptance. A fixture cannot prove Instagram accepts an account or Astrocade accepts controls.

After restart, mark local running work interrupted and offer explicit Resume from validated artifacts. Capture restarts from a known game state. An interrupted publication is reconciled separately. Preserve raw captures and approved renders; no automatic garbage collector or recovery daemon is needed.

Deliver complete source, lockfile, runtime/browser installation instructions, environment example, preflight checks, exact run commands, supported-profile explanation, decision/research documents, a sample run record, and two real permalinks. The reviewer must not need the author's personal browser profile, a Codex connector, or undisclosed manual gameplay. State every actual human checkpoint and unresolved limitation plainly.

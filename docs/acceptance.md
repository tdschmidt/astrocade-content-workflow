# Implementation and acceptance evidence

Updated 2026-10-06 (America/Los_Angeles). Repository: [tdschmidt/astrocade-content-workflow](https://github.com/tdschmidt/astrocade-content-workflow).

**The assignment is not complete.** Live discovery returned 30 games. Crowd Pier Run passed two direct captures and the actual Studio two-capture probe after the loading-overlay fix. Its verified preset is included, and Create video is enabled. A local portrait-render check also succeeded. The first Gemini footage analysis timed out; subsequent uploads await explicit permission after an automatic approval-review block. There is no end-to-end automatically generated live short, verified fresh Instagram account, or published video yet.

The current priority is the initial brief: discover, capture, create, create the account, publish two approved videos, and hand over the code. Research, extra formats and shared hosting are not additional acceptance gates.

## Evidence by requirement

| Requirement | Demonstrated evidence | Remaining proof |
| --- | --- | --- |
| Discover suitable games | Live public-page discovery returned 30 unique games from Trending and Top Picks; URLs, visible text and observed counters were retained | Establish which candidates consistently yield useful short-form gameplay |
| Repeatable gameplay capture | Two direct captures and the actual Studio two-capture probe passed for Crowd Pier Run; moving play and the full HUD were inspected. The verified preset is seeded only when absent, preserving saved edits | Use the proven capture path in complete automatic video generation; another game is not required |
| Automatic video creation | Actual source footage was rendered into an inspected 11.7-second, 1080×1920, H.264, 30 fps silent MP4 using a manually supplied QA hook; synthetic integration exercises automatic orchestration | Obtain permission for the blocked Google upload, validate the SDK bounds fix live, and produce a complete real draft automatically; the manual render check does not satisfy this requirement |
| Fresh Instagram account | Signup browser fixtures cover recognized screens, fresh email-code handling and resumable checkpoints; persistent browser/profile handling exists | Supply real owner/account details and a working inbox, complete fresh signup, then verify identity and upload readiness |
| Two Instagram videos | Browser fixtures cover exact approval, upload, intent-before-Share, one Share and permalink inspection | Approve two actual previews/captions, publish through the workflow, and verify both processed videos; current live count is zero |
| Handoff | Complete source, lockfile, private GitHub repository, incremental commits, tested Crowd Pier Run preset, setup/preflight, tests and decision records | Include a real completed automatic run record, actual human checkpoints and two real permalinks |

## Live capture and render records

- Discovery completed at `2026-10-07T02:34:42.814Z` (October 6 locally). Trending and Top Picks each yielded 20 observed links; deduplication/selection retained 30 candidates.
- The first [Crowd Pier Run](https://www.astrocade.com/games/crowd-pier-run/01M2YWFH66FH6MMVW5AE66NX7S) source is `data/media/e05236ba-1264-4d55-bb6f-4ac93ee7ed8b.webm`: 12.731 seconds, recorded at `2026-10-07T02:35:18.381Z`. It is actual Astrocade footage.
- A loading spinner initially covered Start in six of six rapid attempts. After the bounded actionability-wait fix, two direct captures passed at 12.799 and 12.732 seconds. Moving gameplay and the complete HUD were visually inspected.
- The Studio **Test capture twice** action completed job `0a869b0a-203b-4bc9-babd-aad8ea15f586` at `2026-10-07T02:49:40.820Z`. It saved `data/media/b704031d-3642-445a-bb28-b17f8e4a5155.webm` (12.748 seconds) and `data/media/e557e05f-dae2-4241-a1d1-042865ce8b2e.webm` (12.948 seconds). Both are 720×1280 VP9 with game crop x=29, y=0, width=661, height=1176.
- Profile `crowd-pier-run` is verified. Startup seeds the tested preset only if its ID is absent, preserving existing saved edits and their verification status. The Studio Create video action is now enabled without requiring profile JSON.
- The local render check is preserved as `data/media/crowd-pier-render-check.mp4`: 11.7 seconds, 1080×1920, H.264 at 30 fps, silent, with the manually supplied hook “Choose your gate” and source credit. It was visually inspected. This proves rendering of real footage, not automatic selection, analysis or scripting.
- A timed profile probe now requires two successful technical captures, including the capture layer's source decode validation. It does not call Google analysis or require a Google key. Footage content quality is assessed during generation.

Local media and credentials stay outside the source handoff. These records identify development evidence; they are not substitute submission posts.

## Local verification

- Strict TypeScript checks and the Vite production build pass.
- The final full opt-in suite passed **83 tests with zero failures and zero skips**, including the loading-overlay, provider-bound and preset cases.
- Unit/local HTTP tests cover credential redaction, artifact access, single-operation ownership, cancellation, email freshness, provider contracts, cut/timestamp bounds, approval invalidation, publication uncertainty and restart recovery. The existing local-access boundary remains tested; sharing is outside current scope.
- Timed-profile regression cases pass with no Google key: two successful captures verify; failure on either attempt leaves the profile unverified; content analysis is not invoked.
- Browser/media fixtures use pinned Playwright 1.63.0 / Chromium 153.0.8010.12 and FFmpeg 9.0.2 with libass. They verify native iframe input, moving VP9 footage, final flush and cancellation cleanup, plus decoded portrait output and the bundled Noto Sans captions.
- A connected synthetic workflow generated highlight and narrated variants, verified hashes/timings, reused immutable media for caption edits, cleared approval and resumed without further provider calls. Its speech was a synthetic tone with mocked timings; this establishes orchestration, not provider output quality.
- The workbench has been reviewed at desktop and 390×844 mobile widths. The simplified primary interface now exposes Studio and Setup, with one highlight by default and optional creative choices collapsed.
- Instagram fixtures create no real account or post. Google wire-contract fixtures make no real provider requests. Optional research fixtures do not establish live Tavily results.

Reproduce the checks using [README](../README.md). Tests use isolated temporary data; live private configuration stays in ignored `data/`.

## External dependency status

**Astrocade:** the earlier router block is resolved. Live discovery and repeatable Crowd Pier Run captures now work. No VPN was installed. The tested preset is included; this does not claim generic support for every discovered game.

**Google/Tavily:** keys are now configured locally and are not included in the handoff. The first live Gemini footage-analysis request timed out before returning usable analysis; the source capture remains saved. A subsequent upload was blocked by automatic approval review, and further uploads await explicit permission in this development session. The small SDK timeout/bounds fix is committed, but no new Google upload has validated it. Actual provider capacity and output quality remain unverified. The recipient needs their own key. Optional model/voice overrides remain collapsed; no paid upgrade was activated. Tavily is not required for the default highlight workflow.

**Mailbox:** the authorized Mail.tm attempt remains pending. The selected identity's credentials were saved before creation; subsequent authentication returned HTTP 401. The initial response does not establish whether creation was rejected or its response was lost. No replacement identity or repeated creation request was made. Diagnostics distinguish stages/statuses without exposing credentials. A TLS IMAP alternative is available; live verification-email delivery is unproven.

**Instagram:** no fresh account or post has been verified. Real owner/account details and a working inbox are still required. Unknown verification screens remain human checkpoints in the retained browser. A publication with uncertain Share outcome blocks another revision until reconciled.

## Remaining execution order

1. Obtain explicit permission for the blocked Google upload, then resume analysis from saved footage and validate the bounded request fix. Automatically create one usable highlight and inspect its actual phone-size result.
2. Complete fresh Instagram signup and verify the persistent account and video composer.
3. Obtain approval of the exact first preview/caption, publish and verify it. Produce a second video through the proven capture path, obtain approval, publish and verify it.
4. Record the completed automatic run, actual human checkpoints and both playable permalinks in the handoff.

Synthetic videos, manually scripted render checks and simulated permalinks do not satisfy those remaining steps.

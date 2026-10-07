# Core workflow: acceptance evidence

Updated 2026-10-06 (America/Los_Angeles). Scope: [PLAN.md](../PLAN.md), branch `codex/core-workflow`. The current deliverable is **discover → learn/play/capture → edit**, operated through the CLI. Account creation/publication are manual follow-through and are not current automation gates.

**Current status:** the three-stage workflow has produced a verified real short from a live, automatically shortlisted three-game run. Capture, analysis, event selection, hook/caption creation and rendering were automatic; an explicit model change/resume recovered from provider quota limits. The result meets functional and conservative editorial acceptance. It does not establish viral performance or universal gameplay. The trimmed codebase passed a clean install, typecheck, doctor and all 79 retained opt-in tests.

## Evidence by stage

| Stage | Demonstrated | Limit / handoff note |
| --- | --- | --- |
| Discover suitable games | Public Trending and Top Picks pages returned 30 unique games with URLs and dated card evidence. A live model nominated three candidates with hook hypotheses, viewer questions and control risks. Unlabeled counters remain unknown. | Observed footage, not the provisional metadata hypothesis, determined the selected game. |
| Learn, play and capture | Crowd Pier Run passed independent fresh-browser captures with native controls and complete HUD. Actual input actions, source geometry and finalized VP9 media are saved. Learned controls also produced Manu Tap-Tap Shots (3.611s) and Bladefish.io (10.316s) recordings; analysis rejected both for lacking a supported payoff. | Keep recorded control execution distinct from useful content; no universal-gameplay claim. |
| Edit a short | The full run rendered and visually verified a 3.766667-second 1080×1920 H.264/yuv420p/30 fps silent highlight. Its +5 gate, 8→13 outcome, hook and caption agree; the full HUD remains visible. | Future recordings still need content review; model correctness and game compatibility are not guaranteed. |
| Hand off the code | Source, lockfile, font/license, CLI setup, staged/resume commands, evidence artifacts and tests exist. | The saved run contains its report/media; the final retained suite passed. The recipient supplies their own key; private credentials stay out of the handoff. |

## Saved live evidence

- Repeated Crowd Pier Run sources include `data/media/b704031d-3642-445a-bb28-b17f8e4a5155.webm` (12.748s) and `data/media/e557e05f-dae2-4241-a1d1-042865ce8b2e.webm` (12.948s). Both are 720×1280 VP9 with crop x=29, y=0, width=661, height=1176. Moving play and the full HUD were visually inspected. The tested profile is shipped; it does not guarantee useful content on every attempt.
- Focused run `data/runs/2026-10-07T04-00-44-981Z-9d26f7` captured 12.731s of real gameplay. `gemini-3.5-flash` analysis supported the +8 gate and 10→18 count change. After a 503 response, an explicit edit-stage resume with `gemini-3.5-flash-lite` reused that source/analysis and produced `highlight-83aaddbe.mp4` (3.466s). Frames show a readable approach and result. The generated caption incorrectly called an addition gate a multiplier; that earlier artifact is not the final accepted output.
- Fresh automatic run: `data/runs/2026-10-07T04-08-10-239Z-2b1896`. Discovery returned 30 games and nominated three. The nomination request received two HTTP 503 responses with `Retry-After: 30`, waited accordingly, and succeeded on attempt three after 77.459s. It captured Crowd Pier Run (12.915s), Manu Tap-Tap Shots (3.611s), and Bladefish.io (10.316s). Flash then hit the test project's reported 20-requests/day free quota. An explicit `--stage edit --model gemini-3.5-flash-lite` resume reused Crowd's completed Flash analysis; Lite rejected the other two recordings for no visible scored consequence.
- **Accepted output:** `data/runs/2026-10-07T04-08-10-239Z-2b1896/highlight-3223d0fd.mp4`: 3.766667s, 1080×1920, H.264/yuv420p, 30 fps, silent. Eight sampled frames show the full HUD at 8, approach to the center +5 gate, the +5 animation, count 13 and exit. Hook: “Adding five runners to the crowd!” Caption: “Crowd Pier Run / Crowd count changes from 8 to 13. / Play: [game URL]”. Both match the visible event.
- Recovery command: `npm run pipeline -- --resume data/runs/2026-10-07T04-08-10-239Z-2b1896 --stage edit --model gemini-3.5-flash-lite`. The run records Flash as the reused Crowd analysis model and Flash Lite for the final script and remaining candidate analyses. No manual cut or caption was supplied.
- Completed CLI resume at `2026-10-07T04:23:34Z` validated/reused the finished video and returned complete in under one second, with no candidate or model calls.
- Rejected candidates are retained: Manu's ball leaves the frame with no basket/score (zero score also visually checked); Bladefish swims without a clear hit/score. Learning controls and recording movement do not establish a useful payoff.
- Separate learned-control diagnostic: `data/evidence/shuriken-learned/{highlight.mp4,proof.json,qa.json}` records two fresh captures (5.732s/5.557s) replaying the same learned profile. One showed 0→28 XP and a shield; the other stayed at 0 XP under different spawns. A 4.0s portrait short was rendered, but this is independent of the main CLI run. QA flags unsupported level/color wording in the raw model analysis; the output hook/caption omit those claims. Repeatable inputs do not guarantee the same reward.

## Codex account inference (2026-10-06)

`npm run pipeline -- --provider codex --candidates 1` completed a fresh live run at `data/runs/2026-10-07T05-25-56-881Z-2f6231` in about 66 seconds. CLI authentication was verified as ChatGPT; API-key overrides were removed and ChatGPT login enforced. No billing settings or credit purchases were changed.

- Discovery returned 30 candidates; `gpt-5.6-sol` nominated Crowd Pier Run automatically. This game used the previously verified native-input profile.
- A new 12.78-second recording was captured. Codex analyzed timestamped frames at 8 FPS and selected the +10 gate, where the crowd visibly goes from 10 to 20.
- `highlight-d9565e15.mp4` is a 3.23-second 1080×1920 H.264/30 fps silent short. Hook: “Take +10 and double the crowd.” Source frames at 5.0/5.4s verify the before/after counts and +10 animation; the final render preserves the HUD and fits its text.
- Selection, footage analysis and edit selection took 5.35s, 22.54s and 9.45s. Reported input/output token totals were 10,695/122, 128,415/506 and 9,026/69 respectively. These are usage observations, not dollar charges or a promised allowance.
- Completed resume validated/reused the output in 0.81s with no model or capture calls. Run evidence records `codex/gpt-5.6-sol` for the analysis and edit.
- A separate screenshot test correctly transcribed visible Shuriken HUD text. The actual controls learner then produced a valid bounded WASD plan from the saved before/after inspection, with uncertainty about randomized targets; it took 13.329s (11,814 input/441 output tokens). The endpoint initially rejected Zod’s `oneOf` for tagged actions; converting tagged unions to supported `anyOf` fixed the real request while preserving local Zod checks. Model-name probing rejected `gpt-6-sol`; the CLI default and explicit `gpt-5.6-sol` succeeded. Model availability must be tested on the recipient's account.

The resulting Codex-learned Shuriken profile was replayed in **one fresh 16.144-second VP9 capture** with 12 native actions and `actions_complete`. Sampled frames at 1/8/15s show active movement and top XP readings of 6/12/22. The profile remains unverified (one diagnostic attempt); leaderboard score is a separate quantity, and no win or level increase is claimed. Evidence: `data/evidence/codex-provider/learning/{learning.json,capture.webm,capture.json,capture-qa.json}`. No model calls were made during this capture.

Final typecheck and the default suite plus real FFmpeg frame tests passed: **81 passed, zero failures, nine opt-in browser/render tests skipped**. The earlier full browser/render suite passed on this branch; this change additionally passed fresh live capture/render, exact frame-time tests, account-auth refusal tests and independent code review. [GitHub CI for implementation commit `4d1aa5f`](https://github.com/tdschmidt/astrocade-content-workflow/actions/runs/37576892955) passed.

Original recordings, generated decisions, provider timings/token counts and QA images remain under ignored `data/`. No Gemini inference was used for this fresh run. Account creation and publishing remain manual.

## Unseen-game learning test: Astro Runner (2026-10-06)

This test used no existing Astro Runner control profile and no manually written gameplay sequence. The game was operator-selected to test the learner, rather than automatically nominated.

- Pickaxe Swing Escape was attempted first (`data/runs/2026-10-07T05-37-38-020Z-f3b303`). The inspector remained at an intro showing “TAP TO SKIP”; Codex correctly declined to invent gameplay controls. Intro/menu exploration remains a limitation.
- The first Astro Runner inspection (`data/runs/2026-10-07T05-38-24-516Z-c6f5f4`) exposed the visible “DEPLOY ↗” button but did not recognize it as Start. Both screenshots remained at the menu and Codex returned insufficient confidence. The narrow fix recognizes observed `Deploy`/`DEPLOY ↗` labels within the game iframe; it adds no Astro Runner controls.
- Fresh run `data/runs/2026-10-07T05-40-01-270Z-68e048` then clicked the actual start button and captured gameplay context. Codex inferred a bounded 19-action sequence from visible W/A/D, Space, S, 1/2, R and pointer instructions. The original screenshots, proposal, limitations and executed actions are saved.
- The first fresh native capture lasted **11.367 seconds**; an unchanged-profile replay in a second fresh browser lasted **11.390 seconds**. Both completed the sequence. The replay uses no model calls or manual control changes.
- First-run frames aligned with the input trace show a left lane change after A, an airborne pose after Space, a switch from pistol to automatic weapon after Digit2, ammunition use and replenishment after R. The score rises from 6 at 1s to 207 at 11s, while health falls from five to three hearts. The score increase is not attributed entirely to the learned actions: the game also runs forward automatically. No win or optimal play is claimed.
- The independent first-run audit found an extra shot from the automatic focus click and only one additional visible pistol-ammo decrease after three tightly bunched firing taps. Control mapping works, but shot timing/aim are not optimized. Replay QA confirms the same kinds of response in the second run, score 6→197 and health five→three hearts.
- `qa/gameplay-preview.mp4` is a full-recording H.264 preview, not an automatically selected highlight. The original VP9 sources remain under the game directory and `replay/`.

**Assessment:** basic instruction-to-control inference produces visible gameplay and can be replayed. The learner currently proposes a fixed timed sequence; it does not observe mistakes and adapt to current hazards. This test establishes useful control coverage for one additional game, not general autonomous game mastery. The intro-screen failure is retained alongside the successful case.

Validation: typecheck and default suite **79 passed, zero failures, 12 opt-in tests skipped**; the focused learning suite including both real-browser start-label cases **13 passed, zero skips**. [CI for fix `005bed4`](https://github.com/tdschmidt/astrocade-content-workflow/actions/runs/37577618546) passed.

## Gameplay improvement experiments (2026-10-06)

The user asked for better play and interesting content across a couple of games. These were targeted engineering experiments, not a random benchmark or a measured win rate. All production decisions used public UI/screenshots and native inputs. No game scripts, hidden state, artificial pause, or game-clock manipulation were used.

### Car Wash Simulator: improve the timed plan between attempts

- Fresh old-preset baseline: `data/runs/2026-10-07T05-58-04-184Z-842ae2`, 29.397s. Independent frames show **23% dirt, 0% foam, no customer served**. Soap plateaued early while the sequence continued soaping; it stopped short of a completed wash.
- The live-feedback eligibility check rejected this game because its shift timer keeps running while inference takes seconds. This is retained at `data/runs/2026-10-07T05-59-23-049Z-2942e0`.
- A diagnostic script supplied Codex with the prior native action trace, visible instructions, actual cropped footage frames and observed failures. Revision 1 reached **0% dirt and foam**, but a randomized Blue SUV requested polishing and no customer was served. This failure was fed into the second revision.
- Revision 2 and its **exact unchanged-plan replay** produced **Perfect / three stars / Clean 100% / one completed customer** on a Red Sedan and Blue SUV, with 148 and 168 coins respectively. Recordings: **34.398s / 34.453s**. The action profile hash matches between attempts; no manual gameplay was substituted.
- Replaced the shipped preset with the exact model-generated sequence. A third fresh full CLI run, `data/runs/2026-10-07T06-13-11-583Z-a7503b`, repeated the Perfect result on an SUV. Capture: **34.464s**. Its initial automatic edit was truthful but too narrowly focused on the last rinse; the editorial follow-up is recorded below.
- Source evidence and diagnostic script: `data/evidence/gameplay-improvement/carwash-practice/`. The timed practice experiment is distinct from the shipped screenshot-feedback mode: there is no claimed automatic training service. Later customers and every special-request variation remain unverified.

### Sort It Out: observe current state and react

- An independent manual scout established that native drag matching can reach an explicit completed case; scout actions were not used as an agent solution. Fresh boards shuffle items and target positions.
- First feedback setup was too strict: it rejected the visible board because the drag affordance had not already been tested. The revised gate permits a medium-confidence input-paced hypothesis, then enforces exactly one initial probe at most. Every profile remains unverified until real results are inspected.
- First live feedback capture, `data/runs/2026-10-07T06-02-37-765Z-c29438`, reached **14/20** in its 120-second budget. It visibly detected an unsuccessful placement; repeated one-item probing and inference latency limited progress.
- Longer run `data/runs/2026-10-07T06-05-43-998Z-9d2b43` reached **19/20** in 175.065s. Independent video QA identified a concrete error: the 250ms screenshot caught a rejected paper roll mid-snapback. The next action used its transient location after the roll had returned home. Tape and bottle corrections did work. No completion claim was made for this attempt.
- Run `data/runs/2026-10-07T06-08-38-318Z-ce7ede` also exhausted its decision budget short of completion. Learned mechanics had accidentally included a one-item-at-a-time strategy, which conflicted with controller batching. Its edit exposed a separate real frame-sampling failure when the native source briefly changed resolution.
- Fixes: wait one second for input effects to settle; learn mechanics separately from agent pacing; expose remaining action-batch budget; use up to four confirmed matches per batch; preserve before/current screenshots and recent lessons; prevent late inputs and preserve partial footage on later provider failure. The final model call is evaluation-only. Native time always continues normally.
- Fixed run `data/runs/2026-10-07T06-13-34-414Z-bf1466` completed **all 20 matches**. Native source frames show 18 at 124s, 19 at 125s, and **CASE COMPLETE! / PERFECTLY SORTED** at 126–127s. The complete capture is **134.38s**, with seven model decisions. The source advances to the next case during the final model call, so the edit should end on the earned first-case result, not the next empty board.
- An unchanged-profile fresh replay completed a second shuffled board in **141.776s**, with seven decisions. Independent source frames show all 20 slots and the completion banner at 135s. It made one wrong tweezers placement, corrected it, and finished. Exact profile/hash, native input trace and independent QA are in the successful run’s `replay/` directory.
- Feedback reports contain exact screenshots, input actions, outcomes and concise lessons. These are an evidence trace, not hidden reasoning. Success is established by actual footage rather than the controller's self-rating.

### Editorial findings and regression checks

The first updated Car Wash clip showed a truthful rinse reward in 5.1s but omitted most of the transformation. The next edit joined verified soap, scrub and reward phases in 21.33s, but held the Perfect panel for only about 0.33s. Analysis guidance now retains a brief readable earned result after its animation settles. The final editorial rerun uses the same unmodified source; earlier edits remain preserved.

Puzzle editing revealed two independent bugs. The native stream briefly changed resolution, resetting FFmpeg's filter state and overwriting its timestamp sidecar. Disabling filter reinitialization preserved real frame timestamps; a resizing-VP9 regression and the actual failed source both pass. Long-form analysis also sorted dense observations chronologically before taking six, discarding the later completed-case event. It now retains coarse-window priority through the limit, then sorts the selected evidence chronologically. The final edit is rechecked against actual source frames.

Before the final editorial changes, the full browser/media/frame/render integration suite passed **115 tests, zero failures or skips**. After those changes, typechecking passed; the default suite passed **90 tests, with 24 opt-in tests skipped and zero failures**, and the focused editorial suite passed **14 tests**. These are overlapping suites, not additive totals. Coverage includes whole-event selection, chronological captions, overlapping phases without repeated frames, gaps left unfilled, bounds, and retention of the late payoff. [CI for code and repeated-gameplay documentation at 514af8d](https://github.com/tdschmidt/astrocade-content-workflow/actions/runs/37581764639) passed.

Final outputs reuse the unmodified successful recordings; each editorial run retains its source provenance and independent visual audit under `qa/`:

| Game | Final artifact | Verified content |
| --- | --- | --- |
| Car Wash Simulator | `data/runs/2026-10-07-carwash-editorial-v3/highlight-77d430e9.mp4` (24.333s) | Muddy SUV → foam → scrub → rinse → Perfect, three stars, 168 coins. The settled result panel remains visible for about 1.33s. Source cut 0.281–24.629s. |
| Sort It Out | `data/runs/2026-10-07-sort-editorial-v2/highlight-f97f615b.mp4` (5.000s) | Three final placements reach combos 18, 19 and 20, then CASE COMPLETE / PERFECTLY SORTED. Source cut 122.398–127.398s ends on the earned result before the next board. |

The feedback mode is deliberately for slow/input-paced games. These results do not establish reflex-game performance or general puzzle mastery. Failures, partial progress and full success are retained together.

## Changes driven by measured failures

- Loading overlays intercepted Start; bounded actionability checks and displayed frame geometry fixed repeated capture and HUD cropping.
- Multi-pass analysis was slow and sometimes returned incorrect window-relative timestamps. Recordings up to 45s now use one full 8 FPS review with absolute source times and strict bounds.
- Tight impact-only cuts produced a rushed 2.1s edit. Analysis now reports an unobscured playable span separately; code retains up to 2s before and 1s after the impact within that span. The writer selects an event index and cannot trim away its context.
- Model numeric readings and creative captions have been wrong. Numeric uncertainty stays explicit; current highlight captions copy the selected observed outcome plus attribution/link. This prevents another creative paraphrase, but still requires checking the observation against footage.
- Provider control-plan schemas omit wire-level `maxItems` and convert literal `const` to singleton `enum`, while retaining the original Zod limits on decoded output. Malformed or unsupported control proposals do not execute.
- A candidate's invalid analysis formerly stopped the entire batch. Schema/content-validation failures now save that candidate's error and allow other usable footage to proceed; provider/authentication failures still stop the run.
- Completed-run resume formerly retried failed candidates and could require a model key just to reuse output. Regression-tested behavior now validates/reuses completed media, freezes candidate work once a script exists, and reconstructs missing final caption text.

## Verification and practical limits

After a clean `npm ci`, strict TypeScript checks, doctor and the full retained opt-in suite passed: **79 tests, zero failures, zero skips**. This verifies the final trimmed code, including real FFmpeg/layout and browser/capture checks. The earlier larger codebase passed 118 tests before removed features and their tests were trimmed. This branch has no GUI build step.

Browser/media checks use pinned Playwright 1.63.0 / Chromium 153 and FFmpeg 9.0.2 with libass on macOS. They cover native input, recording flush/cancellation, decoded output, unobscured top/bottom game regions, schema/timestamp bounds, provider wire contracts and artifact reuse. Tests use fixtures and temporary data; they do not establish live model accuracy. Reproduce them using [README](../README.md).

Gemini availability is variable: HTTP 503 overload and the test project's HTTP 429 daily free-quota limit both occurred. The observed 20/day allowance is specific to that project/model response, not a promised allowance for every recipient. Explicit retries are limited to HTTP 429/503, three total attempts and a shared 120-second operation deadline, honoring `Retry-After`; saved artifacts allow a later explicit resume. The recipient supplies their own key and model access. Highlights are silent. The simple timed learner deliberately skips uncertain controls and randomized puzzles needing current-board reasoning. Cross-platform native capture and broad game coverage are not yet demonstrated.

GUI/account/publishing/research modules and their dependencies are removed from this branch; the earlier implementation remains on `main`. Manual account creation and upload can use the reviewed MP4/caption; no fresh account or published-post success is claimed here. No additional infrastructure or automatic publishing work is required for this branch's clarified scope.

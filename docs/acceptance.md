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

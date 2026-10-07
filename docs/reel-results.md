# Gameplay reel verification — 2026-10-07

The user requested recognizable gaming absurdity and nostalgia, conversational captions, and a reel of several interesting parts of one game in at most 15 seconds. The earlier 21-video batch demonstrated functional capture/editing; it did not meet this new humor or montage brief.

## Selection

One production `nominateGames` call used the new default brief, auto control mode and a pool of 102 real candidates: the earlier 100-game discovery plus two public-page research candidates. It chose **BEN 10 OPEN World**, **40 Ways to Kill a Zombie**, and **Superheroes vs. Brainrots**. All three were already in the original discovery pool. The user separately required Ben 10; no selected IDs or final captions were injected into the selector. Public-page metadata is not proof of controls, popularity or playable depth.

Local selection evidence: `data/experiments/reels-2026-10-07/selection-runtime-retry/`. The initial sandboxed runtime attempt failed before inference; its successful authorized retry is recorded separately. A garbled fragment in the third nomination's gameplay-family description remains in the original response.

## Failures that changed the implementation

| Test | Observed failure | Correction and limit |
| --- | --- | --- |
| First Ben 10 capture | The agent tried several alien forms and abilities, but its initial tap missed CLICK TO AIM. The central prompt remained over the character. | Target the actual visible affordance, check browser pointer lock, and remember one corrected attempt. Relative camera movement remains forbidden without lock. No game-specific coordinates or concealed overlay. |
| First Ben 10 edit | The exact-shot critic requested 4 FPS, but Codex's adapter accepted only 1, 2 and 8. | Add 4 FPS to the existing finite sampling contract; verify actual JPEGs and decoded times through the adapter. |
| Resumed Ben 10 edit | The critic rejected the ending: the bark form became clear only about 0.501 seconds before its cut ended. Several transformation reveals had also crowded out verified fireball/dash moments. | Prefer distinct demonstrated abilities as dense-window representatives and retain brief real recognition time within verified bounds. Preserve this failed proposal; do not pad its tail or repeatedly reroll its caption. |
| First zombie inspection | A preparation scene was mistaken for ready gameplay; neither learner could establish controls. | An input-free diagnostic observed the method palette appear around 16 seconds. Require visible readiness evidence and use the existing bounded reobservation. A fresh native fixture checks that no guessed input is sent. |
| First zombie edit | Dense analysis and exact-shot review disagreed slightly about the bomb result's clear-state timestamp. The model approved, but the local check found only 0.917 seconds of recognition time. | Target 1.5 seconds of observed state while keeping the one-second final floor. Request fresh analysis in a separate run; preserve the rejected original. |
| Successful zombie comparison | The writer knew the game name, but the critic's prompt omitted it and rejected a title-based joke about 40 methods. | Supply the same game identity plus title provenance, distinguishing the advertised premise from a claim that the reel demonstrates all methods. One ordinary `--from-run` edit verifies the correction. |

The first Ben 10 source and rejected proposals remain in `data/runs/2026-10-07T19-02-08-103Z-b147da/`. The initial zombie rejection remains in `data/runs/2026-10-07T19-06-49-423Z-dd533e/`; its preparation evidence is in `data/experiments/reels-2026-10-07/zombie-loading-probe-02/`.

## Validation

- `npm run check`: **172 passed, 71 opt-in tests skipped**, typecheck passed.
- Real frame extraction plus Codex adapter tests: **16 passed**, no live model calls.
- Final focused editorial suite: **37 passed**; game identity/provenance reaches the visual critic.
- Native post-start help and preparation fixtures: **one passed each** in separate focused runs.
- Real FFmpeg fractional-cut probes: a three-shot 15-second edit rendered at **15.000 seconds**; a six-shot version rendered at **14.966667 seconds**. Neither exceeded the ceiling.

Fixtures verify implementation contracts. Actual gameplay, captions and render review are separate acceptance evidence; model approval does not establish that a joke is funny or that a video will perform well.

## Fresh-run results

| Game | Final hook | Decoded duration | Actual shots |
| --- | --- | --- | --- |
| Ben 10 | the omnitrix gave bro air superiority | **8.10s** | Fiery ascent above the intersection → Fasttrack transformation → Cyclone lifting debris. |
| 40 Ways to Kill a Zombie | 40 ways to disrespect one zombie | **13.33s** | Acid exposes a skeleton → bomb scatters the body → fire leaves a scorched, slumped state. |

Both are three-shot H.264 portrait videos at 1080×1920, 30 FPS. Source and output hashes match the run manifests. Phone-size opening frames and two-samples-per-second contact sheets were inspected for readable text, visible effects, shot changes and endings. These are separate gameplay moments, not arbitrary splits of one action. No cut timestamps or final hooks were injected manually.

Ben 10's fresh source is **175.03 seconds**, from `data/runs/2026-10-07T19-22-06-001Z-ec5ce4/`; its normal edit produced `highlight-13798f2e.mp4`. The controller confirmed camera engagement across mode changes, explored Heatblast and Fasttrack, and moved through the city. Dense video review found transient flight and a projectile that slower feedback screenshots had missed. No enemy hit or combat victory was established. The native CLICK TO AIM prompt briefly returns during the transformation/menu shot; the flight and Cyclone shots are clean. This remains a visible polish limitation.

The successful zombie source is **175.04 seconds**, from `data/runs/2026-10-07T19-15-45-196Z-b9a7a1/`. The agent learned from an ineffective target tap, discovered dragging the spawned weapon, and applied different tools. The footage confirms three completed methods (sword, bomb, acid); fire visibly scorches but is not presented as another completed kill. The ending of the source shows the acid completion after the final feedback screenshot, illustrating why editing reviews the whole recording.

Zombie recovery is explicit: `data/runs/2026-10-07-zombie-reanalysis-01/` references the unchanged recording and requests new analysis after the timing-guidance fix. The helper and `reanalysis-request.json` record this developer-directed retry; it is not automatic recovery. The ordinary CLI then produced a **12.60s** comparison reel with “who built a whole zombie ragdoll laboratory.” Its original failed source-run manifest remains byte-for-byte unchanged. After repairing the critic's missing game context, an ordinary `--from-run` edit reused this analysis and produced the selected **13.33s** version in `data/runs/2026-10-07T19-37-26-438Z-ccfacf/`, with `highlight-b18bf673.mp4`. The existing single shortening repair removed filler from an approved hook to fit three lines; its number, subject and premise stayed fixed.

The local gallery is `data/experiments/reels-2026-10-07/final-videos.md`; `final-manifest.json` records all three successful renders, hashes, source paths and exact cuts. The selected Ben 10 cuts are 96.896–100.130, 118.895–122.011 and 141.261–143.028 source seconds. The selected zombie cuts are 165.630–171.800, 140.500–144.143 and 68.780–72.380 seconds. Their nonchronological order is a montage, not a continuous streak. Final media duration can differ slightly from the requested sum because source frames are quantized.

The Ben 10 hook is the stronger cultural reaction; the zombie hook now preserves its game-specific advertised premise. This is an editorial assessment, not user approval or measured audience performance. Both videos remain silent. Publishing is manual, and no new account, GUI, publishing service, retry framework or video-generation service was added.

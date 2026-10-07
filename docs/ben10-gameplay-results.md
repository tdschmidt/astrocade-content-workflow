# Ben 10 gameplay improvement — 2026-10-07

The user rejected the previous 8.10-second reel: it showed effects but too little actual gameplay. The revised goal is to learn and use several game features, explore before editing, and produce a coherent gameplay reel of at most 15 seconds. The scope remains the CLI workflow; publishing is manual.

## What failed

The earlier source (`2026-10-07T19-22-06-001Z-ec5ce4`) lasted 175.03 seconds but contained only 8.01 seconds of completed requested keyboard holds and 121.23 seconds of completed decision inference. The controller could not combine movement and flight, used tiny movement fragments, and judged abilities only after they ended. It incorrectly dismissed visibly successful flight. About 38% of the final 8.10-second edit was selection/transformation footage.

These measurements distinguish declared input time from active gameplay: holding a key can produce an ineffective move, while an effect can continue after release. They are diagnostics, not a quality score.

## Iteration 1: better controls, weak exploration

Normal CLI capture: `2026-10-07T20-05-22-590Z-3e1980`, source **600.042 seconds**. The revised runner sampled frames during actions, supported simultaneous controls, and preserved the source on budget expiration. Nineteen decisions completed, with 83.70 seconds of requested keyboard holds, 4.15 seconds of requested relative look, and 441.962 seconds of completed decision inference. The final call was canceled by the recording budget and is excluded from that completed-call total.

Raw-source review confirmed street travel, Fasttrack's elevated city traversal, Diamondhead's crystal wall/blades, and Wildvine's moving burrow state. It also exposed three failures:

- Several unknown ability inputs in one batch made their effects difficult to attribute.
- Verbose responses took up to 28.658 seconds, close to the 30-second deadline.
- Late exploration lost a destination and repeatedly ran over empty ground, incorrectly labeling motion as route progress. Heatblast flight was never tried.

This source is retained as comparison evidence, not accepted as competent exploration. A native regression of 40 mouse turns past every viewport edge reproduced the requested deltas exactly, ruling out the suspected pointer-origin clipping issue. The correction therefore focuses on observable goal progress, camera recovery, and choosing documented, untried mechanics.

## Iteration 2: focused learning

Fresh normal CLI capture: `2026-10-07T20-17-46-165Z-8db772`, using commit `e6f8028`. It uses compact feedback, one new mechanic per probe, and reorientation before more travel when a destination is lost. Early decisions averaged about 13 seconds instead of the first iteration's 23.3 seconds. The agent correctly retained jump success from a DURING frame after NOW showed a landing, selected Heatblast from its visible dial label, corrected one missed aim-engagement tap, and separately observed a fireball without claiming a target hit.

The source finished at **431.832 seconds** after three consecutive no-progress observations, with 24 completed decisions. It contains 39.32 seconds of requested keyboard holds and 4.45 seconds of requested camera movement. Completed decision inference totaled 342.690 seconds, averaging 14.28 seconds with a 17.689-second maximum. These are measured run values, not latency guarantees.

Raw-source review confirms a separate fireball launch around 201.45–202.20 seconds, sustained lift around 219.2 seconds, and combined forward flight over city blocks around 240.5 and 283 seconds. After approaching an elevated roadway, the agent landed elsewhere, stopped forward travel, searched in place, and eventually stopped. It did not complete that route or demonstrate a combat hit. Its compact memory also forgot earlier punch/kick demonstrations; the no-progress guard prevented a redundant final probe. Useful gameplay coverage is established; complete game mastery is not.

## Editorial iteration

The first normal edit produced an **11.50-second** two-shot flight/walking reel. Its 1 FPS scout overlooked the brief fireball, so the revised analyzer uses saved action-time observations as candidate-search hints while keeping independent 8 FPS verification. This repairs selection of the interesting footage already captured, rather than recapturing or inserting a hand-picked cut.

A separate development run, `2026-10-07-ben10-action-hints`, requests new analysis of the unchanged source. Its `reanalysis-request.json` records the original manifest/source hashes and the reason for reanalysis. Independent dense review confirmed the fireball, producing a **15.00-second** three-shot flight/fire/walking reel within the existing review budget. The original completed run remains unchanged. Future fresh pipeline runs receive these hints automatically; legacy sources without action frames still use visual scouting.

Both early hooks were truthful but weak: “bro they made Ben 10 open world and let him fly” was a feature announcement, and “Ben 10 open world really lets bro commute like this” defaulted to a canned metaphor. The shared writer/critic policy now favors a natural comic viewpoint, specific absurdity, or nostalgic contrast over listing the most verified features. An ordinary `--from-run` edit reuses the accepted analysis to test that preference without another capture or manually supplied copy.

That edit also exposed a numeric boundary bug before rendering: the model returned `28.749` for a verified event starting at `28.749000000000002`. Both the general containment check and the reel's referenced-event check now allow only one nanosecond of numeric roundoff. Source limits and overlap checks remain exact. A regression replays the rejected three-cut proposal and checks that actual unverified footage remains rejected. Normal resume then rendered a **14.30-second** three-feature reel, confirming the runtime fix. Its “peak nostalgia” hook was still generic praise, so the final comparison makes the writer and critic explicitly prefer a comic viewpoint among supported alternatives. Each attempt remains saved; this is development iteration, not a claim that every generated caption meets the desired taste.

## Selected rendered result

The final ordinary source-reuse edit is **11.80 seconds**, three shots: fireball → powered takeoff → sustained city flight, descent and landing. It demonstrates two real features; the two flight shots preserve ascent and traversal around an obstructed source interval, rather than inventing a third feature. The slower walking shot is omitted. The workflow chose the cuts and caption without manually supplied timestamps or final copy.

Hook: **“who gave Ben 10 a whole voxel city”**. This is closer to the user's conversational disbelief examples than the earlier feature announcements. It is a mild premise reaction, not proof of audience performance. The posting caption remains an expression of nostalgic investment, with exact game attribution appended.

| Artifact | Value |
| --- | --- |
| Run | `2026-10-07T20-51-39-261Z-7f7493` |
| Video | `highlight-16a15642.mp4` |
| Format | H.264, 1080×1920, 30 FPS, silent |
| Source cuts | 201.159–203.726; 237.823–239.323; 239.841–247.590 seconds |
| Source SHA-256 | `9a6a00c29153a771ead7a2c2a667c2b8d8369f985b62965988f057ecba87b4d1` |
| Video SHA-256 | `9ee86a91ab606e8c41e617a463420fcedfadab001313b0452ab0a8af2afae386` |

Actual rendered frames were checked at phone size across the fireball, cuts, ascent, flight and final landing. The temporary two-line hook is legible and clears before sustained flight; it briefly overlaps the edge of the projectile effect without obscuring the action. Ascent passes a building beam and cuts before serious occlusion. No form menu or CLICK TO AIM prompt is shown. The roughly half-second omitted interval between flight shots is an honest edit; neither copy nor evidence claims uninterrupted timing. Requested cut durations sum to 11.816 seconds; actual encoded frames measure 11.80 seconds.

The local gallery `data/experiments/ben10-exploration-2026-10-07/final-videos.md` includes the selected reel and all three successful comparison edits. `final-manifest.json` records paths, cuts and verified media hashes. The original completed source-run manifest still matches the hash recorded before reanalysis. The final run's `report.md` and `trace.jsonl` retain decisions, returned proposals and the exact visual review. Detailed source and render critiques live beside the gallery.

This fulfills the bounded gameplay-reel goal: explore first, verify actual features, then edit a few understandable actions. It does not establish combat success, reliable route planning, reflex play, or complete knowledge of every form. No video was published.

## Implementation verification

- `npm run check`: **192 passed, 75 opt-in tests skipped**, typecheck passed.
- Native input and runner fixtures: **32 passed, none skipped**, including simultaneous keys, transient frames, cleanup on cancellation, optional screenshot failures, and 40 relative camera turns beyond viewport boundaries.
- Actual FFmpeg extraction and Codex adapter tests: **16 passed, none skipped**, including exact 4 FPS review and 8 FPS source windows; these tests make no live model requests.
- Focused editorial tests: **46 passed**, including the reproduced decimal-boundary proposal and strict rejection of real gaps, overlaps, and source overruns.

The code review also found that a whitespace-only optional feedback observation could pass the loader and later fail analysis. The loader now trims and skips it with the existing warning; source-reuse tests cover that path. Optional search evidence must not make an otherwise valid recording unusable.

## Reproduce and inspect

```sh
npm run pipeline -- --provider codex --play feedback --capture-seconds 600 --stage capture --game https://www.astrocade.com/games/ben-10-open-world/01M32NFPAH709Z7CT0YXSTM73W
npm run pipeline -- --resume data/runs/RUN_DIRECTORY --stage edit
```

The run contains the original recording, observed help/controls, actual input trace, timestamped action screenshots, concise mechanics/decision reports, analysis, and edit proposals. Local independent QA is in `data/experiments/ben10-exploration-2026-10-07/`. No native gameplay was injected manually and no game code, hidden state, or game clock was altered.

The design changes and rationale are recorded in D131–D137 of [design-decisions.md](design-decisions.md). Test results are implementation evidence; the source and rendered reel remain the acceptance evidence.

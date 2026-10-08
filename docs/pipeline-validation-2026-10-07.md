# Integrated pipeline validation — 7 October 2026

The deliverable is a local CLI that captures native Astrocade gameplay and produces agent-planned portrait videos. GUI, Instagram uploading, account/email setup and the background job queue have been removed from the active code. Existing recordings and unrelated task files were preserved.

## Integration boundary

Both referenced tasks were read before relying on their work. The editing prototype was allowed to finish before its package was integrated. Its last completed clarification was at **23:20:43 UTC on 7 October 2026**, task `01a11815-c893-7952-add3-2c520bfda11b`; a subsequent status check found the task idle with no newer revision. Commit `0779585` snapshots the completed package, and `98f23ae` incorporates that final ending clarification.

The main `npm run pipeline` command now supports:

- **Meme:** 15–25 seconds, genuine catalog music, observed payoff, optional short aligned freeze, and at least four seconds after the main phonk drop including two seconds of moving aftermath.
- **Overview:** roughly 30–45 seconds explaining premise, choices and appeal, with an evidence ledger, ranked hooks, independent script review, synthesized speech and recognition of the actual waveform.
- **Story:** roughly 35–60 seconds of sourced narration over independently verified progressing gameplay. Repeated failed runs do not qualify as progression after cutting out deaths.
- **Legacy:** explicit reproduction and resumption of historical silent edits.

Every chosen candidate is produced by the main pipeline. Reviewed source windows and editorial feedback are inputs to the agent; none of the final cuts was manually authored. Source files, failed attempts, generated plans and intermediate evidence remain on disk.

## Whole-pipeline exercise

Two new runs exercised inspection, native control, capture, source analysis, agent editing and final rendering:

| Game | Native recording | Run and result |
| --- | --- | --- |
| Kick the Buddy × Iron Golem | 600.03 seconds | `data/runs/2026-10-07T23-13-56-562Z-877be0`; 17.70-second meme candidate. Source includes a native drag/fling, anvil damage, Creeper explosion, Skeleton arrows and earned gems. The selected Sword icon does not prove that the opening fling is a sword attack. |
| Ben 10 Open World | 600.01 seconds | `data/runs/2026-10-07T23-14-21-798Z-791881`; initial completed edit, followed by a feedback-driven revision in `2026-10-07T23-44-19-205Z-c416d5` lasting 21.50 seconds. Choice, transformation, flight, speed and cyclone are visible; no combat win is claimed. |

The Iron Golem run resumed saved source/analysis after bounded provider failures and a renderer correction. The Ben 10 revision reuses unchanged source through `--from-run`. These are recovery paths inside the CLI, not a separate manual video workflow.

A new 563.86-second Junkyard capture additionally demonstrated scrap earnings, purchases and partial vehicle assembly. It completed in the native feedback loop, and its final edit also came through the main CLI. Earlier weak Pizzeria footage was replaced rather than relabeled.

## Repairs found by real use

| Observed failure | Change and evidence |
| --- | --- |
| Cropped Chromium screenshots shifted subsequent cross-origin clicks. | Capture the full viewport, then crop pixels locally. Native cross-origin, high-DPI, concurrent sampling and original HTML-feedback regressions passed without changing input coordinates. |
| Input seeking and timestamp rebasing advanced sparse source frames. | Retain keyframe pre-roll and sample the original source clock before trimming. Actual sparse-source tests verify held frames, speed changes, freezes and exclusion of the following scene. The real quiz source confirmed the original half-second early-answer error. |
| Source dimensions changed during a recorded page transition. | Preserve the source clock through decoder geometry changes and normalize prepared footage to its probed dimensions. An actual changing-resolution VP9 fixture tests both picture geometry and transition timing. |
| AAC encoding overshot a sample limiter. | Measure the encoded file, apply a bounded whole-track gain correction only when necessary, then remeasure. Regression checks preserve decoded video and timing. The −1 dBTP acceptance gate remains intact. |
| Copied AAC priming packets at clip joins truncated the quiz ending. | Restore a continuous sample clock before mixing, compensate limiter latency and preserve exact output duration. The actual two-clip encode/decode regression verifies sample count, uniform packets and a quiet final fade. Earlier selected candidates received a separate endpoint audit. |
| Native game sounds accumulated delay at repeated short cuts. | Keep temporary audio lossless in MOV containers and encode AAC at final delivery. At exactly 1×, bypass unnecessary tempo processing. A complete render with six synchronized flashes/sounds failed before this fix and now keeps sounds within 10ms and pictures within one frame. All selected meme sources lack native audio, so their checked outputs were unaffected. |
| Narration recovery could confuse old prepared pictures with corrected source timing. | Version preparation caches and evidence by code hashes, preserve source selections/script/WAV, and require fresh corrected pictures plus independent review. |
| Speech recognition split fictional proper names. | Retry recognition once with a bounded vocabulary of names already in the exact script, against the same saved WAV. Original failed recognition remains preserved. No replacement speech or edited transcript bypasses validation. |

## Review artifacts and limits

**Eleven selected candidates** cover the eight categories plus a narrated Ben 10 overview, a sourced Venus story and an additional fresh Golem edit. Exact runs and durations are listed in [the checkpoint](../CHECKPOINT.md). The overview is 36.1 seconds; the story is 37.5 seconds and preserves the full narration with a short ending tail. The story's independently verified background includes medical-case completion and subsequent beauty-case progress. A minor recognition insertion (“opposite it to Earth”) remains visible in one caption and is disclosed in its QA.

The local gallery is `data/experiments/pipeline-review-2026-10-07/index.html`; its `candidates.json` verifies each selected video's SHA-256 against the completed pipeline run and links its plan and QA report. Media, model artifacts, speech models and audio binaries are ignored local data, so they are not present in a fresh GitHub clone.

Picture/source checks and measured audio are documented for each selected result. They are not a human listening review, evidence of musical phrase resolution, or audience-performance proof. Preview-only music/effect restrictions remain in render metadata. Nothing was uploaded or published.

The controller is suitable for input-paced games and bounded exploration. Model latency still limits reflex play. Long captures do not prove completion; the category notes retain unachieved outcomes and rejected attempts.

## Verification

- The full opt-in native browser/media suite passed **317/317** after the input-coordinate repair. Later changes were confined to editing and preparation; the native suite was not misrepresented as testing those later changes.
- Strict core and editorial TypeScript checks pass with unused locals/parameters rejected.
- Final editorial checks passed **58/58**, including real FFmpeg regressions for sparse timestamps, speed/freeze behavior, changing source geometry, encoded AAC peaks, delayed sound effects and native sound/picture synchronization. The targeted legacy-render suite passed **13/13** after the source-clock correction.
- GitHub Actions passed commits `22c4e05` and `5e62aff`, including mandatory media regression tests. Final branch checks are available in [GitHub Actions](https://github.com/tdschmidt/astrocade-content-workflow/actions?query=branch%3Acodex%2Fcore-workflow). A Linux decoder exposed the final partial AAC packet as padding; the revised test still requires every intended sample and measures the fade before that padding.

The branch is [`codex/core-workflow`](https://github.com/tdschmidt/astrocade-content-workflow/tree/codex/core-workflow). Work was committed and pushed incrementally rather than left as one unreviewable working-tree change.

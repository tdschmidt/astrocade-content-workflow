# First agent-edited previews

[Open local review gallery](../../data/experiments/troll-editor/review.html).

| Preview | Actual edit | Agent execution | Render checks |
| --- | --- | --- | --- |
| [Archer: Gravity gets the last shot](../../data/experiments/troll-editor/renders/archer-troll-v1.mp4) | **4.8s**. Brief slowed arrow setup, hit freeze in grayscale with face/drop, clean full fall and real Victory result. | Existing `CodexServices`, CLI model setting `default`; completed in 31.740s from 30 source images at requested 8 FPS. First response passed validation. | 720×1280, H.264/AAC, 30 FPS; full decode passed; measured -16.01 LUFS and -1.51 dBTP. |
| [Zombie: He is probably fine](../../data/experiments/troll-editor/renders/zombie-fail-v1.mp4) | **8.0s**. Fuse setup, record-stop/grayscale anticipation, brief deep-fried explosion reaction, clean ragdoll/counter aftermath. | Existing `CodexServices`, CLI model setting `default`; completed in 28.209s from 58 source images at requested 8 FPS. First response passed validation. | 720×1280, H.264/AAC, 30 FPS; full decode passed; measured -15.48 LUFS and -4.00 dBTP. |

These are separate actual inference calls using the saved editorial system and style prompts, not manually selected cut plans passed off as model responses. Exact requests, source timestamps/hashes, completed provider events, generated drafts, plans and timeline validation remain in [Archer's run](../../data/experiments/troll-editor/archer-troll-v1/request.json) and [Zombie's run](../../data/experiments/troll-editor/zombie-fail-v1/request.json). Copied plans and compact hash/event provenance are in [examples](examples/agent-run-provenance.json). No hand changes were made to the generated plan contents, and neither needed the one allowed automatic semantic repair.

Source choice was revised after comparing five recordings. Archer's ledge fall and Zombie's explosion supply clearer visual consequences than Crowd Pier Run's arithmetic change and plain running. The [selection rationale](source-selection.md) documents the alternatives. Neither clip claims actual Minecraft/Roblox gameplay, multiplayer revenge, or a troll action absent from the source.

The editing agent and parent independently inspected rendered contact sheets. The editing agent also inspected the Zombie effect boundary at 8 FPS. Both preserve causality, important HUD text, and clean final outcomes; no blocking visual defect was observed. The local browser loaded both gallery videos with their correct dimensions/durations. Five renderer tests passed, and the experimental agent and renderer were typechecked.

This is **sampled visual and technical QA, not a completed listening review or audience test**. Archer's opening three-word caption is brisk at 0.8s, and Zombie's face is deliberately brief at about 0.27s. The user should judge musical feel and gag timing from playback. The music beds and cues are original synthesis, and the face is newly generated. Exact songs for the user's two Instagram references were not identified; the [research](research/style-research.md) separately documents named style references and evidence limits.

The original source files and main pipeline remain unchanged. The initial Golem/Crowd attempts and their permission errors are retained separately; the selected successful calls ran only after the user explicitly approved using Codex for the edits. No videos have been published.

The user's specific reel-observation note was added to the reusable prompt bundle after these v1 calls. Saved `prompt.txt` snapshots, rather than the latest prompt file contents, are authoritative for reproducing what those calls received. See [integration notes](integration.md) before moving the experiment into the production workflow.

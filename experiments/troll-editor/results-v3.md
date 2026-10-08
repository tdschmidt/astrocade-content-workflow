# Longer troll-edit results — current delivery

Final videos:

- `data/experiments/troll-editor/renders/golem-troll-v3.mp4` — 21.60 seconds. Three different observed tumbles/collisions, then a real-frame grayscale hold with the reaction face on the golem head. Real bonk, metal pipe, Vine boom and Alex-Productions phonk. Music begins at output 2.46s; its selected source energy-rise anchor arrives at the freeze at 17.30s.
- `data/experiments/troll-editor/renders/zombie-fail-v4.mp4` — 19.37 seconds. Flame reaction, then a later bomb setup/explosion and disposal aftermath. Real record scratch, Vine boom and phonk, with music from output 0s. A brief grayscale hold carries the face on the actual tilted head; moving footage contains no face overlay.

These are actual editorial-agent plans, not manually authored edit lists. Requests, prompts, timestamped source frames, raw responses and validations are retained in `data/experiments/troll-editor/golem-troll-v3/` and `zombie-fail-v4/`. The original short Archer/Zombie v1 previews and intermediate revisions are preserved.

## What changed after the first previews

The winning Archer source lasts only 8.166 seconds, while the other Archer take mostly contains an unresolved miss. Golem was selected for a meaningful longer montage instead of stretching idle footage. Zombie combines two distinct, chronological actions from its existing recording. Real downloaded catalog sounds replaced the procedural demonstration tracks. Freeze head boxes replaced scenery stickers. The renderer composites attached faces before camera shake, so they stay together. A real music lead-in fills Golem's former long silent opening; sound cues duck the music. Platform side/footer chrome is cropped without adding game-name watermarks.

The final Zombie revision only trims the end of the last clip from source 146.977s to 146.877s. All earlier segments, face coordinates, captions and audio are unchanged. Dense tail review shows remains dropping through a disposal floor and a clear chamber; the earlier suggestion that the flying head was a new specimen was not supported. The delivery ends on the clear chamber and visible counter 02.

## Verification

Eight renderer tests and strict experiment TypeScript checking pass. Both final files decode fully, use H.264/AAC at 720×1280/30fps and stereo48kHz, and pass duration/true-peak checks. Actual measured loudness is −11.90 LUFS / −1.52 dBTP for Golem and −13.79 LUFS / −1.44 dBTP for Zombie; the loudness target is not claimed as an achieved exact value.

Full-resolution frames before, during and after each freeze show the face on the actual head, moving with the shake and disappearing before regular motion resumes. Whole-edit contact sheets preserve setup/action/consequence and readable HUD. No added game-name watermark appears. Final evidence and machine-readable review live in `data/experiments/troll-editor/evidence/final/`. Listening quality and audience preference are not claimed from waveform measurements or visual QA.

## Provenance and reuse

Audio catalog: `experiments/meme-audio/catalog.json`. It preserves file hashes, original pages/download URLs, measured trims, creator attribution, and asset-specific reuse restrictions. Soundboard SFX remain local-preview assets; downstream publishing rights are not asserted. The phonk is an actual creator track; its drop anchor is a machine-measured energy candidate, not an identified song from the user's Instagram reference.

Face asset: `experiments/troll-editor/assets/reaction.png`; original image-generation prompt/provenance: `reaction-provenance.json`. This is the original generated troll-like graphic, not a claimed canonical licensed meme drawing.

See `RENDERER.md`, `schema.ts`, `edit-plan.schema.json` and `revised-agent.schema.json` for the stable renderer contract. No main pipeline files or Git commits were changed in this revision task.

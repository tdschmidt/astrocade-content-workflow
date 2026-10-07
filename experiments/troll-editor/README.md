# Current revision: story-led climax timing

The current revised deliverable is Zombie v6 in `data/experiments/troll-editor/renders/`. Its agent ranks observed moments, reserves the main music/visual drop for the actual bomb rupture at output 15.10s of an 18.70s edit, then shows the short readable consequence. The former fire reaction is restrained setup. Real catalog meme SFX/phonk, a freeze-only head attachment, and off-screen credits remain in use. Platform footer chrome is cropped; no game-name watermark is added. Golem v3 and earlier Zombie versions remain comparison baselines, not newly corrected edits.

See `research/climax-timing.md` for online skill references and the revised editorial process; `RENDERER.md` for the opt-in narrative beat declaration, music lead-in/ducking and freeze attachment behavior. `results-v3.md` records the earlier baseline verification; `results-v6.md` records this correction. The real-audio catalog is in `../meme-audio/catalog.json` with asset-level provenance and rights notes. Soundboard SFX are local previews; publication clearance is not implied.

Generated demonstration WAVs and downloaded source audio are not committed. Recreate the optional legacy sounds with `node experiments/troll-editor/tools/make-audio.mjs`. For catalog edits, acquire the selected files from the catalog's recorded source/download URLs into their `relativePath` locations, then run `python3 experiments/meme-audio/build-catalog.py` to verify files and refresh local absolute paths. Keep the saved license restrictions and attribution with the resulting edits. The reaction PNG and its provenance are included.

The following initial-experiment notes are historical and describe the preserved v1 samples.

---

# Gameplay meme editing experiment

An isolated editing package for the existing Astrocade recordings. The main pipeline is unchanged. An editorial agent chooses cuts, effects and sound timing in a constrained JSON plan; a deterministic FFmpeg renderer executes that plan. The Minecraft/Roblox references describe an editing style, not the platform used to capture these sources.

The first two agent-generated previews are ready in the [local review gallery](../../data/experiments/troll-editor/review.html): [Archer — troll freeze, 4.8 seconds](../../data/experiments/troll-editor/renders/archer-troll-v1.mp4) and [Zombie — ironic deep fry, 8.0 seconds](../../data/experiments/troll-editor/renders/zombie-fail-v1.mp4). [Results and verification](results.md) record the actual provider runs and review limits. These are previews for user judgment, not a claim that either style is audience-tested.

## Package

- `prompts/system.md`: reusable evidence-first editorial instructions, causal timing, overlay safety, sound policy and self-check.
- `prompts/reference-guidance.md`: observations from the user's two reference reels; added after the v1 sample calls, with their original request snapshots preserved.
- `styles/troll-freeze.md`: grayscale impact hold, reaction face, bass arrival, clean outcome.
- `styles/ironic-fail.md`: confident setup, record-stop, short deep-fried interruption, partial recovery.
- `styles/velocity.md`: compressed approach, brief slowdown, synchronized impact, clean continuation.
- `research/style-research.md` and `research/sources.json`: linked reference evidence, named soundtrack examples and limits of the research.
- `agent.ts`: saved prompt runner using the project's existing `CodexServices` and signed-in CLI default model.
- `schema.ts`: closed edit language and deterministic timeline validation. No model-supplied shell or filter expressions.
- `examples/*.job.json`: source windows and briefs, including the selected Archer/Zombie pair and retained Golem/Crowd alternatives.
- `source-selection.md`: actual comparison of five recordings and the reasons Crowd was replaced.
- `render.ts`: FFmpeg execution and inspection artifacts (see renderer notes below).
- `RENDERER.md`: rendering CLI, schema semantics, audio alignment and verification.
- `integration.md`: boundaries and the path to adding the experiment to the main workflow.
- `tools/make-audio.mjs`: reproducible demonstration beds and sound effects.
- `tools/make-gallery.mjs`: local side-by-side review page builder.

Music in the preserved v1 previews is synthesized demonstration audio. Commercial song names in the research are references, not included music files or claimed licenses. The reaction face is an original substitute for the familiar trollface, rather than an extracted creator asset.

The two sample plans are copied without editorial modification to `examples/archer-troll.plan.json` and `examples/zombie-fail.plan.json`. `examples/agent-run-provenance.json` records completed provider events, frame counts and hashes. They contain absolute source paths for this local workspace; retain the job briefs and recordings when transferring the package.

## Run the editorial agent

Run from the repository root with its dependencies installed, FFmpeg/FFprobe available, and Codex CLI signed in with ChatGPT:

```sh
node --import tsx experiments/troll-editor/agent.ts \
  --job experiments/troll-editor/examples/archer-troll.job.json \
  --out data/experiments/troll-editor/archer-troll-new

node --import tsx experiments/troll-editor/agent.ts \
  --job experiments/troll-editor/examples/zombie-fail.job.json \
  --out data/experiments/troll-editor/zombie-fail-new
```

The `--out` directory must be new. A job uses a source path relative to the repository root or an absolute path; the saved plan always uses the resolved absolute source path. The agent sees at most 120 timestamped source frames. The existing provider adds its own tool-free, evidence-only instructions; the saved editorial system/style bundle is supplied in that request. It is not a new configuration of the main pipeline's provider.

Every run keeps its exact instruction bundle, job and hashes in `prompt.txt`/`request.json`, actual sampled source JPEGs and timestamps in `source-frames/`/`frames.json`, returned draft(s), inference events, and either `plan.json` plus `validation.json` or an explicit error. Semantic validation can request one complete model repair; it never silently edits the model's choices. Transport/schema failures are saved as errors rather than treated as a valid plan.

For a reviewed revision, pass a text file explaining the observed problem and use a new output directory:

```sh
node --import tsx experiments/troll-editor/agent.ts \
  --job experiments/troll-editor/examples/archer-troll.job.json \
  --out data/experiments/troll-editor/archer-troll-revised \
  --feedback /absolute/path/to/review.txt
```

The first Golem/Crowd planning attempts encountered a runtime sandbox failure and an automatic approval rejection of frame transmission. The user then explicitly approved using Codex for the edits and requested a better source comparison. Failed Golem/Crowd attempts remain preserved; subsequent selected-source runs use that approval. A successful sample must have a completed provider event and a validated `plan.json`; an error-only directory is never a claimed agent output.

## Review gate

Watch the actual render with sound. Inspect dense source and rendered frames around every freeze, drop and gate/impact; the 1–8 FPS planning sample alone does not prove frame-exact contact timing. Check the beginning at phone size, the exact reaction beat, clean consequence, and final frame. Verify HUD and gate labels stay visible, overlays do not cover the action, the loudest mixed sound has headroom, and text is readable for its full hold. A technically valid JSON plan is not editorial acceptance.

If the wrong event frame was selected, a counter is obscured, music arrives late, or the story cannot be understood, describe that evidence to the editorial agent through `--feedback`. Preserve prior plans/renders, generate a new revision, render and review again. Do not manually repair the sample while claiming autonomous selection.

## Source selection

`archer-troll`: source 3.03–6.9 seconds from `2026-10-07T09-52-40-893Z-ab7d60`. Actual frames show arrow flight, contact, an opponent tumbling off the platform, and a genuine Victory/+90/three-star result. No revenge, real multiplayer opponent, or flawless win is claimed.

`zombie-fail`: source 138–145.2 seconds from `2026-10-07T19-15-45-196Z-b9a7a1`. Actual frames show the fuse, bomb explosion, ragdoll scattering and specimen count 01→02. The ironic failure is the zombie's situation; it is not a failed player action. Both original recordings are silent 720×1280 portrait WebM files. Existing captions/narration exports are not used.

Golem and Crowd job briefs remain available as alternatives. Crowd was deprioritized because its small arithmetic change and plain running are less visually forceful than a ledge fall or explosion. Ben 10 flight is an optional future velocity comparison, not a troll encounter. See `source-selection.md` for the inspected windows and limits.

The repository stores code, research, prompts and job briefs. Source recordings, sampled frames, rendered MP4s and review evidence are local artifacts under ignored `data/`. Neither planning nor rendering publishes anything.

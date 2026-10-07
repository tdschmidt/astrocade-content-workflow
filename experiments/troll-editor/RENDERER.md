# Deterministic troll editor renderer

The editorial agent chooses the story, clips, timing, captions, real audio, and an observed character head. The renderer executes a closed JSON edit plan with FFmpeg. It does not execute agent-supplied shell/filter expressions or publish anything. The main pipeline is unchanged.

```sh
node --import tsx experiments/troll-editor/agent.ts --job experiments/troll-editor/examples/golem-troll-v2.job.json --out NEW_AGENT_DIRECTORY --feedback experiments/troll-editor/examples/golem-v2-review.txt
node --import tsx experiments/troll-editor/render.ts PLAN.json NEW_OUTPUT.mp4
node --import tsx --test experiments/troll-editor/render.test.ts
```

`schema.ts` is authoritative. `edit-plan.schema.json` exports the complete local validation schema; `revised-agent.schema.json` exports the required-field catalog contract used for Structured Outputs. The separate fully specified agent schema prevents optional properties from causing provider schema rejection. Legacy plans still validate locally. Existing output videos/manifests are never overwritten.

## Revised sample behavior

Revised jobs target 15–25 seconds of meaningful setup, action and payoff, or distinct observed escalation. They do not lengthen an eight-second source by padding idle frames. They may cut forward between multiple observed windows; chronology and source bounds are checked. Agent request files, prompt hashes, actual sampled frame times, responses and validation evidence are retained. No game-name captions, watermarks, logos or title cards are added.

Output is H.264/AAC MP4 at 720×1280, 30 fps and 48 kHz stereo. Portrait video fits without a crop by default; an explicitly reviewed `sourceCrop` can remove platform chrome. Landscape footage fits over a blurred background. Segment zoom may crop the HUD; revised jobs use zoom 1. Source audio, if present, remains at −15 dB; these sample recordings are silent.

## Plan clocks and visual effects

Clip `start`/`end`, freeze `at`, and crop coordinates refer to the source. Captions, sound cues, punches and music `dropAt` refer to output time. Each segment duration rounds to the nearest 1/30 second; the manifest records exact source→output mapping. `clean`, `bw`, and `deepfry` are bounded built-in treatments. Slow motion uses actual frames, not synthesized action. Captions must be short, readable, and nonoverlapping in the same screen position.

`faceAttachments` replace floating stickers for every catalog revision:

```json
{
  "segmentIndex": 4,
  "asset": "reaction",
  "coordinateSpace": "output-pixels",
  "headBox": {"x": 127, "y": 752, "width": 61, "height": 46},
  "scale": 1.18,
  "rotationDegrees": 0,
  "evidence": "Observed source head bounds and the crop/zoom coordinate conversion."
}
```

The indexed segment **must be a freeze**. The box describes the actual head in that exact frame after the declared crop/zoom, not a convenient region of scenery. The face exists only for that freeze's duration and is composited before camera shake, so both move together. Moving-character overlays would need tracking and are unsupported; omit them. Catalog plans require `stickers: []`. The legacy generated reaction image remains an original graphic; no claim is made that it is a licensed canonical meme drawing. Verify the actual composite before delivery.

## Real audio catalog and timing

Revised plans set `audioCatalogPath` to the reviewed catalog at `experiments/meme-audio/catalog.json`. `music.assetId` and `soundCues[].assetId` resolve only to listed local files. Referenced asset SHA-256 hashes are checked. Full asset provenance and rights notes are copied into each manifest. A public download does not establish publishing rights; the meme soundboard effects in this local experiment remain `preview_only`. The creator-supplied phonk's attribution/usage conditions remain in the catalog.

The old `music.asset` and sound cue `kind` fields label style/intent; the catalog IDs select actual audio. The revised music fields are:

- `sourceStart`: chosen source drop/energy-rise anchor, in source-audio seconds.
- `dropAt`: matching output-video anchor.
- `leadInSeconds`: amount of genuine preceding music to include; must be no larger than either anchor.
- `leadInGainDb`: quieter gain before the anchor; `gainDb` applies after it.

Therefore the excerpt begins at **sourceStart − leadInSeconds** in the music and **dropAt − leadInSeconds** in the output. For example, a source anchor 14.84s, output anchor 17.30s and lead-in 14.84s begins the real track at source 0/output 2.46s while preserving the anchor. The supplied phonk anchor is a machine-measured energy-rise candidate, not a verified musical-downbeat or listening claim. Selected excerpts must fit the actual audio asset; catalog music is never silently looped.

Cue `sourceStart` and `duration` trim actual recordings. With sourceStart zero/unspecified, the catalog's measured leading-silence trim is used; omitted duration uses its recommended end. The manifest records effective cue trims. The cue's output `at` anchors the trimmed sound. No synthesized tones, noise risers, procedural beds or procedural effects are added in catalog mode.

Every `adelay` is immediately followed by `asetpts=N/SR/TB`. Some FFmpeg builds give inserted silence unusable timestamps; without this reset, downstream trimming can discard the silence and front-load the real sound. The regression test decodes an actual delayed file and measures its waveform onset. A production review should additionally match the final mixed waveform to its source excerpt around each important cue; correct plan arithmetic alone does not prove encoded audio timing.

Music ducks to 0.28 of its current gain during real sound cues, with a 40 ms attack and 140 ms release. The envelope uses the shifted music excerpt clock so a lead-in does not move the duck relative to the visual cue. Overlapping envelopes clamp to one dip. The final mix targets −14 LUFS, uses a −2.5 dBTP normalization target plus a 0.7 sample limiter for AAC headroom, and is measured after encoding; encoded true peaks above −1 dBTP fail. The actual integrated loudness is reported rather than assumed.

## Validation and review

New climax-focused jobs set `requireNarrativeBeats: true` and use `ClimaxAgentPlanSchema`. The optional local `narrativeBeats` declaration ranks observed events and identifies setup, escalation, the primary event and final result. Validation maps its source event into output time and requires the main music drop, strongest punch and declared `bw`/`deepfry` onset within two 30fps frames. The local late-payoff default is 70% or later with no more than five seconds of result tail; a written evidence-based exception is required otherwise. These are experiment style defaults, not universal retention rules. Existing revised/legacy schemas remain unchanged. See `research/climax-timing.md` for the editorial process and primary-source references.

Every result is fully decoded and checked for frame rate, dimensions, codecs, duration and audio format. The adjacent `.manifest.json` includes the actual plan, crop, source/output mapping, freeze attachment intervals, catalog provenance, effective cue trims, music source/output anchors, ducking parameters and measured loudness. Visual/listening review flags remain explicit because deterministic checks do not judge comedy, face placement or audible quality.

For each attached face, inspect a frame before the freeze, during shake, during the hold, and after motion resumes. Compare the source head with the actual composite. Review the full causal sequence and unobscured HUD; check no new game-name watermark exists. Audio metadata and transcription cannot replace listening.

## Legacy v1 compatibility

The preserved initial Archer/Zombie plans use short durations, floating stickers and synthesized demonstration beds. Their files and outputs remain unchanged for comparison. Rendering a plan **without** an audio catalog retains that legacy procedural lead-in/looped-bed behavior; new catalog revisions explicitly reject floating stickers and use only real catalog audio. The revised samples are the current package defaults.

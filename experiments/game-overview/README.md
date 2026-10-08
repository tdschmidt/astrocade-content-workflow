# Narrated game overview experiment

**Existing preview (before the latest feedback):** [Ben10: pick your power](../../data/experiments/game-overview/renders/ben10-overview-v3.mp4), 30.4 seconds from the newest eight-form capture. It opens on Fasttrack's cyclone, contrasts Cannonbolt's rolling movement, and ends on two Four Arms ground pounds. Real agents selected the shots, wrote the hook/script and fitted the final impacts to speech. Native-speed local neural speech, six focused tests, strict TypeScript and independent visual review pass. [Delivery metadata](../../data/experiments/game-overview/best-v2/delivery.json) links the exact plan, source map, voice provenance and reviews.

The Zombie walkthrough and earlier Ben10 v1 sections below are preserved historical baselines. The newest workflow and its quota recovery are documented at the end.

This experiment explains the game shown on screen: the premise, several actions a player can try, and a conditional recommendation. The script explains the game from the whole reviewed gameplay and sourced description. Relevant pictures support the ideas across the video; claims do not have to describe the action playing during that sentence.

The first sample is **31.2 seconds of 40 Ways to Kill a Zombie**, showing sword, fire, bomb and acid effects. The only added text is sentence-case speech captions. There is no permanent game-name watermark or credit bar. The source's own game interface remains visible.

## Latest feedback: game narrative, not action commentary

No new video was generated for this correction. The existing Ben10 preview remains a historical example of overly literal narration, despite its technical checks passing.

The editor now starts from what the game is, the player role, its verified objective or sandbox loop, interesting choices and appeal. A strong premise hook can use game-wide evidence, with relevant opening footage. “In this game you can…” is allowed when the premise is specific and compelling. Do not recite rolling past objects, animation colors or each visible effect.

`contracts.ts` lets claims and hooks cite facts from any chapter or sourced `gameFacts`. First-shot IDs still describe the actual opening picture. Unknown claims, ambiguous fact IDs and invalid source windows still fail. `prepare-selected.ts` carries game context and sourced facts into the derived ledger. Chapters remain assembly units, not factual silos; caption timing still follows actual speech. `pace-chapter.ts` retains required action moments but aligns them to speech only when a reviewed moment explicitly sets `syncToSpeech: true`. That exception is for a causal explanation, not the default overview structure. Existing versioned ledgers retain their historical briefs; the new editor prompt supersedes any obsolete requirement to narrate each shot.

Read the script without the video before synthesis: it must explain the game, not sound like an audio description. Wording-only refinement preserves its input's factual scope, so an old action-report draft may require a fresh grounded draft rather than polishing.

## Review the result

- Video: `data/experiments/game-overview/renders/zombie-overview-v2.mp4`
- Render manifest: `data/experiments/game-overview/renders/zombie-overview-v2.manifest.json`
- Exact render plan: `data/experiments/game-overview/plans-v2/zombie-overview-v2.json`
- Claims, source windows and voice chapter joins: `data/experiments/game-overview/plans-v2/claim-timeline.json`
- Agent script: `data/experiments/game-overview/draft-v4/script.txt`
- Actual-output visual review: `data/experiments/game-overview/review-evidence-v2/`

The parent experiment's combined sample gallery includes this result alongside the revised troll and story-background examples. MP4 is the deliverable; a gallery may use a derived WebM preview for browser compatibility.

## How the editing agent works

1. **Observe before writing.** [Source selection](source-selection.md) compares existing recordings. [The ledger](source-ledger.json) identifies the selected raw video by SHA-256, allowed source windows, visible facts and forbidden claims. Read the whole gameplay and game description before selecting the narrative. Selected-shot facts and optional gameFacts form one evidence pool; gameFacts require a description URL/excerpt or original gameplay path/hash/time window/observation. gameSummary guides the angle but is not an independent fact source.
2. **Generate an evidence-linked draft.** [The saved prompt](prompts/editor.md) asks for a conversational recommendation and requires claims to cite observed fact IDs. `agent.ts` extracts timestamped 2 FPS images, calls the existing `CodexServices` with its default model setting, and saves the exact request, response, provider events and source hash. A bounded repair handles schema/semantic validation failures. It does not execute arbitrary model-written FFmpeg commands.
3. **Refine language when warranted.** Early drafts sounded too much like an audit of counters. The first rendered prototype also received independent feedback that its language was too clinical. `refine.ts` made saved, real Codex wording-only revisions, with a final casual recommendation prompt producing draft-v4. Source windows and permitted factual scope stayed fixed. All drafts remain available; the final script was not manually substituted by the parent agent.
4. **Generate and recognize real speech.** `voice.ts` calls the shared Gemini narration helper once per chapter. The final speech is recognized with actual word timestamps, checked against the intended script, then saved with API event/provenance records. The sample uses configured `Kore / gemini-3.8-flash-lite-tts`, transcribed by `gemini-3.5-transcribe`.
5. **Fit supporting pictures to the voice sections.** `assemble.ts` pads each voice chapter by approximately 0.1 seconds to an exact 30 FPS boundary, concatenates real waveforms, offsets the returned word timings, and adjusts only that chapter's video speed. It preserves chronological source windows, never repeats footage, and validates total coverage before rendering. A guard frame covers ffprobe's decimal rounding at the final tail.
6. **Render and review.** The shared `story-background` renderer performs the crop, sentence-case phrase captions, audio normalization and final fade. It fully decodes the MP4 and verifies output format and audio levels. Sampled output stills and the claim/timing ledger receive an independent visual review. These technical checks are not a listening review.

The first render used upper-middle captions; independent review found a transient overlap with the bomb-launched torso. The final render uses shorter three-word phrases in the lower-middle area. Actual-output sampled review passes with minor limits: the face/body and bomb flight remain readable, while some particles and the collapsed skeleton approach the captions. The phone-scale caption image is legible. No continuous-playback or listening review is claimed.

Final technical validation: 720×1280 H.264, 30 FPS, stereo 48 kHz AAC, 31.2 seconds, full decode without errors, measured −16.04 LUFS and −3.85 dBTP. See `review-evidence-v2/editor-review.json` and the render manifest for the exact evidence and limits.

## Actual timing and evidence

| Chapter | Source seconds | Output seconds | Playback speed |
| --- | --- | --- | --- |
| Sword / premise | 40–49.5 | 0–8.167 | 1.163× |
| Fire / scorch and stagger | 67.5–75.5 | 8.167–14.8 | 1.206× |
| Bomb / burst and ragdoll | 138–145.2 | 14.8–21.5 | 1.075× |
| Acid / exposed skeleton | 165–174.5 | 21.5–31.2 | 0.976× |

The last source window includes a guard frame; the renderer uses only its needed portion (ending at approximately 174.467s). The manifest is authoritative for the exact used source endpoint.

The final script contains 81 whitespace-delimited words. A fresh voice set was generated for that materially revised script. Its original four clips total 33.44 seconds, then FFmpeg retimed those same waveforms to 1.1× with pitch preserved. The **actual retimed waveforms** were transcribed, yielding approximately 30.417 seconds before tiny join pads. No word timings were divided by a speed factor.

Final narration evidence is in `voice-v3/`. Sword, Fire and Bomb passed strict positive-word-span validation. Acid's provider returned one article “a” at start=end=8.7s. The explicit `recover-phrase.ts` step verified the saved waveform hash, script match, ordered original timestamps and positive phrase spans, then retained that zero-duration article unchanged for **phrase-only captions**. `acid/phrase-revalidation.json` records the policy, token and checks. No estimated word boundary or additional speech generation was used to evade the timing failure. The original failed validation remains preserved beside the successful phrase-mode recovery.

The previous 37.1-second technical prototype, its 89-word script, voice-v1/voice-v2, and independent review remain archived as v1. Its raw speech was reused for its own tempo change; that history is distinct from the fresh generation required for the final revised script.

An initial assembly attempt hit a one-frame ceil/probe rounding issue. `plans-failed-timing/` preserves its intermediate audio. The completed assembly adds one frame of real source coverage and stores exact 48 kHz sample-count pads. The final plan needs no freeze or duplicated tail image.

## Commands

Run from the repository root. New output directories and media files must not already exist. Model calls use the already-approved external provider workflow and existing configuration; no API key is written into artifacts.

```sh
# Draft from the saved ledger and actual source frames.
node --import tsx experiments/game-overview/agent.ts data/experiments/game-overview/new-draft

# Optional wording-only pass after inspecting the evidence-led draft.
node --import tsx experiments/game-overview/refine.ts data/experiments/game-overview/new-draft/draft.json data/experiments/game-overview/new-refined

# Generate speech once; inspect any saved validation failures before resuming.
node --import tsx experiments/game-overview/voice.ts data/experiments/game-overview/new-refined/draft.json data/experiments/game-overview/new-voice

# Reuse actual audio if changing tempo; the final WAVs are transcribed again.
node --import tsx experiments/game-overview/voice.ts data/experiments/game-overview/new-refined/draft.json data/experiments/game-overview/new-voice-fast --reuse data/experiments/game-overview/new-voice --tempo 1.1

# Build a timed plan and render through the shared deterministic renderer.
node --import tsx experiments/game-overview/assemble.ts data/experiments/game-overview/new-refined/draft.json data/experiments/game-overview/new-voice-fast data/experiments/game-overview/new-plan
node --import tsx experiments/story-background/render.ts data/experiments/game-overview/new-plan/zombie-overview-v1.json data/experiments/game-overview/renders/new-overview.mp4
```

To reproduce the existing sample's rendering without any model or speech calls, pass its saved plan to the final command with a new MP4 output path. Audio and source hashes/provenance are already preserved. Fresh model generations are not guaranteed to return identical scripts or delivery.

## Scope and limits

This remains an isolated experiment. It imports provider/media utilities and the separate story renderer; the main pipeline is unchanged. The original runner was a four-chapter Zombie example; the current runner accepts separate ledgers with two to six chapters. `assemble.ts` accepts `--id`, `--caption`, and `--words` for versioned review variants. An exact final assembly uses `--id zombie-overview-v2 --caption lower-middle --words 3`. If only provider-quantized zero-duration words fail and phrase captions are intended, inspect the saved evidence before explicitly running `recover-phrase.ts` on that chapter directory; it cannot repair overlaps, negative spans or script mismatches. For another game, create and review a new source ledger, pass it to the agent and assembler, choose an output identity, and preserve the same claims-to-footage contract.

The game title advertises forty methods; the sample demonstrates only four. Fire is described as a visible scorch/stagger, not a confirmed elimination. The recommendation is conditional taste, not a measured quality score or a claim of personal playtime. No multiplayer, campaign, popularity or unseen feature is invented. Raw gameplay is silent, so this sample uses generated narration without added music. No publishing occurred.

## Reusable hook-first overview (Ben10)

The revised runner accepts a separate ledger instead of hardcoding Zombie's four tool IDs. `contracts.ts` validates 2–6 ledger chapters, chapter-specific fact references and source bounds. The actual Codex request produces three hook candidates with specificity/curiosity/picture-match scores, first-shot evidence and a selected hook. Validation requires the selected candidate to have the highest score and to begin the spoken narration verbatim. All hook evidence belongs to the opening chapter. A human/agent editorial review still checks whether the chosen question has a payoff; numeric self-scores do not prove a good hook.

For the richer-game revision, actual source images were compared for **BEN 10 OPEN World**, **Sort It Out**, and **Muscle Mommy Clicker**. Ben10 offered the clearest variety: city flight, crystal walls, extending blades and burrow movement. The saved current Players' Choice response places Ben10 at card 11 with an unlabeled displayed `850K`; this is category ordering, not a verified platform-wide ranking or verified play count. See `data/experiments/game-overview/richer-selection/selection-report.json`, saved public HTML, and the three contact sheets.

The source combines two existing Ben10 sessions as an explicit feature montage. A local intermediate avoids changing the shared story renderer. [prepare-ben10.py](prepare-ben10.py) preserves each original path, hash, input window, derived window, frame count and exact FFmpeg command in `data/experiments/game-overview/ben10-source-v2/provenance.json`. The first shot uses the newer capture's immediate ascent past a building, then older clean crystal and burrow actions. Idle gaps, aim prompts and unclear later exploration are omitted. No enemies, missions, unlocks or successful target hits are claimed. No source window repeats.

```sh
# Each output directory must be new. Optional fourth argument is saved editorial feedback.
node --import tsx experiments/game-overview/agent.ts data/experiments/game-overview/ben10-new-draft experiments/game-overview/sources/ben10.json
node --import tsx experiments/game-overview/voice.ts data/experiments/game-overview/ben10-new-draft/draft.json data/experiments/game-overview/ben10-new-voice --tempo 1.1
node --import tsx experiments/game-overview/assemble.ts data/experiments/game-overview/ben10-new-draft/draft.json data/experiments/game-overview/ben10-new-voice data/experiments/game-overview/ben10-new-plan --ledger experiments/game-overview/sources/ben10.json --id ben10-overview-v1 --caption upper-middle --words 3
node --import tsx experiments/story-background/render.ts data/experiments/game-overview/ben10-new-plan/ben10-overview-v1.json data/experiments/game-overview/renders/ben10-new-overview.mp4
node --import tsx --test experiments/game-overview/contracts.test.ts
```

For phrase captions, `voice.ts` now explicitly requests phrase timing from the existing narration helper. Provider-returned zero-duration single words can remain unchanged inside positive-duration phrases; negative, overlapping, missing or mismatched timings still fail. Actual retimed waveforms are transcribed. This does not synthesize estimated word boundaries.

The optional wording-only `refine.ts` accepts a ledger as its third argument and preserves an existing selected hook exactly. Use a fresh full `agent.ts` request when the hook itself needs changing. Historical Zombie source ledgers, drafts, plans and media remain unchanged; the default ledger path still selects that example.

### Previous Ben10 revision (v1)

- Final video: `data/experiments/game-overview/renders/ben10-overview-v1.mp4`
- Three-power ledger: `sources/ben10-three-powers.json`
- Actual agent script and selection: `data/experiments/game-overview/ben10-draft-final/`
- Original speech and new recognition: `data/experiments/game-overview/ben10-voice-final/`
- Plan and chapter timing: `data/experiments/game-overview/ben10-plan-final/`
- Final sentence-to-evidence review: `data/experiments/game-overview/ben10-script-review.json`

The script opens: “Heatblast turns a city street into a launchpad, rocketing past the buildings on a stream of fire.” It then explains the choice of alien powers, Diamondhead's crystal wall and Wildvine's burrow. Actual agent revisions removed an unanswered maximum-distance question and forensic production/color descriptions. Rejected drafts and editorial feedback remain saved. Source-specific spoken exclusions are now validated, and a wording repair preserves its already-selected hook.

The configured TTS model generated three chapters, then returned a daily free-tier quota error for the separate blade chapter. The actual editor agent selected the three strongest completed powers and copied their narration exactly; no alternate account, new purchase or extra speech generation was used. Original natural-tempo audio totals 29.08 seconds. With ordinary short joins and the existing end fade, the final is **29.7 seconds**, an explicitly reviewed exception to the nominal 30–45-second target. It uses motion throughout, without a freeze or duplicate tail added to meet an arbitrary duration.

`voice.ts --reuse-input OLD_VOICE_DIR` reuses each saved `input-narration.wav` at its original tempo and recognizes that final waveform. Flight recognition split two compounds: `Heatblast` → `Heat blast` and `launchpad` → `launch pad`. `recover-compounds.ts` accepted only those explicitly reviewed spacing aliases, required every remaining canonical token to match exactly, verified the waveform hash and preserved all original recognized tokens/times. Its report does not claim a listening review. The initial failed transcript validation and provider quota response are retained.

For this exception, assembly accepts `--min-duration 28 --duration-note 'REASON'`. The default stays 30 seconds; a reduced minimum requires an explicit documented reason. Normalizing all whitespace to bypass speech mismatch is not supported.

Final Ben10 visual review: `ben10-review/editor-review.json` records sampled frame review and a360px phone preview; root independently reviewed the output in `ben10-review/independent-review.json`. Flight, wall activation and burrow are clear, caption placement leaves the main actor/effect readable, and no added name/credit watermark appears. The render fully decodes at720×1280/30FPS, with measured−15.92LUFS and−2.16dBTP. Five focused overview tests and strict TypeScript checks pass. Review metadata does not claim a listening assessment. Gallery integration is tracked by the parent experiment.

## Latest delivery: Ben10 v3 from the eight-form capture

The new 30.4-second sample uses `data/runs/2026-10-07T21-54-48-020Z-05793f`, with one strong opening effect and two contrasting choices. It does not try to list all eight available forms. The narration starts immediately: “Fasttrack’s cyclone turns the street into a storm of flying blocks.” Its final sentence expresses a hypothetical preference for Four Arms, without claiming prior personal play. The saved category ranking evidence is historical and its displayed `850K` is unlabeled; neither is narrated as a verified popularity statistic.

All current artifacts are under `data/experiments/game-overview/best-v2/`:

- `delivery.json` is the stable handoff; `source-selection.json` records the source choice and claim scope.
- `shot-selection/` stores the actual Codex shot-selection request, response and events. `source-expanded/provenance.json` maps every intermediate clip to the original capture with hashes and FFmpeg arguments. An editorial extension added observed sprint coverage; the final writer chose the expanded window.
- `draft-v2/` contains the final real-agent hook candidates, selected opening, fact-linked chapters and script. The ledger is `experiments/game-overview/sources/ben10-best-v2-expanded.json`.
- `synthesis-v1/` stores native 1.0× Kokoro waveforms and model provenance. `voice-final/combined-provenance.json` identifies the validated recognition for each chapter.
- `pacing-fourarms/` records a separate real-agent timing decision. `plan-captioned/ben10-overview-v3.json` is the final deterministic render plan, with the updated claim timeline and exact-token caption correction evidence.
- `review/editor-review.json`, `review/independent/review.json`, contact sheets and the phone preview record accepted visual QA. No listening or audience test is claimed.

The configured cloud speech quota was exhausted. The approved local Kokoro-82M v1.0 model with `af_heart` generated all three new chapters at native speed. Fasttrack and Four Arms were recognized by the existing Google transcription provider; Cannonbolt used local Faster Whisper `small.en` when the separate cloud transcription quota was reached. Its supplied transcript must match the final waveform SHA-256. Original failed attempts remain preserved. There was no speech regeneration, guessed word timing or alternative account.

The three source chapters are fitted independently. Fasttrack and Cannonbolt video run at approximately 1.03× and 1.13×. A further real-agent pass removes uneventful Four Arms approach and slows its final impact/settling footage so the second visible pound lands at the “twice / throwing” phrase. Dense source-frame verification confirms two distinct impacts, around output 23.33 and 26.56 seconds. Native speech stays unchanged; no freeze or repeated footage pads the duration.

Google returned “Fast-track Cyclone” for the opening. `correct-caption-text.ts` applies only reviewed exact-token spelling/case aliases to the approved script, preserves every provider start/end time, and saves original and display tokens beside the waveform hash. Phrase-caption recovery likewise retains quantized zero-duration words without inventing boundaries. The upper-middle three-word captions remain readable at phone scale; brief native menu inserts retain the selected form name above the captions. No permanent name/credit overlay is added.

The final MP4 fully decodes at 720×1280, 30 FPS, stereo 48 kHz AAC, measured −15.54 LUFS and −1.95 dBTP. All six overview contract tests and strict TypeScript checks pass. The main pipeline and other capture task's files remain unchanged.

The reusable additional stages accept reviewed inputs and new output directories:

```sh
node --import tsx experiments/game-overview/choose-shots.ts CANDIDATES.json NEW_SELECTION_DIR
node --import tsx experiments/game-overview/prepare-selected.ts SELECTION.json NEW_SOURCE_DIR NEW_LEDGER.json
node --import tsx experiments/game-overview/agent.ts NEW_DRAFT_DIR NEW_LEDGER.json

# Generate once at native speed, then recognize the exact saved waveforms.
data/experiments/local-speech/.venv/bin/python experiments/local-speech/generate.py REVIEWED_DRAFT.json NEW_SYNTH_DIR
node --import tsx experiments/game-overview/voice.ts REVIEWED_DRAFT.json NEW_VOICE_DIR --reuse-input NEW_SYNTH_DIR --audio-label 'Local Kokoro-82M v1.0 / af_heart'

# After assembly, optional evidence-led fitting of a chapter to actual speech.
node --import tsx experiments/game-overview/pace-chapter.ts REVIEWED_PACING_SPEC.json NEW_PACING_DIR
node --import tsx experiments/game-overview/apply-pacing.ts BASE_PLAN.json PACING.json NEW_PLAN_DIR
node --import tsx experiments/game-overview/correct-caption-text.ts PLAN.json REVIEWED_ALIASES.json NEW_CAPTION_PLAN_DIR NEW_PLAN_ID
```

To reproduce the delivered media without new provider calls, render the saved `best-v2/plan-captioned/ben10-overview-v3.json` through `experiments/story-background/render.ts` to a fresh MP4 filename. The baseline command examples earlier in this document describe historical runs; the current sample uses native speech speed and the explicitly labeled local provider.

# Narrated stories over gameplay

Separate experiment for the format in the [supplied Instagram reference](https://www.instagram.com/reel/Da5amEGzxsV/): sustained traversal, narration, and large outlined captions in short phrases above the action. The observed opening uses third-person Roblox stair traversal and white all-caps captions near the upper quarter. The reference is about 35 seconds. This package implements the format rather than copying its spoken script or downloading its assets.

## Latest feedback: satisfying progression is required

No new capture, narration or video was generated for this correction. The Venus parkour preview was rejected by the user for repetitive early-course attempts. Its unique source intervals and removed falls are technical properties, not proof that it is satisfying to watch. That acceptance criterion is superseded for future work.

`background-quality.ts` requires a semantic review of the complete proposed selection before the pipeline writes a story or generates speech. It checks coverage of the output timeline and rejects retry/failure/stalled spans, a rejected review, an unreviewed selection, or the same route section from different attempts. The reviewer must consistently identify the same obstacle across files; software cannot infer enjoyment or detect a dishonestly renamed section from IDs alone. Full motion review remains necessary.

Selections passed to `prepare-background.ts` and manifests passed to `assemble.ts` now need `progressionReview`. It contains `decision`, `watchedWholeSelection`, `engagementSummary`, `repeatedFailureLoop`, and chronological `spans` covering the whole selected output. Each span records output `start`/`end`, `sectionId`, `attemptId`, `outcome` (`progress`, `retry`, `failure`, `stalled`) and concrete `evidence`. Reuse a section ID across the same landmarks, change attempt ID after resets, and never rename a retry to make it pass. The prepare stage preserves this review and the derived source hash; it no longer automatically claims an exact reference-genre match.

Historical `background-job.json` and Venus manifests have no such review and deliberately cannot start a new run until genuinely re-reviewed. Do not fabricate acceptance for rejected material. Saved historical render plans remain reproducible directly through the renderer. The older command examples below need a newly reviewed background manifest for future assembly.

## First sample

The sample retells [“Mail Merge Documents will waste printer ink”](https://www.reddit.com/r/MaliciousCompliance/comments/uop6jc/mail_merge_documents_will_waste_printer_ink/) by u/CommonwealthGhost in r/MaliciousCompliance. It is framed as a Reddit user's account, with an off-screen source credit and the primary permalink retained in the plan. The agent wrote a fresh 105-word retelling against a fact ledger; a separate agent checked it against the original post. Cached engagement is evidence of historical interest, not a live popularity ranking.

The current background is **train traversal**, not parkour. Existing footage and three fresh candidates were inspected; neither obby produced a usable supported run. The footage scout selected two unique forward-ordered windows from Rail Journey and removed the app chrome. See `source-selection.md` for the actual reasons and `background-job.json` for timestamps, source hash and 71 inspected frames. No repeated gameplay or idle padding is used. A reviewed parkour take can replace this manifest without changing the story workflow.

## Agent process

1. **Research and ground the content.** Read the primary source. Save the author, URL, fact/beat IDs, uncertainty, prohibited inventions, and writer brief. The supplied ledgers support a Reddit retelling and a [NASA Venus explainer](https://science.nasa.gov/venus/facts/).
2. **Write and review.** `agent.ts` sends `prompts/story-writer.md` plus the ledger to the configured signed-in Codex service. It saves prompts, raw responses, hashes, evidence mapping and provider events. One structural repair is allowed. `review.ts` makes a separate semantic review call; rejected content stops before synthesis.
3. **Generate narration.** `narrate.ts` uses the repository's configured Gemini speech model and voice. This sample uses Kore and a 1.16× pitch-preserving tempo adjustment for a brisker delivery. The final audio is then transcribed with actual word timestamps. The comparison accepts equivalent spoken-number formatting, but still rejects changed numbers or negations. A failed transcript stops for review with its audio and evidence preserved; there is no guessed timing fallback.
4. **Select and review the background before generation.** A footage agent applies `prompts/background-selector.md` to the whole proposed sequence. Require satisfying progression and changing situations, whether one continuous run or multiple coherent sections. Consider runners, dodging, collecting, driving or accessible traversal; parkour is optional. Repeated approaches to the same failed obstacle are rejected even with falls removed. Save exact windows, crop, native-capture provenance, genre and limitations. Never choose a file only because its name sounds suitable. Fresh capture is available in `capture-background.ts` using the existing native game tools.
5. **Assemble and render.** `run.ts` checks the progression review and source hash before any model or voice request. `assemble.ts` checks them again with the exact narration script, then builds the closed plan. `render.ts` trims only enough footage for the measured voice plus a 0.3-second ending, adds word-timed captions and preserves off-screen source credit, and normalizes the voice. Short footage is an error, not permission to loop. Output is 720×1280, 30 FPS H.264/AAC.
6. **Inspect the preview.** Use `prompts/story-reviewer.md` for story, motion, caption, pacing and audio review. Technical checks include full decode, media dimensions, timestamps, loudness and encoded true peak. Save the critique separately and make a new version for any revision. Nothing is published by this process.

## Run it

From the repository root, with its dependencies installed and existing Codex/Gemini configuration:

```sh
node --import tsx experiments/story-background/run.ts \
  experiments/story-background/research/source-mail-merge.json \
  experiments/story-background/background-job.json \
  data/experiments/story-background/new-story-run
```

The output directory must be new. This command makes provider requests and uses the configured account. It writes a reviewed draft, generated voice, actual transcript, render plan, MP4, media manifest and review-needed record. A 35.5-second background may be too short for a different generated narration: select more footage or generate a shorter script, rather than forcing a fit. Optional final argument sets voice tempo between 0.9 and 1.2. Use `source-venus.json` for the informational mode, with enough reviewed footage for that particular voice recording.

Individual stages also work separately, so a failed recognition or render does not require another story/voice generation:

```sh
node --import tsx experiments/story-background/narrate.ts DRAFT.json NEW_VOICE_DIR --audio EXISTING.wav --tempo 1.16
node --import tsx experiments/story-background/assemble.ts SOURCE.json DRAFT.json NARRATION.json BACKGROUND.json NEW_PLAN.json
node --import tsx experiments/story-background/render.ts PLAN.json NEW_VIDEO.mp4
node --import tsx --test experiments/story-background/*.test.ts
```

`RENDERER.md` documents the plan contract and caption/audio behavior. `background-job.json` is a concrete reviewed example with local absolute paths, not a portable stock-footage catalog. Retain source files and their hashes or create a new review for replacement footage.

## Integration point and limits

Keep content writing independent of gameplay capture. The integration contract is a source ledger plus a reviewed background manifest, followed by a measured narration and structured edit plan. Import these stages into the main pipeline only after choosing a successful preview; this experiment does not change the main pipeline.

The 35.5-second sample exercises the full path with real model responses, speech and gameplay. It passed 10 focused tests, strict TypeScript checks, a full video decode and output-format checks; measured audio is −15.85 LUFS and −2.93 dBTP. The source and draft were reviewed independently; render frames were checked for readability. A listening/taste review remains for the preview. The one-command wrapper composes these same stages; the later Venus informational sample is described below. Semantic checks are based on the cited source, not independent verification of a Reddit anecdote. Automated recognition and loudness checks do not replace a listening review. The experiment's TTS request omits the explicit delivery mode rejected by the configured endpoint; the shared provider is unchanged. API references: [Gemini speech generation](https://ai.google.dev/gemini-api/docs/speech-generation) and [transcription](https://ai.google.dev/gemini-api/docs/transcribe).

## Revision after user feedback

`mail-merge-v2.mp4` is 41.1 seconds, uses the original natural-pace narration, and removes the on-screen author credit. The same unique reviewed footage runs at 0.86× speed; it does not repeat. Source/author credit remains in metadata and the combined review page. The earlier 35.5-second preview is retained only for comparison. Run `node experiments/review/build.mjs` to refresh the unified gallery under `data/experiments/review/index.html`.

## New Venus / parkour experiment

`data/experiments/story-background/renders/venus-clock-v1.mp4` uses a fresh, independently reviewed Codex draft grounded in [NASA Space Place](https://spaceplace.nasa.gov/all-about-venus/en/). The hook is the supported contradiction that a Venus year ends before the planet finishes one spin; the explanation distinguishes rotation from sunrise-to-sunrise and ends with the westward sunrise. The factual ledger is `research/source-venus-clock.json`; draft/review provenance is in `venus-clock-draft-v4/`.

The 37.486-second voice was generated locally with Kokoro-82M v1.0 / af_heart at native 1× and separately transcribed by the configured recognition provider. The final script and recognized words matched under bounded spoken-number normalization, with no changed numbers or negations. Voice/model hashes and official model/runtime source links are in `venus-clock-synthesis-v1/synthesis.json`. Recognition timestamps are in `venus-clock-voice-v1/`; this is not estimated text timing.

The new background is actual third-person parkour from POPULAR OBBY. It is explicitly a montage of distinct successful movement portions from several native attempts at the early course, **not a continuous successful run**. No selected source interval repeats; gameplay and voice remain 1×. Failed jumps, menu overlays and long inference pauses were excluded. It revisits the same level, so it does not demonstrate course mastery. The original source hashes and exact source→montage map are in `venus-clock-background-v1/provenance.json`. Native game HUD remains, while app chrome is cropped and large captions sit below the avatar/action. Added author/game watermarks remain disabled; NASA, game and voice credits stay off-screen.

Capture support is experiment-only: `settled-inspection.ts` waits for iframe navigation and inspects actual native controls; `capture-proposal.ts` preserves medium-confidence route proposals as unverified rather than changing pipeline acceptance. `revise-route.ts` asks Codex to revise a route from real video evidence. `route-controller.ts` supplies a separate background-oriented visual feedback prompt; it distinguishes normal jump landings from actual falls and stops after repeated failure. The generic highlight controller's first-death stop rule remains unchanged. Every real native action, model decision and screenshot is retained beside its source. `prepare-background.ts` validates bounds and rejects overlapping source intervals before concatenating reviewed clips; `assemble.ts` accepts the background manifest's caption position/mode.

Reproduce the final mechanical stages:

```sh
node --import tsx experiments/story-background/prepare-background.ts REVIEWED_SELECTION.json NEW_BACKGROUND_DIR
node --import tsx experiments/story-background/assemble.ts experiments/story-background/research/source-venus-clock.json DRAFT.json NARRATION.json NEW_BACKGROUND_DIR/background.json NEW_PLAN.json
node --import tsx experiments/story-background/render.ts NEW_PLAN.json NEW_VIDEO.mp4
```

The historical capture and speech generation are complete. New assembly now additionally requires the progression review described above; the old Venus selection should not be reused as an accepted background. A listening/taste review remains distinct from technical decode, measured loudness, transcription agreement and sampled visual QA.

# Zombie v6 — corrected climax

`data/experiments/troll-editor/renders/zombie-fail-v6.mp4` is an 18.70-second revision. The real Codex editorial plan is retained in `data/experiments/troll-editor/zombie-fail-v5-c/plan.json`, with its source frames, exact request/prompt, inference events, response and validation. No creative plan was hand-edited.

The main drop moved from the earlier fire reaction at output 3.93s in v4 to the actual bomb rupture at output 15.10s in the new plan. The selected source event is the first observed blast ring at 141.544s. It starts the strongest visible change: a recognizable specimen becomes launched, separated parts. Fire is now restrained setup; the later bomb/fuse creates escalation. The final 3.60 seconds retain the consequence and counter 02, then stop before reset.

The main grayscale onset, strongest punch and real phonk anchor are declared at output 15.10s. Dense output review finds the first visible grayscale blast at the 15.133334s seek, one 30fps frame after the nominal anchor; the prior seek still shows the intact bomb. The exact observed source 141.610s head receives a 0.60-second deep-fried freeze with the face tightly attached. It disappears before regular motion resumes. The actual quieter phonk lead-in begins at output 0.26s; no long impact sound ducks the main bass arrival. No name/credit watermark is added.

## Process changes

The system/style prompts now rank candidate events before allocating effects. `requireNarrativeBeats: true` invokes a separate `ClimaxAgentPlanSchema`; its declaration and local validator tie the primary source event to the music, visual onset and strongest punch within two output frames. A late event alone is not enough: the agent must explain why it is the strongest narrative change. See `research/climax-timing.md` for online skill references and the distinction between beat detection and editorial judgment.

Two earlier drafts had incorrect duration arithmetic and captions beyond the output boundary. They were rejected, retained, and corrected through another real agent call. Automatic repair prompts now include the exact quantized timeline and duration, and validation errors identify the offending caption/sticker index and bounds. The original sandbox-denied attempt is also preserved. No overflow check was relaxed.

The first rendering attempts failed the encoded true-peak guard. The deterministic mix now leaves more AAC headroom while keeping the agent's edit and sound timing intact. The final file passes the unchanged encoded peak threshold.

An integration audit then found an actual FFmpeg timing failure: `adelay` could emit inserted silence without usable timestamps, and the following trim discarded that silence. The old two-second-delay reproduction produced sound at 0.0427s. The renderer now rebuilds sample timestamps immediately after every delayed music, cue and legacy-riser chain. A real FFmpeg regression checks the waveform is silent before two seconds, plays the requested half-second burst there, and returns to silence.

V6 is a deterministic rerender of the unchanged accepted v5-c creative plan after that audio fix. V5 remains pre-fix evidence and is superseded. Normalized cross-correlation of the actual decoded final AAC mix against catalog source waveforms finds the phonk source anchor at **15.105s** (correlation 0.997), bonk at **2.005s** (0.912), and record scratch at **14.105s** (0.968). All are 5ms after their nominal times. The measured visual blast begins at 15.1333s, about 28ms after the actual audio anchor and within one output frame. The v5 music happened to align, but neither SFX matched its intended position; the fix is verified against actual output rather than inferred from the plan.

## Verification and limits

Ten renderer tests and strict TypeScript checks pass. The final H.264/AAC 720×1280/30fps file fully decodes and passes duration/audio-format checks. Actual encoded audio measures **−11.35 LUFS / −1.36 dBTP**; a −14 LUFS target is not claimed as an achieved result.

Dense source/output contact sheets are under `data/experiments/troll-editor/evidence/climax-v5/`; the v6 visual-equivalence and final review are in `evidence/climax-v6/`. Actual decoded waveform matching and its reproducible analysis are in `evidence/audio-timing-v6/`. The independent research review uses `evidence/revision-5/`. Waveform timing and loudness checks do not substitute for listening or audience retention data.

Golem v3 remains an earlier comparison baseline. Its late effect does not by itself establish that the chosen tumble was the strongest event; it is not labeled as newly corrected in this revision.

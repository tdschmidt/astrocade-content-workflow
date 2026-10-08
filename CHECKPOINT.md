# Pipeline handoff — 7 October 2026

The previous checkpoint has been resumed, retired product scope removed, and the completed editing prototype integrated. **Eleven selected candidate videos were generated through the main CLI:** eight categories, a narrated overview, a sourced story and an additional fresh Golem test. Their local source/picture/media checks and final code review are complete. Earlier recordings, failed attempts and alternative edits remain preserved. All owned model, capture and render jobs have ended; only the optional local review server remains.

## Current scope

The deliverable ends at **local candidate videos**. No GUI, Instagram uploading, account/email creation, publishing service, database or job queue. GitHub commits/pushes to the existing project repository and model analysis of gameplay are authorized. External publishing and outreach are not authorized.

The latest brief supersedes the old 15-second ceiling: meme edits are 15–25 seconds, overviews roughly 30–45 seconds and story videos roughly 35–60 seconds. Phonk edits keep at least four seconds after the main drop, including two seconds moving; a short aligned freeze may be part of that tail. Endpoints use actual audio and the existing fade, without unauditioned musical-resolution claims. Overviews explain premise, choices and appeal. Story backgrounds need sustained progress, not concealed repeated failures.

Both referenced tasks were read. **Prototype troll-style gameplay edits**, `01a11815-c893-7952-add3-2c520bfda11b` (local), completed its latest turn at **2026-10-07 23:20:43 UTC**. Its package was integrated after completion; a later check found it idle with no newer revision. **Plan content farm system design** is `01a112a4-d19c-7a21-9690-58972ef0e6c8` (local). Read either task again before relying on subsequent changes.

## Repository and artifacts

- Workspace: `/Users/theoschmidt/Documents/ChatGPT/Astrocade`
- Branch: `codex/core-workflow`
- Remote: `git@github.com:tdschmidt/astrocade-content-workflow.git`
- [GitHub branch](https://github.com/tdschmidt/astrocade-content-workflow/tree/codex/core-workflow)
- [Implementation and validation](docs/pipeline-validation-2026-10-07.md)
- [Setup and commands](README.md)

Incremental pushed commits include `6f7378c` (retired scope), `0779585` (prototype snapshot), `b135fae` (native input fix), `ed0fe69` (integrated formats), `98f23ae` (latest ending clarification), `d51eaf2` (overview preparation/unused-code checks), `0d52943` (AAC peaks), `ae7515e` (chapter timing/dense review), `63497f5` (CI media setup), `22c4e05` (source clock/narration recovery), `5e62aff` (source dimensions), `ff44c07` (audio endings/crop) and `6f37f1c` (decoder-padding regression). See `git log` for the final native-audio repair and documentation commit.

**Generated media and inference artifacts under `data/` are local and ignored. They are not uploaded to GitHub or present in a fresh clone.** Preserve them and the audio binaries. Audio acquisition/provenance is documented in `experiments/meme-audio/README.md`; narration setup in `experiments/local-speech/README.md`.

The authoritative local selection is `data/experiments/pipeline-review-2026-10-07/candidates.json`. Its companion `index.html` links videos, plans, run reports and QA. The builder checks each video's SHA-256 against its completed run. Detailed category history remains in `data/experiments/category-batch-2026-10-07/continuation/candidate-runs.json`.

## Selected outputs

Run folders are under `data/runs/`; exact video paths and hashes are in their `run.json` and gallery manifest.

| Category / format | Run | Verified content and limits |
| --- | --- | --- |
| Physics / tools | `2026-10-07T23-32-33-099Z-df2092` | 16.5s; Creeper, Slime, anvil damage and actual Totem revival. No unsupported new anvil purchase. |
| Ben 10 overview | `2026-10-07T23-33-01-010Z-1c2d18` | 36.10s; Omnitrix premise, choices and play styles. Speech remained unchanged during timing/recognition recovery. |
| Ben 10 meme | `2026-10-07T23-44-19-205Z-c416d5` | 21.50s; real choice, transformation, flight, speed and cyclone. No combat win. |
| Fresh Golem test | `2026-10-07T23-13-56-562Z-877be0` | 17.70s; native fling, anvil damage, Creeper explosion and moving gem aftermath. Sword selection does not prove a sword strike. |
| Tycoon | `2026-10-07T23-43-42-702Z-70d6df` | 18.23s; scrap earnings, purchases and partial chassis/wheel assembly. No completed car, zone unlock or boss victory. |
| Character growth | `2026-10-07T23-14-14-857Z-51f0e9` | 18.60s; Muscle Mommy Level 1→5. Cartoon growth is an adjacent fit, not Roblox footage. |
| Controversial-person game | `2026-10-07T23-28-34-237Z-0dacf8` | 19.03s; fictional Diddy Slapfest combo, Auto-Slapper and blue glove. No real-person allegations or prestige. |
| Crossover | `2026-10-07T23-32-32-653Z-93ca88` | 15.53s; PvZ planting/growth. Wave 1 unresolved; no kill/wave-completion claim. |
| Political absurdity | `2026-10-07T23-44-06-547Z-456734` | 16.63s; actual swap, bomb and score changes. No completed round. |
| Viewer challenge | `2026-10-07T23-56-07-609Z-55615d` | 17.00s; Tesla/Subaru questions and native correct-answer reveals. Corrected source timing, geometry and full audio fade. Brief native source-size shifts remain. |
| Sourced story | `2026-10-07T23-53-02-361Z-6917e1` | 37.50s; Venus facts over Sort It Out, medical-case completion then beauty-case progress. Minor recognized caption insertion: “opposite it to Earth.” No two-case-completion claim. |

Four retained earlier meme renders received independent per-segment timing audits: Muscle and Totem Golem have zero source seek advance; Diddy/PvZ are bounded within one 30 fps frame. Later selected revisions use corrected source-clock handling.

## Whole-pipeline tests and recovery

Two fresh ten-minute native recordings ran through inspection, control, capture, independent analysis, agent editing and rendering: Golem `2026-10-07T23-13-56-562Z-877be0` and Ben 10 `2026-10-07T23-14-21-798Z-791881`. Ben 10 then received the selected feedback revision above. Resumes retained source/analysis after bounded errors; no final timeline was manually authored.

Junkyard additionally completed 563.86 seconds in `2026-10-07T22-57-19-345Z-f002ee`. Complete source review and older attempts remain in `data/experiments/category-batch-2026-10-07/junkyard-source-review/`. Actual footage corrects controller/analysis errors: earnings are native taps, not merges; the source ends in Garage. No hidden game/source/clock manipulation was used.

`--from-run` makes a new revision while preserving source. `--resume` retains configuration and immutable input hashes. Source windows are candidate evidence, not final cuts. Narration keeps exact WAVs for recognition recovery; bounded hints contain only proper names already in the script. Failed transcripts and semantic rejections remain recorded. Source preparation caches include code hashes and require fresh corrected evidence/review.

## Validation and limits

- Full opt-in native browser/media suite: **317/317 passed** after the screenshot/input repair. Later editing changes were validated separately.
- Strict core/editorial typechecks reject unused locals and parameters.
- Final editing suite: **58/58 passed**, including actual FFmpeg checks for delayed effects, AAC peaks, sparse timestamps, freeze/speed boundaries, changing dimensions, chapter timing and native sound alignment across six short cuts. Legacy rendering: **13/13 passed** after the source-clock fix.
- `22c4e05` and `5e62aff` passed GitHub Actions. The final branch results are in [GitHub Actions](https://github.com/tdschmidt/astrocade-content-workflow/actions?query=branch%3Acodex%2Fcore-workflow). The initial strict decoder sample-count assertion exposed platform padding differences and was corrected to test the intended endpoint without allowing truncation.
- Decoded source/picture review, real ASR and measured audio are **not** human listening or audience-retention evidence. Nothing was published. Preview-only asset restrictions remain in render metadata.

The final quiz has exactly 816,000 decoded audio samples over 17 seconds, a quiet final fade and no malformed AAC packet durations. Its Subaru answer appears within one frame of the source-mapped target. All selected earlier endings were separately checked. The story preserves the complete 37.187-second narration with a 0.313-second tail; the next incomplete drag during the fade is not claimed as a completed placement.

Final independent code review also fixed native game-sound drift by using lossless PCM audio in temporary MOV files and bypassing tempo processing at exactly 1×. A full-render fixture verifies six sounds within 10ms of their intended times and corresponding pictures within one frame. None of the nine selected meme sources contains native audio, and narrated outputs mute it; these candidates were unaffected and retain their original checked hashes.

Local review server: port **8778**, bound to `127.0.0.1`, serving `data/`. Restart with `python3 -m http.server 8778 --bind 127.0.0.1 --directory data`. Port 8777 belongs to the separate prototype gallery; do not replace it. Automatic approval review blocked opening this gallery through the browser connector over possible local-media exposure. Direct local artifacts remain available; no bypass was attempted.

Preserve unrelated untracked `:memory:.ses`, `docs/project-overview.md`, `docs/research-content-strategy.md`, `output/` and `research/content/`. Do not blanket-stage/delete them. The completed prototype package was intentionally committed; unrelated documentation/PDF artifacts were not.

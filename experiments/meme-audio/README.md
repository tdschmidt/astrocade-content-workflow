# Real audio experiment library

Eight downloaded source recordings replace the earlier procedural demonstration sounds: six recognizable meme effects and two creator-supplied phonk tracks. The integrated meme pipeline uses this catalog by default; `--audio-catalog` selects a separately reviewed subset for a particular run. The music is a licensed stylistic option, not a verified match to the Instagram reference or a claim that these tracks are famous meme hits.

`catalog.json` is the interface. Resolve `assets[].id` to its absolute `path`; use `relativePath` for a relocatable workspace. Each entry includes source/download URLs, uploader versus verified creator, SHA-256, duration, suggested trim, cue, mood, gain, permission status and attribution. The first seven IDs are stable; `badly` is the second music option.

| ID | Source length | Suggested source trim | Intended cue |
| --- | ---: | --- | --- |
| `vine-boom` | 1.255s | 0.065–1.24s | Dramatic realization/freeze |
| `bruh` | 0.817s | 0.025–0.65s | Deadpan reaction after a mistake |
| `metal-pipe` | 3.173s | 0–1.6s | Collision with ringing tail |
| `record-scratch` | 0.650s | 0.04–0.63s | Interrupt music at a reversal |
| `doge-bonk` | 2.113s | 1.12–1.85s | Small comic collision |
| `anime-wow` | 4.180s | 0.16–3.3s | Ironic admiration/reveal |
| `phonk-execution` | 126.616s | 10.84–34.84s | Rise then major energy change four seconds into excerpt |
| `badly` | 81.267s | 0–18.8s | Quick opening rise and energetic phrase |

All times refer to the downloaded source, before output placement. Doge bonk has more than a second of leading silence: honor the trim. SFX `onsetOffsetInTrimSeconds` is approximately 0.02s. The music cues come from waveform/energy measurements; a model did not listen to them here. Badly's 130 BPM is embedded in the creator's file metadata; Phonk Execution's roughly 130 BPM is estimated. Audition the final mix and adjust the beat alignment as needed.

## Permission fields

- `preview_only`: the Myinstants source exposes a public download, but original ownership and synchronization rights were not established. Its [terms](https://www.myinstants.com/en/terms_of_use.html) do not grant blanket commercial use. These familiar SFX are available for the requested local review only, pending clearance for publication.
- `attribution_social_only`: [Phonk Execution](https://onsound.eu/track/phonk-execution-phonk/) and [Badly](https://onsound.eu/track/badly-phonk/) have creator-page permission for social media and monetized videos when the exact credit is included. Paid advertising and specified other contexts require a separate paid license. The catalog preserves the required credit and exclusions.
- `commercialReady:false` is intentionally conservative: neither status means unrestricted clearance for an advertising campaign. `previewOnly:false` on music reflects the creator's narrower social-video permission.

Do not redistribute this folder as a public raw-sound pack. Present source links and credits with previews. An offscreen gallery credit is useful for review, but publishing the video under the music permission requires its credit in the actual post/video description. Every sound used in a published mix needs appropriate rights; the music license does not clear the soundboard effects.

## Acquisition and validation

Sources were inspected on 2026-10-07. Individual MP3 links were exposed by the soundboard download buttons or the creator's public audio player. The original files were downloaded without purchasing, logging into accounts, or posting anything. Creator-player metadata and concise permission evidence are saved beside the catalog. The normal Badly source is used, not its separately listed slowed variant.

Run `python3 experiments/meme-audio/build-catalog.py` after changing source files to refresh hashes and durations. It does not download or publish. FFmpeg and FFprobe must be installed. `validation.json` records checks of file existence, hashes, trim bounds, permission flags and full FFmpeg decoding. `audio-analysis.json` records the SFX onset measurements.

Begin around the catalog's suggested gain, duck music for vocal effects, and use a final limiter. Several source recordings are already loud; increasing their gain or stacking impact effects can clip. Use the sound that completes the visual joke, then leave space for it to register.

## Publication candidates

The final-candidate follow-up uses a separate local catalog containing creator-authorized music for credited organic posts and Kenney CC0 impacts. Preview-only effects remain available only in the historical experiment catalog. See [the selection report](../../docs/publication-finalists-2026-10-07.md) for exact run provenance, required credits and review limits. Do not replace a catalog inside an in-progress or saved run: its hash is part of the immutable editorial input.

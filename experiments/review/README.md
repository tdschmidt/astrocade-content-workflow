# Combined editing review

One local review page for the troll edits, narrated story, game overview and actual meme-audio library.

```sh
node experiments/review/build.mjs
python3 -m http.server 8777 --bind 127.0.0.1 --directory data/experiments
```

Open `http://127.0.0.1:8777/review/index.html`. The builder discovers completed renders and manifests in the three experiment `renders/` folders. It shows current revisions, retains earlier drafts behind a toggle, and includes source/credit records outside the videos. Archer v1, the simple Zombie overview, and Golem v3 remain comparison baselines. Golem's late drop does not establish that its final repeated toss is the strongest narrative payoff; see `../editorial-research-v2/golem-review.md`.

When `current.json` exists, its `videos` array explicitly selects the featured collection by render id, with optional titles, descriptions and credit notes. Every other completed render remains behind the earlier-drafts toggle. The builder rejects missing featured renders, so a partial batch cannot silently replace the three-video collection. Source credits are per video, with no hardcoded story attribution in the page footer.

Players use VP9/Opus WebM video and Opus audio previews with simple play, seek and mute controls. This combination was verified in the Codex in-app browser after its native media controls and MP4 playback crashed during testing. Original H.264/AAC MP4 downloads remain available. Preview transcoding changes encoding, not timing or editorial decisions. Starting a player pauses all others.

The actual audio catalog lives in `experiments/meme-audio/catalog.json`. Creator music credits appear beside the audition players; a published use would also need those credits in its description and the correct rights for every included sound. This page stays local and does not publish videos or source audio.

The builder is reproducible within this repository and requires the existing local source/output files. It does not generate editorial plans or make model requests.

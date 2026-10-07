# Gameplay editing lab

Three separate, reusable agent workflows, built against actual local gameplay and model-generated edit decisions. They remain outside the main production pipeline.

| Format | Process package | Key editing rule |
| --- | --- | --- |
| Meme / troll edit | `troll-editor/README.md` | A real setup, action and consequence; downloaded meme audio; reaction face attached to an observed head during a freeze. |
| Narrated story or explainer | `story-background/README.md` | Grounded narration and word-timed captions over satisfying progression; no repeated failed sections, even with falls cut away. |
| Game overview | `game-overview/README.md` | Explain the game premise, player choices and appeal from whole-game evidence; relevant pictures support the narrative without literal action commentary. |

Shared user preferences are in `editing-preferences.md`. All source credits stay in the review page and metadata, outside the video. The reusable real-audio catalog is `meme-audio/catalog.json`; its source and reuse evidence are documented in `meme-audio/README.md`.

Latest feedback updated prompts and code only; existing previews have not been regenerated. Phonk payoffs now reserve roughly 4–6 seconds for the drop and moving aftermath, ending on a resolved musical phrase. Story runs require a whole-selection progression review before script/voice generation. Read each package's latest-feedback section before reusing historical manifests.

When cloud speech quota is exhausted, [local narration](local-speech/README.md) can synthesize a new reviewed script with Kokoro. The audio is then recognized for genuine caption timestamps through the usual narration validator. Voice provenance remains explicit in the render records.

The follow-up [editorial research](editorial-research-v2/README.md) reviews public editing skills and primary platform guidance. The agent must identify the decisive gameplay event before syncing the dominant music/visual drop, and select an evidence-backed opening hook before narrating a game overview. These are editorial criteria; audience retention has not been measured.

## Watch everything together

```sh
node experiments/review/build.mjs
python3 -m http.server 8777 --bind 127.0.0.1 --directory data/experiments
```

Open `http://127.0.0.1:8777/review/index.html`. Current versions are shown first. Use the earlier-drafts toggle to compare against prior renders. The gallery includes audio auditions, off-screen credits, original MP4 downloads and exact edit plans. See `review/README.md` for preview compatibility and regeneration details.

## Evidence and integration

Agent requests, source-frame timestamps, drafts, transcripts, edit plans, rendered outputs and review evidence remain under `data/experiments/`. Runs preserve previous versions; failures are recorded rather than presented as successful agent edits. The repository packages contain prompts, constrained schemas, deterministic renderers and local tests. Renderers never execute model-supplied shell commands.

The integration boundary is a reviewed source selection plus a structured edit plan, audio catalog entries and validation evidence. Editorial planning and narration generation remain separate from rendering. Main capture and publishing behavior is unchanged by these experiment packages.

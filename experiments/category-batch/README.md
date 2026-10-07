# Category gameplay reels

This small adapter takes an existing core capture, its verified event analysis and optional feedback observations, then runs the separate [troll editing workflow](../troll-editor/README.md) on several source windows. It reuses that experiment's saved editorial/style prompts, shared editing preferences, revised agent schema, [real audio catalog](../meme-audio/catalog.json), reaction-face asset and FFmpeg renderer. It does not change the original run, capture another game, or publish anything.

The important difference from the initial troll experiment is the source scope: the editor sees several moments from the explored game, so it can show a choice, transformation, ability and consequence rather than being confined to one short event. The result remains at most 15 seconds. The long source and its capture trace remain available for different narratives; the final reel does not claim to exhaust every feature.

[games.json](./games.json) contains the eight selected categories, public game URLs and exploration goals. These are discovery hypotheses, not claims that every title has passed capture review. It contains no local run paths. Choose one record, then use its URL and goal with the existing CLI:

```sh
npm run pipeline -- --provider codex --stage capture --play feedback \
  --game 'PUBLIC_URL_FROM_GAMES_JSON' \
  --capture-goal 'CAPTURE_GOAL_FROM_GAMES_JSON' --capture-seconds 600

# Analyze the saved source without recapture or the older core editor.
npm run pipeline -- --provider codex --from-run data/runs/CAPTURE_RUN --stage analyze
```

Use the new analysis run printed by the second command as `--run` below. Review its source coverage first: a 600-second budget includes model latency and does not by itself establish six hundred seconds of useful play. This handoff is deliberately a few existing CLI steps, so a failed category can be retried or replaced independently.

The audio catalog stores local absolute paths and does not include the downloaded audio binaries. On a fresh checkout, acquire each required asset from its saved `downloadUrl` (with its `sourceUrl` and usage terms) into the catalog's `relativePath`, then run `python3 experiments/meme-audio/build-catalog.py`. This refreshes file hashes, durations and absolute paths for that checkout. The bridge validates the whole catalog, so all indexed files must be present. Do not copy another machine's absolute paths or repackage raw audio in the repository. See the [audio handoff](../meme-audio/README.md); preview-only soundboard clips do not become licensed publishing assets when downloaded. Preserve the creator's exact credit with allowed music uses.

```sh
# Inspect evidence preparation locally without a model call or render.
node --import tsx experiments/category-batch/edit.ts \
  --run data/runs/COMPLETED_RUN \
  --out data/experiments/category-batch/GAME-preflight \
  --prepare-only

# Agent chooses the style and edit; renderer produces video.mp4.
node --import tsx experiments/category-batch/edit.ts \
  --run data/runs/COMPLETED_RUN \
  --out data/experiments/category-batch/GAME-v1

# A bounded, explicit revision preserves the earlier output.
node --import tsx experiments/category-batch/edit.ts \
  --run data/runs/COMPLETED_RUN \
  --out data/experiments/category-batch/GAME-v2 \
  --style velocity --feedback /absolute/path/to/observed-review.txt

node --import tsx --test experiments/category-batch/windows.test.ts
```

If an independent source review finds better moments than the automatic candidates, supply `--windows /absolute/path/to/source-windows.json`. This replaces the entire candidate selection for that edit; it does not merge extra moments or change the saved core analysis. The JSON contract is:

```json
{
  "sourceSha256": "THE_64_CHARACTER_SHA256_OF_THE_SAVED_SOURCE",
  "sourceReview": "/absolute/path/to/source-review.md",
  "windows": [
    { "start": 155.3, "end": 159.0, "observation": "Readable question followed by a green correct answer and score increment." }
  ]
}
```

Use one to ten nonempty intervals, each at most30 seconds and entirely inside the unchanged source. A wrong source hash fails before inference. The bridge marks these as `source-review` leads, freshly decodes each interval and asks the editor to verify the described events from those frames. It retains the exact supplied JSON and its path/hash in the output provenance. It does not reinterpret an audit description as a core-analysis result or permission to use unseen footage; normal crop, timing, chronology, sampled-freeze and15-second checks still apply. This is useful for a quiz audit that preserves fair question→answer reading time while the automatic pass chose only result animations or easy wordmark logos.

`--game ID` disambiguates multi-capture runs. With no override, the adapter uses the selected capture or the sole capture. Inference uses the saved run's Codex model with the existing authenticated adapter (the signed-in default model for a source originally captured with Gemini). This is a local experiment, not a new core `editingStyle` value. Output directories must be new.

Source windows come from up to six existing core-analysis events plus up to four supplementary current feedback observations about selectors, transformations, unlocks, questions, stages or results. Each core window retains its exact prior `analyzedBounds`; the extra 0.4 seconds on each side is freshly sampled context, not previously verified footage. Every selected moment still needs support from the supplied images. Feedback is only a search lead: proposals, cumulative plans and intended actions are excluded; its time range must match actual during-action observations. One observed selection/setup and explicit level-ups, transformations or purchases take priority over repeating level mentions; negated or prospective clauses cannot earn that priority. Remaining slots are spread across the session. This small heuristic locates candidates only. Fresh frames are decoded from the source for all candidates. A selector is useful only if the images show a real causal choice and later consequence; it is never counted as an independent gameplay feature. Generic menus and obstructing aim overlays remain poor footage.

A capture-only run can be used before core analysis, but then the bridge only inspects up to four feedback leads. That fallback can miss most of the recording, brief effects or interesting events without matching feedback language; it is not a replacement for the core source scan. The request records this limitation as a warning. For the actual category batch, complete core analysis first and use feedback to supplement it. Neither a short sample nor a generated edit establishes that the agent thoroughly explored the game.

Each window is sampled at 1–8 FPS with at most 30 requested frames. Core windows cannot exceed 30 seconds; feedback windows cannot exceed 20. At most ten windows/310 decoded frames can enter a request, allowing for timestamp rounding at window edges. No model edit segment may cross an unseen gap, reverse source chronology, change source identity or exceed the 15-second output budget. A freeze may reference a frame up to 0.26 seconds before the preceding endpoint, covering a 4-FPS observation bucket plus timestamp rounding; moving clips get no such replay allowance. Deterministic validation allows one model repair and never silently changes its edit decisions.

The saved game-surface crop is immutable in the edit; raw source frames come with an explicit projection into the cropped720×1280 output. Faces attach only to an actual head during a freeze at an exact observed source-frame timestamp. The editor records the source and output head boxes in its evidence; visual review must confirm their placement. Floating decorative stickers and added watermarks are excluded. The job records whether the source actually has an audio stream; still images cannot establish sound. Music is audible from the opening by default, and intentional silence needs an explicit visible comedic purpose. Music and cues use only reviewed catalog IDs, real file durations and actual offsets; their rights restrictions and credits stay offscreen in metadata. Preview-only sounds remain preview-only.

Every output keeps the source hash, original-run hash, exact prompt text/hashes, renderer/schema/bridge source bytes, source frames/timestamps, generated drafts, validation, provider events, source-to-output timeline, encode/audio measurements and output hash. A changed source or audio file fails before inference. The renderer/schema/catalog and every referenced catalog audio path—including nested external audio directories—also have saved hashes checked immediately before and after rendering, so concurrent work cannot silently mix implementations or assets in an accepted result. If they change, preserve the draft and make a new version after the package stabilizes. An additive schema or renderer correction can reuse an unchanged plan after explicit revalidation in a separately recorded render attempt; a file-hash change alone does not justify another model call. The generated video needs actual visual review at phone size and listening review; a valid encode does not prove the joke or selection works. Do not count a stalled capture or menu-only sequence as a successfully explored game.

The three additional categories in this batch are transformation/power rosters (choice→transformation→distinct ability, velocity), physics chain reactions (setup→collision→cascading consequence, troll-freeze), and cursed tycoons (absurd premise→purchase→visible production or upgrade consequence, ironic-fail/troll-freeze). These are editorial hypotheses; a game earns its category through observed gameplay, not its title. A causal progression within one mechanic is valid material; the adapter does not require an artificial two-feature quota.

The story-over-parkour workflow remains separate. It needs sustained clean traversal and a separately grounded narration script; a short feature reel or repeated failed jump is not automatically a suitable background.

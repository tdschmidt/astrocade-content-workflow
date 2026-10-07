# The golem has plot armor

The new final sample is `data/experiments/troll-editor/renders/golem-plot-armor-v3.mp4`, with the adjacent manifest. Its container/video duration is 18.10 seconds (543 frames at 30 fps); its intended timeline and audio are 18.0667 seconds. It uses a fresh ten-minute Iron Golem capture from `data/runs/2026-10-07T22-06-08-887Z-d66b61`, not a re-export of the earlier Zombie sample.

The source has an earned reversal. A Creeper explosion, Skeleton attack and Wind knockback establish escalating damage. The later Anvil brings the heartbar nearly to zero. A giant native golden Totem then appears and refills the hearts; the ending confirms the upright golem with its restored red heartbar. The agent reserves the strongest music/visual treatment for the revival rather than rewarding the earlier attacks equally.

## Agent and source evidence

`data/experiments/troll-editor/golem-plot-armor-v3/` contains the exact request, prompt, sampled source frames, returned response, completed signed-in Codex inference events, validated plan, and semantic validation. Creative cuts, captions, face placement, and sound choices are the agent's returned plan. Targeted feedback from v1/v2 improved causal pacing, replaced unnecessary late padding with the distinct Skeleton attack, kept the music introduction audible through the buildup, and added a safely positioned reaction after the native reveal. Prior plans remain preserved.

The source is `8f309f1b-fde7-4877-8760-2ba827497e2d.webm` (SHA-256 `97cce92b0e682cd7db25651560be649191b9f67560c90fefb6ffc3047f0138b4`). Dense source frames in `data/experiments/troll-editor/evidence/fresh-golem/` place the first golden revival at approximately 465.1333 seconds, between the preceding near-empty frame at 465.1000 and the agent's sampled 465.154 anchor. `anvil-source-contact.jpg` and `totem-first-frame.jpg` document why this ranks above the ordinary hit reactions.

## Actual decoded result

The final review and waveform evidence are in `data/experiments/troll-editor/evidence/golem-plot-armor-v3/`:

| Check | Observed final result |
|---|---|
| First golden revival | Frame 473, 15.7667 seconds |
| Primary phonk content anchor | 15.77198 seconds, normalized waveform correlation .9979 |
| First deep-fry frame | Frame 474, 15.8000 seconds |
| Reaction-face onset | Frame 481, 16.0333 seconds |
| Encoded loudness / true peak | −14.28 LUFS / −1.99 dBTP |
| Bonk / metal-pipe timing | Both within 5 ms of planned placement |

Thus the main music arrives about 5.3 ms after the first visible revival, and the strongest visual treatment follows that audio anchor by 28.0 ms. This is within one rendered frame, not a claim of exact zero lag. `drop-dense.jpg` shows the decisive consecutive frames; `whole-edit.jpg` includes setup, escalating attacks, health drain, face hold and clean ending. `review.json` records machine-readable acceptance, and `waveform-review.json` records comparisons against the actual decoded AAC mix.

The crop removes platform chrome while preserving the character, Anvil, hearts, Totem and native UNDYING signal. Independent review at 360×640 confirmed that the face attaches to the head below the gold bar and left of the Totem. Some peripheral leftmost item-card content is cropped. Captions occupy empty wall space; there is no added game-name or credit watermark. The final clean tail shows the restored red hearts.

## Reproducible audio mastering

The unadjusted encoded mix measured −0.14 dBTP and correctly failed the renderer's original peak guard. A data-only isolated copy adds −3 dB of final post-normalization gain. It preserves the agent plan, timing and original guard, and leaves shared renderer/schema/catalog dependencies unchanged. `data/experiments/troll-editor/golem-mastering/` contains the exact base renderer, isolated renderer, reproducible diff and SHA-256 provenance. Re-render from the repository root with:

```sh
node --import tsx data/experiments/troll-editor/golem-mastering/render-mastered.ts \
  data/experiments/troll-editor/golem-plot-armor-v3/plan.json \
  data/experiments/troll-editor/renders/golem-plot-armor-v3.mp4
```

The successful final render passed full decode, stream-format and encoded peak checks. Audio timing was measured from real AAC output using original catalog waveform templates. This is technical synchronization verification, not a human listening or audience-retention test.

The soundtrack is Phonk Execution by Alex-Productions; sound effects are the existing Doge bonk and metal-pipe catalog files. Existing source/license notes and required off-screen credits remain in the manifest/catalog. This local preview was not published.

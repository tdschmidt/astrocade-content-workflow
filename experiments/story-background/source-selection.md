# Background-footage scouting

Target: about 35–45 seconds under a spoken story, with a moving game world and little interruption. The user's reference is third-person Roblox stair/ledge traversal. This selection therefore prioritizes sustained motion over a short comic payoff. No narration is authored here.

**Selected alternative:** a fresh native Rail Runner / RAIL JOURNEY recording, using source **2–10.5s** followed by **22–49s**, both at normal speed: **35.5 seconds of unique train traversal**, one forward cut, no loops or resets. This is a train-background demonstration, **not a successfully captured parkour take**. Both inspected obby candidates failed to provide an adequately supported traversal source. The exact [background manifest](background-job.json) records source identity/hash, crop, timings, evidence and limits.

## Existing recordings reviewed

| Candidate | Evidence inspected | Finding |
| --- | --- | --- |
| Ben 10, 600.042s first exploration | Full-source overview at one image per15s, native decision report | Long recording does not imply continuous motion. Frequent inference pauses, form menus and later featureless ground. No30–50s clean traversal take found. |
| Ben 10, 431.832s second exploration | Full-source overview at one image per10s, prior8FPS analysis, dense2FPS sheets at261–272s and280–291s | Several separate clean flight bursts, roughly239.8–247.5s,262.5–270.2s and281.5–290s. Between bursts the character lands and waits while inference runs. Usable no-repeat montage backup, not continuous parkour. Later platform ground is visually weak. |
| Minecraft Creation World, run35,121.412s | Entire recording at one image per5s plus existing dense analysis | Mostly standing in a flat field and placing four isolated blocks. No traversed parkour course or sustained forward progression. Rejected for background motion, independently of its earlier highlight rejection. |
| Crowd Pier Run, five captures | Capture manifests12.714–12.915s; prior actual gameplay frames4–12s | Forward motion is suitable in principle; earlier troll-edit rejection does not apply. Existing recordings are each only about13s and repeat the same opening gates. Concatenating them would visibly reset; looping cannot honestly supply40s. |
| Astro Runner,11.367s | Capture manifest and existing source inventory | Too short for the target; no longer unique recording exists in the inventory. |
| Car Wash Simulator,34.603s | Entire recording at one image per2s | Continuous useful cleaning from roughly0–26s, then car departure and modal result. A satisfying-task alternative, but it does not match the requested traversal background and cannot supply40s at natural speed. |

Overview images and dense review sheets are saved under `data/experiments/story-background/source-evidence/`. Coarse overview cadence is a scouting aid, not proof of exact boundaries. Any selected render needs denser verification of its actual window.

## Bounded fresh scouting

The parent initially authorized two fresh public-game candidates and about 120 seconds of native capture per candidate after the existing-footage comparison failed to find a clean take. After Rail Runner proved to be a train game, the parent explicitly added ONE LIFE OBBY as a third and final candidate to try to match the reference more closely. The experiment-only `capture-background.ts` reuses the existing inspector, timed control learner, native capture runner and CodexServices with its default model setting. It supplies an explicit 40-second sustained-traversal goal. It does not modify the main pipeline or use hidden game state.

1. **POPULAR OBBY** — public catalog ID `01M3WBJ6P4T8S4ZES9JV3T1616`. The bounded inspector observed a spinner then an empty dark iframe, including reobservations. No route, avatar, instruction or control mapping was visible. The learner rejected it and no source recording was started. Evidence: `data/experiments/story-background/obby-capture-02/`.
2. **Rail Runner** — public catalog ID `01KYNNYEY1VXE2HYZQDA71M27Z`. Actual visible title is RAIL JOURNEY: a third-person train on endless tracks. Visible instructions establish W/up throttle, S/down brake, Space horn and C camera. The model proposed a native timed sequence: six seconds throttle, roughly 40 seconds coasting with one horn, then brake/settle. The completed original source is **54.245s**, 720×1280, 30 FPS VP9 with **no audio stream**. Native inputs and all provider events are preserved in `data/experiments/story-background/rail-capture-01/`. No inference runs occurred during the timed gameplay recording.
3. **ONE LIFE OBBY** — public catalog ID `01M492C4VHV0E4096R6MS2T25W`. Loaded a 2D vertical platform course with visible left/right touch control and jump button, not the reference's third-person 3D style. Keyboard mappings were not visible. The existing single-pointer executor cannot simultaneously hold direction while tapping jump, and the jump trajectory/momentum were unverified. The learner declined a high-confidence timed route; no source capture was started. Evidence: `data/experiments/story-background/onelife-capture-01/`.

The initial `obby-capture-01` directory was created before an input-schema error in the experiment wrapper (`titleSource` had an invalid value). No inspection or gameplay ran in that directory. The wrapper was corrected to the catalog's `image_alt` provenance before the real inspection.

## Selected rail windows and exclusions

- **2–10.5s:** actual acceleration and forward track motion through green terrain. The initial start and nearly stationary opening are removed.
- **22–49s:** continuous forward motion, curved tracks, passing trains and transition into sandy terrain. The last 1.8 seconds include actual deceleration; the gauge still reads 13 km/h at source 49s. This supplies 27 seconds, not a repeat of the first window.
- **Excluded 10.5–22s:** a red deer warning appears, followed by life-loss feedback and a brief toast. These compete with unrelated narration. The selected montage does not claim a flawless or uninterrupted game run.
- **Excluded after 49s:** braking removes the useful motion; the speed gauge reads 0 by 51s. The stopped tail must not fill speech.

Reviewed evidence includes the full source at two-second intervals, the warning transition at 4 FPS, the tail at 2 FPS plus full-size 49s/51s images, and **71 exact timestamped source frames at 2 FPS across the selected windows**. Their mappings and JPEGs are retained under `data/experiments/story-background/source-evidence/`. No menu, reset or long idle state appears in the chosen samples. This is sampled visual QA, not a continuous playback or listening review.

Recommended game-surface crop is x=30, y=0, width=660, height=1176 from the 720×1280 source, preserving the train/route while removing Astrocade's footer and side strips. Relative to that cropped surface, centered story captions fit in the open sky at approximately y=0.13–0.30. Keep the upper HUD and horizon/track edges clear. Renderer review must confirm the final type size and wrapping.

Do not extend this 35.5-second source bed by looping, freezing, or silently calling it parkour. Shorter speech can trim its tail. For longer narration, shorten the script or obtain additional distinct footage. A future true parkour source can replace these windows through the same manifest contract; [the selector prompt](prompts/background-selector.md) explicitly requires genuine sustained traversal and reports failures rather than weakening the standard silently.

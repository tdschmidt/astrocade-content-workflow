# Editorial workflow and rendering research

Research date: 2026-10-06. The production goal is two good published videos made from real Astrocade gameplay. Selection, scripting, and rendering must preserve the relationship between what happened in the game and what the video claims.

## Select a game and an achievable moment

The selection unit is a game, a video format, and an achievable event. A popular game with attractive cover art can still be difficult to control, unreadable in portrait, or incapable of producing a short payoff. Initial metadata screening should therefore be followed by a short actual-play probe before committing to a concept.

Astrocade emphasizes quickly reaching enjoyable play and approachable controls. Its internal rankings also use player behavior, including median playtime. Those observations favor understandable mechanics, but private creator analytics must not be treated as publicly available inputs. Public counters must keep their original labels; cumulative plays do not measure current growth. [Astrocade design lesson](https://www.astrocade.com/create/academy/lesson-1), [Astrocade analytics](https://www.astrocade.com/blog/analytics-transforming-creation)

Use an evidence checklist instead of a purported viral score:

- Is the mechanic or objective understandable from the footage?
- Does actual interaction produce meaningful visible change?
- Is there a completion, transformation, near miss, consequence, or clear failure?
- Can the controller repeatably capture that event?
- Does the important action remain readable in the chosen portrait layout?
- Can every factual gameplay claim be tied to recorded evidence or verified game information?

The agreed balanced, popular, visual, and trend-led modes change ranking emphasis over the same eligible candidates. They do not bypass capture suitability. Preserve the reason a candidate failed. If capture support narrows every mode to the same small set, disclose that rather than implying broad game-playing ability.

## Evidence for content choices

YouTube describes recommendation signals including the decision to watch, viewing duration, percentage watched, and satisfaction; it does not prescribe one preferred Shorts format or a minimum posting cadence. TikTok's hypercasual guidance offers useful challenge/progress/reward patterns, but it is advertising guidance and should not be presented as proof of an organic Instagram formula. [YouTube guidance](https://support.google.com/youtube/answer/11914225?co=YOUTUBE._YTVideoType%3Dshorts&hl=en-GB), [TikTok guidance](https://ads.tiktok.com/business/creativecenter/quicktok/online/tiktok-hyper-casual-game-creative-tips/pc/en)

Public examples inspected in the browser on 2026-10-06:

| Example | Directly observed | Useful inference and limit |
| --- | --- | --- |
| [Astrocade top five games](https://www.instagram.com/reel/DZ6MQ-MirI9/) | Full-height gameplay, separate game/creator cards, approximately 69 seconds; profile displayed 6,841 views at inspection | A repeatable showcase can use real gameplay and attribution. This single example does not establish that compilations outperform one-game videos. |
| [Astrocade Neon Dash collaboration](https://www.instagram.com/reel/DX-bte-tk9U/) | On-camera creator, branded clothing, studio display, ambassador description; profile displayed about 3 million views | Creator identity and distribution are confounding factors. This is not a fair performance benchmark for an automated faceless account. |
| [Astrocade relatable skit](https://www.instagram.com/reel/DUjIkLlEtGI/) | Live-action situational humor and text | It shows variety in the brand's content, not evidence for gameplay-background narration. |

Counts are observation snapshots, not comparable experiments. Historical Astrocade articles can suggest satisfying gameplay archetypes, but their publication dates do not make the named games current trends. No growth experiment service or attribution system is warranted for two posts.

## Saved research without a trend scraping project

Use explicit refresh with Tavily Search, selective Extract, and a short model synthesis. Tavily currently supplies 1,000 free credits monthly; basic and advanced search cost one and two credits, while its separate Research product has much larger per-request bounds. The UI action named Refresh research must not accidentally call that separate product. [Tavily pricing](https://docs.tavily.com/documentation/api-credits)

Save URL, observation time, publication date when known, what was actually inspected, and the supported pattern. Distinguish direct observation, metadata, publisher claims, and our inference. Finding a video URL does not mean the application watched it. A saved snapshot remains usable when refresh fails, with its original date intact. A trend-led request with no credible fit reports no match rather than silently becoming an evergreen run.

Initial engineering defaults: at most four search queries and five targeted source extractions per refresh. These are adjustable cost controls, not claims about adequate scientific sampling. Discovery of Astrocade games should still come from live public Astrocade pages.

## From recorded evidence to an edit

Keep finalized local media authoritative. First inspect an overview, then examine the strongest candidate windows more densely. Gemini normally samples video at one frame per second and supports explicit rates and clip intervals. Its timestamps are proposals to validate, not ground truth. [Video understanding](https://ai.google.dev/gemini-api/docs/video-understanding)

Start with a 1 fps overview and inspect up to three candidate windows at 8 fps. A window should include enough setup and aftermath to establish the event. These are initial implementation defaults; if a decisive fast event remains unclear, inspect that window more closely or reject the claim. Do not send every captured frame to the model by default.

The analysis result contains observed events, usable source intervals, excluded spans, and the evidence for the proposed payoff. The edit plan contains ordered cuts, the purpose of each cut, hook, narration, and layout. All cut offsets refer to the finalized source file. Validate finite numbers, interval ordering, bounds, and minimum usable footage deterministically.

Generate the final script after this analysis. If the intended win never occurred, describe the actual failure or reject the concept. Do not invent completion, personal experience, difficulty statistics, or a result implied only by a score change.

Generate the narration next, measure its actual duration, and only then finalize the output timeline. Keep source-video, narration, and output-video times distinct. Shorten and regenerate an overlong script once before surfacing a draft issue. Never secretly repeat a decisive event to fill speech. Story backgrounds have looser semantic correspondence but should still avoid conspicuous accidental loops.

## Formats and composition

| Format | Required relationship to footage | Initial duration guidance |
| --- | --- | --- |
| Highlight | A clear setup, event, and observable outcome | Roughly 15 to 25 seconds |
| Narrated recommendation | Demonstrate one distinctive mechanic and one supported reason to try it | Roughly 20 to 40 seconds |
| Original story or factual explainer over gameplay | Original fiction identified appropriately, or facts supported by saved sources; readable background play | As short as the material permits |

These are editorial starting points, not padding targets. Retain both same-game and best-game-per-format comparisons; default to best fit and reuse captures. The user will choose the strongest two previews, with at least one game-centered video.

Use a small set of fixed portrait layouts. Fit the complete meaningful game region; do not crop away a player, target, or result just to fill the screen. For wide footage, place the sharp game image over a restrained blurred background. Keep phrase captions away from important game content and Instagram interface areas. Verify actual phone readability; a generic safe-area percentage is not proof.

Show game and creator attribution without a long title slate. Original game audio is optional as agreed. Narration provides the baseline audio path. Adding licensed music, sound imitation, or a music-generation service is not necessary to prove the assignment.

## Speech and caption implementation

Use the existing Google provider for the initial speech path: configurable `gemini-3.8-flash-lite-tts`, one prebuilt voice, one complete narration. Current unary TTS responses are WAV; style instructions belong in speech metadata, not text that may be spoken. Measure and validate the returned audio instead of assuming a raw PCM format. The current guide specifies the newer SDK/API schema, so pin the tested SDK rather than mixing older examples. [TTS guide](https://ai.google.dev/gemini-api/docs/speech-generation)

Transcribe the generated audio with `gemini-3.5-transcribe`, verbatim mode, and word timestamps. Do not combine timestamp mode with custom vocabulary. Build readable phrase cues from the recognized word intervals, then compare the transcript to the intended script. This is speech recognition, not forced alignment. Names, numbers, and punctuation can differ without proving incorrect speech; flag material differences for listening review. Validate nonnegative, ordered intervals within the measured audio duration. [Transcription guide](https://ai.google.dev/gemini-api/docs/transcribe)

Do not distribute intended script words evenly over estimated durations or replace unheard words merely to make the captions match. Retry invalid transcription once; preserve the draft when the result still needs attention. Regenerate speech when listening confirms an omission or wrong statement.

A local Whisper path is an alternative if the actual provider quota or caption test fails. Current Homebrew `ffmpeg-full` includes whisper.cpp support, and FFmpeg documents a Whisper transcription filter. It still needs a model and a quality test. Prefer evaluating this existing media-tool path before adding a large alignment package. Do not ship a provider fallback framework in advance. [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html#whisper), [Homebrew formula](https://formulae.brew.sh/formula/ffmpeg-full)

Gemini quotas are project/model specific and capacity is not guaranteed. Its temporary uploaded files expire; local source files must allow re-upload when needed. A paid upgrade is not an automatic recovery action. [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Files API](https://ai.google.dev/gemini-api/docs/files)

## Deterministic rendering and verification

Render from validated edit data using ordinary FFmpeg commands. The model cannot produce arbitrary filter expressions. Normalize cut dimensions and time bases before concatenation; reset each cut's timestamps. FFmpeg's concat filter expects segments to start at zero, and dimensions need explicit normalization. Generate subtitle files and pass arguments directly to the subprocess, keeping user text out of shell interpolation. [FFmpeg concat filter](https://ffmpeg.org/ffmpeg-filters.html#concat)

Use 1080 by 1920, 30 fps, progressive H.264 with 4:2:0 pixels, and AAC stereo at 48 kHz for the baseline export. Current Instagram Help specifies at least 30 fps and 720 pixels; the old API-specific acceptance range is no longer the governing reference for browser publishing. Converting a 25 fps source to 30 fps repeats frames and does not restore motion. [Instagram video requirements](https://help.instagram.com/1038071743007909)

Use a verified FFmpeg binary with libass and a bundled licensed font. The existing machine's regular FFmpeg lacks the required subtitle filters, so merely finding an `ffmpeg` executable does not pass preflight. Verify the configured binary, encoders, filters, and font before expensive generation.

Write a temporary render, await successful subprocess completion, inspect it with ffprobe, and only then promote it to a finished revision. Automated checks cover streams, dimensions, durations, file validity, and cut/caption bounds. Playback review still checks motion, unsupported claims, pronunciation, synchronization, subtitle overflow, and portrait readability. Two reviewed and published videos are the assignment evidence; model scores and successful command exits are not substitutes.

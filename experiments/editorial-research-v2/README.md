# Editing research: semantic payoffs and social hooks

Researched 2026-10-07 for the user's feedback on the editing lab. Public skill files were read as references; nothing was installed, executed, or granted access to local footage. This research changes the agent's editorial decisions before rendering. Beat synchronization alone does not determine whether an event deserves the edit's biggest effect.

## Findings that matter here

1. **Choose the decisive gameplay event before arranging the music.** An attack being shrugged off can establish the joke, but a later reversal, destruction, escape, or win can be the actual payoff. The user specifically wants the dominant audio and visual drop at that payoff near the end. Build the setup around it, then fit the music. This is our editorial interpretation of the user's examples and feedback, not a universal rule about all troll edits.
2. **An overview's first sentence must earn attention while remaining factual.** Start with the game's most surprising demonstrated rule, difficult choice, or visible consequence. Explain the goal and mechanics immediately afterward. A generic recommendation such as “For quick, playful destruction…” has little specific tension.
3. **Select footage with something to explain.** Prefer a game/run showing a goal, at least three meaningful decisions or interacting mechanics, and visible progression or consequences. A long list of visually similar attacks does not by itself create a richer overview.

## Public agent skills reviewed

| Source | Useful idea to adapt | Why it is not a drop-in replacement |
| --- | --- | --- |
| [Beat-Sync Edit SKILL.md](https://github.com/ZiadAbdelkarim/beat-synced-edit/blob/main/.claude/skills/beat-sync-edit/SKILL.md), with [pipeline README](https://github.com/ZiadAbdelkarim/beat-synced-edit) | Analyze music beats/energy, view footage contact sheets, inspect the edit decision list, and explicitly pin a chosen clip to a musical peak. Its effect guidance reserves stronger flashes/punches for peaks and offers a lower cut density. | Motion/brightness/energy scoring does not understand who won, whether an attack worked, or which event resolves the joke. Its instruction to lead with the highest-energy clip is not automatically appropriate for this user's setup-to-payoff style. Keep semantic event selection in our agent. |
| [Motion Video SKILL.md](https://github.com/bestagentkits/motion-video-skill/blob/main/skills/motion-video/SKILL.md) | Arrange music so drops occur where the script needs them; trace facts to evidence; inspect scene snapshots. | Built for HTML/GSAP motion graphics and narrated product announcements, with different aspect ratio/caption defaults and external providers. We retain our existing FFmpeg gameplay pipeline. |
| [Motion Video audio reference](https://github.com/bestagentkits/motion-video-skill/blob/main/skills/motion-video/references/audio-and-beat-sync.md) | Anchors attached to a beat or spoken word survive retiming better than arbitrary seconds. Read the source track's build/drop structure and arrange whole musical phrases around target anchors. Measure the result after mixing. | Its exact voices, durations, loudness choices, and provider commands are project-specific. Our event anchors must additionally reference observed gameplay source frames. Do not import its arbitrary numbers as a general social-video standard. |
| [OpenClip SKILL.md](https://github.com/OpenClip-App/agent-skills/blob/main/skills/openclip/SKILL.md) | Documents a real remote clipping/caption workflow with presets and asynchronous render states. | A hosted service with authentication and potentially paid processing. Its advertised virality score does not establish editorial quality, game understanding, or correct climax placement. Its watermark facilities conflict with the user's preference if enabled. Not needed for this experiment. |

## Primary creative guidance

- [YouTube: Shorts discussion with Todd Sherman and Jenny Hoyos](https://blog.youtube/creator-and-artist-stories/youtube-shorts-deep-dive/) (2025-01-28) describes an immediate hook followed by a compact story. This supports leading with an intriguing, concrete mechanic rather than a slow genre introduction. This is creator guidance published by YouTube, not a controlled guarantee that a particular script will retain viewers.
- [TikTok Creative Codes](https://ads.tiktok.com/business/en-US/creative-codes) recommends a hook/body/close structure, with suspense, surprise, or emotion in the hook, and deliberate use of sound/movement. It also advises vertical framing and space for platform UI. It is advertising guidance; we borrow clarity and structure without forcing an ad-like CTA or adding branding/watermarks.
- [Adobe: music-video editors putting action on the beat](https://blog.adobe.com/en/publish/2020/08/28/why-music-video-pros-choose-adobe-premiere-pro) describes changing footage speed so the action itself hits the music. Our application is to align the decisive visible event with the drop, rather than merely putting a transition on a convenient downbeat. [Adobe's editing tutorial](https://helpx.adobe.com/ph_fil/premiere-pro/how-to/edit-music-video.html) also covers beat markers and speed changes as practical mechanisms.
- [CapCut's Freeze troll face template](https://www.capcut.com/template-detail/Freeze-troll-face/7382814681502584070) is first-party evidence that a freeze/troll-face convention exists. Its page lists a two-clip template, but does not explain how to select the story's climax. A template cannot establish that a particular attack or freeze in our footage is the right moment.

We did not find a reviewed skill among these sources that independently supplies reliable troll-story understanding. The useful combination is **semantic event ranking + music anchors + restrained effects + frame review**, implemented in our existing agent workflow.

## Troll/phonk decision protocol

The following is a proposed project-specific editorial contract, synthesized from the sources above and the user's explicit feedback. The timing ranges are planning defaults, not published claims about retention.

1. Watch or sample the candidate sequence before choosing the song cut. List at least two potential payoff events, including source timestamps and what changes for the character. Rank them by narrative consequence, visible clarity, and relevance to the setup. Motion alone cannot win the ranking.
2. State the mini-story in one sentence: “The character seems immune to X, then Y finally changes the outcome.” If no meaningful change exists, choose a different sequence or explicitly use an endurance payoff; do not fabricate a reversal.
3. Name one primary payoff and a frame/time where the audience can first read it. Distinguish **action onset** from **outcome confirmation** when needed. Preserve enough normal-speed footage for cause and effect to be legible.
4. Build roughly 15–25 seconds around that event if the source supports it. For this user's late-payoff style, keep the main event in the final third and leave only a short readable aftermath. Do not stretch weak footage merely to satisfy duration.
5. An earlier survival/troll beat may use a short reaction or small sound accent. It must not spend the edit's maximum zoom, strongest shake, main musical drop, and longest freeze together if the actual climax is still to come.
6. Choose the music's actual build-to-drop transition and map its drop onset to the primary event. If musical phrasing and the story disagree, rearrange/trim the music or select another section. Do not move the payoff to an unrelated medium event just to fit an untouched song.
7. Reserve the dominant visual change for the primary payoff. Make a clearly visible contrast from the setup: a brief anticipation dip/slowdown followed by a punch-in, grade change, or controlled impact shake. The exact combination should fit the moment rather than applying every effect at once.
8. Face overlays require a verified head box in the transformed frame and tracking or a deliberate freeze. Inspect the frame before, at, and after the overlay. If the head is no longer visible, skip the face rather than attach it to an arbitrary body part or empty screen.
9. After rendering, compare music-drop time, visual-hit time, and the visible gameplay event. Review a continuous window around the event as well as still frames. A mathematically aligned effect may still be narratively premature.

Suggested review record fields: `setupMeaning`, `candidatePayoffs`, `selectedPayoffReason`, `sourceEventAt`, `sourceOutcomeReadableAt`, `outputPayoffAt`, `musicDropAt`, `dominantVisualAt`, `secondaryBeatRoles`, `afterwardDuration`, and a brief reviewer decision. Existing schema names may differ; this is a conceptual contract, not a new required API.

## Overview writer contract

Treat the first shot and first spoken sentence as one hook. The following is an original prompt supplement for our pipeline:

> Find the most distinctive demonstrated rule, risk/reward choice, or visible consequence in the evidence. Write three opening candidates: a surprising rule, a concrete challenge, and a curiosity question. Each must be true, easy to understand without knowing the game, and matched to a specific source shot. Choose the strongest one and explain why it wins. Begin speaking immediately, without a greeting, game-name title card, vague “worth playing” recommendation, or unsupported superlative. Explain the goal next, then show how two or three mechanics interact. Let each clause introduce a new fact or consequence and pair it with footage that proves it. Pay off the opening curiosity by the end. Keep names and credits out of the video overlays. Do not invent progression, multiplayer, hidden levels, or features absent from the evidence.

Useful structural forms, to fill only with observed facts:

- “You can [surprising action]—but [visible cost or constraint].”
- “The goal is [simple objective]. The problem is [unexpected obstacle].”
- “Would you [risky choice] to get [visible reward]?”

Before voice generation, reject an opening if it could describe dozens of unrelated games, takes multiple clauses to reach the interesting detail, promises an unseen outcome, or does not match the first shot. Score candidates on specificity, curiosity, factual support, and visual match; this score is an editorial aid, not a predicted retention percentage.

## What would establish improvement

Local review can establish that the climax is correctly selected and synchronized, the hook is specific, claims are evidenced, overlays are attached, and captions are readable. It cannot establish actual watch-time uplift. If the user later publishes, compare variants of the same format and similar length. [YouTube's Shorts analytics guide](https://support.google.com/youtube/answer/12942217?co=YOUTUBE._YTVideoType%3Dshorts&hl=en) documents viewed-versus-swiped-away and recommends comparing within format. [YouTube's retention guide](https://support.google.com/youtube/answer/9314415?hl=en-GB) explains that dips and spikes need interpretation; a rewatch can reflect confusion as well as interest. No publishing or measurement automation is activated by this research.

# Experiment boundary and integration path

This package is separate from the production pipeline. It reuses the existing `CodexServices` transport, frame extraction, media probing and process primitives without changing them. It does not capture new gameplay, publish media, or modify old run manifests.

The editorial instructions live in `prompts/system.md` and one selected `styles/*.md` card. `agent.ts` assembles them with a bounded source window, timestamped observations, job constraints and optional reviewer feedback. It delegates the creative edit plan to the existing authenticated Codex inference adapter. `render.ts` accepts a closed, validated edit language and uses FFmpeg to execute it. The plan is data, never a model-generated shell command.

## Before integration

1. Have the user review the actual sample videos, especially soundtrack feel, gag timing and reaction-face placement. Technical validity cannot establish taste or audience performance.
2. Compare at least two style plans on the same observed gameplay event. That comparison separates the style from the source's inherent appeal. Keep the original clean highlight as a baseline.
3. Make the existing analysis stage nominate candidate source windows and reject those without a clear visible consequence. The current experiment starts from windows scouted by a separate editing agent; it does not yet scan arbitrary hour-long recordings unattended.
4. Add an explicit effect-capability contract and this validated EDL at the rendering boundary. Preserve source-to-output mappings, source hashes, prompt versions, generated plans, validation failures and reviews. Existing pipeline overlay/timeline limits differ from the experiment and should not be bypassed by calling this a normal highlight.
5. Add a rendered-output critic that reviews dense frames around every effect boundary and checks actual audio levels. Feed concrete corrections back to the editorial model for a bounded new revision. Do not let a critic silently rewrite the plan, invent events, or repeatedly regenerate until it happens to pass.

## Soundtrack adapter

The shipped assets are original demonstration synthesis, not the commercial songs in the research. `tools/make-audio.mjs` regenerates the three 36-second beds and four cues. Each bed has a strong downbeat at source time zero, and `music.dropAt` places it on the output timeline. The renderer supplies a quiet anticipatory layer before that point. The original example captures contain no audio.

For user-supplied or separately cleared music, extend the asset registry with an immutable file identity, provenance, exact version, measured source drop, beat times, gain and any use constraints. The alignment calculation is `audio offset = output payoff time - source drop time`; don't infer a drop or BPM from a song title. Negative offsets require trimming, positive offsets require a deliberate introduction. Analyze the actual file, including any slowed/sped-up version. Keep platform music-library assembly as a separate delivery option with an audio-free master and cue sheet.

The current renderer uses fixed asset IDs and a source-zero drop contract. It is not a general commercial-track beat detector or automatic licensing service. The generated sticker and its exact generation prompt are recorded in `assets/reaction-provenance.json`; it is a newly generated reaction face, not a verified copy of the historical Trollface asset.

## What this experiment can establish

- An agent can turn observed gameplay and a style prompt into an executable, reviewable plan.
- The renderer can reproduce selected timing, speed changes, holds, color effects, overlays and audio cues from that plan.
- Saved outputs permit a concrete style discussion before changing the main pipeline.

It cannot establish that the music feels like a particular recording, that a sparse observation catches the exact best frame, that a joke is funny, or that any style is currently viral. Research references and proposed parameter recipes are labeled separately in `research/style-research.md`.

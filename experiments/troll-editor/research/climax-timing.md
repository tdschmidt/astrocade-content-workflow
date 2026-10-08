# Story-led drop timing

The user's October 7 review identified a concrete error: Zombie v4 spent the main music drop at output 3.93s on an early fire reaction, while the later bomb explosion was the stronger event. The earlier frame was valid and the face aligned, but the hierarchy was wrong. This is an editorial failure even though the media and schema checks passed.

## Online references consulted

- [Beat-synced-edit skill](https://github.com/ZiadAbdelkarim/beat-synced-edit/blob/main/.claude/skills/beat-sync-edit/SKILL.md): contact sheets, beat timestamps and an explicit clip-to-peak override are useful implementation ideas. Its motion/brightness scores cannot establish a narrative climax by themselves.
- [Motion-video skill](https://github.com/bestagentkits/motion-video-skill/blob/main/skills/motion-video/SKILL.md) and its [audio/beat reference](https://github.com/bestagentkits/motion-video-skill/blob/main/skills/motion-video/references/audio-and-beat-sync.md): arrange/splice music so a build resolves where the script needs its drop; use deliberate anchors and contrast.
- [Adobe: music-video editing](https://blog.adobe.com/en/publish/2020/08/28/why-music-video-pros-choose-adobe-premiere-pro): speed changes can bring the action onto a beat. For this experiment the source event remains truthful and continuous through contact.

These were read as references, not installed or executed. The following rules are our adaptation to the user's footage and feedback, not a claim of one universal troll-edit formula.

## Agent process

1. Rank at least two actual moments by the change they create, readability, surprise and relationship to the premise. Select one primary climax before choosing effects or music placement.
2. Label setup, escalation, climax and result in source time. Sample densely around the decisive change; a convenient intact head must not decide which event is the climax.
3. Build the cut around that event. Give minor earlier reactions smaller treatment; preserve anticipation and contact, then keep only the necessary result tail.
4. Map the event through all speed changes and freezes. Bring the real music anchor, strongest punch and main visual change to that mapped time. A later reaction freeze can hold a head that is still present, but its convenience cannot move the main event earlier.
5. Review frames before/on/after the event and the last frame. Check that no earlier effect is more dominant, the result remains legible, and the face follows the supported freeze-only contract. Numerical alignment does not establish whether the event itself was correctly chosen.

## Enforced declaration

New jobs can set `requireNarrativeBeats: true`. `ClimaxAgentPlanSchema` requires ranked candidates, setup/escalation/climax/result, mapped output time, the primary visual segment and strongest punch indexes, plus the reason for the remaining tail. Local validation rejects a main drop, strongest punch or visual onset more than two 30fps frames from the declared event.

This particular style defaults to a primary event at or after 70% of the output and no more than five seconds of result tail. These are reviewable local defaults, not research-proven retention thresholds. An evidence-based exception must explain why the footage needs different timing. Old agent/render plans remain compatible and are not silently rewritten.

The saved plan and render manifest retain this declaration. Human/visual QA must still verify that the declared event is actually the strongest observed moment and that the music anchor sounds right; an energy measurement alone is not audible verification.

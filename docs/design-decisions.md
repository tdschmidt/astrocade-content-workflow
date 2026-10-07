# Design decisions and rationale

Updated 2026-10-06. This record distinguishes user decisions from engineering choices and superseded proposals. The local application is implemented; [acceptance evidence](acceptance.md) separates tested local behavior from unverified live integrations. The current architecture is an Instagram browser workflow; earlier Meta API prerequisites are no longer part of v1. The user's latest scope decision, D48, takes precedence over earlier optional additions: finish the initial brief's core workflow first.

## Requirements and user choices

| ID | Decision | Reason and consequence |
| --- | --- | --- |
| D01 | Build a strong, concise take-home with no invented production requirements. | Code quality, working outputs, and explainable choices matter. Distributed infrastructure and service-level targets do not follow from the brief. |
| D02 | Address casual gamers and trend-driven viewers. | Selection can consider both understandable gameplay and supported cultural relevance. |
| D03 | Retain balanced, popular, visual, and trend-led selection, with saved research and explicit refresh. | Explore editorial choices without repeating paid or quota-limited research on every run. |
| D04 | Retain highlights, narrated recommendations, and original-story or factual-explainer backgrounds. | Different formats have different footage requirements; implement recipes over one pipeline. |
| D05 | Record growth hypotheses without building experiment infrastructure. | Two published posts cannot establish statistical performance conclusions. |
| D06 | Use successful storytelling structures as inspiration for original scripts. | Preserve distinct characters, events, and resolution; do not lightly rewrite someone else's story or falsely label fiction as a real anecdote. |
| D07 | Superseded by D48: a workbench shared through ngrok was an earlier preference. | Shared access is no longer a delivery requirement. Keep the local workbench for operating the core workflow. |
| D08 | Use hybrid gameplay for v1; broad generic visual play is a later direction. | Models interpret; local code performs bounded time-sensitive input. |
| D09 | Original game sound is useful but optional. | Silent gameplay plus generated narration is an acceptable baseline. |
| D10 | Prefer TypeScript and ordinary, well-supported tools. | Keep UI, orchestration, browser automation, and validation in one language. |
| D11 | Automatically produce finished drafts before publication review. | Do not require a human to select every intermediate frame or write the first script. |
| D12 | Prefer local and free-tier services. | No automatic billing activation or unapproved spending. Actual capacity still needs verification. |
| D13 | Require express approval for each intended external publication. | User-supplied instructions require it. Planning, draft generation, and an account-creation request are not approval to post unspecified videos. |
| D14 | Offer same-game and best-game-per-format comparisons, defaulting to best fit. | Allow useful creative comparison and share source captures where possible. |
| D15 | Allow hook, narration, and post-caption edits with rerendering. | Provide practical polish without a timeline editor. |
| D19 | Discover broadly, use reusable controllers plus small game profiles, and skip unsupported candidates. | The user explicitly selected this boundary. A new strategy or perception algorithm must not be disguised as profile configuration. |
| D20 | Choose the two submission posts after previewing them; at least one must be game-centered. | Judge actual results instead of choosing the pair before footage exists. |
| D27 | Plan for one or two focused implementation days. | Prove the difficult external dependencies first. This does not waive any hard requirement. |
| D28 | Fresh Instagram creation must be a capability of the delivered automation. | A pre-created account or setup instructions alone do not satisfy the user's clarified requirement. This corrects the earlier external-prerequisite assumption. |
| D29 | Investigate unattended creation first; allow human checkpoints if it is too difficult for v1. | The workflow still starts account creation, retains progress, resumes, and verifies the new identity. An exceptional handoff is reported explicitly. |
| D30 | Superseded by D41: an existing inbox was the initial verification direction. | The user later requested trying programmatic mailbox creation first, with configurable email as a fallback. |
| D31 | Use Instagram browser signup and browser publishing. Do not require Facebook or Meta developer signup. | The user starts without those identities and explicitly ruled out developer enrollment. Native upload of a local video removes that dependency chain. |
| D48 | Prioritize the simplest working implementation of the initial brief: find suitable Astrocade games, capture gameplay, create short videos, create a fresh Instagram account, publish at least two approved videos, and hand over the complete code. | The user explicitly deprioritized shared access and frills. This overrides earlier optional scope: additional research controls, format comparisons, model configuration, and hosted review must not delay the core outcome or become acceptance requirements. Remove the shared-access/password section and its setup reminder; retain the existing backend local-access boundary without a separate rewrite. Model overrides remain collapsed for resolving actual provider access issues. Code quality, truthful evidence, and explicit publication approval still apply. |

## Engineering decisions supported by research

These are selected implementation defaults, subject to the explicit feasibility tests in the plan. They are not claims that the user personally selected every technical parameter.

| ID | Decision | Reason and consequence |
| --- | --- | --- |
| D16 | React/Vite, Express, TypeScript, Zod, Playwright, FFmpeg, local JSON records, and local media. | A small coherent stack for the agreed workbench and automation. No database or agent framework is necessary. |
| D17 | Use configurable Google model functions and Tavily Search. | Reuse one provider for visual reasoning, writing, speech, and transcription; use explicit sourced search for the requested research feature. Test account quotas instead of promising unlimited free use. See [editorial research](research-editorial.md). |
| D21 | Select a game-format-payoff concept and analyze recorded moments before final scripting. | Screenshots and popularity alone cannot establish an achievable event. Every gameplay claim needs evidence. |
| D22 | Try timestamped transcription and phrase captions before a native forced-alignment package. | Reduces setup and dependency burden. Recognized text and timing require validation; transcription is not forced alignment. A local Whisper media-tool path is the first alternative to investigate on measured failure. |
| D23 | Prove account creation, live gameplay, recording quality, model capacity, and browser upload before UI expansion. | This replaces the old API-ingestion gate. These are functional dependencies rather than added production NFRs. |
| D24 | Use finalized media timestamps for editing, with coarse analysis followed by denser event windows. | Browser wall-clock observations and sparse video sampling are insufficient cut boundaries. |
| D26 | Use bounded Tavily Search and selective Extract rather than its Research product. | Retains the user-requested capability with predictable credit consumption. Record the difference between directly inspected examples and search metadata. |
| D32 | Give Instagram a dedicated persistent browser profile, separate from gameplay contexts. Start Instagram headed but automate ordinary steps. | A visible browser supports the accepted human handoff. Headed mode is not a claim of avoiding platform detection. Persisted authentication is a secret and stays outside the handoff. |
| D33 | Make the local server the sole workflow writer, with one active mutation operation. | Account setup, generation, rerender, and publishing share one lane. A mutating CLI, if retained, calls that server rather than creating another writer. Freeze edits to an active target until cancellation or completion. |
| D34 | Save publish intent before Share, bind approval to the exact revision/account/caption, and reconcile uncertain outcomes. | Browser publishing lacks the old API container handle. A timeout may occur after success; do not automatically click Share again. |
| D35 | Finalize the edit after measuring actual speech duration. | If speech exceeds authentic footage, shorten and regenerate once. Do not silently repeat a payoff, freeze a long frame, or truncate narration. |
| D36 | Export 1080 by 1920 at 30 fps for the browser upload route. | Current Instagram Help specifies at least 30 fps and 720 pixels. The previously cited Graph API range is no longer the governing path. A higher export rate does not recover missing source frames. See [Instagram research](research-instagram.md). |
| D37 | Use pinned full Chrome/Chromium in unified headless mode for gameplay, with a verified headed fallback. | Local tests proved native input and hardware-backed WebGL on this Mac; actual Astrocade parity remains a separate test. Do not add GPU flags or fake clocks without evidence. See [gameplay research](research-gameplay.md). |
| D38 | Record the composed game tab through native tab capture and explicit VP9 MediaRecorder in a separate local recorder tab. | Local comparative measurements favored its detail and data volume over the built-in recorder and JPEG transport. Matching Playwright 1.63.0/Chromium 153 confirmed 180 distinct frames in six seconds and final-chunk flush. Real-game compatibility remains a gate; JPEG to FFmpeg is a replacement decision if that gate fails, not a second shipped backend. See [capture research](research-capture.md). |
| D39 | Launch a dedicated browser per capture attempt, with its unique capture-title token allocated before launch. | Tab auto-selection is a browser launch argument and cannot be changed by opening a new context. Each attempt owns both game and recorder tabs, releases inputs, flushes recording, and closes its browser. One capture runs at a time. |
| D40 | Park human checkpoints and release the global operation slot after automated work stops. | An identity check should not prevent unrelated video generation. Preserve the Instagram session, reacquire the slot on Resume, and re-observe the page. Keep identity-specific signup and unresolved publication safeguards in force while parked. |
| D41 | Try Mail.tm programmatic provisioning; provide TLS IMAP as the configured alternative. | User requested this change. Persist credentials before creating one identity. Pending creation can authenticate that same identity, but never silently creates replacement addresses. The live attempt could not be verified; IMAP remains available. |
| D42 | Wait for the user's router repair instead of adding VPN Gate. | The user identified the local block and is fixing it. A VPN adds a separate operational dependency without proving better gameplay or Instagram acceptance; unaffected implementation continues. |
| D43 | Expose credential setup in the local workbench, with optional nonempty environment overrides. | The user has no external services configured. Private settings keep setup usable without putting credentials in chat or source; public status only exposes configured flags. |
| D44 | Reuse existing libraries for browser control, media, mail parsing, validation and UI. | User explicitly allows libraries; custom code is limited to the workflow's decisions and integration boundaries. Exact versions and the lockfile support reproducibility. |
| D45 | Preserve publication uncertainty across draft revisions. | Review found that approving a later revision could otherwise bypass an earlier uncertain Share. Block edits/new revision publication until the original intent is reconciled; expose the original recovery action in the UI. |
| D46 | Keep narrated duration content-led and preserve edited words on resume. | A hard twenty-second minimum was unnecessary. Measured speech must fit verified action. Only original generated copy receives one automatic shortening attempt; user-edited revisions require explicit edits. |
| D47 | Check real SDK request serialization with offline fixtures, then require separate live acceptance. | Typed inputs alone do not prove correct media delivery. Tests caught the need to request inline WAV explicitly and use the current nested word-timestamp configuration. They do not establish key access or quota. |

## Superseded proposals

| Previous proposal | Why it changed | What remains useful |
| --- | --- | --- |
| Owner creates the Instagram account before running the application | The user explicitly rejected externalizing fresh account creation. | Accurate recovery details and exceptional identity checks may still require the owner. |
| Official Instagram Login publishing through a new Meta app | It introduced Facebook/developer prerequisites the user does not have and has ruled out for v1. | It remains background comparison evidence, not a fallback the implementer should quietly build. |
| D18 signed public video URLs and Meta ingestion hosting | Browser publishing uploads the local MP4 directly. D48 also removes shared hosting from delivery scope. | The existing backend local-access boundary stays in place; no sharing setup is needed for the core workflow. |
| D25 API container IDs and `is_ai_generated` request fields | These belong to the removed API publisher. | Exact-revision approval and appropriate disclosure remain; the actual browser controls must be inspected. |
| A generic CLI directly executing alongside the web server | It would violate the single-writer assumption and create avoidable races. | A diagnostic CLI or thin client of the server is compatible. |
| Fixed 25 fps final export based on recorder or API behavior | Browser/Reels Help calls for a 30 fps minimum. | Source cadence must still be measured honestly. |
| Native alignment package as an assumed default | Current provider transcription and existing media-tool alternatives can be simpler. | Add a different timing implementation only after a representative quality or quota failure. |
| Playwright built-in video as the final capture master | Synthetic testing revealed avoidable compression loss and fixed 25 fps. Native VP9 capture performed better in the tested scene. | The built-in recorder remains useful for diagnostics; the research retains a tested JPEG alternative. |

## Constraints that decisions do not resolve

Instagram's terms restrict automated account creation and automated access without its permission. The browser route is technically plausible and user-selected; it is not an officially supported provisioning API. Human code entry does not eliminate that platform restriction. Preserve this limitation in the handoff rather than claiming guaranteed unattended creation. [Instagram terms](https://help.instagram.com/581066165581870/)

Live Astrocade access, actual suitable games and controls, signup completion, mailbox-code retrieval, fresh-account upload availability, model account quotas, and two published results remain unproven. A successful local browser fixture or a loaded signup form is evidence only for that narrower capability. The [requirements audit](requirements-audit.md) defines what would establish the remaining requirements.

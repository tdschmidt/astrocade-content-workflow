# Requirements and implementation readiness audit

Audited 2026-10-06 against the assignment and the user's later choices. Read this with the [implementation plan](../PLAN.md) and [decision record](design-decisions.md).

The plan now assigns an implementation and a concrete proof to every hard requirement. No live integration is considered complete merely because its documentation exists. Research establishes a plausible design and exposes the remaining risks; the production application, fresh account, and two posts have not been built or created during this research.

The central delivery risk is external acceptance, not missing infrastructure. Astrocade could not be reached from the tested environment. Instagram's signup form loaded, but registration and posting were not attempted. These facts make a promise that the entire assignment will fit in two days premature. The first implementation session must resolve those dependencies.

## Traceability to the brief

| Requirement | Chosen implementation | Evidence required for completion | Current evidence and gap |
| --- | --- | --- | --- |
| Find suitable Astrocade games | Discover from live public pages, save source evidence, rank by the selected mode, then probe control and editorial suitability | A run discovers real current candidates and explains why the chosen footage concept is achievable | Public pages appear in web crawls. Live category/game access from this environment failed. Cached lists and a hardcoded final pair do not pass this requirement. |
| Repeatably capture usable gameplay | Bounded reusable controllers with verified game profiles; native tab recording in a dedicated browser; finalized local source files | Start, play, record, reset, and repeat with understandable action and an observable event; demonstrate reuse on another game | Synthetic native input, hardware WebGL, and recording work. No actual Astrocade interaction, reset behavior, portrait composition, or capture has been verified. |
| Automatically create short videos | Analyze recorded events, write evidence-grounded scripts, synthesize speech where needed, derive captions, and render through a typed FFmpeg edit plan | Actual gameplay produces a finished preview without manual editing or writing the initial script; claimed payoff, captions, narration, and composition survive review | Provider capabilities and media steps are researched. Actual model quota, speech/caption quality, installed subtitle rendering, and an end-to-end draft remain untested. |
| Create a fresh Instagram account | Direct browser signup, one existing-inbox adapter, persisted progress, exceptional resumable human checkpoints | Workflow initiates signup and handles recognized steps; records the new identity; reopens its own session; verifies public setting and upload readiness | Initial signup form reached HTTP 200 and rendered. No fields were submitted. Inbox provider/access is unspecified. Acceptance after submission is unproven. Manual-only signup or an existing account is not a substitute. |
| Publish at least two videos | Upload immutable approved local MP4s through the browser composer; Share once; reconcile uncertain outcomes | Two distinct playable permalinks on the intended fresh account with matching content/captions and necessary settings | Desktop upload is documented. Fresh-account availability, actual disclosure controls, and publication remain untested. Two previews or two successful clicks do not count. |
| Hand off complete code | Source, lockfile, setup/preflight, commands, profiles, tests, decisions, sample run record, and actual post URLs | Reviewer can follow the instructions without the author's personal browser, hidden gameplay work, or Codex-only connectors | Planning documents and research fixtures exist. Production code and a clean handoff rehearsal remain to be completed. |

Repeating captures and using a second game are proposed proof methods for repeatability and reuse, not invented throughput or reliability targets. The brief does not require a universal game player, cloud deployment, round-the-clock service, or guaranteed viral performance.

## What the experiments actually establish

| Observation | Supported conclusion | Unsupported extrapolation |
| --- | --- | --- |
| Full Chrome 148 in headless mode created hardware-backed WebGL2 and delivered trusted keyboard/pointer events to an iframe canvas | The local browser/input substrate is viable | Astrocade loads, accepts these controls, or offers an easy controller |
| Isolated Instagram signup rendered contact, password, birthday, name, username, and Submit controls | Browser-driven signup can reach a real initial form | Verification, successful account creation, absence of challenges, or permission to automate |
| Built-in Playwright recording lost visible detail in a synthetic moving scene; explicit native VP9 preserved more sampled detail | Native recording is the stronger tested local default for this project | All games need this recorder or all native recordings will have the measured quality |
| Matching Playwright 1.63.0 and Chromium 153 produced 180 distinct decoded frames over approximately six seconds, with final chunk and ended track | Selected pinned browser/codec path works on the synthetic fixture | Real-game capture, audio, long-running stability, or Instagram recompression quality |
| Incremental transfer appended ordered chunks, validated the normal output before promotion, and canceled with a write outstanding without producing a ready file | The proposed chunk-transfer and orderly cancellation mechanism works on the short fixture | Recovery from a killed process, full disk, recorder-page crash, or a normal-length live game capture |
| Astrocade homepage and direct game requests failed; a normal-browser view showed an offline fallback | Live access is an unresolved environment/dependency gate | Astrocade is globally down or blocks all automation |
| The installed regular FFmpeg has no subtitle/ASS filters | Existing `ffmpeg` on PATH is insufficient for planned captions | FFmpeg itself cannot render captions; a configured libass build addresses that dependency |

See the [capture measurements and reproducible scripts](../research/probes/capture/README.md), [gameplay probe account](research-gameplay.md), and [Instagram evidence](research-instagram.md). Neither cached pages nor synthetic scenes are submission footage.

## Decisions that changed under scrutiny

1. **Account creation stays inside the system.** The earlier idea of treating it as owner setup would skip the clarified requirement. Ordinary forms and email verification belong in delivered code; exceptional identity checkpoints pause and resume the same attempt.
2. **The chosen Instagram route has a real limitation.** Browser signup and publishing avoid the rejected Facebook/developer prerequisites, but Instagram restricts automated account creation/access without its permission. Owner consent and human code entry do not remove that restriction. No supported account-provisioning API was identified. This must remain visible in the handoff, not be described as a solved robust integration. [Instagram terms](https://help.instagram.com/581066165581870)
3. **The inbox is an integration, not just an email address.** Select one adapter after confirming the existing provider and usable API or IMAP access. A normal mailbox password may not work. Do not build several speculative adapters or use the assistant's connector as a hidden runtime dependency.
4. **The recorder now has a precise lifecycle.** Allocate a unique title token, launch the attempt's browser with its matching selector, open game and recorder tabs, record, flush, validate, and close. Reusing a browser while changing a launch-time selector would be a design bug.
5. **Gameplay support has an honest boundary.** Models interpret and local controllers execute finite actions. Profiles configure proven interaction patterns; a new detector or strategy is new development. Unsupported candidates are skipped with reasons. Random movement does not establish useful play.
6. **Speech determines the final timeline.** Select real moments before writing the final script; measure the generated narration before locking cuts. Shorten overlong text rather than fabricating loops, freezing a payoff, or clipping speech.
7. **Publication uncertainty is durable state.** Persist intent before Share. After a timeout, inspect the account before considering another attempt. Browser automation cannot promise exactly-once publication. Draft edits invalidate approval for the old revision.
8. **The workbench has one writer.** A server operation owns mutations, cancellation, and state updates. Immutable source/media revisions support rerendering. A second direct-writing CLI, database, queue service, or generic workflow engine adds no necessary capability here.
9. **Human checkpoints do not occupy the worker indefinitely.** Stop automation, persist `needs_attention`, and release the operation slot while keeping the Instagram session available. Resume reacquires the slot. An unresolved signup or Share outcome remains protected from duplicate attempts even while unrelated generation proceeds.

## Remaining design input and execution gates

The mailbox provider and already available access method are the only current user input that selects an unresolved integration implementation. The question is pending. Username alternatives, display name, real birthday, and password are normal runtime inputs; private values should be entered locally, not into this document. The user has also been asked whether Astrocade works in their normal browser to help diagnose access.

| Gate | Smallest decisive test | Response if it fails |
| --- | --- | --- |
| Live game access | Load a current category and game interaction surface in the app-owned browser | Diagnose once using the user's ordinary access result; keep the dependency visibly unmet. Do not substitute synthetic or cached footage. |
| Signup and inbox | Execute one intended fresh-account attempt and retrieve its verification through the chosen adapter | Resume recognized checkpoints. Preserve unknown outcome; do not create another account blindly. An unresolved challenge leaves the requirement unmet. |
| Upload readiness | Inspect public setting and actual Create/composer controls on that account | Resolve the observed restriction. Do not invent an account-warming schedule or quietly reintroduce API enrollment. |
| Useful automated play | Repeat a meaningful segment from reset, then demonstrate controller reuse | Choose a simpler candidate when control requires a disproportionate perception project. Report the supported set. |
| Native real-game capture | Record the composed game, verify stop/cancel, inspect playable source and portrait output | One headed diagnosis, then select the researched JPEG replacement if appropriate. Do not ship competing capture backends preemptively. |
| Provider and renderer | Generate one actual narration, timestamp it, render captions, and inspect the output | Preserve artifacts on quota or quality failure. Test the specific local alternative only when needed; no billing activation by default. |
| Synthetic-audio disclosure | Inspect the actual browser publishing controls for the selected narrated content | Resolve an ordinary supported UI route or propose a concrete content change before Share. An API field or caption is not assumed equivalent. [Meta guidance](https://about.fb.com/news/2024/02/labeling-ai-generated-images-on-facebook-instagram-and-threads/) |
| First real publication | Publish one expressly approved exact revision and verify its permalink/media | Repair observed errors; reconcile ambiguous success. A manual post does not demonstrate the publisher. |

The next decisive evidence is execution, not another comparison of browser frameworks. Documentation cannot promise which verification challenge this owner will receive or whether a fresh account has all composer controls.

## Practical implementation sequence

First establish the external path: account creation and upload readiness, live game access, and one useful capture. Resolve inbox access and FFmpeg capability before building around assumptions. These investigations can proceed independently while no conflicting mutation is running.

Then implement one complete draft through analysis, speech, captions, render, and preview. Run the first approved publication early enough to repair actual composer/media issues. After that proof, build the agreed options over this same path and publish the second selected video. Finish by restarting, rerendering from existing source footage, demonstrating publication deduplication/reconciliation, and rehearsing setup and handoff.

The four selection modes, saved research/refresh, three format families, comparison modes, editable drafts, and shared workbench are user-agreed scope. They are not all hard requirements in the original brief, but cannot be silently dropped. If external gates consume the available one or two days, raise that tradeoff explicitly with a concrete remaining-work list. Compressing every stage into a schedule does not make the dependencies disappear.

## Review and test focus

Meaningful automated checks cover stale verification messages, unknown signup state, account mismatch, held-input cancellation, late model responses, invalid cuts and transcript timing, narration overrun, partial media promotion, restart/resume, repeated Share requests, and lost publication confirmation. Keep fixtures small and sanitized. Live proofs establish platform acceptance; fixtures establish local decision and recovery behavior.

For the submitted videos, review actual phone-size playback: understand the objective immediately, see the claimed action/outcome, read captions without losing the game, hear correct narration without clipping, and avoid setup/loading/frozen tails. Verify the platform-processed version as well as the local render. These are concrete definitions of usable output, not speculative service-level requirements.

The final handoff should state which steps were fully unattended, which human checkpoints actually occurred, which games/controllers were tested, and where the two posts can be viewed. A candid supported system is stronger evidence than an interface that implies capabilities the run never exercised.

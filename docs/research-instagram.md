# Instagram account creation and publishing research

Research date: 6 October 2026. Status: implementation plan, not a completed integration. This document owns the Instagram portion of the take-home; recommendations are distinguished from user decisions and observed behavior.

## Scope and conclusions

The chosen route is one local TypeScript/Playwright workflow that creates a fresh Instagram account through the public signup interface, reads its verification email through the owner's existing inbox access, and uploads finished videos through Instagram's desktop interface. The first attempt should execute unattended. A visible browser can still be unattended and allows the owner to complete an exceptional checkpoint in the same session.

This retains the assignment's account-creation requirement. Supplying an existing Instagram account or giving the owner signup instructions is not equivalent fulfillment. The user has explicitly excluded Facebook signup, Meta developer registration, and Graph API setup. The chosen verification route reuses an existing owner-controlled inbox rather than adding another service-registration dependency.

The largest remaining uncertainty is whether Instagram will let this specific new account finish registration and publish, including any verification or account-specific restriction. Documentation cannot settle that. Prove account creation and one real, approved publication early, then finish the second video and handoff. Do not spend the first day polishing a dashboard while these gates remain untested.

Instagram's Terms restrict automated account creation and automated access without its express permission. Owner authorization and a human-entered verification code do not constitute that platform permission. The browser route therefore has a documented supportability/terms limitation; it must not be presented as an officially supported automation integration. No stealth modifications, challenge bypass, account vendors, repeated account creation or proxy rotation belong in this design. [Instagram Terms](https://help.instagram.com/581066165581870)

## What is actually proven

| Claim | Evidence and confidence | Consequence |
| --- | --- | --- |
| Public signup is reachable with the installed automation stack | **Observed, high for the initial page only.** An isolated headless Playwright session using installed Chromium build 1223 reached `/accounts/emailsignup/`, received HTTP 200, and rendered email/mobile, password, birthday selectors, name, username and Submit after a bounded wait. No failed requests were reported. | We can begin implementing against an actual rendered form. This is not proof of post-submit verification or account creation. |
| Instagram supports signup on its website | **Documented, high.** Official guidance describes creation through Instagram.com or the app, with contact verification and account details. [Create a profile](https://help.instagram.com/155940534568753) | The system can execute public web signup rather than requiring a native-app stack from the outset. |
| Desktop video upload is a supported user flow | **Documented, high; fresh-account availability untested.** Official Help describes Create → Post → Select from computer → editing → caption/settings → Share. [Record a reel](https://help.instagram.com/2720958398006062) | Upload the rendered local file. No public media host, Facebook account or developer app is required by this flow. |
| API account creation is available | **False for the documented IG User resource.** Its Creating operation is unsupported. [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user) | The official publishing API does not solve creating the fresh account. |
| Signup, email confirmation, public profile and two posts work end to end | **Unproven.** No signup input or submission, mailbox access, account mutation or publication was performed during this research. | These are explicit implementation acceptance gates, not completed research outcomes. |
| The desktop composer exposes every required disclosure/setting | **Unknown.** The documentation establishes a composer, not the exact controls offered to this new account. | Inspect the first real upload before claiming full publishing support. |

The observed signup page includes birthday fields on the first screen, while some help instructions describe different screen ordering. Detect the current screen from its controls; do not encode a fixed sequence of page numbers.

## Requirement traceability

| Brief requirement | Instagram-side obligation | Completion evidence |
| --- | --- | --- |
| Find promising Astrocade games | Accept a selected game URL and source attribution with each draft. | Published artifact remains traceable to its game and selection record. |
| Capture gameplay repeatably | Accept a validated recording/render, not a manual upload outside the workflow. | Run record links source capture and final media file. |
| Automatically create short-form videos | Consume an immutable finished video, caption and cover choice from the video stage. | Local preview and media validation pass for the approved revision. |
| Create a fresh Instagram account | Workflow fills and submits signup, handles supported email verification, resumes after checkpoints, and verifies the resulting account. | New username, profile URL, successful session reopen and recorded creation outcome. |
| Publish at least two videos | Workflow performs two explicitly approved publication actions and verifies their results. | Two distinct Reel/post permalinks on the intended account; playable media and matching captions. |
| Hand off complete code | Include browser handlers, the selected inbox adapter, recovery behavior, setup instructions, limitations and tests. | A reviewer can run the documented commands without the author's personal browser profile or hard-coded secrets. |

Human checkpoints are an accepted fallback, not evidence that a run was fully unattended. Record which steps needed help. If signup cannot complete, the fresh-account requirement remains incomplete; a manual-only substitute needs an explicit scope change.

## Framework decision

**Recommendation: direct Playwright in TypeScript for signup and publishing.** Authentication and publishing have a small set of recognizable screens, consequential actions, and clear outcomes. Explicit handlers are easier to inspect, test and recover than a general agent deciding its own next action.

Use role/label locators scoped to the active dialog, then inspect the resulting page state. Playwright resolves locators against the current DOM and provides actionability checks, but a successful click does not prove account creation or publication. [Locators](https://playwright.dev/docs/locators), [actionability](https://playwright.dev/docs/actionability)

| Option | Fit for this deadline | Decision and reasoning |
| --- | --- | --- |
| Direct Playwright | Existing TypeScript stack; explicit file input, form and session support. | Recommended baseline. Keep selectors and screen classifiers in one adapter so UI changes have a small repair surface. |
| Browser Use | Offers an LLM browser agent, screenshot/vision input, configurable tools and failures; its documented local setup uses Python. [Quickstart](https://docs.browser-use.com/open-source/quickstart), [agent parameters](https://docs.browser-use.com/open-source/customize/agent/all-parameters) | Reject as the signup/publish controller for v1: another runtime/model dependency and less predictable failure recovery. Its general capabilities are not evidence of reliable Instagram signup. |
| Stagehand | Offers model-assisted actions and deterministic execution of previously observed actions. [Maintainer action documentation](https://github.com/browserbase/stagehand/blob/main/packages/docs/v3/references/act.mdx) | Reasonable future aid for low-risk UI discovery, but adds an abstraction without removing authentication, challenge or ambiguous-publication problems. Pin a release before relying on features documented on the main branch. |
| Native mobile automation | Appium requires platform-specific drivers and toolchains. [Appium requirements](https://appium.io/docs/en/latest/quickstart/requirements/) | Reject as a parallel v1 stack. Consider only if a required checkpoint genuinely exists only in the mobile app; that is a visible exception, not an automatic migration of the whole system. |
| Official Instagram publishing API | More structured publication responses, but does not create the account. Meta developer registration's documented route starts from a Facebook login. [Developer registration](https://developers.facebook.com/documentation/development/register) | Rejected by user scope. Do not reintroduce Facebook/app/OAuth setup as an invisible prerequisite. |
| Reverse-engineered private APIs or purchased accounts | Could shorten a demo superficially, but rely on undocumented auth, endpoints or third-party account provenance. | Reject: poor handoff and supportability, and purchased/pre-created accounts do not fulfill system-created signup. |

## Account creation implementation

Use a dedicated application-owned persistent browser profile for this account, separate from gameplay and the owner's everyday Chrome profile. Playwright stores browser session data in that directory; only one browser process may use it at a time. Its documentation specifically warns against automating the default personal Chrome profile. [Persistent contexts](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)

Proposed runbook, executed by the system:

1. Validate supplied owner inputs: existing email address, actual owner birthday, display name, desired handle and an approved small list of handle alternatives. Read the password from local ignored secret configuration. Do not invent birthday, identity or telephone details. Official signup guidance asks for the owner's birthday even when the profile represents a business or project. [Create a profile](https://help.instagram.com/155940534568753)
2. Open the isolated browser. On resume, first inspect whether the intended account is already authenticated; never start another signup merely because the last process crashed.
3. Establish the mailbox watermark, open signup, fill the visible controls, inspect field validation, and submit once. A username collision selects only a pre-approved alternative; exhausted alternatives produce a specific checkpoint.
4. Classify the next screen: email confirmation, optional onboarding, validation error, account home, phone/challenge request, or unknown. A timeout is an unknown state, not permission to submit again.
5. For a recognized email-code screen, fetch a fresh matching message, parse the code locally, fill it and verify advancement. The actual message format, sender and code length must be established from the first real email; do not pretend they have already been observed.
6. Complete ordinary optional onboarding without creating extra external actions. Skip suggested follows/contact syncing and leave any option to publish the profile picture as a first post off. These are not required to create or publish the two videos.
7. Verify the active username, profile route and successful session reopen. Record account creation separately from publishing readiness.
8. Inspect account privacy and the desktop Create entry. Configure the approved project profile as public and verify the setting rather than assuming a fresh account defaults to public. Instagram documents public/private controls, with age-dependent defaults. A logged-out login wall is not proof that a profile is private. [Privacy setting](https://help.instagram.com/448523408565555), [who can see posts](https://help.instagram.com/517073653436611)

Suggested durable states are `not_started`, `signing_up`, `waiting_for_verification`, `needs_attention`, `created`, and `ready`. Store only state, attempt identifiers, timestamps and nonsecret account identifiers. Keep an ephemeral reason/next-action display for checkpoints. Passwords, DOB, codes, raw mail and browser cookies must not appear in logs, traces or the repo. Browser authentication state can impersonate an account, so exclude profile/storage files from source control. [Playwright authentication guidance](https://playwright.dev/docs/auth)

A visible/headed browser is the proposed first-run default. It still follows the entire recognized path without human interaction. If Instagram asks for SMS, identity confirmation or an unrecognized challenge, stop automatic input, expose the same browser and let the owner complete that checkpoint; resume by observing the page afterward. Do not attempt to defeat the checkpoint. If it cannot be completed, persist the reason and keep the unmet requirement visible.

After stopping automatic work, park the attempt as `needs_attention` and release the server's active-operation slot. Preserve its browser/session for the owner; Resume reacquires the slot and inspects the page. Unrelated generation may proceed meanwhile, but another signup for the same intended identity cannot start. An uncertain publication likewise keeps its no-repeat-Share guard while parked.

Professional conversion is optional for browser publishing. Official Help documents a web conversion route, but adding it before the first upload creates another unnecessary state transition. If later useful, inspect More → Settings → Account type/tools → professional account options and verify the resulting public profile. [Professional account setup](https://help.instagram.com/2358103564437429)

Recovery setup belongs in the handoff. Instagram documents authenticator-based two-factor authentication and backup codes; enabling the authenticator option is described as a mobile-app operation. Treat that as a separate owner security step when applicable, not a hidden requirement for completing the browser proof. Never weaken an existing security setting to make automation easier. [Two-factor authentication](https://help.instagram.com/566810106808145)

## Email verification without adding a new service

The unresolved input is the existing inbox provider and the access method already available to the local program. An inbox visible in a Codex connector does not automatically provide portable credentials to the delivered workflow. Implement **one selected adapter**, with a small interface such as `waitForCode({ recipient, since, attemptId, signal })`. Do not build Gmail, Microsoft and generic IMAP implementations speculatively.

| Existing access | Concrete route | Setup implications |
| --- | --- | --- |
| Working IMAP credentials or OAuth token | TLS IMAP through Node's ImapFlow; fetch matching raw messages and parse locally with MailParser. Both have current maintained documentation and TypeScript/Node support. [ImapFlow](https://imapflow.com/docs/), [MailParser](https://nodemailer.com/extras/mailparser) | Fastest if access already exists. Verify that the provider accepts the credentials; a normal mailbox password is not universally sufficient. Read messages without marking, moving or deleting them. |
| Gmail API credentials already available | Read-only `messages.list` plus message retrieval; filter by recipient, time and the confirmed sender. [Gmail filtering](https://developers.google.com/workspace/gmail/api/guides/filtering) | Body access needs an appropriate scope such as `gmail.readonly`; metadata-only access is insufficient for a code in the body. New API setup adds a Google Cloud project, enabled API and OAuth client/consent work. [Scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Node quickstart](https://developers.google.com/workspace/gmail/api/quickstart/nodejs) |
| Gmail with an eligible existing app password | IMAP adapter using that credential. | App passwords require two-step verification and are unavailable for some account/security configurations. Do not assume eligibility or disable protections to obtain one. [Google app passwords](https://support.google.com/accounts/answer/185833) |
| Microsoft Graph access already available | List/read the signed-in user's messages using delegated `Mail.Read`. [List messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0), [permission reference](https://learn.microsoft.com/en-us/graph/permissions-reference#mailread) | `Mail.ReadBasic` excludes body/preview content. New app registration and consent may cost more time than using established mailbox access. Tenant policies can add constraints. |
| Outlook.com IMAP | Existing OAuth2 IMAP access with IMAP enabled. | Microsoft says POP/IMAP are disabled by default and Outlook.com requires Modern Auth/OAuth2. Its page also mentions password/app-password fields, so those fields must not be interpreted as proof that basic authentication will work. [Outlook.com settings](https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com) |

The proposed adapter takes a watermark before requesting a code, polls with a deadline and cancellation, and considers only new messages matching the intended recipient and current attempt. Use the provider's server receipt time/UID where possible; do not rely solely on the sender's Date header or unread status. Normalize recipient aliases explicitly because mailbox APIs need not expand aliases like their web UI.

Parse text/MIME deterministically, with bounded message sizes, and keep the code only in memory. Do not send mail to an LLM or automatically follow arbitrary links from a message. If multiple plausible codes arrive, the code is stale, or delivery times out, inspect the visible verification state. A resend is permitted only through a recognized UI control with a bounded retry policy; it starts a new watermark and invalidates the older candidate code. These are proposed implementation safeguards, not claims about Instagram's exact expiry rules.

## Desktop publishing and media contract

The uploader consumes a local, validated MP4 and caption from a specific approved draft revision. Use Playwright's file-input or file-chooser support; pre-render graphics, speech and captions so native editing is minimal. [Playwright input handling](https://playwright.dev/docs/input)

Official desktop flow: Create → Post → Select from computer → Next for cover/trim → Next for caption/settings → Share. Inspect the actual controls once signed into the new account; account-specific availability remains unproven. [Instagram Reel instructions](https://help.instagram.com/2720958398006062)

**Export correction:** Instagram's consumer Reel guidance specifies a minimum 30 FPS and 720-pixel resolution, with aspect ratios from 1.91:1 to 9:16. Use **1080 × 1920 at 30 FPS** as this project's proposed export contract. A 25 FPS recording converted to 30 FPS repeats/interpolates frames; it does not recover missing captured motion. Do not reuse the old API-derived 25 FPS export assumption after choosing desktop publishing. [Reel size and aspect ratios](https://help.instagram.com/1038071743007909)

Proposed compatible encoding is MP4/H.264, progressive 4:2:0, with AAC stereo at 48 kHz, and no black intro/tail. Verify using ffprobe and a local playback preview. The official page also lists progressive encoding, High profile, CABAC, closed GOP and audio sample-rate guidance; codec/container choices here are engineering recommendations rather than a claim that every setting is mandatory or exhaustively specified for the desktop uploader. Exact file-size limits are not established by this research.

The prepared caption must be read back from the composer and compared with the approved text after normalization. Verify crop and selected cover; do not assume the first preview preserves the full 9:16 composition. If burned-in subtitles are present, inspect any native caption setting to avoid redundant overlays. Such controls are account/UI dependent and have not been observed on the fresh account.

Meta says its disclosure tool is required for realistic-sounding digitally created audio or photorealistic synthetic/altered video. Synthetic narration therefore creates a concrete publishing dependency. Research has **not verified the desktop control's presence or exact label**. Inspect it in the first real upload; caption text alone must not be assumed equivalent to the platform disclosure tool, and an API-only parameter does not solve browser publishing. If the required control is absent, pause before Share and resolve an ordinary UI route or an explicitly approved content change. [Meta AI labeling guidance, updated April 2025](https://about.fb.com/news/2024/02/labeling-ai-generated-images-on-facebook-instagram-and-threads/)

## Publication recovery and proof

Browser publication has no proven application-supplied idempotency key. The goal is to prevent avoidable duplicates and surface uncertainty, not promise exactly-once publication.

Before Share, persist a publication intent with account username, draft ID/revision, asset SHA-256, caption hash/text, attempt ID, start time and the account's current post permalinks. Verify that the explicit approval still matches this revision. Only then click Share once.

Observe confirmation and reconcile the account's new posts. A successful result records the permalink and corroborating caption/visual/duration checks. Account identity matters: posting the right video to the wrong profile is a failure. Instagram re-encodes uploaded media, so exact equality with the original file hash is not expected.

| Failure point | Proposed behavior |
| --- | --- |
| Before Share, file rejected or upload failed | Record the visible error; repair the file or resume the composer. No post has been intentionally submitted. |
| Share clicked, browser/network times out | Mark `publication_unknown`; reopen/reconcile the profile against the pre-attempt post list. Do not immediately reupload or click Share again. |
| One matching new post found | Save its permalink and complete the attempt, even if the original confirmation was lost. |
| Multiple plausible matches or no conclusive outcome | Require reconciliation in the same account UI; retain uncertainty rather than guessing. |
| Rerun of an already published revision | Return its saved permalink and do not publish again. |
| Draft edited after approval | Invalidate approval for publication of the changed revision. |

The final proof for the assignment is two distinct published videos, not two successful clicks, local renders, draft uploads or database rows. Confirm each permalink resolves in the intended account and the video is playable. Also record the public-account setting. Logged-out Instagram access may still show a login wall, so that wall alone cannot establish visibility or invisibility to Instagram users.

## Small implementation/test plan

Keep one module for browser screen detection/actions, one selected inbox adapter, and one durable run/publication record. Use the project's existing persistence choice; this subproblem does not justify a queue service or separate database. The server's single mutation lane prevents overlapping account operations; do not add a separate lock framework.

Meaningful automated tests should cover wrong/old recipient mail, stale codes after resend, malformed email, verification timeout, known versus unknown screen classification, and publication recovery after a lost confirmation. Use sanitized fixtures and a local fake composer for mutation/retry behavior. These tests cannot prove Instagram accepts a new account or file.

The live acceptance sequence, when execution is authorized, is:

1. Read from the selected existing inbox without changing messages; prove the local program has access.
2. Run fresh-account signup automatically through all recognized states. Record any checkpoint honestly. Verify the correct account survives closing/reopening the browser.
3. Verify public visibility setting and desktop composer access.
4. Upload an actual short draft, inspect crop/caption/disclosure and resolve media failures early. Share only the explicitly approved revision.
5. Verify and record the first live permalink. Run the second approved video through the same implementation.
6. Rerun a completed publication and demonstrate it returns the prior result without another Share action. Include exact setup, recovery and secrets-exclusion instructions in the handoff.

No arbitrary account-warming period is proposed: none was established by primary evidence, and it would consume the deadline without proving the required flow. Specific platform messages and observed state should determine any necessary wait or checkpoint.

## Decision record and remaining inputs

| Decision | Status / owner | Reason |
| --- | --- | --- |
| Fresh account creation remains a system capability | User decision | Explicitly required by the brief and reinforced by the user; manual-only signup is not a substitute. |
| Browser-only signup and publishing; no Facebook/developer setup | User decision | User starts without those identities and excluded that prerequisite chain. |
| Attempt unattended, then resume at human checkpoints | User decision | Preserve automation ambition while acknowledging verification cannot be guaranteed from documentation. |
| Reuse an existing owner-controlled inbox | User decision; provider pending | Avoid a second account-creation project. |
| Direct TypeScript Playwright with dedicated headed profile | Research recommendation | Small inspectable state machine, shared runtime, persistent session and immediate checkpoint handoff. |
| One email adapter selected after access is known | Research recommendation | Avoid speculative providers and OAuth projects inside a 1–2 day budget. |
| 1080×1920, 30 FPS final export | Research correction/recommendation | Official consumer Reel guidance has a 30 FPS minimum. |
| Personal public account first; professional conversion optional | Research recommendation | Desktop upload does not document a professional-account prerequisite. |
| Verify first real publication before polishing UX | Research recommendation | New-account acceptance and composer behavior remain the highest delivery risks. |
| Persist intent and reconcile ambiguous publications | Research recommendation | Avoid duplicate posts without claiming unsupported exactly-once behavior. |

Inputs still needed before implementation can complete: inbox provider and already available access method; desired username/allowed alternatives and display name; owner-supplied real birthday and password through local secret configuration; the actual verification/challenge route encountered; required disclosure availability for the chosen audio/video; and explicit approval for the final two publication revisions. Private identity and credential values should be entered through a local secret mechanism, not written into this research document.

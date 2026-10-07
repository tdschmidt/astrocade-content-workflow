# Implementation and acceptance evidence

Updated 2026-10-06 (America/Los_Angeles). Repository: [tdschmidt/astrocade-content-workflow](https://github.com/tdschmidt/astrocade-content-workflow).

The local application is implemented and verified with synthetic media, local browser fixtures, and mocked provider transport. The assignment's live outcome is **not complete**: no real Astrocade footage, fresh Instagram account, or published videos are claimed.

## Evidence by requirement

| Requirement | What exists and was exercised | Remaining live proof |
| --- | --- | --- |
| Discover suitable games | Public DOM extraction, canonical URL filtering, observed counters and ranking modes; local fixture proves extraction and unavailable-source distinction | User must restore router access; run discovery against Astrocade and inspect actual candidates |
| Repeatable gameplay capture | Bounded native iframe controls/reset; two independent VP9 captures; final flush, cancellation and unexpected-page-close checks | Configure and probe real profiles twice, then demonstrate reuse on another game; currently zero verified profiles |
| Automatic video creation | Google SDK wire-contract tests; evidence-based edits; actual FFmpeg portrait rendering; connected synthetic run produced highlight and narrated-recommendation MP4s with captions and AAC | Add a Gemini key; check model access/quota and real speech, analysis, timing and content quality on actual gameplay |
| Research | Bounded Search/Extract and source-backed synthesis; partial extraction/invalid citation tests | Add Tavily key before refreshing research; no real Tavily call made |
| Fresh Instagram account | Signup fixtures exercise real browser controls and fresh email-code handling; persistent profile and resumable checkpoints implemented | Enter real intended owner/account details and working inbox; complete one actual signup and publishing-readiness check |
| Two Instagram videos | Browser fixture verifies exact approval, file upload, intent-before-Share, one Share, permalink inspection and disclosure checkpoint | Obtain express approval of exact real previews, publish twice and verify both platform-processed videos; currently zero posts |
| Handoff | Complete source, lockfile, private GitHub repository, incremental commits, setup/preflight, workbench, tests and decision/research documents | Rehearse live setup and attach a real run record plus two real permalinks |

## Local verification

- Strict TypeScript checks and Vite production build pass.
- The final full opt-in suite passed **74 tests with zero failures and zero skips**, including browser and real media integration, in approximately 40 seconds on this Mac.
- Unit and local HTTP tests cover credential redaction, shared-workbench authentication, artifact allowlisting, single-operation ownership, cancellation, email freshness, provider contracts, time bounds, approval invalidation and restart recovery.
- Opt-in browser fixtures use pinned Playwright 1.63.0 / Chromium 153.0.8010.12. They record moving local content, inspect native iframe input, test reset twice, and verify cancellation leaves no ready/partial recording.
- Real FFmpeg 9.0.2 with libass produced decoded H.264, 1080×1920, 30 fps portrait output and AAC 48 kHz stereo narration. The bundled Noto Sans font was rendered and visually inspected.
- The connected synthetic workflow generated two formats, verified hashes and captions, reused identical media for a caption edit, cleared its approval, and reopened/resumed a completed run without a Gemini key or more provider calls. Its speech was a synthetic tone with mocked timings; this tests orchestration, not voice or transcription quality.
- Studio, Research and Setup were reviewed in a real browser at desktop and 390×844 mobile widths. No horizontal overflow was observed. The local production workbench runs at `http://127.0.0.1:4310`.
- Instagram browser fixtures intercept network requests. They create no actual account or post. Google transport fixtures similarly make no real provider calls.

Reproduce using the commands in [README](../README.md). Tests create isolated temporary data and remove it after completion; live private configuration stays in ignored `data/`.

## External dependency observations

**Astrocade:** the user identified their router as the cause of the site's inaccessibility and will report when fixed. No VPN was installed. This is an environment gate, not evidence that Astrocade is globally unavailable.

**Mailbox:** the user authorized trying programmatic email creation. One Mail.tm identity was selected and its credentials persisted before the account request. The first attempt could not be verified. Authentication of that same saved identity later returned HTTP 401 (“Invalid credentials”). The initial response was not retained with enough detail to establish whether creation was rejected or its response was lost. The account remains pending; no replacement identity or repeated creation request was made. Recovery diagnostics now distinguish stages and HTTP statuses without logging response bodies or secrets. A configurable TLS IMAP fallback is implemented. Mail delivery has not been proven.

**Google/Tavily:** keys are not configured. The user elected to configure them later and asked to finish local verification. Model defaults were checked against the installed SDK and provider documentation, but key-specific access, quota and output quality remain unverified. Setup allows model and voice changes. No paid upgrade was activated.

**Instagram:** no intended real birthday, username/password and owner details are configured. No live signup or publication was attempted during implementation. Unexpected identity/verification screens remain human checkpoints in the retained browser. Uncertain publication blocks another revision until the original intent is reconciled.

**Sharing:** the password boundary is tested locally. No ngrok account/token or public tunnel has been configured. The README documents production sharing through an owner-configured tunnel.

## Next live session

1. User restores Astrocade router access and enters a Gemini key and intended Instagram identity/inbox in Setup. Add Tavily if research is desired.
2. Inspect real candidates and surfaces; save two small supported profiles and prove repeatable useful action/capture. Correct selectors/controllers based on observed pages.
3. Produce real drafts, review phone-size composition, visible payoff, narration and captions; test provider quota and any required disclosure controls.
4. Complete the fresh-account workflow and verify its persisted identity/public/composer state.
5. Present two exact previews/captions for approval. Publish approved revisions through the system, verify playable permalinks, and record actual human checkpoints.

No local fixture, synthetic video or simulated permalink substitutes for these steps.

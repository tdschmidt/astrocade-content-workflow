# Game discovery and capture support

`discoverGames` reads public Astrocade links from live pages. An inaccessible source is reported as `unreachable`/`unavailable`; cached research is never returned as live discovery. `rankGames` uses only labeled public metrics, provided visual evidence, and saved research terms. Trend mode can return no matches.

No Astrocade profile is currently verified. On 2026-10-06 the homepage, Trending category, and direct Neon Slopes game URL were all unreachable from an approved network probe and isolated Playwright 1.63 / Chromium 153. The restricted sandbox separately failed DNS, but the outside-sandbox requests and browser reached the host resolution step and failed with connection refusal. The user also confirmed the site fails in their ordinary browser. This is a live external dependency, not evidence of a worldwide outage.

`unverifiedProfileTemplate` is deliberately labeled as a template: its canvas selector, portrait viewport, and missing start/reset procedures are not claims about that game. Capture rejects unverified profiles unless an operator explicitly enables a test attempt. An actual profile must be based on inspecting the game and repeatably observing useful play. The application cannot certify a profile merely because a video file exists.

Profiles contain selectors, bounded input steps, and controller settings, not arbitrary scripts. The `timed` controller uses a finite action sequence; the `sparse` controller receives one screenshot at a time through an injected decision provider. Inputs are native Playwright events with bounded holds and cleanup. Pointer coordinates are normalized relative to the current surface bounds, including iframe positioning. Unfamiliar reflex games may require a new controller and should be skipped instead of pretending a configuration change solves them.

`runCaptureAttempt` owns one recorder session, begins recording before start actions, stops at its duration budget, and always releases inputs/closes the session. It returns a finalized artifact plus attempt evidence; editorial analysis still determines whether it contains a meaningful event. A reset is a verified UI sequence or a reload; fresh recorder/browser contexts are used for separate attempts.

The pure tests run with the normal test command. Browser fixture tests additionally require `RUN_BROWSER_TESTS=1` and installed matching Playwright Chromium. Their local synthetic game is explicitly a fixture and never reported as Astrocade footage.

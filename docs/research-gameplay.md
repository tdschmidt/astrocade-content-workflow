# Headless gameplay research and buildability decisions

Research date: 2026-10-06. Context: a one-to-two-day take-home that must discover Astrocade games, capture usable gameplay, create short videos, and publish two approved results. This document covers gameplay execution, not the separate recording or Instagram integration research.

## Recommendation

Use Playwright with its pinned full Chrome/Chromium distribution in unified headless mode, one app-owned browser at a time, and a fresh browser and isolated context for each capture attempt. Allocate the capture-title token before launch; the native recorder's tab-selection argument cannot change during a browser's lifetime. Start with a small set of verified games controlled by reusable, bounded input patterns plus declarative game profiles. Use the model for interpretation and sparse decisions, not a cloud inference call for every reflex action.

This is a proposal supported by browser documentation and a local synthetic capability probe. It is not a claim that Astrocade gameplay has been verified. The current machine cannot reach either the Astrocade homepage or the tested direct game URL.

The main unresolved difficulty is not dispatching a key. It is obtaining the right state, choosing the right action quickly enough, and recognizing that the result makes useful footage. A typed action schema alone does not solve any of those three problems.

## What was actually tested

The workspace has no game implementation to inspect. The gameplay/input probe below used existing dependencies and performed no actions on a live game, login, account creation, or submissions. The separate [capture research](research-capture.md) subsequently installed a matching browser/runtime pair into a temporary research directory; no application dependencies were installed.

### Public Astrocade access

An isolated headless browser was launched successfully through the available Playwright installation. Both `https://www.astrocade.com/` and the direct [Neon Slopes page](https://www.astrocade.com/games/neon-slopes/01KF3XC466B68JCY80M6Q8B30Q) failed with `net::ERR_CONNECTION_REFUSED`. The resulting document was Chrome's connection-error page; no Astrocade canvas, frame, or controls were available to inspect.

Earlier ordinary-browser inspection showed Astrocade's offline fallback. Neither result establishes a general service outage. The cause could still be specific to this environment or network. Public web crawls expose category pages such as [Trending](https://www.astrocade.com/category/trending) and [Players' Choice](https://www.astrocade.com/category/top_picks), but cached discovery data is not proof that the delivered workflow can load and play a game.

### Local browser and input capability

A separate in-memory page contained an iframe and a focusable canvas. It made no external requests and wrote no project artifacts. Its results were:

| Property | Observed result |
| --- | --- |
| Playwright available in the bundled runtime | 1.62.1 |
| Explicitly launched cached browser | Full Chrome for Testing 148.0.7778.96, cache revision 1223 |
| Host graphics reported by WebGL | ANGLE Metal Renderer: Apple M2 Max |
| WebGL2 context creation | Successful |
| Frame visibility and focus | `visible`, focused canvas |
| Animation callbacks | 241 callbacks over approximately 2,000 ms, about 120 Hz |
| Nested canvas bounds | Correct main-frame rectangle: x=120, y=110, width=600, height=400 |
| Keyboard input | Trusted down/up events; a second down had `repeat=true` |
| Pointer input | Trusted down/move/up events with expected frame-relative positions and held-button state |

This validates the local automation substrate. It does not measure game performance, recorder quality, inference latency, or Astrocade compatibility. The browser was explicitly selected from an older available cache because the library's expected browser path was absent. The delivered project must install and verify its own pinned matching browser rather than rely on this path.

## Browser design choices

### Full unified headless Chrome versus headless shell

Chrome's modern headless mode uses the full browser implementation. The legacy implementation moved to the separate `chrome-headless-shell` binary; the full Chrome binary no longer supports `--headless=old`. Playwright exposes unified headless operation through `channel: 'chromium'`, whereas its default headless execution can use the separate shell. [Chrome announcement](https://developer.chrome.com/blog/removing-headless-old-from-chrome), [Playwright browser documentation](https://playwright.dev/docs/browsers)

For this project, prefer the full browser because visual/game compatibility matters more than reducing installation size. Use the same pinned distribution in headed debugging and headless execution. Do not add a second automation framework or browser matrix.

First prove a real game in headed mode so failures are easy to inspect, then repeat in headless mode. A successful headed run is not sufficient acceptance for headless capture. If headless fails while headed works, preserve headed capture as an explicit fallback on the user's awake laptop, and diagnose the difference before adding flags. Headlessness is an implementation preference, not a requirement in the assignment.

### Graphics acceleration

Start with the pinned browser's ordinary launch configuration. Do not copy Linux GPU flags into this macOS project or add `--disable-gpu` reflexively. The local synthetic test already obtained hardware-backed WebGL2 with no additional GPU flags.

Chrome's published GPU recipe describes a particular Linux/Colab/NVIDIA environment and relies on compatible drivers. It is evidence that actual hardware use must be verified, not a universally appropriate flag bundle. [Chrome GPU investigation](https://developer.chrome.com/blog/supercharge-web-ai-testing)

A capability diagnostic should report browser version, graphics renderer, WebGL availability, viewport, and basic animation cadence. On a failing real game, distinguish context creation failure, browser crash, missing assets, and a slow render loop. A successful WebGL context alone does not prove the game runs smoothly.

SwiftShader is CPU rendering. Chromium documents performance limitations and deprecates its automatic WebGL fallback; explicit unsafe fallback is intended for trusted testing, not a blanket solution for untrusted pages. Do not force it as the first strategy. [Chromium SwiftShader documentation](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/swiftshader.md)

### Visibility, animation, and clocks

Use one active game page and keep the relevant frame visible. In headed fallback, bring that page forward. Record `document.visibilityState` and a simple animation heartbeat when diagnosing stalls. Background tabs and hidden frames may stop animation callbacks. The synthetic headless probe was visible and active, but that does not establish how a particular game responds to visibility events. [Animation-frame behavior](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)

Do not assume a game runs at 60 updates per second: the local probe ran near 120 Hz. Express action durations in elapsed milliseconds, and inspect actual game speed. Do not introduce fake time, a frame-rate override, or an unlimited-frame-rate flag merely to standardize a number.

Do not use `page.clock` as a general solution to cloud-model latency. It replaces page time functions, animation callbacks, and performance timing. `fastForward` is not equivalent to simulating every intervening game frame; `runFor` has different semantics. Installation order also matters. [Playwright Clock](https://playwright.dev/docs/clock)

Engineering inference: a third-party game may additionally use workers, audio clocks, network state, or engine-specific timing. Replacing page timers can therefore alter gameplay or fail to pause all relevant state. A native game pause button is preferable when present and verified. Clock manipulation belongs only in a separately demonstrated adapter or test fixture, not the default real-footage path.

## Delivering input correctly

### Identify the real interaction surface

Inspect the loaded page and frame tree before writing a profile. The interaction surface might be a canvas, an iframe containing a canvas, ordinary DOM controls, or a mixture. Use public UI locators for play/start/retry controls, and a verified locator or bounded visual target for the game surface. Playwright can locate and interact inside frames; there is no need to disable browser security to do that. [Frames](https://playwright.dev/docs/frames)

Wait for a game-specific ready condition, not just navigation completion or generic network idleness. A spinner can be animated while no game is usable. The condition may combine a known start screen, visible game bounds, and the absence of a loading/error overlay.

### Coordinates and focus

Represent pointer targets relative to the current game rectangle, using normalized coordinates between zero and one. Convert immediately before input:

`pageX = gameBounds.x + normalizedX * gameBounds.width`

`pageY = gameBounds.y + normalizedY * gameBounds.height`

Playwright mouse coordinates are main-frame CSS pixels. Locator bounding boxes use the same coordinate space, including elements within child frames. Avoid adding iframe offsets again or multiplying by the display's pixel ratio. If the model sees a cropped/resized screenshot, account for that image transform exactly once. [Mouse](https://playwright.dev/docs/api/class-mouse), [Locator bounds](https://playwright.dev/docs/api/class-locator#locator-bounding-box)

Fix the viewport for an attempt. Recompute bounds after start, resize, navigation, or a layout transition. Ensure the game owns focus before using keyboard input. A clicked canvas was sufficient in the local fixture; actual games still need verification.

Use native Playwright keyboard and mouse methods rather than page-evaluated synthetic DOM events. For continuous movement, use a finite `down`/duration/`up` operation. For repeated taps, explicitly send the taps; a held key and repeated keydown events can mean different things to a game. Keep physical key names such as `KeyA` or `ArrowLeft` in the verified profile. [Keyboard API](https://playwright.dev/docs/api/class-keyboard)

Mouse `steps` controls the number of interpolated move events, not a specified drag duration. For timing-sensitive drags, space bounded segments using elapsed time. Use mouse gestures first for games that support them. Touch-only swipes or multitouch need a separately verified adapter; changing the user-agent string does not implement those gestures. [Mouse movement](https://playwright.dev/docs/api/class-mouse#mouse-move)

### Input lifecycle

Only one controller may issue inputs to a page. Maintain the held-key/button set centrally. Every action has a maximum duration and runs within cleanup that releases held controls. Release before navigation, reset, cancellation, model handoff, and browser shutdown. The model must never be responsible for eventually returning a separate release command.

Do not hold a movement key while awaiting a cloud response unless that is an intentionally bounded local action. A late inference response should not execute against an obsolete attempt. Bind it to the attempt and observation that requested it; discard it after reset or cancellation.

## What “hybrid controllers plus profiles” means

The accepted approach needs a visible boundary between first-time developer onboarding and unattended runtime.

| Layer | Contents | Does adding a game require code? |
| --- | --- | --- |
| Game profile | Canonical URL, ready/start/reset procedure, verified surface locator, viewport, control mapping, controller selection, timing parameters, intended capture event | Usually configuration, after live inspection |
| Shared input executor | Bounded key/tap/drag operations, coordinate conversion, cancellation and release | No per-game changes expected |
| Controller | Strategy for a particular interaction pattern; optionally interprets model outputs | New interaction patterns may require code |
| Perception adapter | Extracts board state, player position, obstacles, or targets when required | Often bespoke; cannot be hidden inside a supposedly simple profile |
| Capture assessment | Decides whether footage contains meaningful play and an understandable event | Shared model prompt plus profile-specific objective/evidence |

A profile must not become an arbitrary JavaScript escape hatch. Conversely, do not promise that every game can be added as configuration. A new visual detector or strategy is real implementation work and should be documented as such.

### Alternatives and when they fit

| Approach | Good fit | Main weakness | Position for this take-home |
| --- | --- | --- | --- |
| Timed input sequence | Deterministic introduction, forgiving movement, satisfying continuous interaction | Drift, randomness, changing levels | First option when a useful repeatable segment is demonstrated |
| Sparse visual model decisions plus local actions | Turn-based puzzles, sorting, deliberate clicks, forgiving movement | Slow decisions and occasional spatial errors | Recommended second pattern if it produces useful footage within the call budget |
| Local reactive vision controller | Simple detectable obstacle/target geometry with real-time response needs | Detection calibration and strategy become a separate project | Add only for a compelling game with a short successful proof |
| Generic cloud screenshot/action agent | Broad exploration and interpreting unfamiliar instructions | State changes during inference; retries and calls accumulate | Bounded exploration aid, not the baseline capture guarantee |
| Reading a game engine's internal state | A game with a stable, public, appropriate interface | Private implementation coupling and access to nonvisible state | No dependency unless actually discovered and justified |
| Human play followed by automatic editing | Emergency content production and renderer development | Does not prove automated gameplay | Explicit fallback/demo input only, not evidence the capture requirement is solved |

The first controller should be selected after observing actual available games. Do not choose a runner because its footage looks good and only then discover that controlling it requires a new perception subsystem.

GameWorld is useful cautionary evidence: it separates paused-inference play from real-time play and reports substantial control difficulties. Its tested real-time Qwen loops took seconds per action; those numbers do not predict the latency of the chosen Gemini model. Its benchmark games also expose serialized state, which Astrocade has not been shown to expose. Transfer the failure mechanism, not its success rates or infrastructure. [GameWorld paper](https://arxiv.org/html/2604.07429v1), [project and runtime](https://github.com/gameworld-project/GameWorld)

### Planning versus execution cadence

Measure screenshot acquisition, model round trip, local action execution, and observation-to-action age separately. If a state changes faster than the measured loop can react, a better prompt will not repair the mismatch. Select a slower game, use a proven local controller, or use a genuine game pause feature.

For model-driven steps, keep context short: instructions, the current observation, the immediately relevant prior action/result, and a small state summary. Do not stream the entire growing frame history into every request. Sample the model only when a new decision is needed; do not create a fixed per-frame model loop.

A successful run needs interesting observable play, not necessarily a win. A near miss or clear failure can meet the capture objective. However, changing pixels, random inputs, or a model's optimistic description are not sufficient proof.

## Execution and failure boundaries

Each attempt owns a browser, separate isolated contexts for the game and local recorder pages, a profile, a controller, and a recorder. It proceeds through load, ready, start, play, finalize, cleanup, and assessment of the saved footage. Close the attempt's browser after stopping capture and releasing inputs. This can be ordinary sequential code with explicit statuses, not a workflow framework.

Reset into a fresh context when anonymous play permits it. A page reload may preserve progress in local storage. If Astrocade requires authentication, save only the necessary session state outside the repository, and verify whether fresh contexts actually reset game progress. Do not use the user's ordinary browser profile. [Playwright authentication-state guidance](https://playwright.dev/docs/auth)

Return distinct reasons for navigation failure, authentication required, missing controls, unsupported input pattern, game crash, no meaningful progress, and no editorially useful footage. Only retry failures whose cause can plausibly change. One diagnosed retry is more useful than an undifferentiated long retry loop.

An unsupported candidate is a valid result. Preserve the agreed discovery modes and format options, but show when capture support narrows the candidates. Broad discovery with two tested capture profiles is an honest capability; two hand-authored scripts presented as universal autonomous gameplay is not.

Recording is finalized before editorial analysis. Browser observation timestamps help controller diagnostics; cuts use the media file's own timeline. A late capture failure must not create an apparently complete source asset.

## Feasibility gates for the available time

These are suggested development timeboxes and acceptance evidence, not production service requirements.

| Gate | Smallest useful proof | Stop or change course when |
| --- | --- | --- |
| Live access | App-owned browser loads a category and one real game's interaction surface | Connection failure persists after one diagnosed retry; ask for access/network evidence rather than building against a fictional DOM |
| First control pattern | Enter, start, generate meaningful play, release inputs, reset; repeat twice | Approximately 30–45 minutes produces no usable segment or reveals a substantial perception project; choose another candidate |
| Headless parity | Same profile and visible objective succeed in headless after headed debugging | Headless-specific failure remains; retain transparent headed fallback while investigating |
| Game/profile reuse | A second game works with existing input/controller code plus a small profile | A new detector or strategy is required; explicitly price it as new code or choose another game |
| Model practicality | Representative steps have measured latency and call count within available quota | Decisions arrive too late or exhaust quota before useful footage; reduce model cadence or change game/controller |
| Real footage | An actual recording shows understandable action and a usable event twice | Recording only proves menus, idle motion, or unrelated activity; do not continue as if the capture gate passed |
| Interruption | Cancel mid-input, then start a new attempt without stuck controls or stale responses | Cleanup depends on another model response or a prior attempt can still issue actions |

Aim to have one real capture in the first working session. If that fails, prioritize diagnosing access and selecting controllable games over adding the workbench's options. Keep the accepted modes and formats in the final scope, implemented on top of the proven path rather than as separate pipelines.

## Decisions to carry forward

Proposed: unified headless Chrome from a pinned Playwright installation; headed debugging and explicit fallback; no additional GPU flags without evidence; no default fake clock; isolated attempt contexts; finite native input operations; profiles distinguished from controllers and perception code; sparse model reasoning; media-grounded evidence of useful play.

Still unproven: live Astrocade access, anonymous playback, actual frame/canvas structure, game-specific controls and reset behavior, suitable initial games, headless parity on those games, useful footage, and the chosen model's measured latency/quota. The local synthetic probe resolves only the browser/input substrate.

# Gameplay capture: research and local feasibility

Research date: 2026-10-06. This report concerns the local, one-to-two-day Astrocade take-home. Game audio is optional. No claim here establishes that live Astrocade capture works: the site remained inaccessible during the research.

## Recommendation

Use **an application-owned Chromium browser, a dedicated game tab, and a separate local recorder tab using `getDisplayMedia` → `MediaRecorder` with explicit VP9 WebM**. Request 30 fps and an 8 Mbps video target, then let the existing FFmpeg rendering stage produce the final H.264 MP4. Use Chromium's tab-title selection switch only in this isolated automation browser. Pin the browser and Playwright versions and retain a local capture smoke fixture.

This recommendation changed after experiments. Playwright's built-in video recorder was the simplest apparent choice, but its released 25 fps, low-bitrate encoding visibly degraded a busy scene. JPEG screencast → H.264 improved it. Native tab capture with VP9 then produced better sampled detail than either, with substantially less data crossing into Node and no custom frame-timestamp/spooling machinery. Two successful native VP9 tests included a separate recorder tab, which matches the proposed integration.

The tradeoff is explicit: unattended source selection depends on a Chromium automation/testing switch, not a portable web-standard permission grant. This is acceptable as a disclosed, tested local-browser dependency for this take-home; it is not a claim of general browser support. Ordinary `getDisplayMedia` requires user activation and a fresh permission/source selection, while Chromium's source code provides a tab-specific title auto-selector. [Web capture requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia), [Chromium 147 source for the selection switch](https://chromium.googlesource.com/chromium/src/+/refs/tags/147.0.7727.118/chrome/common/chrome_switches.cc)

**One bounded fallback decision, not two shipped backends:** test this native path on an actual Astrocade game before building the rest of the capture integration. If source selection, rendering, or recording fails reproducibly after one same-browser headed check, replace it with the already-demonstrated Playwright JPEG → FFmpeg path described below. Do not spend the assignment building an extension, OS recorder, or dynamic capture-provider framework. If both paths expose a non-rendering game, treat that candidate as unsupported; a different encoder cannot repair missing gameplay.

## Alternatives scrutinized

| Mechanism | Strength | Relevant difficulty | Decision |
|---|---|---|---|
| Released Playwright video recording | Minimal application code; headless; clean viewport | v1.63.0 source fixes output at 25 fps, VP8, 1 Mbps target, silent audio; extra frozen tail on stop | Do not use as the final footage master after the observed quality loss |
| Playwright JPEG screencast → FFmpeg | Documented public interface; quality/dimension control; headless; no picker | Application must preserve time, sample frames, bound temporary data, and finalize encoding | Proven replacement if native capture fails its live-game gate |
| Direct CDP `startScreencast` | JPEG/PNG, frame acknowledgments, dimensions and every-Nth-frame control | Same basic frame transport but more browser-specific code than Playwright; no audio in this mechanism | No benefit sufficient to justify another implementation |
| Native tab stream → MediaRecorder | Browser handles pacing/encoding; captures composed page and frames; optional audio capability | Picker/activation, explicit codec selection, recording-tab lifetime, ordered chunk transfer | Selected primary for fixed local Chromium |
| Canvas `captureStream()` | Can avoid surrounding webpage; native MediaRecorder encoding | Captures one accessible, origin-clean canvas, not arbitrary DOM/HUD/multiple canvases; no general game-audio solution | Do not assume Astrocade architecture or couple recorder to game internals |
| Chrome extension `tabCapture` | Tab audio/video, separate offscreen recording page | Extension packaging, permissions, activation, extra lifecycle and deployment | Too much integration for optional audio in this take-home |
| OS screen capture / FFmpeg AVFoundation / ScreenCaptureKit | High-quality desktop/window capture with OS capabilities | OS permissions, visible window geometry, desktop/focus coupling, platform-specific handoff | Not the default for a headless-capable workflow |

Released recorder facts are from a versioned source, not `main`. The public screencast API provides JPEG frame callbacks and presentation timestamps, with an 800×800 bounding default unless explicit dimensions are supplied. [Playwright v1.63.0 recorder](https://raw.githubusercontent.com/microsoft/playwright/v1.63.0/packages/playwright-core/src/server/videoRecorder.ts), [screencast API](https://playwright.dev/docs/api/class-screencast)

Canvas capture's origin-clean requirement and single-canvas scope are material here. Tab capture observes the rendered tab and does not require reading the game's canvas or knowing its engine. [Canvas capture documentation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream)

Chrome documents the extension approach through a service worker and offscreen document, following extension invocation. Apple documents screen-recording permission for its capture APIs; FFmpeg exposes AVFoundation as a macOS input device. These are real alternatives, but each adds setup or lifecycle work that the selected tab path avoids. [Chrome extension recording](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture), [tabCapture API](https://developer.chrome.com/docs/extensions/reference/api/tabCapture), [Apple ScreenCaptureKit](https://developer.apple.com/documentation/ScreenCaptureKit), [FFmpeg input devices](https://ffmpeg.org/ffmpeg-devices.html#avfoundation)

### A misleading emerging alternative

The current tip-of-tree CDP protocol includes `Page.startScreenRecording`, with frame rate and audio arguments. The installed Chrome 148 returned **method not found**. It must not become a project dependency based solely on current protocol documentation. The older supported screencast API and this newer recording command are different mechanisms. [Current protocol definition](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl)

## Actual local experiments

Initial comparison environment: macOS 26.6.2 arm64, Node 24.14.0, Playwright 1.62.1, Chrome for Testing 148.0.7778.96, FFmpeg 8.1.2. The installed Playwright expected another browser revision; the available executable was supplied explicitly. That mismatch is disclosed rather than treated as a recommended deployment.

The selected native path was subsequently confirmed on a **matching Playwright 1.63.0 / Chromium 153.0.8010.12, revision 1243 pair**, installed only into an isolated `/private/tmp` research directory. No application dependencies were created. This narrow repeat produced 180 decoded frames with 180 distinct scene IDs over 5.965 seconds of presentation timestamps, explicit VP9 WebM at 1080×1920, and a 3.71 MB file. Stop emitted a sixth and final chunk after five periodic chunks; the recorder became inactive and the capture track ended. The matching-version result supports selecting that pinned pair. It does not repeat all quality measurements or prove live Astrocade compatibility.

A final bounded probe tested **incremental chunk transfer and cancellation** on that matched pair. Normal stop appended chunks 0–3 in order, flushed the final fourth chunk, and fully decoded the partial WebM before renaming it ready: 102 decoded frames and 102 distinct scene IDs, 1080×1920 VP9, 2,169,126 bytes, approximately 30 fps. Maximum queued raw-Blob bytes were 615,899, versus the large whole-JPEG buffers in the earlier comparison. This counter is not a measurement of total browser/Node process memory; base64 serialization adds overhead.

The cancellation attempt deliberately delayed the first Node append for 500 ms. Cancellation was requested with one write in flight. It drained both chunks, reached zero pending bytes, stopped the track/browser, closed the file, and removed the partial artifact. No ready file was created and no partial remained. Each attempt allocated its unique capture title before launching a fresh dedicated browser, eliminating ambiguity about changing a process-scoped launch flag. This proves the tested orderly cancellation path, not recovery from a killed process or a full disk.

The fixture rendered a 1080×1920, six-second 2D animation with fast scrolling tiles, thin colored edges, text, and a moving object. It drew a binary scene ID into every animation frame. For five decoded samples per output, the inspector recovered the ID and reconstructed that exact source frame before calculating SSIM and RGB PSNR. Thus it did not compare unrelated animation positions.

| Capture | Actual codec/container | Decoded frames | Distinct scene IDs among first 180/150 frames | File size | Five-sample SSIM range |
|---|---|---:|---:|---:|---:|
| Playwright built-in | VP8 / WebM | 174 | 150 of first 150 | 1.34 MB | 0.8791–0.9163 |
| Same JPEG stream → FFmpeg CRF18 | H.264 / MP4 | 182 | 180 of first 180 | 6.90 MB | 0.9500–0.9760 |
| Tab MediaRecorder, explicit VP8 | VP8 / WebM | 181 | 180 of first 180 | 6.40 MB | 0.8620–0.9091 |
| Tab MediaRecorder, `video/mp4` | **VP9** / MP4 | 181 | 180 of first 180 | 3.87 MB | 0.9948–0.9956 |
| Separate recorder tab, explicit VP9 | VP9 / WebM | 180 | 180 of first 180 | 4.03 MB | 0.9946–0.9956 |

The built-in file lasted 6.96 seconds and contained 24 repeated tail frames after the first six seconds. Its versioned source intentionally extends the last frame when stopping. The custom encode lasted 6.066 seconds, including its deliberately repeated final concat image. Production should close against the chosen capture end and trim container padding; neither prototype's tail is a content decision.

The Chrome 148 native WebM's nominal `r_frame_rate` was 120 even though its actual packet timing was about 30 fps and it contained about 180 frames over six seconds. The matching Chrome 153 repeat reported 30 fps. The MP4 browser default selected VP9, despite the container being MP4. These results are why the implementation must inspect **decoded content, timestamps, and codec**, rather than infer quality from an extension or a single ffprobe field.

During the JPEG tests, the fixture's roughly 120 Hz animation produced about 99 delivered frames/s. Keeping every JPEG used approximately 213 MB for six seconds before video encoding. Native encoded chunks avoided that data volume. The measurement harness intentionally retained all JPEGs to compare identical source inputs; it is not the production memory strategy.

Visual inspection of the decoded crops showed ringing/softness in the built-in recorder's tile edges and text, while the higher-quality custom encode preserved them better. This confirms a perceptible difference in this scene, not a claim that every Astrocade game would fail the built-in encoder.

### Evidence and limits

- Reproducible source and instructions: [capture probes](../research/probes/capture/README.md).
- Full measurements: [results.json](../research/probes/capture/results.json), [environment.json](../research/probes/capture/environment.json).
- Matching Playwright 1.63 / Chromium 153 proof: [matched-1.63-result.json](../research/probes/capture/matched-1.63-result.json).
- Incremental transfer and cancellation: [probe source](../research/probes/capture/incremental.cjs), [saved result](../research/probes/capture/incremental-result.json).
- Observed JPEG timestamps and byte totals: [built-in stream](../research/probes/capture/builtin-stats.json), [JPEG-only stream](../research/probes/capture/jpeg90-stats.json).
- Small visual artifact: [decoded crop comparison](../research/probes/capture/comparison.png).
- Full media is temporary under `/tmp/astrocade-capture-bench`; no large test videos were added to the project.

This is not an Astrocade/WebGL test, audio test, social-upload recompression test, CPU benchmark, or statistical performance study. The machine's other load was uncontrolled. SSIM is reported for five samples, not the whole video. Variable-frame-rate sample indices are approximately one second apart. The fixture's delivery rate must not be presented as an actual game frame rate or a guaranteed application rate.

## Concrete primary integration

1. **Own the browser per attempt.** Allocate the unique capture title first, then launch a fresh, dedicated, pinned Chromium instance for that capture attempt. Only one attempt runs at a time. It owns the game tab and a local recorder tab and closes after the attempt. The probes use `browser.newPage` for each, giving each page an app-owned isolated context. The title-selection argument is fixed at browser launch, so this design does not pretend it can be changed between attempts inside a reused process. Never attach capture-selection flags to the user's personal Chrome profile. Headless is the default; visible mode is available for diagnosing real-game rendering.
2. **Set framing before capture.** Use a fixed game viewport and device scale factor 1 for the capture. Choose a viewport that preserves the game's playable layout, rather than forcing every landscape game into a portrait layout. Record the full composed viewport; save the measured game rectangle for FFmpeg's crop/fit stage. A 1080×1920 capture is appropriate when the game actually supports that layout, not a blanket browser setting.
3. **Select exactly the game tab.** Give the game tab the per-attempt title already supplied to `--auto-select-tab-capture-source-by-title` at launch. Do not use the broader desktop/screen selector. Set the unique title immediately before requesting capture and verify it. No other app tabs share that title.
4. **Supply real activation in the recorder page.** Serve the app's own small recorder page on localhost. Its Start button calls `getDisplayMedia`; Playwright clicks that button. Request browser-tab video, dimensions matching the capture viewport, 30 fps, and `audio:false`. Verify the returned stream reports a browser surface and expected dimensions. The local probe performed this successfully with a separate 800×600 recorder tab capturing a 1080×1920 game tab.
5. **Choose the codec explicitly.** Check `MediaRecorder.isTypeSupported('video/webm;codecs=vp9')`, then create that recorder with an 8 Mbps video target. Do not infer codec from `video/mp4`. Fail the capture preflight clearly if the pinned environment lacks the selected codec; do not silently replace it with the visibly poorer tested VP8 path. MediaRecorder's constructor supports codec and bitrate selection. [MediaRecorder constructor](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/MediaRecorder)
6. **Wait for readiness, then play.** Start the recorder before the gameplay start action so a short opening event cannot be missed. Bring the game tab to front internally; retain the recorder tab without navigation. Strip setup screens through footage analysis and editing afterward. Capture itself needs no game source, canvas extraction, DOM rendering library, or game-engine hook.
7. **Transfer ordered chunks.** Request approximately one-second chunks. Through a binding exposed only on the recorder page, transfer each Blob as base64 to Node and append its bytes sequentially to a generated `.partial.webm` file. A promise chain preserves order; sequence numbers detect omitted/reordered chunks. Keep a small pending-byte counter; if writes cannot keep up, stop and fail the capture instead of accumulating unbounded memory. A 60-second default attempt limit bounds work. Release chunk references after writing. The incremental research probe tested this mechanism, including the final chunk and cancellation during a pending append; it is not production application code.
8. **Preserve actual media time.** Keep action times as hints, but analyze and edit using the recorded media's presentation timestamps. Chunk delivery intervals are not media duration. `timeslice` can be delayed and the last chunk can differ in size. [Chunk timing documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event)
9. **Finish before declaring success.** On success or cancellation, stop the recorder, await its final data event and stop event, await pending file writes, close the file, and stop the tracks. Run ffprobe plus representative decode checks before promoting successful output. Only complete validated captures become immutable footage artifacts. Cancellation never promotes an artifact; close the browser and remove only that attempt's partial file after outstanding writers release it. A crash or write failure leaves a failed partial artifact, never a ready capture. MediaRecorder emits the final data before its stop event. [Stop behavior](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/stop)
10. **Render once for delivery.** The normal editing stage decodes VP9 and emits H.264, yuv420p, 30 fps, fast-start MP4 with narration/audio as appropriate. Validate the final codec and dimensions. Native variable frame rate and WebM lacking a convenient duration field are handled by parsing/decoding and the final render, rather than pretending an extension proves compatibility.

The separate recorder page is material: navigation of a page containing an in-page recorder destroys that script context. Keeping capture in an app-owned page decouples it from the game page. v1 closes each attempt's browser before the next capture attempt; it does not need cross-navigation continuous recording.

Original game audio remains optional and disabled in this baseline. The stream API can offer tab audio, but support/source selection varies and no audio test was performed. Do not claim the current silent probe proves audio capture. Narration belongs to the later rendering stage. Audio enhancement can be tested later without making it an acceptance dependency.

## Bounded replacement: JPEG → FFmpeg

If native capture fails the real-game gate, the replacement remains within Playwright and FFmpeg:

1. Start a screencast with explicit dimensions and JPEG quality 90, without `path`, tracing screenshots, or action overlays competing for capture settings.
2. Anchor time at the first valid frame. Divide presentation time into 1/30-second buckets; retain the latest frame for each occupied bucket. Finalize a bucket when a frame enters a later one. This prevents approximately 100 delivered frames/s from becoming 100 stored frames/s.
3. Write selected JPEGs to a per-capture temporary directory with generated names. Keep only the current frame and a small ordered write backlog in memory. Persist source timestamps alongside filenames. Bound capture length and pending bytes, failing cleanly on a disk/write error.
4. Write an ffconcat manifest whose durations preserve elapsed presentation time, including gaps. A repeated source frame can cover an empty interval. Do not feed all frames to `-framerate 30` as if their arrival intervals were constant: that can change gameplay speed. Encode with FFmpeg's `fps=30` filter, libx264 CRF18, yuv420p, and faststart. [FFmpeg concat format](https://ffmpeg.org/ffmpeg-formats.html#concat), [FFmpeg fps filter](https://ffmpeg.org/ffmpeg-filters.html#fps)
5. On stop, finalize the last frame to the chosen media end, await writes and FFmpeg, validate the complete MP4, then rename it from partial state. On cancellation stop capture and the owned encoder process, and remove only that capture's generated temporary directory after the stopped processes release it. Keep the validated source master for later rerenders; remove JPEG spool files after encoding.

This replacement requires more temporal and temporary-file code than native recording but uses the public Playwright interface. A fixed frame rate label never proves that the source supplied enough distinct motion; the footage QA is required with either implementation.

## Acceptance checks that remain

- Run the selected capture against two actual supported Astrocade games and repeat each from reset. At least one should contain meaningful motion, not merely an idle screen.
- Inspect the actual game layout and iframe composition before fixing viewport/crop rules. Ensure score/objective and the claimed payoff remain visible in the final portrait composition.
- Inspect recording start/stop, mid-capture cancellation, recorder-tab closure, and game-tab failure. No path may mark a corrupt/truncated partial file ready.
- Verify browser/codec support during setup. For native selection, demonstrate that only the dedicated game tab is captured.
- Watch source and final-render clips at phone size for legibility, motion, clipping, and compression. Recheck after an actual Instagram upload; none of the local measurements proves the platform's recompression result.
- Complete caption rendering setup separately: the installed FFmpeg here has no ASS/subtitles/drawtext filters. Capturing good footage does not fix a missing subtitle renderer.

The application still needs a real capture preflight. Research and synthetic experiments have reduced the design uncertainty; they have not fulfilled the assignment's live-game capture requirement.

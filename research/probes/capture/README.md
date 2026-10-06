# Local capture research probes

These are research fixtures, not production application code. They record only a synthetic local 1080×1920 canvas animation. No accounts, external sites, desktop capture, or user browser profiles are involved. Research date: 2026-10-06.

## Recorded environment

- macOS 26.6.2, arm64; Node 24.14.0.
- Bundled Playwright 1.62.1, explicitly launched Chrome for Testing 148.0.7778.96 from Chromium revision 1223.
- FFmpeg/ffprobe 8.1.2 with libx264; Sharp available from the bundled runtime.
- This installed Playwright/browser pair is not its normal matched pair. The experiment demonstrates local feasibility; the delivered application must pin and test a matched pair.

A subsequent narrow confirmation ran the separate-recorder VP9 probe on matching Playwright 1.63.0 / Chromium 153.0.8010.12 (revision 1243). These dependencies were installed only in `/private/tmp/astrocade-browser-research-20261006`, not as project dependencies. `matched-1.63-result.json` records the successful capture, decoded frame count, packet timing, and final-chunk/track shutdown. This repeat did not rerun the full quality comparison.

`incremental.cjs` and `incremental-result.json` record a final matched-version test of ordered chunk transfer to Node, validation before ready-file rename, and cancellation while the first append was delayed. Normal output fully decoded to 102 distinct frames. The canceled attempt left neither a ready nor a partial file. This is orderly cancellation evidence, not browser-crash, disk-full, or real-game validation. Each attempt launches a fresh browser after allocating its unique tab-title token.

`environment.json`, `results.json`, and the `*-stats.json` files preserve the measurements. `comparison.png` shows the built-in recorder at left and JPEG→H.264 at right, from their respective decoded three-second samples. Full temporary media remains under `/tmp/astrocade-capture-bench` on the machine where research ran; it is ephemeral and is not required to read the results.

## Reproduce

Use a local Node environment with `playwright` and `sharp`, a full Chromium browser, and FFmpeg/ffprobe supporting libx264. The probes do not install dependencies. Optional environment variables select existing dependencies:

- `PLAYWRIGHT_MODULE_PATH`: path to the Playwright package directory; otherwise resolve `playwright` normally.
- `SHARP_MODULE_PATH`: path to the Sharp package directory; otherwise resolve `sharp` normally.
- `CHROME_EXECUTABLE`: full Chrome/Chromium executable; otherwise use Playwright's expected executable.
- `FFMPEG_PATH`, `FFPROBE_PATH`: executable names or absolute paths.
- `CAPTURE_BENCH_DIR`: temporary output directory; defaults to `/tmp/astrocade-capture-bench`.

Run these commands from the repository root:

```sh
node research/probes/capture/bench.cjs
node research/probes/capture/encode.cjs
node research/probes/capture/media.cjs
node research/probes/capture/media-mp4.cjs
node research/probes/capture/media-vp9-separate.cjs
node research/probes/capture/inspect.cjs
```

For a narrow native-path repeat after changing browser versions, reuse the generated `scene.html`, run only `media-vp9-separate.cjs`, then run `inspect-native.cjs` with the same environment. The latter measures decoded frame IDs and actual packet timing without launching another browser. The native probe also records runtime versions and the final data chunk emitted on stop.

To repeat the incremental-transfer/cancellation probe, reuse that same `scene.html` and dependency environment and run `node research/probes/capture/incremental.cjs`. It records roughly 3.4 seconds normally, then starts a separate canceled attempt. Each write is ordered; the canceled attempt adds an intentional 500 ms write delay so cancellation occurs with a write outstanding. The script has bounded capture-start, finish, and media-inspection waits. Its result and normal video stay in `CAPTURE_BENCH_DIR`; the canceled partial is removed after the browser and writer stop.

`bench.cjs` captures all browser-delivered JPEG frames in memory to measure delivery cadence and keep the comparison input identical. This is deliberately NOT the proposed production buffering algorithm. It used approximately 213 MB of JPEG data in one six-second run. Other temporary artifacts make the full fixture several hundred MB. Inspect or remove only this named benchmark directory after use.

`media.cjs` tests tab capture with VP8 WebM. `media-mp4.cjs` tests browser-selected MP4 encoding, which selected VP9 on the tested Chrome. `media-vp9-separate.cjs` explicitly requests VP9 WebM and uses a separate recorder tab to capture the game tab. The tab-title auto-selection flag is specific to this dedicated test browser; do not reuse it with a personal browser profile.

## What is measured

The animation draws a frame ID into twelve binary blocks. The inspector decodes those blocks from each video frame. It reconstructs the exact corresponding source canvas frame and measures five individual frame samples using FFmpeg SSIM and raw RGB PSNR. This avoids comparing different moving-scene moments as if they were the same frame.

The inspected sample indices are approximately one-second apart, not exact equal presentation timestamps for variable-rate output. Packet timestamps are sorted before calculating actual packet rate because H.264 packets can be reordered. Codec names, dimensions, declared frame rates, file sizes, actual packet timing, distinct scene IDs, and sample-level metrics are stored separately.

This is a deterministic 2D stress scene with fast scrolling, saturated edges, and text. It is not an Astrocade/WebGL benchmark, social-platform recompression test, audio test, or multi-run performance study. Other machine load was uncontrolled. The approximately 99 JPEG frames/s received from a roughly 120 Hz animation loop is browser delivery cadence, not a promised game or final-video rate. No synthetic quality threshold should be used to accept real gameplay without watching it.

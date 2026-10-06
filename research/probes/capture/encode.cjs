// Research-only encoder: same timestamped JPEG input as the Playwright recording.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = process.env.CAPTURE_BENCH_DIR || '/tmp/astrocade-capture-bench';
execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y', '-safe', '0', '-f', 'concat',
  '-i', path.join(root, 'builtin/frames.ffconcat'), '-vf', 'fps=30',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', path.join(root, 'builtin/from-jpegs.mp4'),
], { stdio: 'inherit' });

// Research-only measurement for a separate-recorder native capture.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = process.env.CAPTURE_BENCH_DIR || '/tmp/astrocade-capture-bench';
const file = path.join(root, 'media-vp9-separate.webm');
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const metadata = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate:stream=codec_name,width,height,r_frame_rate,avg_frame_rate', '-of', 'json', file], { encoding: 'utf8' }));
const pts = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'json', file], { encoding: 'utf8' })).packets.map(p => Number(p.pts_time)).sort((a, b) => a - b);
const raw = execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'crop=600:40:20:130,format=gray', '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 20 * 1024 * 1024 });
const ids = [];
for (let p = 0; p < raw.length; p += 24000) {
  let id = 0;
  for (let bit = 0; bit < 12; bit++) if (raw[p + 12000 + bit * 50 + 20] > 128) id |= 1 << bit;
  ids.push(id);
}
const result = {
  ...JSON.parse(fs.readFileSync(path.join(root, 'media-vp9-separate.json'))),
  probe: metadata, decodedFrames: ids.length, distinctSceneIds: new Set(ids).size,
  firstPts: pts[0], lastPts: pts.at(-1), actualPacketRate: (pts.length - 1) / (pts.at(-1) - pts[0]),
  note: 'Native tab capture and stop/flush measurement. Does not repeat quality measurements or test live Astrocade.',
};
fs.writeFileSync(path.join(root, 'native-measurement.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));

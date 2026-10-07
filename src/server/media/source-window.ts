const number = (value: number) => Number(value.toFixed(6)).toString();

/** Keep the decoder's keyframe pre-roll. Accurate input seeking would discard
 * the frame still displayed at the cut during a sparse/VFR recording. */
export function sourceSeekArgs(startSeconds: number): string[] {
  if (!Number.isFinite(startSeconds) || startSeconds < 0) throw new Error('Source seek needs a finite nonnegative timestamp.');
  return ['-ss', number(startSeconds), '-noaccurate_seek'];
}

/** Input seeking subtracts the requested source start from PTS. Sample that
 * unchanged clock before trimming, so pre-roll supplies the correct held frame
 * at zero. Never rebase the first post-seek packet with PTS-STARTPTS. */
export function sourceWindowVideoFilter(durationSeconds: number, speed = 1): string {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(speed) || speed <= 0) throw new Error('Source window needs a positive finite duration and speed.');
  return `fps=30:start_time=0:round=up,trim=start=0:end=${number(durationSeconds)},setpts=PTS/${number(speed)},fps=30:start_time=0:round=up`;
}

export function sourceFreezeVideoFilter(durationSeconds: number): string {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Source freeze needs a positive finite duration.');
  return `fps=30:start_time=0:round=up,trim=end_frame=1,tpad=stop_mode=clone:stop_duration=${number(durationSeconds)}`;
}

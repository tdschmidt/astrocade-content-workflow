import type { z } from 'zod';

export type MediaInput =
  | { type: 'image'; data: string; mime_type: 'image/png' | 'image/jpeg' }
  | { type: 'video'; uri: string; mime_type: string; processing: { type: 'static'; fps: number; start_offset?: string; end_offset?: string } };

export interface InferenceProgressEvent {
  stage: 'upload' | 'processing' | 'ready' | 'cleanup' | 'json' | 'speech' | 'transcription';
  model?: string;
  attempt: number;
  status: 'started' | 'completed' | 'retrying' | 'failed';
  durationMs: number;
  httpStatus?: number;
  retryAfterMs?: number;
  message?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** The core workflow needs structured decisions and visual evidence only. */
export interface Inference {
  json<T>(prompt: string, schema: z.ZodType<T>, media?: MediaInput[], signal?: AbortSignal): Promise<T>;
  withVideo<T>(path: string, operation: (video: { uri: string; mimeType: string }) => Promise<T>, signal?: AbortSignal): Promise<T>;
}

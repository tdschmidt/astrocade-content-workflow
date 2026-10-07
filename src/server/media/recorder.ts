import { chromium, type Browser, type Page } from 'playwright';
import { mkdir, mkdtemp, open, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { abortError } from './process.js';
import { ensureNewOutput, promoteMedia, validateVideo, type MediaTools } from './probe.js';

export interface CaptureArtifact {
  path: string;
  durationSeconds: number;
  width: number;
  height: number;
  codec: string;
}

export interface CaptureOptions {
  outputPath: string;
  viewport: { width: number; height: number };
  maxDurationMs: number;
  headless?: boolean;
  signal?: AbortSignal;
  ffmpeg?: MediaTools;
}

export interface GameCapture {
  page: Page;
  start(): Promise<void>;
  finish(): Promise<CaptureArtifact>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

interface RecorderState {
  ready: boolean;
  error?: string;
  recorder?: MediaRecorder;
  stream?: MediaStream;
  uploads: Promise<void>;
  stopped?: Promise<void>;
  sequence: number;
  pendingBytes: number;
}

declare global {
  interface Window {
    astrocadeRecording: RecorderState;
    appendAstrocadeChunk(chunk: { sequence: number; base64: string }): Promise<void>;
  }
}

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Recorder did not finish within its cleanup deadline')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function createGameCapture(options: CaptureOptions): Promise<GameCapture> {
  if (options.signal?.aborted) throw abortError();
  const { width, height } = options.viewport;
  if (![width, height].every(value => Number.isInteger(value) && value >= 240 && value <= 3840)) throw new Error('Invalid capture viewport');
  if (!Number.isFinite(options.maxDurationMs) || options.maxDurationMs <= 0 || options.maxDurationMs > 180_000) throw new Error('Capture duration must be between 0 and 180 seconds');
  if (!options.outputPath.endsWith('.webm')) throw new Error('Native captures must use a .webm output path');
  await ensureNewOutput(options.outputPath);
  await mkdir(dirname(options.outputPath), { recursive: true });
  const title = `Astrocade-capture-${randomUUID()}`;
  const browser = await chromium.launch({ channel: 'chromium', headless: options.headless ?? true, args: [`--auto-select-tab-capture-source-by-title=${title}`] });
  try {
    const page = await browser.newPage({ viewport: options.viewport, deviceScaleFactor: 1 });
    const session = new NativeGameCapture(browser, page, title, options);
    session.attachAbort();
    if (options.signal?.aborted) { await session.close(); throw abortError(); }
    return session;
  } catch (error) { await browser.close(); throw error; }
}

class NativeGameCapture implements GameCapture {
  private recorderPage?: Page;
  private handle?: FileHandle;
  private tempDirectory?: string;
  private readonly partial: string;
  private readonly abort = new AbortController();
  private failure?: Error;
  private startPromise?: Promise<void>;
  private finishPromise?: Promise<CaptureArtifact>;
  private closePromise?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private writer: Promise<void> = Promise.resolve();
  private nextSequence = 0;
  private complete?: CaptureArtifact;
  private readonly onAbort = () => { void this.cancel().catch(() => {}); };

  constructor(private readonly browser: Browser, readonly page: Page, private readonly title: string, private readonly options: CaptureOptions) {
    this.partial = `${options.outputPath}.${randomUUID()}.partial.webm`;
    browser.once('disconnected', () => this.fail(new Error('Gameplay browser disconnected during capture')));
    page.once('close', () => this.fail(new Error('Game page closed during capture')));
  }

  attachAbort(): void { this.options.signal?.addEventListener('abort', this.onAbort, { once: true }); }

  start(): Promise<void> {
    if (this.closePromise || this.finishPromise || this.failure) return Promise.reject(this.failure ?? new Error('Capture already stopped'));
    return this.startPromise ??= this.startRecording();
  }

  private async startRecording(): Promise<void> {
    this.checkCanceled();
    this.tempDirectory = await mkdtemp(join(tmpdir(), 'astrocade-recorder-'));
    const html = join(this.tempDirectory, 'recorder.html');
    await writeFile(html, '<!doctype html><meta charset="utf-8"><title>Astrocade recorder</title><button id="start">Start capture</button>');
    this.handle = await open(this.partial, 'wx');
    this.recorderPage = await this.browser.newPage({ viewport: { width: 640, height: 480 } });
    const recorder = this.recorderPage;
    recorder.once('close', () => this.fail(new Error('Recorder page closed during capture')));
    await recorder.goto(pathToFileURL(html).href);
    await recorder.exposeBinding('appendAstrocadeChunk', async (source, payload: { sequence?: unknown; base64?: unknown }) => {
      if (source.page !== recorder || payload.sequence !== this.nextSequence || typeof payload.base64 !== 'string' || payload.base64.length > 24 * 1024 * 1024) throw new Error('Invalid or out-of-order recording chunk');
      const buffer = Buffer.from(payload.base64, 'base64');
      this.writer = this.writer.then(async () => {
        if (!this.handle) throw new Error('Capture file is closed');
        await this.handle.writeFile(buffer);
        this.nextSequence++;
      });
      await this.writer;
    });
    await recorder.evaluate(({ width, height }) => {
      const state: RecorderState = { ready: false, uploads: Promise.resolve(), sequence: 0, pendingBytes: 0 };
      window.astrocadeRecording = state;
      document.querySelector<HTMLButtonElement>('#start')!.onclick = async () => {
        try {
          if (!MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) throw new Error('This Chromium does not support VP9 recording');
          const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser', width, height, frameRate: 30 }, audio: false });
          state.stream = stream;
          const settings = stream.getVideoTracks()[0]!.getSettings();
          if (settings.displaySurface !== 'browser' || settings.width !== width || settings.height !== height) throw new Error('Capture selected an unexpected surface or size');
          const media = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 8_000_000 });
          state.recorder = media;
          state.stopped = new Promise(resolve => media.addEventListener('stop', () => resolve(), { once: true }));
          media.onerror = () => { state.error = 'Browser video encoder failed'; };
          media.ondataavailable = event => {
            if (!event.data.size) return;
            const sequence = state.sequence++;
            const blob = event.data;
            state.pendingBytes += blob.size;
            if (state.pendingBytes > 16 * 1024 * 1024) {
              state.error = 'Recording writes could not keep up';
              if (media.state !== 'inactive') media.stop();
              return;
            }
            state.uploads = state.uploads.then(async () => {
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = () => reject(reader.error);
                reader.onload = () => resolve(String(reader.result).split(',')[1]!);
                reader.readAsDataURL(blob);
              });
              await window.appendAstrocadeChunk({ sequence, base64 });
              state.pendingBytes -= blob.size;
            }).catch(error => {
              state.error = String(error);
              if (media.state !== 'inactive') media.stop();
            });
          };
          media.start(1000);
          state.ready = true;
        } catch (error) {
          state.error = String(error);
          state.stream?.getTracks().forEach(track => track.stop());
        }
      };
    }, this.options.viewport);
    await this.page.evaluate(title => { document.title = title; }, this.title);
    this.checkCanceled();
    await recorder.getByRole('button', { name: 'Start capture' }).click();
    await recorder.waitForFunction(() => window.astrocadeRecording.ready || window.astrocadeRecording.error, undefined, { timeout: 10_000 });
    const error = await recorder.evaluate(() => window.astrocadeRecording.error);
    if (error) throw new Error(error);
    this.checkCanceled();
    await this.page.bringToFront();
    this.timer = setTimeout(() => {
      this.failure = new Error('Capture exceeded its maximum duration');
      void this.cancel().catch(() => {});
    }, this.options.maxDurationMs);
  }

  async finish(): Promise<CaptureArtifact> {
    if (this.complete) return this.complete;
    if (!this.startPromise) throw new Error('Capture has not started');
    await this.startPromise;
    return this.finishPromise ??= this.finalize();
  }

  private async finalize(): Promise<CaptureArtifact> {
    clearTimeout(this.timer);
    try {
      if (this.recorderPage && !this.recorderPage.isClosed()) {
        try {
          await bounded(this.recorderPage.evaluate(async () => {
            const state = window.astrocadeRecording;
            if (!state) return;
            try {
              if (state.recorder?.state !== 'inactive') state.recorder?.stop();
              await state.stopped;
              await state.uploads;
              if (state.error) throw new Error(state.error);
            } finally { state.stream?.getTracks().forEach(track => track.stop()); }
          }), 10_000);
        } catch (error) {
          await this.recorderPage.close().catch(() => {});
          if (!this.abort.signal.aborted) throw error;
        }
      }
      await this.writer;
      await this.handle?.close();
      this.handle = undefined;
      this.checkCanceled();
      const info = await validateVideo(this.partial, this.options.ffmpeg, this.abort.signal);
      if (info.video?.codec !== 'vp9' || info.video.width !== this.options.viewport.width || info.video.height !== this.options.viewport.height) throw new Error('Final recording has an unexpected codec or dimensions');
      this.checkCanceled();
      await promoteMedia(this.partial, this.options.outputPath);
      if (this.abort.signal.aborted) { await rm(this.options.outputPath, { force: true }); this.checkCanceled(); }
      this.complete = { path: this.options.outputPath, durationSeconds: info.durationSeconds, width: info.video.width, height: info.video.height, codec: info.video.codec };
      return this.complete;
    } finally {
      await this.writer.catch(() => {});
      await this.handle?.close().catch(() => {});
      this.handle = undefined;
      if (!this.complete) await rm(this.partial, { force: true });
      this.options.signal?.removeEventListener('abort', this.onAbort);
    }
  }

  async cancel(): Promise<void> {
    if (this.complete) return;
    this.failure ??= abortError();
    this.abort.abort();
    clearTimeout(this.timer);
    await this.startPromise?.catch(() => {});
    this.finishPromise ??= this.finalize();
    await this.finishPromise.catch(() => {});
  }

  close(): Promise<void> {
    return this.closePromise ??= (async () => {
      await this.cancel();
      await this.browser.close();
      if (this.tempDirectory) await rm(this.tempDirectory, { recursive: true, force: true });
      this.options.signal?.removeEventListener('abort', this.onAbort);
    })();
  }

  private checkCanceled(): void {
    if (this.failure || this.abort.signal.aborted || this.options.signal?.aborted) throw this.failure ?? abortError();
  }

  private fail(error: Error): void {
    if (this.complete || this.closePromise) return;
    this.failure ??= error;
    void this.cancel().catch(() => {});
  }
}

import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { JsonStore } from './store.js';

if (existsSync('.env')) loadEnvFile('.env');

export const settingsSchema = z.object({
  geminiApiKey: z.string().max(500).default(''),
  reasoningModel: z.string().default('gemini-3.8-flash'),
  speechModel: z.string().default('gemini-3.8-flash-lite-tts'),
  transcriptionModel: z.string().default('gemini-3.5-transcribe'),
  voice: z.string().default('Kore'),
});
export type Settings = z.infer<typeof settingsSchema>;
const settingsPatchSchema = settingsSchema.partial().strict();

export class Configuration {
  readonly dataDir: string;
  readonly mediaTools = {
    ffmpegPath: process.env.FFMPEG_PATH ?? (existsSync('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg') ? '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg' : 'ffmpeg'),
    ffprobePath: process.env.FFPROBE_PATH,
    fontPath: resolve(process.env.FONT_PATH ?? 'assets/fonts/NotoSans-Regular.ttf'),
    fontFamily: 'Noto Sans',
  };

  private constructor(readonly store: JsonStore<Settings>, dataDir: string) {
    this.dataDir = dataDir;
  }

  static async open(dataDir = resolve(process.env.DATA_DIR ?? 'data')) {
    return new Configuration(await JsonStore.open(resolve(dataDir, 'settings.json'), settingsSchema, settingsSchema.parse({})), dataDir);
  }

  get(): Settings {
    const value = this.store.read();
    const overrides = {
      geminiApiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    };
    for (const [key, entry] of Object.entries(overrides)) if (entry?.trim()) Reflect.set(value, key, entry);
    return settingsSchema.parse(value);
  }

  async save(patch: z.infer<typeof settingsPatchSchema>) {
    const parsed = settingsPatchSchema.parse(patch);
    await this.store.update(value => { Object.assign(value, parsed); });
  }
}

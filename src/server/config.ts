import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { JsonStore } from './store.js';

if (existsSync('.env')) loadEnvFile('.env');

export const settingsSchema = z.object({
  geminiApiKey: z.string().max(500).default(''),
  tavilyApiKey: z.string().max(500).default(''),
  workbenchPassword: z.string().max(200).default(''),
  reasoningModel: z.string().default('gemini-3.8-flash'),
  speechModel: z.string().default('gemini-3.8-flash-lite-tts'),
  transcriptionModel: z.string().default('gemini-3.5-transcribe'),
  voice: z.string().default('Kore'),
  emailProvider: z.enum(['mailtm', 'imap']).default('mailtm'),
  instagramEmail: z.string().max(254).default(''),
  instagramPassword: z.string().max(200).default(''),
  instagramUsername: z.string().max(30).default(''),
  instagramDisplayName: z.string().max(100).default(''),
  instagramBirthday: z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/).default(''),
  verificationSenders: z.array(z.string().email()).default(['verify@mail.instagram.com', 'security@mail.instagram.com', 'no-reply@mail.instagram.com']),
  imapHost: z.string().default(''),
  imapPort: z.number().int().min(1).max(65535).default(993),
  imapUsername: z.string().default(''),
  imapPassword: z.string().default(''),
  imapAccessToken: z.string().default(''),
  imapMailbox: z.string().default('INBOX'),
  mailtm: z.object({
    provider: z.literal('mailtm'), address: z.string().email(), password: z.string(),
    accountId: z.string().optional(), provisioning: z.enum(['pending', 'created']),
  }).optional(),
});
export type Settings = z.infer<typeof settingsSchema>;
export const settingsPatchSchema = settingsSchema.partial().omit({ mailtm: true }).strict();
const privateFields = ['geminiApiKey', 'tavilyApiKey', 'workbenchPassword', 'instagramPassword', 'instagramBirthday', 'imapPassword', 'imapAccessToken'] as const;

export class Configuration {
  readonly dataDir: string;
  readonly mediaDir: string;
  readonly instagramProfileDir: string;
  readonly port = Number(process.env.PORT ?? 4310);
  readonly host = process.env.HOST ?? '127.0.0.1';
  readonly mediaTools = {
    ffmpegPath: process.env.FFMPEG_PATH ?? (existsSync('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg') ? '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg' : 'ffmpeg'),
    ffprobePath: process.env.FFPROBE_PATH,
    fontPath: resolve(process.env.FONT_PATH ?? 'assets/fonts/NotoSans-Regular.ttf'),
    fontFamily: 'Noto Sans',
  };

  private constructor(readonly store: JsonStore<Settings>, dataDir: string) {
    this.dataDir = dataDir;
    this.mediaDir = resolve(dataDir, 'media');
    this.instagramProfileDir = resolve(dataDir, 'instagram-profile');
  }

  static async open(dataDir = resolve(process.env.DATA_DIR ?? 'data')) {
    return new Configuration(await JsonStore.open(resolve(dataDir, 'settings.json'), settingsSchema, settingsSchema.parse({})), dataDir);
  }

  get(): Settings {
    const value = this.store.read();
    const overrides = {
      geminiApiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
      tavilyApiKey: process.env.TAVILY_API_KEY,
      workbenchPassword: process.env.WORKBENCH_PASSWORD,
      instagramEmail: process.env.INSTAGRAM_EMAIL,
      instagramPassword: process.env.INSTAGRAM_PASSWORD,
      instagramUsername: process.env.INSTAGRAM_USERNAME,
      instagramDisplayName: process.env.INSTAGRAM_DISPLAY_NAME,
      instagramBirthday: process.env.INSTAGRAM_BIRTHDAY,
    };
    for (const [key, entry] of Object.entries(overrides)) if (entry !== undefined) Reflect.set(value, key, entry);
    return settingsSchema.parse(value);
  }

  publicSettings() {
    const value = this.get();
    const { mailtm, ...publicValues } = value;
    const output: Record<string, unknown> = { ...publicValues };
    for (const field of privateFields) { delete output[field]; output[`${field}Configured`] = Boolean(value[field]); }
    output.mailtm = mailtm ? { address: mailtm.address, provisioning: mailtm.provisioning } : null;
    return output;
  }

  async save(patch: z.infer<typeof settingsPatchSchema>) {
    const parsed = settingsPatchSchema.parse(patch);
    await this.store.update(value => { Object.assign(value, parsed); });
  }
}

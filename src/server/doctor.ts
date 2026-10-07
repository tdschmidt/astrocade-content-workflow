import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { Configuration } from './config.js';
import { preflightMediaTools } from './media/probe.js';

export interface ReadinessCheck { name: string; status: 'ready' | 'missing' | 'failed'; message: string }
export async function doctor(config: Configuration): Promise<{ checks: ReadinessCheck[] }> {
  const settings = config.get();
  const checks: ReadinessCheck[] = [];
  checks.push({ name: 'Chromium', status: existsSync(chromium.executablePath()) ? 'ready' : 'missing', message: existsSync(chromium.executablePath()) ? 'Matching Playwright browser installed.' : 'Run npm run browser:install.' });
  try {
    const media = await preflightMediaTools(config.mediaTools);
    checks.push({ name: 'Video rendering', status: 'ready', message: `${media.ffmpegVersion}. Caption font and libass available.` });
  } catch (error) { checks.push({ name: 'Video rendering', status: 'failed', message: error instanceof Error ? error.message : 'FFmpeg preflight failed.' }); }
  checks.push({ name: 'Gemini', status: settings.geminiApiKey ? 'ready' : 'missing', message: settings.geminiApiKey ? 'Key configured. Model access and quota are checked when used.' : 'Set GEMINI_API_KEY for --provider gemini, or use --provider codex after signing in with codex login.' });
  return { checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await doctor(await Configuration.open());
  for (const check of result.checks) console.log(`${check.status.toUpperCase()} ${check.name}: ${check.message}`);
  if (result.checks.some(check => check.status === 'failed')) process.exitCode = 1;
}

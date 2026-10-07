import type { Page } from 'playwright';
import sharp from 'sharp';
import type { GameBounds } from './input.js';

interface GameScreenshotOptions {
  type?: 'png' | 'jpeg';
  quality?: number;
  timeout?: number;
}

/** Observe the displayed game without changing Chromium's native input surface. */
export async function gameScreenshot(page: Page, clip: GameBounds, options: GameScreenshotOptions = {}): Promise<Buffer> {
  if (![clip.x, clip.y, clip.width, clip.height].every(Number.isFinite) || clip.width <= 0 || clip.height <= 0) {
    throw new Error('A game screenshot needs finite bounds with positive dimensions.');
  }
  const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  if (clip.x < 0 || clip.y < 0 || clip.x + clip.width > viewport.width + 0.5 || clip.y + clip.height > viewport.height + 0.5) {
    throw new Error('The game screenshot bounds are outside the current viewport.');
  }
  // A browser-side clip temporarily changes cross-origin hit testing in current
  // Chromium. Even a repaint afterward races screenshots taken DURING inputs.
  // Capture the unchanged viewport and crop its pixels locally instead.
  const image = await page.screenshot({ type: 'png', fullPage: false, scale: 'device', timeout: options.timeout });
  const pipeline = sharp(image);
  const metadata = await pipeline.metadata();
  if (!metadata.width || !metadata.height) throw new Error('The browser screenshot has no image dimensions.');
  const scaleX = metadata.width / viewport.width, scaleY = metadata.height / viewport.height;
  const left = Math.round(clip.x * scaleX), top = Math.round(clip.y * scaleY);
  // Match Playwright's viewport-clip rounding in CSS pixels before applying DPR.
  const width = Math.min(metadata.width - left, Math.round(Math.floor(clip.width + 1e-3) * scaleX));
  const height = Math.min(metadata.height - top, Math.round(Math.floor(clip.height + 1e-3) * scaleY));
  if (width <= 0 || height <= 0) throw new Error('The game screenshot bounds contain no image pixels.');
  const cropped = pipeline.extract({ left, top, width, height });
  return options.type === 'jpeg' ? cropped.jpeg({ quality: options.quality ?? 80 }).toBuffer() : cropped.png().toBuffer();
}

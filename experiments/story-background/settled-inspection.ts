import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import type { GameInspection } from '../../src/server/games/learning.js';
import type { GameCandidate } from '../../src/server/games/schema.js';

/** Experiment-only load stabilization; observes public UI and sends native button clicks. */
export async function inspectSettledGame(candidate: GameCandidate, directory: string): Promise<GameInspection> {
  await mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const viewport = { width: 720, height: 1280 };
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(candidate.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.locator('[aria-label="Start playing"]').click({ timeout: 15_000 });
    const frame = page.frameLocator('iframe[title="Astrocade Game"]');
    await page.waitForTimeout(10_000);
    const surface = page.locator('iframe[title="Astrocade Game"]');
    await surface.waitFor({ state: 'visible' });
    const beforeText = (await frame.locator('body').innerText()).slice(0, 6000);
    const beforeImagePath = join(directory, 'inspection-before.png');
    await surface.screenshot({ path: beforeImagePath });
    const targets = await frame.locator('button').evaluateAll(elements => elements.flatMap((element, index) => {
      const button = element as HTMLButtonElement, box = element.getBoundingClientRect();
      const style = getComputedStyle(element), label = (button.innerText || element.getAttribute('aria-label') || '').trim();
      if (box.width < 1 || box.height < 1 || style.visibility === 'hidden' || style.display === 'none' || button.disabled || !label) return [];
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      if (!hit || (hit !== element && !element.contains(hit))) return [];
      return [{ selector: element.id ? `#${CSS.escape(element.id)}` : `:nth-match(button, ${index + 1})`, label }];
    }));
    const performedStart = targets.find(x => /^(?:start(?: game| run)?|play(?: now)?|let[’']s play|begin|deploy\s*↗?)$/i.test(x.label));
    if (performedStart) {
      await frame.locator(performedStart.selector).click({ timeout: 5000 });
      await page.waitForTimeout(700);
    }
    const imagePath = join(directory, 'inspection.png');
    await surface.screenshot({ path: imagePath });
    const result: GameInspection = {
      gameUrl: candidate.url, observedAt: new Date().toISOString(), outputDir: directory,
      imagePath, beforeImagePath, text: `Before Start:\n${beforeText}\nAfter Start:\n${(await frame.locator('body').innerText()).slice(0, 6000)}`,
      surface: { selector: 'iframe[title="Astrocade Game"]', frames: [] },
      ready: { selector: 'iframe[title="Astrocade Game"]', frames: [] },
      startTargets: targets, startTargetFrames: ['iframe[title="Astrocade Game"]'], performedStart, viewport,
      setup: [{ type: 'click', target: { selector: '[aria-label="Start playing"]', frames: [] } }, { type: 'wait', durationMs: 5000 }, { type: 'wait', durationMs: 5000 }],
    };
    await writeFile(join(directory, 'inspection.json'), JSON.stringify(result, null, 2));
    return result;
  } finally { await browser.close(); }
}

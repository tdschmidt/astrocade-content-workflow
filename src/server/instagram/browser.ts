import { chromium, type BrowserContext, type Locator, type Page } from 'playwright';

export const INSTAGRAM_ORIGIN = 'https://www.instagram.com';

export interface InstagramOutcome {
  status: 'ready' | 'needs_attention' | 'unknown';
  stage: string;
  username?: string;
  reason?: string;
}

export async function openInstagramBrowser(profileDirectory: string): Promise<BrowserContext> {
  // A dedicated visible profile supports both unattended execution and checkpoint handoff.
  // Do not enable tracing/HAR/video here: signup contains credentials and private identity data.
  return chromium.launchPersistentContext(profileDirectory, {
    headless: false,
    channel: 'chromium',
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
  });
}

export async function firstVisible(locators: Locator[]): Promise<Locator | undefined> {
  for (const locator of locators) {
    for (const match of await locator.all()) {
      if (await match.isVisible().catch(() => false)) return match;
    }
  }
  return undefined;
}

export async function activeUsername(page: Page): Promise<string | undefined> {
  if (new URL(page.url()).origin !== INSTAGRAM_ORIGIN) return undefined;
  // Only use the account's Profile navigation control, never a random feed/profile link.
  const hrefs = await page.locator('a[href]').evaluateAll(anchors => anchors
    .filter(anchor => /^(profile|profile picture)$/i.test((anchor.textContent ?? '').trim())
      || /^profile$/i.test(anchor.getAttribute('aria-label') ?? ''))
    .map(anchor => anchor.getAttribute('href') ?? '')).catch(() => []);
  const names = new Set(hrefs.flatMap(href => {
    const match = /^\/(?:@)?([a-zA-Z0-9_.]+)\/?$/.exec(href);
    return match ? [match[1]!] : [];
  }));
  return names.size === 1 ? names.values().next().value : undefined;
}

export async function inspectAccount(page: Page, expectedUsername: string): Promise<InstagramOutcome> {
  const username = await waitForChange(() => activeUsername(page), Boolean);
  if (!username) return { status: 'needs_attention', stage: 'account', reason: 'The signed-in account could not be verified from its Profile control.' };
  if (username.toLowerCase() !== expectedUsername.toLowerCase()) {
    return { status: 'needs_attention', stage: 'account', username, reason: 'The browser is signed into a different account.' };
  }
  return { status: 'ready', stage: 'account', username };
}

export async function waitForChange<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!accept(value) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 300));
    value = await read();
  }
  return value;
}

import { chromium, type Browser } from 'playwright';
import type { GameCandidate } from './schema.js';
import { parsePublicMetrics } from './selection.js';

export const defaultDiscoveryUrls = [
  'https://www.astrocade.com/category/trending',
  'https://www.astrocade.com/category/top_picks',
  'https://www.astrocade.com/',
];

export type DiscoverySource = {
  url: string;
  observedAt: string;
  status: 'ok' | 'empty' | 'unreachable' | 'offline' | 'authentication_required';
  candidateCount: number;
  message?: string;
};
export type DiscoveryResult = {
  status: 'ok' | 'partial' | 'unavailable' | 'empty';
  observedAt: string;
  candidates: GameCandidate[];
  sources: DiscoverySource[];
};

export function canonicalGameUrl(value: string, base = 'https://www.astrocade.com/'): string | undefined {
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || !['astrocade.com', 'www.astrocade.com'].includes(url.hostname)) return;
    if (!/^\/games\/[^/]+\/[A-Za-z0-9-]+\/?$/.test(url.pathname)) return;
    return `https://www.astrocade.com${url.pathname.replace(/\/$/, '')}`;
  } catch { return; }
}

export function isAllowedGameUrl(value: string, allowLocal = false): boolean {
  if (canonicalGameUrl(value)) return true;
  try {
    const url = new URL(value);
    return allowLocal && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

export async function discoverGames(options: {
  browser?: Browser;
  urls?: string[];
  limit?: number;
  signal?: AbortSignal;
  allowLocalSources?: boolean;
  executablePath?: string;
  timeoutMs?: number;
} = {}): Promise<DiscoveryResult> {
  const urls = options.urls ?? defaultDiscoveryUrls;
  if (!urls.length || urls.length > 10) throw new Error('Discovery requires between one and ten source pages.');
  for (const value of urls) {
    const url = new URL(value);
    const astrocade = url.protocol === 'https:' && ['www.astrocade.com', 'astrocade.com'].includes(url.hostname);
    if (!astrocade && !isAllowedGameUrl(value, options.allowLocalSources)) throw new Error('Discovery sources must be Astrocade pages.');
  }
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  const observedAt = new Date().toISOString();
  options.signal?.throwIfAborted();
  const browser = options.browser ?? await chromium.launch({ channel: 'chromium', headless: true, executablePath: options.executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const abort = () => { void context.close().catch(() => {}); };
  options.signal?.addEventListener('abort', abort, { once: true });
  const sources: DiscoverySource[] = [];
  const candidates = new Map<string, GameCandidate>();
  try {
    for (const url of urls) {
      options.signal?.throwIfAborted();
      const page = await context.newPage();
      const source: DiscoverySource = { url, observedAt: new Date().toISOString(), status: 'empty', candidateCount: 0 };
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs ?? 15000 });
        if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
        await page.locator('a[href*="/games/"]').first().waitFor({ state: 'attached', timeout: Math.min(options.timeoutMs ?? 5000, 5000) }).catch(() => {});
        options.signal?.throwIfAborted();
        const body = (await page.locator('body').innerText()).slice(0, 5000);
        if (/you(?:'|’)re offline|you are offline|check your internet connection/i.test(body)) {
          source.status = 'offline'; source.message = 'Astrocade displayed an offline page; no live games were observed.';
        } else if (/\/accounts\/login|\/login(?:\?|$)/.test(page.url())) {
          source.status = 'authentication_required'; source.message = 'This discovery page redirected to sign-in.';
        } else {
          const links = await page.locator('a[href*="/games/"]').evaluateAll(anchors => anchors.map(anchor => {
            const element = anchor as HTMLAnchorElement;
            const explicitCard = element.closest('article, [data-testid="game-card"], [data-game-id], [role="listitem"]') as HTMLElement | null;
            const parent = element.parentElement;
            const parentGameUrls = parent ? new Set(Array.from(parent.querySelectorAll('a[href*="/games/"]')).map(a => a.getAttribute('href')?.split(/[?#]/)[0])) : new Set();
            const card = explicitCard ?? (parent && parent.innerText.length < 700 && parentGameUrls.size === 1 ? parent : element);
            const image = element.querySelector('img') ?? card.querySelector('img');
            const heading = card.querySelector('h1,h2,h3,h4,[data-game-title]');
            const creator = (card.querySelector('a[data-testid="profile-item-link"],a[href^="/profile/"]') as HTMLElement | null)?.innerText.trim() || '';
            const imageAlt = image?.getAttribute('alt')?.trim() || '';
            const creatorSuffix = creator ? ` by ${creator}` : '';
            const alt = creatorSuffix && imageAlt.endsWith(creatorSuffix) ? imageAlt.slice(0, -creatorSuffix.length).trim() : imageAlt;
            // Current cards expose the title in image alt and only a counter inside the game link.
            const bareCount = /^\d[\d,]*(?:\.\d+)?\s*[kmb]?$/i;
            const counter = /^(?:\d[\d,]*(?:\.\d+)?\s*[kmb]?(?:\s+(?:plays?|players?|likes?|favou?rites?))?|(?:plays?|players?|likes?|favou?rites?)\s*:\s*\d[\d,.]*\s*[kmb]?)$/i;
            const visibleTitle = heading?.textContent?.trim() || element.innerText.trim().split('\n').map(line => line.trim()).find(line => line && line !== creator && !counter.test(line)) || '';
            const metricLabels = Array.from(card.querySelectorAll('[aria-label],[aria-labelledby],[title],svg title')).flatMap(node => {
              if (node.closest('[aria-hidden="true"]')) return [];
              const referenced = node.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
              const label = node.getAttribute('aria-label') || referenced || node.getAttribute('title') || (node.tagName.toLowerCase() === 'title' ? node.textContent : '') || '';
              const value = (node as HTMLElement).innerText?.trim() || (node.closest('[data-slot="badge"]') as HTMLElement | null)?.innerText.trim() || '';
              return [label.trim(), bareCount.test(value) ? `${value} ${label.trim()}` : ''].filter(Boolean);
            });
            return {
              url: element.href,
              visibleTitle, alt, creator,
              thumbnailUrl: image?.currentSrc || image?.getAttribute('src') || '',
              text: [card.innerText, imageAlt ? `Image alt: ${imageAlt}` : '', ...metricLabels].filter(Boolean).join('\n').slice(0, 1500),
              metricText: [card.innerText, ...metricLabels].join('\n'),
            };
          }));
          for (const link of links) {
            const gameUrl = canonicalGameUrl(link.url, url);
            if (!gameUrl) continue;
            const parts = new URL(gameUrl).pathname.split('/');
            const id = parts.at(-1)!;
            const existing = candidates.get(gameUrl);
            const observation = { sourceUrl: url, observedAt: source.observedAt, cardText: link.text };
            if (existing) {
              if (!existing.observations.some(o => o.sourceUrl === url)) existing.observations.push(observation);
              continue;
            }
            if (candidates.size >= limit) continue;
            const title = link.visibleTitle || link.alt || decodeURIComponent(parts.at(-2)!).replaceAll('-', ' ');
            const creator = link.creator || link.text.match(/(?:^|\n)\s*(?:by|creator:)\s+([^\n]{1,100})/i)?.[1]?.trim();
            let thumbnailUrl: string | undefined;
            try { const thumbnail = new URL(link.thumbnailUrl, url); if (link.thumbnailUrl && /^https?:$/.test(thumbnail.protocol)) thumbnailUrl = thumbnail.href; } catch { /* Missing or malformed artwork is unknown. */ }
            candidates.set(gameUrl, { id, url: gameUrl, title, titleSource: link.visibleTitle ? 'visible_text' : link.alt ? 'image_alt' : 'url_slug', creator, thumbnailUrl, metrics: parsePublicMetrics(link.metricText), observations: [observation] });
          }
          source.candidateCount = links.filter(l => canonicalGameUrl(l.url, url)).length;
          source.status = source.candidateCount ? 'ok' : 'empty';
          if (!source.candidateCount) source.message = 'The loaded page contained no recognized public game links.';
        }
      } catch (error) {
        options.signal?.throwIfAborted();
        source.status = 'unreachable';
        source.message = error instanceof Error ? error.message.split('\n')[0] : 'Page could not be reached.';
      } finally { sources.push(source); await page.close().catch(() => {}); }
      if (candidates.size >= limit) break;
    }
  } finally {
    options.signal?.removeEventListener('abort', abort);
    await context.close().catch(() => {});
    if (!options.browser) await browser.close();
  }
  const failed = sources.filter(s => !['ok', 'empty'].includes(s.status)).length;
  return { observedAt, candidates: [...candidates.values()], sources, status: candidates.size ? failed ? 'partial' : 'ok' : failed === sources.length ? 'unavailable' : 'empty' };
}

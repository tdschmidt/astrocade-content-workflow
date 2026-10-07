import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Page } from 'playwright';
import { firstVisible, inspectAccount, INSTAGRAM_ORIGIN, waitForChange, type InstagramOutcome } from './browser.js';
import { ensurePublicInstagramAccount } from './signup.js';

export interface PublicationDraft {
  id: string;
  revision: number;
  accountUsername: string;
  assetPath: string;
  assetSha256: string;
  caption: string;
  requiresAiDisclosure: boolean;
}

export interface PublicationApproval {
  draftId: string;
  revision: number;
  accountUsername: string;
  assetSha256: string;
  caption: string;
  requiresAiDisclosure: boolean;
  approvedAt: string;
}

export interface PublicationIntent extends PublicationApproval {
  attemptId: string;
  attemptedAt: string;
  previousPermalinks: string[];
}

export interface PublicationResult extends InstagramOutcome {
  attemptId?: string;
  permalink?: string;
}

export interface PublicationOptions {
  approval?: PublicationApproval;
  existingIntent?: PublicationIntent;
  existingResult?: PublicationResult;
  persistIntent: (intent: PublicationIntent) => Promise<void>;
  persistResult: (result: PublicationResult) => Promise<void>;
  signal?: AbortSignal;
}

export function approvalMatches(draft: PublicationDraft, approval?: PublicationApproval): approval is PublicationApproval {
  return !!approval && approval.draftId === draft.id && approval.revision === draft.revision
    && approval.accountUsername === draft.accountUsername && approval.assetSha256 === draft.assetSha256
    && approval.caption === draft.caption && approval.requiresAiDisclosure === draft.requiresAiDisclosure
    && Number.isFinite(Date.parse(approval.approvedAt));
}

export async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Proves public setting and ordinary desktop upload entry, without selecting a file or sharing. */
export async function ensureInstagramPublishingReady(page: Page, username: string): Promise<InstagramOutcome> {
  const privacy = await ensurePublicInstagramAccount(page, username);
  if (privacy.status !== 'ready') return privacy;
  try {
    await page.goto(`${INSTAGRAM_ORIGIN}/${encodeURIComponent(username)}/`, { waitUntil: 'domcontentloaded' });
    const create = await waitForChange(() => firstVisible([
      page.getByRole('link', { name: /^(create|new post)$/i }),
      page.getByRole('button', { name: /^(create|new post)$/i }), page.getByText(/^create$/i),
    ]), Boolean);
    if (!create) return { status: 'needs_attention', stage: 'composer', reason: 'The public account exists, but its desktop Create control is unavailable.' };
    await create.click();
    const post = await firstVisible([page.getByRole('menuitem', { name: /^post$/i }), page.getByText(/^post$/i)]);
    if (post) await post.click();
    const canUpload = await waitForChange(async () => (await page.locator('input[type="file"]').count()) > 0
      || !!await firstVisible([page.getByRole('button', { name: /^select from computer$/i })]), Boolean);
    if (!canUpload) return { status: 'needs_attention', stage: 'composer', reason: 'The desktop local-file upload entry could not be verified.' };
    await page.goto(`${INSTAGRAM_ORIGIN}/${encodeURIComponent(username)}/`, { waitUntil: 'domcontentloaded' });
    return { status: 'ready', stage: 'publishing_ready', username };
  } catch {
    return { status: 'unknown', stage: 'composer', reason: 'The account exists, but desktop publishing readiness could not be verified.' };
  }
}

async function recentPermalinks(page: Page, username: string): Promise<string[]> {
  await page.goto(`${INSTAGRAM_ORIGIN}/${encodeURIComponent(username)}/`, { waitUntil: 'domcontentloaded' });
  const links = page.locator('a[href*="/reel/"], a[href*="/p/"]');
  const loaded = await waitForChange(async () => {
    const hrefs = await links.evaluateAll(anchors => anchors.map(anchor => anchor.getAttribute('href') ?? ''));
    const permalinks = [...new Set(hrefs.filter(href => /^\/(reel|p)\/[a-zA-Z0-9_-]+\/?$/.test(href)).map(href => new URL(href, INSTAGRAM_ORIGIN).href))];
    const empty = await page.getByText(/^no posts yet$/i).isVisible().catch(() => false);
    return { permalinks, loaded: permalinks.length > 0 || empty };
  }, state => state.loaded);
  if (!loaded.loaded) throw new Error('The profile post list could not be verified');
  return loaded.permalinks;
}

async function captionField(page: Page) {
  return firstVisible([
    page.getByRole('textbox', { name: /write a caption|^caption$/i }),
    page.locator('[contenteditable="true"][aria-label*="caption" i]'),
    page.getByPlaceholder(/write a caption/i),
  ]);
}

/** Uploads and configures a draft, but never clicks Share. */
export async function prepareInstagramReel(page: Page, draft: PublicationDraft): Promise<PublicationResult> {
  try {
    if (await fileSha256(draft.assetPath) !== draft.assetSha256) return { status: 'needs_attention', stage: 'asset', reason: 'The video changed after this draft was prepared.' };
    const account = await inspectAccount(page, draft.accountUsername);
    if (account.status !== 'ready') return account;
    const create = await firstVisible([
      page.getByRole('link', { name: /^(create|new post)$/i }),
      page.getByRole('button', { name: /^(create|new post)$/i }),
      page.getByText(/^create$/i),
    ]);
    if (!create) return { status: 'needs_attention', stage: 'composer', reason: 'The desktop Create control is unavailable for this account.' };
    await create.click();
    const post = await firstVisible([page.getByRole('menuitem', { name: /^post$/i }), page.getByText(/^post$/i)]);
    if (post) await post.click();
    const upload = page.locator('input[type="file"]').first();
    if (await upload.count()) {
      await upload.setInputFiles(draft.assetPath);
    } else {
      const select = await firstVisible([page.getByRole('button', { name: /^select from computer$/i })]);
      if (!select) return { status: 'needs_attention', stage: 'upload', reason: 'The local-file upload control is unavailable.' };
      const chooser = page.waitForEvent('filechooser');
      await select.click();
      await (await chooser).setFiles(draft.assetPath);
    }
    const crop = await firstVisible([page.getByRole('button', { name: /select crop/i }), page.getByLabel(/^select crop$/i)]);
    if (crop) {
      await crop.click();
      const original = await firstVisible([page.getByRole('button', { name: /^original$/i }), page.getByText(/^original$/i)]);
      if (!original) return { status: 'needs_attention', stage: 'crop', reason: 'The original aspect ratio could not be selected. Inspect the crop before publishing.' };
      await original.click();
    }
    for (let step = 0; step < 4; step++) {
      const controls = await waitForChange(async () => ({
        caption: await captionField(page),
        next: await firstVisible([page.getByRole('button', { name: /^next$/i })]),
      }), state => !!state.caption || !!state.next, 30_000);
      if (controls.caption) break;
      if (!controls.next) return { status: 'needs_attention', stage: 'upload', reason: 'Upload processing did not reach the next composer step.' };
      await controls.next.click();
    }
    const caption = await captionField(page);
    if (!caption) return { status: 'needs_attention', stage: 'caption', reason: 'The caption editor was not found.' };
    await caption.fill(draft.caption);
    const actual = await caption.evaluate(element => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.textContent ?? '');
    if (normalize(actual) !== normalize(draft.caption)) return { status: 'needs_attention', stage: 'caption', reason: 'The composer caption does not match the draft.' };
    if (draft.requiresAiDisclosure) {
      const advanced = await firstVisible([page.getByRole('button', { name: /advanced settings/i }), page.getByText(/^advanced settings$/i)]);
      if (advanced) await advanced.click();
      const disclosure = await firstVisible([
        page.getByRole('checkbox', { name: /AI info|made with AI|AI.generated|AI label/i }),
        page.getByRole('switch', { name: /AI info|made with AI|AI.generated|AI label/i }),
      ]);
      if (!disclosure) return { status: 'needs_attention', stage: 'disclosure', reason: 'The required AI disclosure control is not recognizable in this composer. Inspect the open browser before publishing.' };
      await disclosure.setChecked(true);
      if (!await disclosure.isChecked()) return { status: 'needs_attention', stage: 'disclosure', reason: 'The required AI disclosure setting was not enabled.' };
    }
    const share = await firstVisible([page.getByRole('button', { name: /^share$/i })]);
    if (!share) return { status: 'needs_attention', stage: 'composer', reason: 'The Share control is unavailable.' };
    return { status: 'ready', stage: 'prepared', username: draft.accountUsername };
  } catch {
    return { status: 'unknown', stage: 'preparing', reason: 'The upload UI changed or did not respond. No Share action was requested.' };
  }
}

/** Read-only reconciliation. It must never create another upload or click Share. */
export async function reconcileInstagramPublication(page: Page, intent: PublicationIntent): Promise<PublicationResult> {
  const account = await inspectAccount(page, intent.accountUsername);
  if (account.status !== 'ready') return { ...account, attemptId: intent.attemptId };
  try {
    const current = await recentPermalinks(page, intent.accountUsername);
    const candidates = current.filter(url => !intent.previousPermalinks.includes(url));
    const matches: string[] = [];
    for (const permalink of candidates.slice(0, 6)) {
      await page.goto(permalink, { waitUntil: 'domcontentloaded' });
      const verified = await waitForChange(async () => {
        const text = normalize(await page.locator('body').innerText());
        const video = page.locator('video').first();
        const playable = await video.evaluate(element => element instanceof HTMLVideoElement && Number.isFinite(element.duration) && element.duration > 0 && element.readyState >= 1).catch(() => false);
        return playable && !!normalize(intent.caption) && text.includes(normalize(intent.caption));
      }, Boolean, 10_000);
      if (verified) matches.push(permalink);
    }
    if (matches.length === 1) return { status: 'ready', stage: 'published', username: intent.accountUsername, attemptId: intent.attemptId, permalink: matches[0] };
    return { status: 'unknown', stage: 'publication_unknown', username: intent.accountUsername, attemptId: intent.attemptId, reason: matches.length > 1 ? 'Multiple posts match this attempt. Reconcile them in the account before any retry.' : 'No unique playable post with the approved caption could be verified. Do not automatically publish again.' };
  } catch {
    return { status: 'unknown', stage: 'publication_unknown', attemptId: intent.attemptId, reason: 'Publication could not be reconciled. The previous Share action must not be repeated automatically.' };
  }
}

export async function publishInstagramReel(page: Page, draft: PublicationDraft, options: PublicationOptions): Promise<PublicationResult> {
  if (options.signal?.aborted) return { status: 'needs_attention', stage: 'cancelled', reason: 'Publication was cancelled before another browser action.' };
  if (options.existingIntent) {
    if (!approvalMatches(draft, options.existingIntent)) return { status: 'needs_attention', stage: 'approval', reason: 'An existing publication intent belongs to different draft content. Resolve it before another attempt.' };
    if (options.existingResult?.status === 'ready' && options.existingResult.stage === 'published'
      && options.existingResult.attemptId === options.existingIntent.attemptId && options.existingResult.permalink) return options.existingResult;
    const result = await reconcileInstagramPublication(page, options.existingIntent);
    await options.persistResult(result);
    return result;
  }
  if (!approvalMatches(draft, options.approval)) return { status: 'needs_attention', stage: 'approval', reason: 'Explicit approval must match this account, video, caption, disclosure and revision before Share.' };
  const account = await inspectAccount(page, draft.accountUsername);
  if (account.status !== 'ready') return account;
  let intent: PublicationIntent | undefined;
  try {
    options.signal?.throwIfAborted();
    const previousPermalinks = await recentPermalinks(page, draft.accountUsername);
    const prepared = await prepareInstagramReel(page, draft);
    if (prepared.status !== 'ready') return prepared;
    // Recheck the local file and caption immediately before recording the external action.
    if (await fileSha256(draft.assetPath) !== draft.assetSha256) return { status: 'needs_attention', stage: 'asset', reason: 'The approved file changed during upload.' };
    const caption = await captionField(page);
    const actual = await caption?.evaluate(element => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.textContent ?? '');
    if (!actual || normalize(actual) !== normalize(draft.caption)) return { status: 'needs_attention', stage: 'caption', reason: 'The caption changed before Share.' };
    const finalAccount = await inspectAccount(page, draft.accountUsername);
    if (finalAccount.status !== 'ready') return finalAccount;
    if (draft.requiresAiDisclosure) {
      const disclosure = await firstVisible([
        page.getByRole('checkbox', { name: /AI info|made with AI|AI.generated|AI label/i }),
        page.getByRole('switch', { name: /AI info|made with AI|AI.generated|AI label/i }),
      ]);
      if (!disclosure || !await disclosure.isChecked()) return { status: 'needs_attention', stage: 'disclosure', reason: 'The required disclosure changed before Share.' };
    }
    const share = await firstVisible([page.getByRole('button', { name: /^share$/i })]);
    if (!share) return { status: 'needs_attention', stage: 'composer', reason: 'The Share control disappeared.' };
    options.signal?.throwIfAborted();
    intent = { ...options.approval, attemptId: randomUUID(), attemptedAt: new Date().toISOString(), previousPermalinks };
    await options.persistIntent(intent);
    options.signal?.throwIfAborted();
    await share.click(); // The only Share action in this adapter. Never repeat an existing intent.
    await page.getByText(/your (?:reel|post) has been shared/i).waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    const result = await reconcileInstagramPublication(page, intent);
    await options.persistResult(result);
    return result;
  } catch {
    const result: PublicationResult = {
      status: 'unknown', stage: intent ? 'publication_unknown' : 'preparing',
      ...(intent ? { attemptId: intent.attemptId } : {}),
      reason: intent ? 'The Share outcome is uncertain. Reconcile the saved intent; do not automatically repeat it.' : 'The composer could not be prepared. No Share action was requested.',
    };
    await options.persistResult(result);
    return result;
  }
}

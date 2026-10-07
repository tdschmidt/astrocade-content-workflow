import type { Locator, Page } from 'playwright';
import { activeUsername, firstVisible, inspectAccount, INSTAGRAM_ORIGIN, waitForChange, type InstagramOutcome } from './browser.js';
import { waitForVerificationCode, type VerificationInbox } from './inbox.js';

export interface InstagramAccountDetails {
  email: string;
  password: string;
  birthday: { year: number; month: number; day: number };
  displayName: string;
  username: string;
}

export interface SignupCheckpoint {
  phase: 'submitted' | 'verification_submitted' | 'created';
  username: string;
  verificationRequestedAt: string;
  usedMessageIds?: string[];
}

export interface SignupOptions {
  checkpoint?: SignupCheckpoint;
  persistCheckpoint: (checkpoint: SignupCheckpoint) => Promise<void>;
  inbox?: VerificationInbox;
  allowedVerificationSenders?: string[];
  verificationTimeoutMs?: number;
  signal?: AbortSignal;
}

export type SignupScreen = 'signup' | 'birthday' | 'login' | 'email_code' | 'challenge' | 'onboarding' | 'signed_in' | 'unknown';

export async function classifySignupScreen(page: Page): Promise<SignupScreen> {
  if (await activeUsername(page)) return 'signed_in';
  const text = await page.locator('body').innerText().catch(() => '');
  if (/\/(challenge|checkpoint|two_factor)\b/i.test(new URL(page.url()).pathname)
    || /confirm (?:that )?you.re human|video selfie|account (?:has been )?suspended|enter (?:a |your )?phone number/i.test(text)) return 'challenge';
  const code = await confirmationInput(page);
  if (code && /email|e-mail/i.test(text)) return 'email_code';
  if (code) return 'challenge';
  if (await firstVisible([page.locator('input[name="emailOrPhone"]'), page.getByRole('textbox', { name: /^mobile number or email$/i })])) return 'signup';
  if (await firstVisible([page.getByRole('combobox', { name: /month/i }), page.locator('select[title^="Month"]'), page.locator('select[name="birthday_month"]')])) return 'birthday';
  if (await firstVisible([page.getByRole('button', { name: /^log in$/i })])
    && await firstVisible([page.locator('input[name="password"]')])) return 'login';
  if (await firstVisible([page.getByRole('button', { name: /^(not now|skip)$/i })])) return 'onboarding';
  return 'unknown';
}

async function confirmationInput(page: Page): Promise<Locator | undefined> {
  return firstVisible([
    page.getByRole('textbox', { name: /confirmation code|security code|verification code/i }),
    page.locator('input[name="email_confirmation_code"]'),
    page.locator('input[autocomplete="one-time-code"]'),
  ]);
}

function validateDetails(details: InstagramAccountDetails): void {
  if (!details.email.includes('@') || !details.password || !details.displayName.trim()
    || !/^[a-zA-Z0-9_.]{1,30}$/.test(details.username)) throw new Error('Intended Instagram account details are incomplete or invalid');
  const { year, month, day } = details.birthday;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (![year, month, day].every(Number.isInteger) || year < 1900
    || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getTime() > Date.now()) throw new Error('Provide the account owner’s real, valid birthday');
}

async function fillRequired(page: Page, candidates: Locator[], value: string): Promise<void> {
  const field = await firstVisible(candidates);
  if (!field) throw new Error('A required signup field is unavailable');
  await field.fill(value);
}

async function fillBirthday(page: Page, birthday: InstagramAccountDetails['birthday']): Promise<void> {
  for (const part of ['month', 'day', 'year'] as const) {
    const field = await firstVisible([
      page.getByRole('combobox', { name: new RegExp(part, 'i') }),
      page.locator(`select[name="birthday_${part}"]`),
      page.locator(`select[title^="${part[0]!.toUpperCase()}${part.slice(1)}"]`),
    ]);
    if (!field) throw new Error('The birthday selectors are unavailable');
    const options = await field.locator('option').evaluateAll(nodes => nodes.map(node => ({ value: (node as HTMLOptionElement).value, text: node.textContent ?? '' })));
    let wanted = String(birthday[part]);
    if (part === 'month' && options.some(option => /^january$/i.test(option.text) && option.value === '0')) wanted = String(birthday.month - 1);
    const option = options.find(option => option.value === wanted || option.value === wanted.padStart(2, '0'));
    if (!option) throw new Error('The intended birthday option is unavailable');
    await field.selectOption(option.value);
  }
}

async function fillSignup(page: Page, details: InstagramAccountDetails): Promise<void> {
  await fillRequired(page, [page.locator('input[name="emailOrPhone"]'), page.getByRole('textbox', { name: /^mobile number or email$/i })], details.email);
  await fillRequired(page, [page.locator('input[name="password"]'), page.getByLabel(/^password$/i)], details.password);
  await fillRequired(page, [page.locator('input[name="fullName"]'), page.getByRole('textbox', { name: /^(full name|name)$/i })], details.displayName);
  await fillRequired(page, [page.locator('input[name="username"]'), page.getByRole('textbox', { name: /^username$/i })], details.username);
  if (await firstVisible([page.getByRole('combobox', { name: /month/i }), page.locator('select[title^="Month"]'), page.locator('select[name="birthday_month"]')])) await fillBirthday(page, details.birthday);
}

/** Executes signup; unknown/challenge screens leave the same browser open for a checkpoint. */
export async function createOrResumeInstagramAccount(
  page: Page,
  details: InstagramAccountDetails,
  options: SignupOptions,
): Promise<InstagramOutcome> {
  validateDetails(details);
  let checkpoint = options.checkpoint;
  if (checkpoint && checkpoint.username !== details.username) throw new Error('Signup checkpoint belongs to a different username');
  try {
    options.signal?.throwIfAborted();
    if (new URL(page.url()).origin !== INSTAGRAM_ORIGIN) await page.goto(`${INSTAGRAM_ORIGIN}${checkpoint ? '/accounts/login/' : '/accounts/emailsignup/'}`, { waitUntil: 'domcontentloaded' });
    let screen = await waitForChange(() => classifySignupScreen(page), state => state !== 'unknown');
    if (screen === 'login' && checkpoint) {
      await fillRequired(page, [page.locator('input[name="username"]'), page.getByRole('textbox', { name: /phone number, username, or email/i })], details.username);
      await fillRequired(page, [page.locator('input[name="password"]'), page.getByLabel(/^password$/i)], details.password);
      await page.getByRole('button', { name: /^log in$/i }).click();
      screen = await waitForChange(() => classifySignupScreen(page), state => state !== 'login' && state !== 'unknown', 30_000);
    }
    if (screen === 'signup' && !checkpoint) {
      await fillSignup(page, details);
      const submit = await firstVisible([page.getByRole('button', { name: /^(sign up|submit|next)$/i })]);
      if (!submit) return { status: 'needs_attention', stage: 'signup', reason: 'The signup submission control is unavailable.' };
      // Save intent before the external action. An ambiguous result must not cause another signup.
      checkpoint = { phase: 'submitted', username: details.username, verificationRequestedAt: new Date().toISOString() };
      await options.persistCheckpoint(checkpoint);
      await submit.click();
      screen = await waitForChange(() => classifySignupScreen(page), state => state !== 'signup' && state !== 'unknown', 30_000);
    }
    for (let step = 0; step < 6; step++) {
      options.signal?.throwIfAborted();
      if (screen === 'signed_in') {
        const result = await inspectAccount(page, details.username);
        if (result.status === 'ready') {
          await options.persistCheckpoint({ ...checkpoint, phase: 'created', username: details.username, verificationRequestedAt: checkpoint?.verificationRequestedAt ?? new Date().toISOString() });
          return { ...result, stage: 'created' };
        }
        return result;
      }
      if (screen === 'challenge') return { status: 'needs_attention', stage: 'verification', reason: 'Instagram requires a checkpoint in the open browser. Complete it there, then resume.' };
      if (screen === 'birthday') {
        await fillBirthday(page, details.birthday);
        const next = await firstVisible([page.getByRole('button', { name: /^(next|submit|sign up)$/i })]);
        if (!next) return { status: 'needs_attention', stage: 'birthday', reason: 'The birthday confirmation control is unavailable.' };
        await next.click();
        screen = await waitForChange(() => classifySignupScreen(page), state => state !== 'birthday' && state !== 'unknown', 30_000);
        if (screen === 'birthday') return { status: 'needs_attention', stage: 'birthday', reason: 'Birthday confirmation did not advance. Inspect the current validation message.' };
        continue;
      }
      if (screen === 'email_code') {
        if (!checkpoint || !options.inbox || !options.allowedVerificationSenders?.length) {
          return { status: 'needs_attention', stage: 'email_verification', reason: 'Email verification is open. Configure the existing inbox and expected sender, or enter the code in this browser and resume.' };
        }
        if (checkpoint.phase === 'verification_submitted') return { status: 'needs_attention', stage: 'email_verification', reason: 'The previous code was submitted but verification has not completed. Inspect the current screen before another attempt.' };
        const match = await waitForVerificationCode(options.inbox, {
          recipient: details.email,
          since: checkpoint.verificationRequestedAt,
          allowedSenders: options.allowedVerificationSenders,
          usedMessageIds: checkpoint.usedMessageIds,
        }, { timeoutMs: options.verificationTimeoutMs, signal: options.signal });
        if (match.status !== 'found') return { status: 'needs_attention', stage: 'email_verification', reason: match.status === 'ambiguous' ? 'Multiple possible verification codes need inspection.' : 'No fresh matching verification email arrived before the deadline.' };
        const input = await confirmationInput(page);
        const submit = await firstVisible([page.getByRole('button', { name: /^(next|confirm|submit)$/i })]);
        if (!input || !submit) return { status: 'unknown', stage: 'email_verification', reason: 'The email verification screen changed.' };
        await input.fill(match.code);
        checkpoint = { ...checkpoint, phase: 'verification_submitted', usedMessageIds: [...(checkpoint.usedMessageIds ?? []), match.messageId] };
        await options.persistCheckpoint(checkpoint);
        await submit.click();
        screen = await waitForChange(() => classifySignupScreen(page), state => state !== 'email_code' && state !== 'unknown', 30_000);
        continue;
      }
      if (screen === 'onboarding') {
        const skip = await firstVisible([page.getByRole('button', { name: /^(not now|skip)$/i })]);
        if (skip) await skip.click();
        screen = await waitForChange(() => classifySignupScreen(page), state => state !== 'onboarding' && state !== 'unknown');
        continue;
      }
      return { status: 'unknown', stage: checkpoint ? 'signup_submitted' : 'signup', reason: checkpoint ? 'Signup was already submitted. Inspect this browser; automatic resubmission is disabled.' : 'The current signup screen is not recognized.' };
    }
    return { status: 'needs_attention', stage: 'onboarding', reason: 'Onboarding needs inspection in the open browser.' };
  } catch {
    return { status: 'unknown', stage: checkpoint ? 'signup_submitted' : 'signup', reason: 'The browser action did not complete. Inspect the open browser and resume; credentials were not logged.' };
  }
}

/** Separate from account creation: verifies or switches the intended project account to public. */
export async function ensurePublicInstagramAccount(page: Page, username: string): Promise<InstagramOutcome> {
  try {
    const account = await inspectAccount(page, username);
    if (account.status !== 'ready') return account;
    await page.goto(`${INSTAGRAM_ORIGIN}/accounts/account_privacy/`, { waitUntil: 'domcontentloaded' });
    const toggle = await waitForChange(() => firstVisible([page.getByRole('checkbox', { name: /private account/i }), page.getByRole('switch', { name: /private account/i })]), Boolean);
    if (!toggle) return { status: 'needs_attention', stage: 'privacy', reason: 'Verify the public-account setting in the open browser, then resume.' };
    if (await toggle.isChecked()) {
      await toggle.setChecked(false);
      const confirm = await firstVisible([page.getByRole('button', { name: /^switch to public$/i })]);
      if (confirm) await confirm.click();
    }
    await waitForChange(() => toggle.isChecked(), checked => !checked);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await toggle.waitFor({ state: 'visible' });
    const stillPrivate = await toggle.isChecked();
    return stillPrivate
      ? { status: 'needs_attention', stage: 'privacy', reason: 'The account is still private.' }
      : { status: 'ready', stage: 'public', username };
  } catch {
    return { status: 'unknown', stage: 'privacy', reason: 'The public-account setting could not be verified.' };
  }
}

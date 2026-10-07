import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { createOrResumeInstagramAccount, type SignupCheckpoint } from './signup.js';
import { ensureInstagramPublishingReady, fileSha256, publishInstagramReel, type PublicationDraft, type PublicationIntent } from './publish.js';

const fixtureOptions = { skip: process.env.INSTAGRAM_BROWSER_FIXTURE !== '1' };
const launch = () => chromium.launch({ headless: true, channel: 'chromium' });

test('local browser fixture: signup fills real controls and verifies an email without human input', fixtureOptions, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `
      <form id="signup"><input name="emailOrPhone" aria-label="Mobile number or email"><input name="password" type="password">
      <input name="fullName" aria-label="Name"><input name="username" aria-label="Username">
      <select title="Month:"><option value="10">October</option></select><select title="Day:"><option value="6">6</option></select>
      <select title="Year:"><option value="1990">1990</option></select><button>Submit</button></form>
      <script>document.querySelector('form').onsubmit = event => {
        event.preventDefault(); window.submitted = Object.fromEntries(new FormData(event.target));
        document.body.innerHTML = '<p>Check your email for your Instagram confirmation code</p><input name="email_confirmation_code"><button id="confirm">Confirm</button>';
        document.querySelector('#confirm').onclick = () => {
          if (document.querySelector('input').value === '123456') document.body.innerHTML = '<a href="/project/">Profile</a>';
        };
      };</script>` }));
    const checkpoints: SignupCheckpoint[] = [];
    const result = await createOrResumeInstagramAccount(page, {
      email: 'project@example.com', password: 'fixture-only-password', username: 'project', displayName: 'Project', birthday: { year: 1990, month: 10, day: 6 },
    }, {
      persistCheckpoint: async checkpoint => { checkpoints.push(checkpoint); },
      allowedVerificationSenders: ['verify@mail.instagram.com'],
      inbox: { listMessages: async () => [{ id: 'fresh', receivedAt: new Date().toISOString(), to: ['project@example.com'], from: 'verify@mail.instagram.com', subject: 'Instagram code 123456', text: 'Your confirmation code is 123456.' }] },
    });
    assert.equal(result.status, 'ready');
    assert.equal(result.stage, 'created');
    assert.deepEqual(checkpoints.map(checkpoint => checkpoint.phase), ['submitted', 'verification_submitted', 'created']);
    assert.equal(JSON.stringify(checkpoints).includes('fixture-only-password'), false);
    const submitted = await page.evaluate(() => (window as unknown as { submitted: Record<string, string> }).submitted);
    assert.equal(submitted.emailOrPhone, 'project@example.com');
    assert.equal(submitted.username, 'project');
  } finally { await browser.close(); }
});

test('local browser fixture: approved upload records intent before one Share and verifies its permalink', fixtureOptions, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'instagram-fixture-'));
  const browser = await launch();
  try {
    const assetPath = join(directory, 'fixture.mp4');
    await writeFile(assetPath, 'local fixture content; no real upload');
    const page = await browser.newPage();
    const caption = 'A unique Astrocade fixture caption';
    let shares = 0;
    let privacyChecks = 0;
    let omitDisclosure = false;
    let intent: PublicationIntent | undefined;
    await page.route('**/*', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/accounts/account_privacy/') {
        privacyChecks++;
        await route.fulfill({ contentType: 'text/html', body: '<a href="/project/">Profile</a><label>Private account<input type="checkbox"></label>' });
        return;
      }
      if (pathname === '/fixture-share') {
        assert.ok(intent, 'intent is persisted before Share');
        shares++;
        await route.fulfill({ contentType: 'application/json', body: '{}' });
        return;
      }
      if (pathname === '/reel/fixture-proof/') {
        await route.fulfill({ contentType: 'text/html', body: `<a href="/project/">Profile</a><p>${caption}</p><video></video>
          <script>const video = document.querySelector('video'); Object.defineProperty(video, 'duration', {value: 4}); Object.defineProperty(video, 'readyState', {value: 1});</script>` });
        return;
      }
      await route.fulfill({ contentType: 'text/html', body: `<a href="/project/">Profile</a><h1>project</h1>
        ${shares ? '<a href="/reel/fixture-proof/">Published reel</a>' : '<p>No posts yet</p>'}
        <button id="create">Create</button><div id="composer"></div>
        <script>const composer = document.querySelector('#composer');
        document.querySelector('#create').onclick = () => {
          composer.innerHTML = '<input type="file">';
          composer.querySelector('input').onchange = () => {
            composer.innerHTML = '<button id="next">Next</button>';
            composer.querySelector('#next').onclick = () => {
              composer.innerHTML = '<textarea aria-label="Write a caption"></textarea>${omitDisclosure ? '' : '<label>AI info<input type="checkbox"></label>'}<button id="share">Share</button>';
              composer.querySelector('#share').onclick = async () => {
                if (!composer.querySelector('input').checked) throw new Error('disclosure missing');
                await fetch('/fixture-share', {method: 'POST'}); composer.innerHTML = '<p>Your reel has been shared</p>';
              };
            };
          };
        };</script>` });
    });
    await page.goto('https://www.instagram.com/project/');
    assert.equal((await ensureInstagramPublishingReady(page, 'project')).stage, 'publishing_ready');
    assert.equal(privacyChecks, 2, 'privacy was verified again after reload');
    const draft: PublicationDraft = { id: 'fixture', revision: 1, accountUsername: 'project', assetPath, assetSha256: await fileSha256(assetPath), caption, requiresAiDisclosure: true };
    const result = await publishInstagramReel(page, draft, {
      approval: { draftId: draft.id, revision: 1, accountUsername: 'project', assetSha256: draft.assetSha256, caption, requiresAiDisclosure: true, approvedAt: new Date().toISOString() },
      persistIntent: async value => { intent = value; }, persistResult: async () => {},
    });
    assert.equal(result.status, 'ready');
    assert.equal(result.permalink, 'https://www.instagram.com/reel/fixture-proof/');
    assert.equal(shares, 1);
    assert.deepEqual(await publishInstagramReel(page, draft, {
      existingIntent: intent!, existingResult: result,
      persistIntent: async () => { throw new Error('duplicate intent'); }, persistResult: async () => {},
    }), result);
    assert.equal(shares, 1);
    omitDisclosure = true;
    const changedDraft = { ...draft, id: 'second-fixture' };
    const withheld = await publishInstagramReel(page, changedDraft, {
      approval: { draftId: changedDraft.id, revision: 1, accountUsername: 'project', assetSha256: draft.assetSha256, caption, requiresAiDisclosure: true, approvedAt: new Date().toISOString() },
      persistIntent: async () => { throw new Error('missing disclosure must prevent publication intent'); }, persistResult: async () => {},
    });
    assert.equal(withheld.status, 'needs_attention');
    assert.equal(withheld.stage, 'disclosure');
    assert.equal(shares, 1);
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});

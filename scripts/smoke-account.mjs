import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "./lib/headlessEdge.mjs";

// Synthetic account responses only: no real sign-in, payouts or preference changes.
const browser = await launchBrowser({ port: 9479 });
const shadow = "document.querySelector('.web-account-dialog > div')?.shadowRoot";
const out = new URL("../.tmp/account-check/", import.meta.url);
await mkdir(out, { recursive: true });
const checks = {};
try {
  await browser.viewport(1280, 820);
  await browser.goto(process.env.ADCODE_ACCOUNT_TEST_URL ?? "http://localhost:5180");
  assert(await browser.waitFor("document.querySelector('.web-gate-card')", { timeoutMs: 60000 }));
  await browser.evaluate(`(() => {
    const balance = { availableMicros: '72415000', lifetimeMicros: '128250000' };
    const payouts = { minMicros: '50000000', ...balance, pendingMicros: '0', eligible: false, rules: [{ id: 'profile', ok: false, label: 'Add payout details', detail: 'Tell us where the money goes.' }], profile: null, withdrawals: [] };
    const referral = { code: 'fixture', link: 'https://example.test/i/fixture', showName: false, inviterPreview: 'A developer', claimed: false, invitedBy: null, canClaim: false, claimEndsAt: 0, people: { claimed: 3, seen: 5, cameBack: 2 }, advertisers: 0, earnedMicros: '1500000', last30Micros: '500000', rates: { userPercent: 10, advertiserPercent: 5, windowDays: 30 } };
    const prefs = { subscribed: false, email: 'test@example.test', eligible: true, suppressed: false };
    const original = window.fetch;
    window.accountTestWrites = [];
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (!url.pathname.startsWith('/v1/')) return original(input, init);
      const body = init?.body ? JSON.parse(init.body) : {};
      if (init?.method && init.method !== 'GET') window.accountTestWrites.push({ path: url.pathname, body });
      let value;
      switch (url.pathname) {
        case '/v1/balance': if (window.accountTestUnavailable) return Response.json({ error: 'server-error' }, { status: 503 }); value = balance; break;
        case '/v1/activity': value = { days: [], totals: { manualChars: 0, agentChars: 0, acceptedEdits: 0, rejectedEdits: 0, activeMs: 0, sessions: 0, agentPercent: null } }; break;
        case '/v1/ledger': value = { rows: [{ entryId: url.searchParams.has('cursor') ? 'older' : 'first', kind: 'impression', micros: '15000', description: url.searchParams.has('cursor') ? 'Older verified view' : 'Verified sponsor view', createdAt: Date.now(), refId: null }], nextCursor: url.searchParams.has('cursor') ? null : 'older' }; break;
        case '/v1/referrals': Object.assign(referral, body); value = referral; break;
        case '/v1/payouts': value = payouts; break;
        case '/v1/payout-corridors': value = { corridors: [] }; break;
        case '/v1/payouts/profile': value = { ...payouts, profile: { ...body, adultConfirmedAt: Date.now(), updatedAt: Date.now() } }; break;
        case '/v1/email-preferences': Object.assign(prefs, body); value = prefs; break;
        default: return Response.json({ error: 'not-found' }, { status: 404 });
      }
      return Response.json(value);
    };
    return true;
  })()`);
  await browser.evaluate(`import('/@web/accountPanel.tsx').then(m => m.openAccountPanel({ token: 'synthetic-test-token', email: 'test@example.test', refresh: async () => 'synthetic-test-token', signOut: async () => {} }))`);
  assert(await browser.waitFor(`${shadow}?.querySelector('.hero-figure')`), "account renders with its existing data components");
  checks.balance = await browser.evaluate(`${shadow}.querySelector('.hero-figure').textContent`);
  assert(checks.balance.includes('72.41'));
  await browser.screenshot(fileURLToPath(new URL("account-desktop.png", out)));
  const choose = async (label) => {
    await browser.evaluate(`[...${shadow}.querySelectorAll('.account-nav > button')].find(b => b.textContent.includes(${JSON.stringify(label)})).click()`);
    assert(await browser.waitFor(`${shadow}.querySelector('.account-main').getAttribute('aria-label') === ${JSON.stringify(label)}`));
  };
  await choose('Invites');
  assert(await browser.waitFor(`${shadow}.querySelector('.invite-panel-name input')`));
  await browser.evaluate(`${shadow}.querySelector('.invite-panel-name input').click()`);
  assert(await browser.waitFor("window.accountTestWrites.some(w => w.path === '/v1/referrals' && w.body.showName === true)"));
  checks.inviteUpdate = true;
  await choose('Email preferences');
  await browser.evaluate(`${shadow}.querySelector('#email-preferences input').click()`);
  await browser.evaluate(`${shadow}.querySelector('#email-preferences button').click()`);
  assert(await browser.waitFor("window.accountTestWrites.some(w => w.path === '/v1/email-preferences' && w.body.subscribed === true)"));
  checks.preferenceUpdate = true;
  await choose('Payouts');
  assert(await browser.waitFor(`${shadow}.querySelector('#legal-name')`));
  checks.payoutForm = await browser.evaluate(`${shadow}.querySelector('#payouts').textContent.includes('Tell us where the money goes.')`);
  assert(checks.payoutForm);
  await browser.screenshot(fileURLToPath(new URL("account-payouts.png", out)));
  await choose('Ledger');
  await browser.evaluate(`[...${shadow}.querySelectorAll('#ledger button')].find(b => b.textContent.includes('Load older')).click()`);
  assert(await browser.waitFor(`${shadow}.querySelector('#ledger').textContent.includes('Older verified view')`));
  checks.ledgerPagination = true;
  await choose('Overview');
  await browser.evaluate(`window.accountTestUnavailable = true; ${shadow}.querySelector('.account-toolbar button').click()`);
  assert(await browser.waitFor(`${shadow}.querySelector('[role=alert]')`));
  assert(await browser.evaluate(`${shadow}.querySelector('.hero-figure') === null`));
  await browser.evaluate(`window.accountTestUnavailable = false; ${shadow}.querySelector('[role=alert] button').click()`);
  assert(await browser.waitFor(`${shadow}.querySelector('.hero-figure')`));
  checks.errorAndRetry = true;
  await browser.viewport(390, 844, true);
  for (const label of ['Overview', 'Earnings', 'Invites', 'Payouts', 'Activity', 'Ledger', 'Email preferences']) {
    await choose(label);
    assert(await browser.evaluate(`(() => { const m = ${shadow}.querySelector('.account-main'); return m.scrollWidth <= m.clientWidth + 1; })()`), label + ' fits on a phone');
  }
  checks.mobileSections = 7;
  await choose('Overview');
  await browser.screenshot(fileURLToPath(new URL("account-phone.png", out)));
  await browser.evaluate(`${shadow}.querySelector('.account-back').click()`);
  assert(await browser.waitFor("document.querySelector('.web-account-dialog') === null"));
  checks.close = true;
  const errors = browser.consoleErrors.filter(t => !/Failed to load resource|ERR_CONNECTION_REFUSED/.test(t));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(checks, null, 2));
} finally { await browser.close(); }

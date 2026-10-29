// BUG-25: after the screen locks, iPads stop the page's audio and don't restart
// it. The kitchen must notice and ask for a tap again instead of staying silent.
// A stand-in AudioContext lets the test play the iPad: `allowResume` is false
// while only a tap may restart sound.
import { test, expect, seedData } from './fixtures.js';

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        const a = window.__audio = { allowResume: true, ctx: null, beeps: 0 };
        class FakeAudioContext {
            constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; a.ctx = this; }
            resume() { if (a.allowResume) this.state = 'running'; return Promise.resolve(); }
            createOscillator() { a.beeps++; return { frequency: {}, connect() {}, start() {}, stop() {} }; }
            createGain() { return { gain: {}, connect() {} }; }
        }
        window.AudioContext = window.webkitAudioContext = FakeAudioContext;
    });
});

const banner = (page) => page.locator('#sound-banner');
const audio = (page) => page.evaluate(() => ({ state: window.__audio.ctx && window.__audio.ctx.state, beeps: window.__audio.beeps }));
// Screen locks: sound stops, and only a tap may restart it.
const lock = (page, state = 'interrupted') => page.evaluate((state) => { window.__audio.ctx.state = state; window.__audio.allowResume = false; }, state);
const wake = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const newTicket = (page) => page.evaluate((t) => window.__fakeDb.set('tickets/k9', Object.assign(t, { timestamp: Date.now() })), seedData().tickets.k1);

async function soundOnByTap(page) {
    await page.goto('kitchen.html');
    await expect(banner(page)).toBeVisible();
    await banner(page).click();
    await expect(banner(page)).toBeHidden();
    expect((await audio(page)).state).toBe('running');
}

test('after the screen locks, the tap banner comes back and a tap restores sound', async ({ page, errors }) => {
    await soundOnByTap(page);
    await lock(page);
    await wake(page);
    await expect(banner(page)).toBeVisible();

    await page.evaluate(() => { window.__audio.allowResume = true; });
    await banner(page).click();
    await expect(banner(page)).toBeHidden();
    const before = (await audio(page)).beeps;
    await newTicket(page);
    await expect.poll(async () => (await audio(page)).beeps).toBeGreaterThan(before);
    expect((await audio(page)).state).toBe('running');
    expect(errors).toEqual([]);
});

test('where the device allows it, sound restarts on its own without the banner', async ({ page, errors }) => {
    await soundOnByTap(page);
    await page.evaluate(() => { window.__audio.ctx.state = 'suspended'; });
    await wake(page);
    await expect.poll(async () => (await audio(page)).state).toBe('running');
    await expect(banner(page)).toBeHidden();
    expect(errors).toEqual([]);
});

test('a new order on a silenced tablet brings the banner back', async ({ page, errors }) => {
    await soundOnByTap(page);
    await lock(page, 'suspended');
    await newTicket(page);
    await expect(page.getByText('Smoke Latte')).toHaveCount(2);
    await expect(banner(page)).toBeVisible();
    expect(errors).toEqual([]);
});

// BUG-10: a tap on a ticket only counts if the ticket is still in the state
// this screen shows. "Unseen" writes play another device or a late update.
test.describe('ticket status from a stale screen (BUG-10)', () => {
    const TOK = 'TRACKtrackTRACKtrack';
    test.use({ db: (() => {
        const d = seedData();
        d.tickets.k1.trackTok = TOK;
        d.order_track = { [TOK]: { bill: 'B7', status: 'accepted', at: 1, paid: true } };
        return d;
    })() });
    const get = (page, p) => page.evaluate((p) => window.__fakeDb.get(p), p);
    const stale = (page, p, v) => page.evaluate(([p, v]) => window.__fakeDb.setUnseen(p, v), [p, v]);
    const open = async (page) => {
        await page.goto('kitchen.html');
        await expect(page.locator('.action-btn')).toHaveCount(1);
    };

    test('start cooking: ticket and tracking page move on', async ({ page, errors }) => {
        await open(page);
        await page.locator('.action-btn').click();
        await expect.poll(() => get(page, 'tickets/k1/status')).toBe('cooking');
        await expect.poll(() => get(page, 'order_track/' + TOK + '/status')).toBe('making');
        expect(errors).toEqual([]);
    });

    test('a tap on a ticket that was cancelled meanwhile changes nothing', async ({ page, errors }) => {
        await open(page);
        await stale(page, 'tickets/k1/status', 'canceled');
        await page.locator('.action-btn').click();
        await page.waitForTimeout(300);
        expect(await get(page, 'tickets/k1/status')).toBe('canceled');
        expect(await get(page, 'order_track/' + TOK + '/status')).toBe('accepted');
        expect(errors).toEqual([]);
    });

    test('undo on a ticket another screen already finished changes nothing', async ({ page, errors }) => {
        await open(page);
        await page.locator('.action-btn').click(); // pending → cooking
        await expect(page.locator('.undo-btn')).toHaveCount(1);
        await stale(page, 'tickets/k1/status', 'completed');
        await page.locator('.undo-btn').click();
        await page.waitForTimeout(300);
        expect(await get(page, 'tickets/k1/status')).toBe('completed');
        expect(await get(page, 'order_track/' + TOK + '/status')).toBe('making');
        expect(errors).toEqual([]);
    });
});

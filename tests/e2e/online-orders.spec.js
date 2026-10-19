// The cashier's online-orders panel (online-cashier.js) renders data written by
// anonymous customers on order.html, inside a logged-in staff session.
import { test, expect, seedData } from './fixtures.js';

const PAYLOAD = '<img src="x-xss-probe" onerror="window.__xss=(window.__xss||0)+1">';

function dbWithHostileOrders() {
    const now = Date.now();
    const db = seedData(now);
    const order = (status, ageMin) => ({
        name: 'Evil ' + PAYLOAD,
        phone: '+8562011112222',
        status,
        createdAt: now - ageMin * 60000,
        total: 20000,
        items: [{ itemId: 'tea', qty: 1, unitPrice: 20000, name: PAYLOAD, note: PAYLOAD }],
    });
    db.online_orders = {
        'ON171026001-AAA': order('new', 1), // waiting for the cashier
        'ON171026002-BBB': order('rejected', 30), // in the "done" list
        'ON171026003-CCC': order('expired', 60), // in the "expired" list (SEC-1)
    };
    return db;
}

test.describe('online orders panel', () => {
    test.use({ db: dbWithHostileOrders() });

    test('SEC-1: customer-supplied names are shown as text, never run as HTML', async ({ page, errors }) => {
        await page.goto('cashier.html');
        await page.locator('.axo-btn').click();
        const panel = page.locator('.axo-ov');
        await expect(panel).toBeVisible();
        await expect(panel).toContainText('ON171026003-CCC');

        // Every section that lists the hostile orders shows the payload literally...
        await expect(panel.getByText(PAYLOAD, { exact: false }).first()).toBeVisible();
        // ...and no element was created from it.
        await expect(page.locator('img[src="x-xss-probe"]')).toHaveCount(0);
        await page.waitForTimeout(300); // give a broken image time to fire onerror
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
        expect(errors).toEqual([]);
    });
});

function dbWithNewOrder() {
    const now = Date.now();
    const db = seedData(now);
    db.online_orders = {
        'ON191026001-AAA': {
            name: 'Somchai', phone: '+8562011112222', status: 'new', createdAt: now - 60000, total: 20000,
            items: [{ itemId: 'tea', qty: 1, unitPrice: 20000, name: 'Smoke Tea' }],
        },
    };
    return db;
}
const billsFor = (page, id) => page.evaluate((id) => Object.values(window.__fakeDb.get('orders') || {}).filter((b) => b.appOrderNo === id).length, id);

test.describe('accepting an online order', () => {
    test.use({ db: dbWithNewOrder() });

    test('opens one bill and marks the order accepted', async ({ page, errors }) => {
        await page.goto('cashier.html');
        await page.locator('.axo-btn').click();
        await page.locator('.axo-ov [data-a="unpaid"][data-id="ON191026001-AAA"]').click();
        await expect.poll(() => page.evaluate(() => window.__fakeDb.get('online_orders/ON191026001-AAA/billId'))).toBeTruthy();
        expect(await page.evaluate(() => window.__fakeDb.get('online_orders/ON191026001-AAA/status'))).toBe('accepted');
        expect(await billsFor(page, 'ON191026001-AAA')).toBe(1);
        expect(errors).toEqual([]);
    });

    test('BUG-5: does not open a second bill when another device accepted it first', async ({ page, errors }) => {
        await page.goto('cashier.html');
        await page.locator('.axo-btn').click();
        const accept = page.locator('.axo-ov [data-a="unpaid"][data-id="ON191026001-AAA"]');
        await expect(accept).toBeVisible();
        // Another cashier device accepts it; this device's screen hasn't updated yet.
        await page.evaluate(() => window.__fakeDb.setUnseen('online_orders/ON191026001-AAA/status', 'accepted'));
        await accept.click();
        await expect(page.getByText('ถูกจัดการจากเครื่องอื่นแล้ว')).toBeVisible();
        expect(await billsFor(page, 'ON191026001-AAA')).toBe(0);
        expect(await page.evaluate(() => window.__fakeDb.get('online_orders/ON191026001-AAA/billId'))).toBeNull();
        expect(errors).toEqual([]);
    });
});

function dbWithExpiredOrders() {
    const now = Date.now();
    const db = seedData(now);
    const order = (id, hoursAgo, tok) => ({
        name: 'Late Payer', phone: '+8562033334444', status: 'expired', createdAt: now - hoursAgo * 3600000, expiredAt: now - hoursAgo * 3600000 + 600000,
        total: 20000, trackTok: tok, items: [{ itemId: 'tea', qty: 1, unitPrice: 20000, name: 'Smoke Tea' }],
    });
    db.online_orders = {
        'ON181026001-OLD': order('ON181026001-OLD', 25, 'OLDtokOLDtokOLDtok01'),
        'ON191026001-NEW': order('ON191026001-NEW', 2, 'NEWtokNEWtokNEWtok01'),
    };
    db.order_track = {
        OLDtokOLDtokOLDtok01: { bill: 'ON181026001-OLD', status: 'expired', paid: false, at: now - 25 * 3600000 },
        NEWtokNEWtokNEWtok01: { bill: 'ON191026001-NEW', status: 'expired', paid: false, at: now - 2 * 3600000 },
    };
    return db;
}

test.describe('expired online orders', () => {
    test.use({ db: dbWithExpiredOrders() });

    test('BUG-22: are kept (with their tracking page) after 24 h, just hidden from the list', async ({ page, errors }) => {
        await page.clock.install();
        await page.clock.resume();
        await page.goto('cashier.html');
        await expect(page.locator('.axo-btn')).toBeVisible();
        await page.clock.fastForward(20000); // let the 15 s cleanup run
        await page.waitForTimeout(100);

        await page.locator('.axo-btn').click();
        const panel = page.locator('.axo-ov');
        await expect(panel).toContainText('ON191026001-NEW'); // under 24 h: listed, can be revived
        await expect(panel.locator('[data-a="revive"][data-id="ON191026001-NEW"]')).toBeVisible();
        await expect(panel).not.toContainText('ON181026001-OLD'); // over 24 h: hidden from the list...
        for (const path of ['online_orders/ON181026001-OLD', 'order_track/OLDtokOLDtokOLDtok01', 'online_orders/ON191026001-NEW']) {
            expect(await page.evaluate((p) => window.__fakeDb.get(p), path), path).not.toBeNull(); // ...but kept
        }
        const deletes = await page.evaluate(() => window.__FAKE_WRITES.filter((w) => w[0] === 'remove' || (w[0] === 'update' && Object.values(w[2]).some((v) => v === null))));
        expect(deletes).toEqual([]);
        expect(errors).toEqual([]);
    });
});

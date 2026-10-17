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
        await page.goto('index.html');
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

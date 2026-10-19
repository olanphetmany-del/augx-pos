// Customer storefront (order.html) features added after the smoke tests:
// placing an order, test mode (PR #3), product links and sharing (PRs #5/#7),
// and the PRE-ORDER "starting price" (PR #2).
import { test, expect, seedData } from './fixtures.js';

const fakeDb = (page, path) => page.evaluate((p) => window.__fakeDb.get(p), path);

// Opens Smoke Tea, adds it, and confirms a pickup order as a new customer.
async function orderTea(page) {
    await page.locator('.item[data-id="tea"]').click();
    await page.locator('#sheet [data-act="add"]').click();
    await page.locator('#bar-btn').click();
    await page.locator('#sheet [data-act="checkout"]').click();
    await page.locator('#cname').fill('Somchai');
    await page.locator('#cphone').fill('020 5555 6666');
    await page.locator('#sheet [data-act="confirm"]').click();
}
const onlyOrder = async (page) => {
    const all = (await fakeDb(page, 'online_orders')) || {};
    expect(Object.keys(all)).toHaveLength(1);
    const [id] = Object.keys(all);
    return { id, ...all[id] };
};

test.describe('customer storefront', () => {
    test.use({ user: null });

    test('places a pickup order: online order + tracking page, no test flag', async ({ page, errors }) => {
        await page.goto('order.html');
        await expect(page.locator('#testbar')).toBeHidden();
        await orderTea(page);
        await expect.poll(() => fakeDb(page, 'online_orders')).not.toBeNull();
        const o = await onlyOrder(page);
        expect(o.id).toMatch(/^ON\d{9}-[A-Z]{3}$/);
        expect(o).toMatchObject({ name: 'Somchai', phone: '+8562055556666', status: 'new', total: 20000 });
        expect(o.items).toEqual([expect.objectContaining({ itemId: 'tea', qty: 1, unitPrice: 20000 })]);
        expect(o.test).toBeUndefined();
        const t = await fakeDb(page, 'order_track/' + o.trackTok);
        expect(t).toMatchObject({ bill: o.id, status: 'new', total: 20000 });
        expect(t.test).toBeUndefined();
        expect(await fakeDb(page, 'throttle/+8562055556666')).toEqual(expect.any(Number));
        // A real order remembers the customer on this phone.
        expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('augx')))).not.toEqual([]);
        expect(errors).toEqual([]);
    });

    test('test mode (?test): order is flagged, nothing is saved on the phone, tracking shown', async ({ page, errors }) => {
        await page.goto('order.html?test');
        await expect(page.locator('#testbar')).toBeVisible();
        await orderTea(page);
        await expect.poll(() => fakeDb(page, 'online_orders')).not.toBeNull();
        const o = await onlyOrder(page);
        expect(o.test).toBe(true);
        expect((await fakeDb(page, 'order_track/' + o.trackTok)).test).toBe(true);
        expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('augx')))).toEqual([]);
        await expect(page).toHaveURL(/#t=/);
        expect(errors).toEqual([]);
    });

    test('product link ?p= opens that item; an unknown id shows the normal storefront', async ({ page, errors }) => {
        await page.goto('order.html?p=latte');
        await expect(page.locator('#sheet')).toBeVisible();
        await expect(page.locator('#sheet')).toContainText(/smoke latte/i);

        await page.goto('order.html?p=dunk'); // a SHOP item: switches to the SHOP group
        await expect(page.locator('#sheet')).toContainText(/smoke dunk/i);
        await page.locator('#sheet [data-act="close"]').first().click();
        await expect(page.locator('.item[data-id="dunk"]')).toBeVisible();

        await page.goto('order.html?p=nope');
        await expect(page.locator('.item[data-id="latte"]')).toBeVisible();
        await expect(page.locator('#sheet')).toBeHidden();
        expect(errors).toEqual([]);
    });

    test('share button sends the ?p= link through the phone share sheet', async ({ page, errors }) => {
        await page.addInitScript(() => {
            window.__shared = [];
            navigator.share = (d) => { window.__shared.push(d); return Promise.resolve(); };
        });
        await page.goto('order.html?p=latte');
        await page.locator('#sheet [data-act="share"]').click();
        const [d] = await page.evaluate(() => window.__shared);
        expect(new URL(d.url).pathname).toBe('/');
        expect(new URL(d.url).search).toBe('?p=latte');
        expect(d.text).toMatch(/^SMOKE LATTE · .*AUGUSTX$/);
        expect(errors).toEqual([]);
    });

    test('without a share sheet, the link is copied instead', async ({ page, errors }) => {
        await page.addInitScript(() => {
            window.__copied = [];
            Object.defineProperty(navigator, 'share', { value: undefined });
            Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
        });
        await page.goto('order.html?p=latte');
        await page.locator('#sheet [data-act="share"]').click();
        await expect.poll(() => page.evaluate(() => window.__copied.length)).toBe(1);
        expect(await page.evaluate(() => window.__copied[0])).toMatch(/\n.*\/\?p=latte$/);
        expect(errors).toEqual([]);
    });

    test.describe('PRE-ORDER-only shoe', () => {
        const db = seedData();
        db.menu_items.jordan = {
            name: 'Smoke Jordan', category: 'Smoke Shoes', priceOptions: '41|4200,42|4200', prePrice: 4200, preFrom: true,
            currency: 'THB', retail: true, usesCup: false, preorder: true, stockOn: true, stock: { 41: 0, 42: 0 },
        };
        test.use({ db });
        test('shows a starting price (ເລີ່ມຕົ້ນ)', async ({ page, errors }) => {
            await page.goto('order.html?shop');
            const card = page.locator('.item[data-id="jordan"]');
            await expect(card).toContainText('ເລີ່ມຕົ້ນ');
            await expect(card).toContainText('4,200');
            await expect(page.locator('.item[data-id="dunk"]')).not.toContainText('ເລີ່ມຕົ້ນ');
            expect(errors).toEqual([]);
        });
    });
});

test.describe('cashier: test-mode orders', () => {
    const db = seedData();
    db.online_orders = {
        'ON191026009-TST': {
            name: 'Tester', phone: '+8562011112222', status: 'new', createdAt: Date.now() - 60000, total: 20000, test: true,
            items: [{ itemId: 'tea', qty: 1, unitPrice: 20000, name: 'Smoke Tea' }],
        },
    };
    test.use({ db });

    test('accepting opens no bill, no kitchen ticket and changes no stock', async ({ page, errors }) => {
        await page.goto('cashier.html');
        await page.locator('.axo-btn').click();
        await expect(page.locator('.axo-ov')).toContainText('TEST');
        const writesBefore = await page.evaluate(() => window.__FAKE_WRITES.length);
        await page.locator('.axo-ov [data-a="paid"][data-id="ON191026009-TST"]').click();
        await expect.poll(() => fakeDb(page, 'online_orders/ON191026009-TST/status')).toBe('accepted');
        expect(await fakeDb(page, 'online_orders/ON191026009-TST/paid')).toBe(true);
        expect(await fakeDb(page, 'online_orders/ON191026009-TST/billId')).toBeNull();
        // Every write went to the order itself: nothing to bills, tickets, stock, cups, counters or customers.
        const paths = await page.evaluate((n) => window.__FAKE_WRITES.slice(n).map((w) => w[1]), writesBefore);
        expect(paths.length).toBeGreaterThan(0);
        for (const p of paths) expect(p).toMatch(/^online_orders\/ON191026009-TST(\/|$)/);
        expect(errors).toEqual([]);
    });
});

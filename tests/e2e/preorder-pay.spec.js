// Pre-orders on two devices. "Unseen" writes play the other device: this
// screen still shows the old data.
// BUG-7: taking the rest of a payment must create exactly one revenue bill.
// BUG-27: a status step from a stale screen must not move the order back.
import { test, expect, seedData } from './fixtures.js';

const DEPOSIT = { kind: 'deposit', amt: 400000, method: 'cash', at: 1, lak: 400000 };
function db() {
    const d = seedData();
    d.preorders = {
        p1: {
            no: 'PO-T1', status: 'arrived', name: 'Smoke Dunk', variant: '42', qty: 1, customerName: 'Lee', customerPhone: '+8562055556666',
            total: 1000000, paid: 400000, cur: 'LAK', store: 'shop', createdAt: Date.now() - 86400000, etaFrom: Date.now(), etaTo: Date.now(),
            arrivedAt: Date.now(), pickupBy: Date.now() + 7 * 86400000, payments: { x1: DEPOSIT },
        },
        p2: { // fully paid, waiting at the shop
            no: 'PO-T2', status: 'arrived', name: 'Smoke Dunk', variant: '43', qty: 1, customerName: 'Kham', customerPhone: '+8562077778888',
            total: 1000000, paid: 1000000, cur: 'LAK', store: 'shop', createdAt: Date.now() - 86400000, etaFrom: Date.now(), etaTo: Date.now(),
            orderedAt: 1, shippedAt: 2, arrivedAt: 3, pickupBy: 4, payments: { y1: { kind: 'full', amt: 1000000, method: 'cash', at: 1, lak: 1000000 } },
        },
    };
    return d;
}
test.use({ db: db() });

const bills = (page) => page.evaluate(() => Object.values(window.__fakeDb.get('orders') || {}).filter((b) => b.appOrderNo === 'PO-T1'));
const po = (page) => page.evaluate(() => window.__fakeDb.get('preorders/p1'));
const otherDevice = (page, path, v) => page.evaluate(([p, v]) => window.__fakeDb.setUnseen('preorders/p1/' + p, v), [path, v]);

async function openPay(page) {
    await page.goto('shop.html');
    await expect(page.locator('#login-overlay')).toBeHidden();
    await page.evaluate(() => window.AXPO.open());
    await page.locator('[data-open="p1"]').click();
    await page.locator('[data-a="pay-rest"]').click();
    await expect(page.locator('[data-a="pay-save"]')).toBeEnabled();
}

test('paying the rest creates one bill and records the payment', async ({ page, errors }) => {
    await openPay(page);
    await page.locator('[data-a="pay-save"]').click();
    await expect.poll(async () => (await po(page)).paid).toBe(1000000);
    expect(await bills(page)).toHaveLength(1);
    const p = await po(page);
    expect(Object.keys(p.payments)).toHaveLength(2);
    expect(p.payClaim).toBeUndefined();
    expect(errors).toEqual([]);
});

test('a screen that missed a payment from another device is stopped', async ({ page, errors }) => {
    await openPay(page);
    await otherDevice(page, 'paid', 1000000); // the other device already took the rest
    await page.locator('[data-a="pay-save"]').click();
    await expect(page.getByText('ยอดที่จ่ายแล้วเปลี่ยนจากเครื่องอื่น')).toBeVisible();
    expect(await bills(page)).toHaveLength(0);
    expect((await po(page)).paid).toBe(1000000);
    expect((await po(page)).payClaim).toBeUndefined();
    expect(errors).toEqual([]);
});

test('while another device is taking payment, this one waits', async ({ page, errors }) => {
    await openPay(page);
    await page.evaluate(() => window.__fakeDb.setUnseen('preorders/p1/payClaim', { id: 'other', at: Date.now(), by: 'staff@example.com' }));
    await page.locator('[data-a="pay-save"]').click();
    await expect(page.getByText('อีกเครื่องกำลังรับเงิน')).toBeVisible();
    expect(await bills(page)).toHaveLength(0);
    expect(errors).toEqual([]);
});

test('a claim left behind by a crashed device expires', async ({ page, errors }) => {
    await openPay(page);
    await page.evaluate(() => window.__fakeDb.setUnseen('preorders/p1/payClaim', { id: 'other', at: Date.now() - 10 * 60000 }));
    await page.locator('[data-a="pay-save"]').click();
    await expect.poll(async () => (await po(page)).paid).toBe(1000000);
    expect(await bills(page)).toHaveLength(1);
    expect(errors).toEqual([]);
});

test.describe('status steps (BUG-27)', () => {
    // confirm(): yes to the status question, no to the WhatsApp / print follow-ups.
    const openP2 = async (page) => {
        await page.goto('shop.html');
        await expect(page.locator('#login-overlay')).toBeHidden();
        await page.evaluate(() => { window.confirm = (m) => !/WhatsApp|พิมพ์/.test(m); });
        await page.evaluate(() => window.AXPO.open());
        await page.locator('[data-open="p2"]').click();
    };
    const p2 = (page) => page.evaluate(() => window.__fakeDb.get('preorders/p2'));

    test('picked up: the status and pickup time are saved', async ({ page, errors }) => {
        await openP2(page);
        await page.locator('[data-a="picked"]').click();
        await expect.poll(async () => (await p2(page)).status).toBe('picked');
        expect((await p2(page)).pickedAt).toBeGreaterThan(4);
        expect(errors).toEqual([]);
    });

    test('undo from a screen that missed "picked up" is refused', async ({ page, errors }) => {
        await openP2(page);
        await page.evaluate(() => window.__fakeDb.setUnseen('preorders/p2/status', 'picked'));
        await page.locator('[data-a="undo"]').click();
        await expect(page.getByText('สถานะถูกเปลี่ยนจากเครื่องอื่นแล้ว')).toBeVisible();
        const p = await p2(page);
        expect(p.status).toBe('picked');
        expect(p.pickupBy).toBe(4); // not cleared by the stale undo
        expect(errors).toEqual([]);
    });

    test('a step from a stale screen does not overwrite a newer status', async ({ page, errors }) => {
        await openP2(page);
        await page.evaluate(() => window.__fakeDb.setUnseen('preorders/p2/status', 'shipping')); // another device undid "arrived"
        await page.locator('[data-a="picked"]').click();
        await expect(page.getByText('สถานะถูกเปลี่ยนจากเครื่องอื่นแล้ว')).toBeVisible();
        expect((await p2(page)).status).toBe('shipping');
        expect((await p2(page)).pickedAt).toBeUndefined();
        expect(errors).toEqual([]);
    });
});

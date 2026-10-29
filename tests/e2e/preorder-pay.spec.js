// BUG-7: taking the rest of a pre-order payment must create exactly one
// revenue bill, even when another device just took it or is taking it now.
// "Unseen" writes play the other device: this screen still shows the old data.
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

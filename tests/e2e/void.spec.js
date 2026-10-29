// BUG-6: the void dialog can stay open while another device pays, voids or
// adds to the same bill. voidBill (shared.js) must not act on that stale copy.
// Seed: o1 is open (2 cups), o2 is paid; inventory has 200 cups.
import { test, expect } from './fixtures.js';

test.beforeEach(async ({ page, errors }) => { // `errors` installs the fake Firebase
    await page.goto('cashier.html');
    await expect(page.locator('#login-overlay')).toBeHidden();
});

const db = (page, p) => page.evaluate((p) => window.__fakeDb.get(p), p);
const set = (page, p, v) => page.evaluate(([p, v]) => window.__fakeDb.set(p, v), [p, v]);
// What the dialog does: the bill as it looked when the dialog opened, then confirm.
const staleCopy = (page, id) => page.evaluate((id) => JSON.parse(JSON.stringify(window.__fakeDb.get('orders/' + id))), id);
const confirmVoid = (page, id, bill, refund) => page.evaluate(([id, bill, refund]) =>
    window.voidBill(id, bill, { reason: 'คีย์ผิด', by: 'cashier', refund }).then(() => 'ok', (e) => e.message), [id, bill, refund]);
const cancelTickets = (page) => page.evaluate(() => Object.values(window.__fakeDb.get('tickets') || {}).filter((t) => t.kind === 'cancel').length);

test('a void confirmed after another device took payment is refused', async ({ page, errors }) => {
    const bill = await staleCopy(page, 'o1');
    await set(page, 'orders/o1/status', 'paid');
    await set(page, 'orders/o1/paid', true);
    expect(await confirmVoid(page, 'o1', bill)).toContain('ชำระเงินจากเครื่องอื่น');
    expect(await db(page, 'orders/o1/status')).toBe('paid');
    expect(await db(page, 'orders/o1/voidedAt')).toBeNull();
    expect(await db(page, 'inventory/cups')).toBe(200);
    expect(await cancelTickets(page)).toBe(0);
    expect(errors).toEqual([]);
});

test('voiding twice restores stock once and sends one cancel ticket', async ({ page, errors }) => {
    const bill = await staleCopy(page, 'o1');
    expect(await confirmVoid(page, 'o1', bill)).toBe('ok');
    expect(await confirmVoid(page, 'o1', bill)).toContain('ยกเลิกจากเครื่องอื่น');
    expect(await db(page, 'orders/o1/status')).toBe('void');
    expect(await db(page, 'inventory/cups')).toBe(202);
    expect(await cancelTickets(page)).toBe(1);
    expect(errors).toEqual([]);
});

test('a round added elsewhere after the dialog opened is restored too', async ({ page, errors }) => {
    const bill = await staleCopy(page, 'o1');
    const items = bill.items.concat([{ lid: 'l9', itemId: 'tea', name: 'Smoke Tea', variant: '', price: 20000, quantity: 1, modifiers: [], cup: true, round: 2 }]);
    await set(page, 'orders/o1/items', items);
    await set(page, 'orders/o1/cups', 3);
    expect(await confirmVoid(page, 'o1', bill)).toBe('ok');
    expect(await db(page, 'inventory/cups')).toBe(203);
    expect(errors).toEqual([]);
});

test('voiding a paid bill records the refund', async ({ page, errors }) => {
    const bill = await staleCopy(page, 'o2');
    expect(await confirmVoid(page, 'o2', bill, { status: 'refunded', method: 'cash' })).toBe('ok');
    const o2 = await db(page, 'orders/o2');
    expect(o2).toMatchObject({ status: 'void', voidedWasPaid: true, voidReason: 'คีย์ผิด', refund: { status: 'refunded', method: 'cash', amount: 20000 } });
    expect(errors).toEqual([]);
});

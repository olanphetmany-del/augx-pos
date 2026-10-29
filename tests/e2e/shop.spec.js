// SHOP counter (shop.html). BUG-15: a failed payment followed by "Retry" (or
// cancel and pay again) must not open a second bill or deduct stock twice.
import { test, expect } from './fixtures.js';

const shopBills = (page) => page.evaluate(() => Object.values(window.__fakeDb.get('orders') || {}).filter((b) => b.store === 'shop'));
const stock = (page) => page.evaluate(() => window.__fakeDb.get('menu_items/dunk/stock/42'));

async function cartToPaySheet(page) {
    await page.goto('shop.html');
    await page.locator('#tabs button[data-v="sell"]').click();
    await page.locator('#sell button[data-add="dunk"][data-v="42"]').click();
    await page.locator('#go-pay').click();
    // The next payment attempt fails once, as on a flaky connection.
    await page.evaluate(() => {
        const real = window.payBill;
        window.payBill = function () { window.payBill = real; return Promise.reject(new Error('network')); };
    });
    await page.locator('#p-ok').click();
    await expect(page.locator('#p-ok')).toHaveText('ลองใหม่');
}

test('retry after a failed payment pays the same bill', async ({ page, errors }) => {
    await cartToPaySheet(page);
    await page.locator('#p-ok').click();
    await expect(page.getByText('รับเงินแล้ว')).toBeVisible();
    const bills = await shopBills(page);
    expect(bills).toHaveLength(1);
    expect(bills[0].status).toBe('paid');
    expect(await stock(page)).toBe(1);
    expect(errors).toEqual([]);
});

test('cancel after a failed payment leaves one unpaid bill to pay from the list', async ({ page, errors }) => {
    await cartToPaySheet(page);
    await page.locator('#p-no').click();
    await expect(page.locator('#go-pay')).toHaveCount(0); // the cart became the bill
    await page.locator('#sell [data-paybill]').click();
    await page.locator('#p-ok').click();
    await expect(page.getByText('รับเงินแล้ว')).toBeVisible();
    const bills = await shopBills(page);
    expect(bills).toHaveLength(1);
    expect(bills[0].status).toBe('paid');
    expect(await stock(page)).toBe(1);
    expect(errors).toEqual([]);
});

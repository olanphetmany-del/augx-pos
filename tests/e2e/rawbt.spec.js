// BUG-28: "send straight to RawBT" is set for the whole shop, but RawBT is
// installed per device. Each Android device asks once and remembers, so a
// phone without RawBT uses the print dialog instead of printing nothing.
import { test, expect, seedData } from './fixtures.js';

const ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const db = (() => { const d = seedData(); d.settings.printer = { printMethod: 'rawbt', paperSize: '58mm' }; return d; })();

async function cashier(page) {
    await page.goto('cashier.html');
    await expect(page.locator('#login-overlay')).toBeHidden();
    // Record which print path runs instead of really printing.
    await page.evaluate(() => {
        window.__printed = [];
        window.printReceiptDialog = () => window.__printed.push('dialog');
        window.rcptEscBytes = () => { window.__printed.push('rawbt'); return new Promise(() => {}); };
    });
}
const print = (page) => page.evaluate(() => window.printReceipt(window.__fakeDb.get('orders/o2'), false));
const printed = (page) => page.evaluate(() => window.__printed);
const stored = (page) => page.evaluate(() => localStorage.getItem('augx-rawbt'));
const question = (page) => page.getByText('เครื่องนี้ติดตั้งแอป RawBT แล้วหรือยัง?');

test.describe('Android device, shop set to RawBT', () => {
    test.use({ userAgent: ANDROID, db });

    test('asks once; "not installed" uses the print dialog from then on', async ({ page, errors }) => {
        await cashier(page);
        await print(page);
        await expect(question(page)).toBeVisible();
        expect(await printed(page)).toEqual([]);
        await page.getByRole('button', { name: 'ยังไม่มี · ใช้หน้าต่างพิมพ์' }).click();
        expect(await printed(page)).toEqual(['dialog']);
        expect(await stored(page)).toBe('off');
        await print(page);
        await expect(question(page)).toHaveCount(0);
        expect(await printed(page)).toEqual(['dialog', 'dialog']);
        expect(errors).toEqual([]);
    });

    test('"installed" sends to RawBT', async ({ page, errors }) => {
        await cashier(page);
        await print(page);
        await page.getByRole('button', { name: 'มี RawBT แล้ว · ส่งตรง' }).click();
        expect(await printed(page)).toEqual(['rawbt']);
        expect(await stored(page)).toBe('on');
        expect(errors).toEqual([]);
    });

    test('#printer asks again so the choice can be changed', async ({ page, errors }) => {
        await cashier(page);
        await page.evaluate(() => localStorage.setItem('augx-rawbt', 'on'));
        await page.evaluate(() => { location.hash = '#printer'; });
        await expect(question(page)).toBeVisible();
        await page.getByRole('button', { name: 'ยังไม่มี · ใช้หน้าต่างพิมพ์' }).click();
        expect(await stored(page)).toBe('off');
        await expect(page.getByText('บันทึกการพิมพ์ของเครื่องนี้แล้ว')).toBeVisible();
        expect(errors).toEqual([]);
    });
});

test.describe('Android device, staff screen in English', () => {
    test.use({ userAgent: ANDROID, db });
    test('the question is translated', async ({ page, errors }) => {
        await page.addInitScript(() => localStorage.setItem('augx-lang', 'en')); // runs after the fixture clears storage
        await cashier(page);
        await print(page);
        await expect(page.getByText('Is the RawBT app installed on this device?')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Not installed · use the print dialog' })).toBeVisible();
        expect(errors).toEqual([]);
    });
});

test.describe('computer, shop set to RawBT', () => {
    test.use({ db });
    test('never asks; uses the print dialog', async ({ page, errors }) => {
        await cashier(page);
        await print(page);
        await expect(question(page)).toHaveCount(0);
        expect(await printed(page)).toEqual(['dialog']);
        expect(errors).toEqual([]);
    });
});

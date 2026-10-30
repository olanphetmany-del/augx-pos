// Smoke tests: every page loads against a fake Firebase without JavaScript
// errors and shows the seeded data. Catches broken uploads, missing files and
// script-order problems before customers or staff do.
import { test, expect, OWNER, ADMIN2, STAFF, seedData } from './fixtures.js';

const loginOverlay = (page) => page.locator('#login-overlay');
// Everything on the page except the login overlay is hidden until login is confirmed.
const shownOutsideLogin = (page) => page.evaluate(() => [...document.body.children]
    .filter((el) => el.id !== 'login-overlay' && getComputedStyle(el).visibility !== 'hidden').map((el) => el.tagName + '#' + el.id));

test.describe('staff pages, signed out', () => {
    test.use({ user: null });
    for (const p of ['cashier.html', 'kitchen.html', 'shop.html', 'admin.html']) {
        test(`${p} shows the login form`, async ({ page, errors }) => {
            await page.goto(p);
            await expect(page.locator('#login-email')).toBeVisible();
            await expect(page.locator('#login-btn')).toBeVisible();
            expect(await shownOutsideLogin(page)).toEqual([]);
            expect(errors).toEqual([]);
        });
    }
});

test.describe('while the saved sign-in is being restored', () => {
    // A real browser takes a moment to restore the session; nothing should flash meanwhile.
    for (const [who, user] of [['signed in', STAFF], ['signed out', null]]) {
        test.describe(who, () => {
            test.use({ user });
            test(`cashier shows neither the login form nor the page until it knows (${who})`, async ({ page, errors }) => {
                await page.addInitScript(() => { window.__FAKE_AUTH_DELAY = 1500; });
                await page.goto('cashier.html');
                await expect(page.locator('#login-overlay')).toBeAttached();
                await expect(page.locator('#login-overlay')).toBeHidden();
                expect(await shownOutsideLogin(page)).toEqual([]);
                if (user) await expect(page.getByText('Smoke Latte').first()).toBeVisible();
                else await expect(page.locator('#login-email')).toBeVisible();
                expect(errors).toEqual([]);
            });
        });
    }
});

test.describe('staff pages, signed in', () => {
    test('cashier (cashier.html) shows the menu', async ({ page, errors }) => {
        await page.goto('cashier.html');
        await expect(loginOverlay(page)).toBeHidden();
        await expect(page.getByText('Smoke Latte').first()).toBeVisible();
        await expect(page.getByText('Smoke Tea').first()).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('kitchen shows the pending ticket', async ({ page, errors }) => {
        await page.goto('kitchen.html');
        await expect(loginOverlay(page)).toBeHidden();
        await expect(page.getByText('Smoke Latte').first()).toBeVisible();
        expect(await shownOutsideLogin(page)).not.toEqual([]);
        expect(errors).toEqual([]);
    });

    test('shop shows shop items on the sell tab', async ({ page, errors }) => {
        await page.goto('shop.html');
        await expect(loginOverlay(page)).toBeHidden();
        await page.locator('#tabs button[data-v="sell"]').click();
        await expect(page.locator('#v-sell').getByText('Smoke Dunk').first()).toBeVisible();
        expect(errors).toEqual([]);
    });

    test.describe('admin as owner', () => {
        test.use({ user: OWNER });
        test('admin.html loads', async ({ page, errors }) => {
            await page.goto('admin.html');
            await expect(loginOverlay(page)).toBeHidden();
            await expect(page.locator('body')).toContainText('Smoke Latte');
            expect(errors).toEqual([]);
        });
    });

    test.describe('admin CSV export (SEC-11)', () => {
        test.use({ user: OWNER });
        test('text that a spreadsheet would run as a formula is neutralised; numbers stay numbers', async ({ page, errors }) => {
            await page.goto('admin.html');
            await expect(loginOverlay(page)).toBeHidden();
            const cells = await page.evaluate(() => [
                '=HYPERLINK("http://x","click")', '+1+1', '-2+3', '@SUM(A1)', '\tx', 'Somchai', '-', -5000, '-5000', '12.5', 0, null,
            ].map(window.csvCell));
            expect(cells).toEqual([
                '"\'=HYPERLINK(""http://x"",""click"")"', '"\'+1+1"', '"\'-2+3"', '"\'@SUM(A1)"', '"\'\tx"', '"Somchai"', '"-"', '"-5000"', '"-5000"', '"12.5"', '"0"', '""',
            ]);
            expect(errors).toEqual([]);
        });
    });

    test.describe('admin as the second owner', () => {
        test.use({ user: ADMIN2 });
        test('admin.html loads; owner checks match any listed email, ignoring case', async ({ page, errors }) => {
            await page.goto('admin.html');
            await expect(loginOverlay(page)).toBeHidden();
            await expect(page.locator('body')).toContainText('Smoke Latte');
            expect(await page.evaluate(() => [
                'olan.phetmany@gmail.com', 'BRANDON+augx@massconfusion.com', 'staff@example.com', 'brandon@massconfusion.com', '', null,
            ].map(window.isOwnerEmail))).toEqual([true, true, false, false, false, false]);
            expect(errors).toEqual([]);
        });
    });

    test.describe('admin on a phone', () => {
        test.use({ user: OWNER, viewport: { width: 390, height: 844 } });
        test('home buttons split the menu icon from the label', async ({ page, errors }) => {
            await page.goto('admin.html');
            const delivery = page.locator('#m-home button', { hasText: 'Delivery Partners' });
            await expect(delivery.locator('span')).toHaveText('🛵');
            await expect(page.locator('#m-home button', { hasText: 'Printer' }).locator('span')).toHaveText('🖨️');
            expect(errors).toEqual([]);
        });
    });

    test.describe('admin as non-owner', () => {
        test.use({ user: STAFF });
        test('admin.html refuses staff accounts', async ({ page, errors }) => {
            await page.goto('admin.html');
            await expect(page.locator('#login-msg')).toContainText('ไม่มีสิทธิ์');
            await expect(page.locator('#login-logout')).toBeVisible();
            expect(await shownOutsideLogin(page)).toEqual([]);
            expect(errors).toEqual([]);
        });
    });
});

test.describe('customer ordering (order.html)', () => {
    test.use({ user: null });

    test('the site root opens the customer storefront and keeps ?shop and #t=', async ({ page, errors }) => {
        await page.goto('index.html?shop#t=abc');
        await expect(page).toHaveURL(/\/order\.html\?shop#t=abc$/);
        await page.goto('./');
        await expect(page).toHaveURL(/\/order\.html$/);
        await expect(page.getByText('Smoke Latte').first()).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('shows the menu', async ({ page, errors }) => {
        await page.goto('order.html');
        await expect(page.getByText('Smoke Latte').first()).toBeVisible();
        await expect(page.getByText('Smoke Tea').first()).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('is installable as its own app and offers the install bar', async ({ page, errors }) => {
        await page.goto('order.html');
        await expect(page.getByText('Smoke Latte').first()).toBeVisible();
        const res = await page.request.get('order.webmanifest');
        const m = await res.json();
        expect(m.start_url).toBe('./order.html');
        expect(m.scope).toBe('./order');
        expect(m.display).toBe('standalone');
        for (const icon of m.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);
        // iPhone/iPad (the WebKit project) shows the bar straight away with Add to Home Screen steps;
        // other browsers wait for the install prompt event
        const ios = await page.evaluate(() => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
        if (ios) {
            await expect(page.locator('#appbar')).toBeVisible();
            await page.locator('#appbar-go').click();
            await expect(page.locator('#appbar-ios')).toBeVisible();
        } else {
            await expect(page.locator('#appbar')).toBeHidden();
        }
        await page.evaluate(() => {
            const e = new Event('beforeinstallprompt');
            e.prompt = () => {};
            e.userChoice = Promise.resolve({ outcome: 'dismissed' });
            window.dispatchEvent(e);
        });
        await expect(page.locator('#appbar')).toBeVisible();
        await page.locator('#appbar-no').click();
        await expect(page.locator('#appbar')).toBeHidden();
        // the fixture clears localStorage on every load, so check the saved flag instead of reloading
        expect(await page.evaluate(() => localStorage.getItem('augx-appbar-off'))).toBe('1');
        expect(errors).toEqual([]);
    });

    test.describe('when online ordering is disabled', () => {
        const db = seedData();
        db.settings.online.enabled = false;
        test.use({ db });
        test('shows the closed message instead of the menu', async ({ page, errors }) => {
            await page.goto('order.html');
            await expect(page.locator('#loading')).toBeHidden();
            await expect(page.getByText('Smoke Latte')).toHaveCount(0);
            expect(errors).toEqual([]);
        });
    });
});

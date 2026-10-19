// Smoke tests: every page loads against a fake Firebase without JavaScript
// errors and shows the seeded data. Catches broken uploads, missing files and
// script-order problems before customers or staff do.
import { test, expect, OWNER, STAFF, seedData } from './fixtures.js';

const loginOverlay = (page) => page.locator('#login-overlay');

test.describe('staff pages, signed out', () => {
    test.use({ user: null });
    for (const p of ['cashier.html', 'kitchen.html', 'shop.html', 'admin.html']) {
        test(`${p} shows the login form`, async ({ page, errors }) => {
            await page.goto(p);
            await expect(page.locator('#login-email')).toBeVisible();
            await expect(page.locator('#login-btn')).toBeVisible();
            expect(errors).toEqual([]);
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

    test.describe('admin as non-owner', () => {
        test.use({ user: STAFF });
        test('admin.html refuses staff accounts', async ({ page, errors }) => {
            await page.goto('admin.html');
            await expect(page.locator('#login-msg')).toContainText('ไม่มีสิทธิ์');
            await expect(page.locator('#login-logout')).toBeVisible();
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
        await expect(page.locator('#appbar')).toBeHidden();
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

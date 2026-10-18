// Shared Playwright setup: serves the fake Firebase in place of gstatic, blocks
// every other external request, seeds data, and collects page errors.
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FAKE_FIREBASE = readFileSync(path.join(import.meta.dirname, 'fake-firebase.js'), 'utf8');
export const OWNER = { uid: 'owner-uid', email: 'olan.phetmany@gmail.com' }; // shared.js APP_CONFIG.OWNER_EMAIL
export const STAFF = { uid: 'staff-uid', email: 'staff@example.com' };

// Seed data with timestamps relative to "now" so time-windowed queries see it.
export function seedData(now = Date.now()) {
    const day = (ts) => new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Vientiane' });
    return {
        categories: {
            c1: { name: 'Smoke Coffee' },
            c2: { name: 'Smoke Shoes', shop: true, shoe: true },
        },
        modifiers: {
            m1: { name: 'Sweetness', options: [{ name: 'Normal', price: 0 }, { name: 'Less', price: 0 }] },
        },
        menu_items: {
            latte: { name: 'Smoke Latte', category: 'Smoke Coffee', priceOptions: 'HOT|30000,ICED|35000', modifierIds: 'm1' },
            tea: { name: 'Smoke Tea', category: 'Smoke Coffee', priceOptions: '20000' },
            dunk: { name: 'Smoke Dunk', category: 'Smoke Shoes', priceOptions: '42|3500', currency: 'THB', stockOn: true, stock: { 42: 2 } },
        },
        tables: { t1: { name: 'A1' } },
        customers: { cu1: { name: 'Smoke Customer', phone: '02012345678' } },
        delivery_partners: { p1: { name: 'SmokeRide', commission: 20 } },
        inventory: { cups: 200 },
        settings: {
            currency: { enabled: true, rate: 650, rateAt: now },
            online: { enabled: true, beta: false, waNumber: '8562000000000', payWindowMin: 10 },
            features: { tables: true },
        },
        orders: {
            o1: {
                orderNo: 7, status: 'open', paid: false, source: 'store', orderType: 'dine-in', table: 'A1', customer: 'โต๊ะ A1',
                items: [{ lid: 'l1', itemId: 'latte', name: 'Smoke Latte', variant: 'HOT', price: 30000, quantity: 2, modifiers: [], cup: true, round: 1 }],
                subtotal: 60000, discount: 0, total: 60000, rounds: 1, cups: 2,
                dayKey: day(now), openedAt: now - 600000, timestamp: now - 600000, tickets: { k1: true },
            },
            o2: {
                orderNo: 6, status: 'paid', paid: true, paymentMethod: 'cash', source: 'store', customer: 'ทั่วไป',
                items: [{ lid: 'l2', itemId: 'tea', name: 'Smoke Tea', variant: '', price: 20000, quantity: 1, modifiers: [], cup: true, round: 1 }],
                subtotal: 20000, discount: 0, total: 20000, cashReceived: 20000, change: 0, cups: 1,
                dayKey: day(now), openedAt: now - 3600000, timestamp: now - 3000000, paidAt: now - 3000000,
            },
        },
        tickets: {
            k1: {
                billId: 'o1', orderNo: 7, kind: 'new', round: 1, name: 'โต๊ะ A1', source: 'store', orderType: 'dine-in', status: 'pending',
                items: [{ name: 'Smoke Latte', variant: 'HOT', modifiers: [], note: '', quantity: 2 }],
                timestamp: now - 600000, dayKey: day(now),
            },
        },
        counters: { orders: { [day(now)]: 7 } },
    };
}

export const test = base.extend({
    db: [seedData(), { option: true }],
    user: [STAFF, { option: true }],
    errors: async ({ page, db, user }, use) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
        page.on('console', (m) => {
            // Blocked fonts/CDNs and the known-missing images/bg.jpg show up as resource errors; ignore those.
            if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push(`console: ${m.text()}`);
        });
        page.on('dialog', (d) => { errors.push(`unexpected dialog: ${d.message()}`); d.dismiss(); });

        await page.addInitScript(({ db, user }) => {
            window.__FAKE_DB = db;
            window.__FAKE_USER = user;
            try { localStorage.clear(); } catch { /* ignore */ }
        }, { db, user });
        await page.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (url.hostname === '127.0.0.1') return route.continue();
            if (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) {
                const body = url.pathname.endsWith('firebase-app.js') ? FAKE_FIREBASE : '/* stubbed by fake-firebase.js */';
                return route.fulfill({ contentType: 'text/javascript', body });
            }
            return route.abort();
        });
        await use(errors);
    },
});

export { expect };

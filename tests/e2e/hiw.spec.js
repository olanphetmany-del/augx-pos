// รับหิ้ว (pre-order from Korea): customer storefront hiw.html + owner back office hiw-admin.html.
// Full loop against the fake Firebase: customer orders with a slip → owner confirms the slip →
// marks an item out of stock → customer picks a refund → owner sees it in the refund list.
import { test, expect, OWNER, STAFF } from './fixtures.js';

const fakeDb = (page, path) => page.evaluate((p) => window.__fakeDb.get(p), path);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function hiwData(now = Date.now()) {
    const iso = (t) => new Date(t).toISOString().slice(0, 10);
    return {
        hiw: {
            pub: {
                settings: { shop: 'Smoke Hiw', tag: 'tag', wa: '02055550000', bank: 'BCEL One', accNo: '0302 1000', accName: 'SMOKE', round: { name: 'R1', close: iso(now + 5 * 864e5), fly: iso(now + 9 * 864e5) } },
                products: {
                    p1: { name: 'Smoke Toner', cat: 'skin', sell: 471000, best: 1 },
                    p2: { name: 'Smoke Mask', cat: 'mask', sell: 189000 },
                    p3: { name: 'Hidden Thing', cat: 'other', sell: 1000, hidden: true },
                },
            },
            priv: { settings: { rate: 15.9, buffer: 3, fee: 15, step: 1000 }, pmeta: { p1: { store: 'Olive Young', won: 25000 }, p2: { store: 'Daiso', won: 10000 } } },
        },
    };
}

test.describe('hiw.html (customer)', () => {
    test.use({ db: hiwData(), user: null });

    test('order with a slip lands in hiw/orders and the customer can track it', async ({ page, errors }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('hiw.html');
        await expect(page.getByText('Smoke Toner').first()).toBeVisible();
        await expect(page.getByText('Hidden Thing')).toHaveCount(0);
        // add 2 toners + 1 mask, then remove the mask from the cart sheet
        await page.locator('.add').first().click();
        await page.locator('[data-a=cp][data-id=p1]').first().click();
        await page.locator('[data-a=cp][data-id=p2]').first().click();
        await page.click('[data-a=cart]');
        await page.click('.sheet [data-a=crm][data-id=p2]');
        await expect(page.locator('.sheet .tot')).toContainText('942,000');
        await page.click('[data-a=checkout]');
        await expect(page.locator('[data-a=deliv]')).toHaveCount(0); // no pick-up/delivery choice
        await page.fill('#f_n', 'Bibi');
        await page.fill('#f_p', '020 5738 8383');
        await page.click('[data-a=place]'); // no slip yet → refused
        expect(await fakeDb(page, 'hiw/orders')).toBeNull();
        await page.setInputFiles('input[data-f=slip]', { name: 'slip.png', mimeType: 'image/png', buffer: PNG });
        await expect(page.locator('.sheet .up img')).toBeVisible();
        await page.click('[data-a=place]');
        await expect(page.getByText('#1001')).toBeVisible();

        const orders = await fakeDb(page, 'hiw/orders');
        const o = Object.values(orders)[0];
        expect(o).toMatchObject({ no: 1001, name: 'Bibi', total: 942000, pay: 'pend', deliv: 'pick', addr: '' });
        expect(o.items).toEqual([{ pid: 'p1', n: 'Smoke Toner', q: 2, s: 471000, st: 'wait' }]);
        expect(o.slip).toMatch(/^data:image\//);
        const track = await fakeDb(page, 'hiw/track/' + o.tok);
        expect(track).toMatchObject({ no: 1001, pay: 'pend', total: 942000 });
        expect(JSON.stringify(track)).not.toContain('Bibi'); // no name/phone on the public tracking record
        expect(await fakeDb(page, 'hiw/throttle/02057388383')).toBeGreaterThan(0);

        await page.click('[data-a=gotrack]');
        await expect(page.locator('main')).toContainText('ຮ້ານກຳລັງກວດສະລິບ');
        expect(errors).toEqual([]);
    });

    test('brand chips filter the shop (brand guessed from the name)', async ({ page, errors }) => {
        await page.goto('hiw.html');
        await expect(page.locator('.chips.brands')).toContainText('Smoke');
        await page.click('[data-a=brand][data-v=smoke]');
        await expect(page.locator('.p .nm', { hasText: 'Smoke Toner' }).first()).toBeVisible();
        await page.click('[data-a=brand][data-v=all]');
        expect(errors).toEqual([]);
    });

    test('installable: manifest and icons load', async ({ page, errors }) => {
        await page.goto('hiw.html');
        const href = await page.getAttribute('link[rel=manifest]', 'href');
        const m = await page.evaluate(async (h) => (await fetch(h)).json(), href);
        expect(m).toMatchObject({ start_url: './hiw.html', display: 'standalone' });
        for (const i of m.icons) expect((await page.request.get(i.src)).ok()).toBe(true);
        expect(errors).toEqual([]);
    });

    test('ask-for-an-item request is saved', async ({ page, errors }) => {
        await page.goto('hiw.html');
        await page.click('[data-a=ct][data-v=req]');
        await page.fill('#r_w', 'Laneige Lip Mask');
        await page.fill('#r_p', '02099998888');
        await page.click('[data-a=reqsend]');
        await expect.poll(() => fakeDb(page, 'hiw/requests')).not.toBeNull();
        const r = Object.values(await fakeDb(page, 'hiw/requests'))[0];
        expect(r).toMatchObject({ what: 'Laneige Lip Mask', phone: '02099998888', qty: 1 });
        expect(errors).toEqual([]);
    });
});

test.describe('hiw-admin.html (owner)', () => {
    const now = Date.now();
    const data = hiwData(now);
    data.hiw.orders = {
        o1: { no: 1001, tok: 'TOKaaaaaaaaaaaa1', name: 'Bibi', phone: '02057388383', total: 942000, pay: 'pend', slip: 'data:image/png;base64,AAAA', deliv: 'pick', at: now - 6e5, items: [{ pid: 'p1', n: 'Smoke Toner', q: 2, s: 471000, st: 'wait' }] },
        o2: { no: 1002, tok: 'TOKbbbbbbbbbbbb2', name: 'Noy', phone: '02011112222', total: 189000, pay: 'pend', slip: 'data:image/png;base64,AAAA', deliv: 'send', addr: 'VTE', at: now - 3e5, items: [{ pid: 'p2', n: 'Smoke Mask', q: 1, s: 189000, st: 'wait' }] },
    };
    data.hiw.track = {
        TOKaaaaaaaaaaaa1: { no: 1001, pay: 'pend', total: 942000, items: [{ n: 'Smoke Toner', q: 2, s: 471000, st: 'wait' }] },
        TOKbbbbbbbbbbbb2: { no: 1002, pay: 'pend', total: 189000, items: [{ n: 'Smoke Mask', q: 1, s: 189000, st: 'wait' }] },
    };
    test.use({ db: data, user: OWNER });

    test('slip check → buy list by store → out of stock → customer refund', async ({ page, errors }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('hiw-admin.html');
        await expect(page.locator('.todo').first()).toContainText('ตรวจสลิป');
        await page.click('[data-a=go][data-v=orders]');
        await expect(page.locator('.warn').first()).toContainText('#100'); // same slip on both orders
        await page.locator('[data-a=okpay][data-id=o1]').click();
        await expect.poll(() => fakeDb(page, 'hiw/orders/o1/pay')).toBe('ok');
        expect(await fakeDb(page, 'hiw/track/TOKaaaaaaaaaaaa1/pay')).toBe('ok');
        expect(await fakeDb(page, 'hiw/orders/o1/slip')).toBe('data:image/png;base64,AAAA'); // untouched

        await page.click('[data-a=ot][data-v=buy]');
        await expect(page.locator('main')).toContainText('Olive Young');
        await expect(page.locator('main')).toContainText('Bibi ×2');
        await page.click('[data-a=oos][data-id=p1]');
        await expect.poll(() => fakeDb(page, 'hiw/track/TOKaaaaaaaaaaaa1/items/0/st')).toBe('ask');

        // the customer answers on the tracking page; the owner app applies it
        await page.evaluate(() => window.firebase.database().ref('hiw/track/TOKaaaaaaaaaaaa1/req/0').set('refund'));
        await expect.poll(() => fakeDb(page, 'hiw/orders/o1/items/0/st')).toBe('refund');
        expect(await fakeDb(page, 'hiw/track/TOKaaaaaaaaaaaa1/req')).toBeNull();
        await page.click('[data-a=ot][data-v=home]');
        await page.click('[data-a=go][data-v=refund]');
        await expect(page.locator('main')).toContainText('942,000');
        expect(errors).toEqual([]);
    });

});

// ค่าหิ้วเป็นบาทต่อชิ้น: ของปกติ 200 บาท · เมกอัพ/เล็บ 100 บาท · หน้าร้านโชว์ ₩ + ≈ กีบรวมค่าหิ้ว
function feeData() {
    const d = hiwData();
    d.hiw.pub.products = {
        p1: { name: 'Fee Toner', cat: 'skin', sell: 546000, won: 25000, fee: 136000, size: '50ml × 2' },
        p4: { name: 'Fee Tint', cat: 'makeup', sell: 232000, won: 10000, wonFull: 16000, fee: 68000 },
        p5: { name: 'Heavy Toner', cat: 'skin', sell: 1, won: 25000, fee: 0, size: '250ml', heavy: true },
    };
    d.hiw.priv = { settings: { rate: 15.9, buffer: 3, fee: 0, step: 1000, thb: 680, feeThb: 200, feeLite: 100, feeHeavy: 300, heavyMl: 200 }, pmeta: { p1: { store: 'Olive Young', won: 25000 }, p4: { store: 'Olive Young', won: 10000, wonFull: 16000 }, p5: { store: 'Olive Young', won: 25000 } } };
    return d;
}

test.describe('hiw baht service fee (customer)', () => {
    test.use({ db: feeData(), user: null });

    test('card shows won with kip incl. fee; cart splits item price and fee', async ({ page, errors }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('hiw.html');
        await expect(page.locator('.p', { hasText: 'Fee Toner' })).toContainText('₩25,000');
        await expect(page.locator('.p', { hasText: 'Fee Toner' }).locator('.psz')).toContainText('50ml × 2');
        await expect(page.locator('.p', { hasText: 'Fee Toner' }).locator('.prk')).toContainText('546,000');
        await expect(page.locator('.p', { hasText: 'Fee Tint' }).locator('.pfull')).toContainText('₩16,000');
        await expect(page.locator('.p', { hasText: 'Fee Tint' }).locator('.pfull')).toContainText('-38%');
        await expect(page.locator('.p', { hasText: 'Fee Toner' }).locator('.pfull')).toHaveCount(0);
        await expect(page.locator('.p', { hasText: 'Heavy Toner' }).locator('.pheavy')).toBeVisible();
        await expect(page.locator('.p', { hasText: 'Fee Toner' }).locator('.pheavy')).toHaveCount(0);
        await page.locator('[data-a=cp][data-id=p1]').first().click();
        await page.locator('[data-a=cp][data-id=p4]').first().click();
        await page.click('[data-a=cart]');
        const sheet = page.locator('.sheet');
        await expect(sheet.locator('.sub2').nth(0)).toContainText('574,000');
        await expect(sheet.locator('.sub2').nth(1)).toContainText('204,000');
        await expect(sheet.locator('.sub2').nth(1)).toContainText('2');
        await expect(sheet.locator('.tot')).toContainText('778,000');
        expect(errors).toEqual([]);
    });
});

test.describe('hiw baht service fee (owner)', () => {
    const d = feeData();
    d.hiw.pub.products.p1.sell = 1; d.hiw.pub.products.p4.sell = 1;
    test.use({ db: d, user: OWNER });

    test('reprice uses 200 baht per item and 100 baht for makeup', async ({ page, errors }) => {
        await page.goto('hiw-admin.html');
        await page.click('[data-a=ot][data-v=more]');
        await page.click('[data-a=sub][data-v=set]');
        await expect(page.locator('#s_feeThb')).toHaveValue('200');
        await page.click('[data-a=reprice]');
        await expect.poll(() => fakeDb(page, 'hiw/pub/products/p1/sell')).toBe(546000);
        expect(await fakeDb(page, 'hiw/pub/products/p1/fee')).toBe(136000);
        expect(await fakeDb(page, 'hiw/pub/products/p4/sell')).toBe(232000);
        expect(await fakeDb(page, 'hiw/pub/products/p4/fee')).toBe(68000);
        expect(await fakeDb(page, 'hiw/pub/products/p4/won')).toBe(10000);
        expect(await fakeDb(page, 'hiw/pub/products/p4/wonFull')).toBe(16000);
        expect(await fakeDb(page, 'hiw/pub/products/p5/sell')).toBe(614000); // 250ml ≥ 200ml → heavy 300 baht
        expect(await fakeDb(page, 'hiw/pub/products/p5/fee')).toBe(204000);
        expect(await fakeDb(page, 'hiw/pub/products/p5/heavy')).toBe(true);
        expect(await fakeDb(page, 'hiw/pub/products/p1/heavy')).toBe(false);
        // product list explains the price: ₩ → item + fee (baht) = sell
        await page.click('[data-a=sub][data-v=""]');
        await page.click('[data-a=sub][data-v=prod]');
        await expect(page.locator('.card', { hasText: 'Fee Tint' })).toContainText('₩10,000 → ของ 164,000 + หิ้ว 68,000 (100฿) = 232,000');
        await expect(page.locator('.card', { hasText: 'Fee Tint' })).not.toContainText('ยังไม่อัปเดต');
        expect(errors).toEqual([]);
    });
});

test.describe('hiw-admin.html (staff account)', () => {
    test.use({ db: hiwData(), user: STAFF });
    test('non-owner accounts are refused', async ({ page, errors }) => {
        await page.goto('hiw-admin.html');
        await expect(page.locator('#login-msg')).toContainText('ไม่มีสิทธิ์');
        expect(await page.locator('#app').isVisible()).toBe(false);
        expect(errors).toEqual([]);
    });
});

// 🏆 Today's Ranking: ອັນດັບ 1–10 ຈາກ Olive Young · ລູກສອນ ▲▼/NEW · ດາວ/ລີວິວ · ຈຸດເດັ່ນ · ຄົນລາວສັ່ງແລ້ວ (≥ 5 ຄົນ)
function rankData() {
    const d = hiwData();
    const P = {};
    for (let i = 1; i <= 7; i++) P['r' + i] = { name: 'Rank Item ' + i, brand: 'Brand' + i, cat: i === 7 ? 'sun' : 'skin', sell: 400000 + i * 1000, won: 20000, wonFull: 30000, rank: i, size: '50ml' };
    Object.assign(P.r1, { rankPrev: 3, rating: 4.8, reviews: 22880, hook: 'ຮູຂຸມຂົນ' });
    Object.assign(P.r2, { rankPrev: 0 });
    P.u1 = { name: 'Unranked Cream', cat: 'skin', sell: 300000 };
    d.hiw.pub.products = P;
    Object.assign(d.hiw.pub.settings, { rankAt: '8/11', ordered: { r1: 6, r2: 2 } });
    return d;
}

test.describe('hiw ranking (customer)', () => {
    test.use({ db: rankData(), user: null });

    test('ranking shows top 5 in order with movement, rating, hook and Lao order count', async ({ page, errors }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('hiw.html');
        const rank = page.locator('section.rank');
        await expect(rank).toContainText("Today's Ranking");
        await expect(rank).toContainText('ອັບເດດ 8/11');
        await expect(rank).toContainText('ສະກິນແຄທີ່ ພ.ສ ເກົາຫຼີກຳລັງນິຍົມ');
        const rows = rank.locator('.rrow');
        await expect(rows).toHaveCount(5);
        await expect(rows.nth(0)).toContainText('Rank Item 1');
        await expect(rows.nth(0).locator('.mv')).toHaveText('▲2');
        await expect(rows.nth(1).locator('.mv')).toHaveText('NEW');
        await expect(rows.nth(2).locator('.mv')).toHaveCount(0);
        await expect(rows.nth(0)).toContainText('★ 4.8 · 22,880');
        await expect(rows.nth(0)).toContainText('ຮູຂຸມຂົນ');
        await expect(rows.nth(0).locator('.bought')).toContainText('6');
        await expect(rows.nth(1).locator('.bought')).toHaveCount(0); // only 2 → hidden
        await expect(rank).not.toContainText('Unranked Cream');
        await rank.locator('[data-a=rkmore]').click();
        await expect(rows).toHaveCount(7);
        await rank.locator('[data-a=rk][data-v=sun]').click();
        await expect(rows).toHaveCount(1);
        await expect(rows.nth(0)).toContainText('Rank Item 7');
        await expect(rows.nth(0).locator('.rn')).toHaveText('1');
        await rows.nth(0).locator('[data-a=cp]').click();
        await expect(page.locator('.cbar')).toContainText('1');
        expect(errors).toEqual([]);
    });
});

test.describe('hiw ranking (owner)', () => {
    const d = rankData();
    d.hiw.orders = {
        o1: { no: 1001, phone: '020 1111 1111', items: [{ pid: 'r3', n: 'Rank Item 3', q: 1, s: 1, st: 'wait' }, { pid: 'r4', n: 'x', q: 1, s: 1, st: 'refund' }] },
        o2: { no: 1002, phone: '02011111111', items: [{ pid: 'r3', n: 'Rank Item 3', q: 2, s: 1, st: 'got' }] },
        o3: { no: 1003, phone: '02022222222', items: [{ pid: 'r3', n: 'Rank Item 3', q: 1, s: 1, st: 'wait' }] },
    };
    test.use({ db: d, user: OWNER });

    test('order counts sync to the storefront; editing the rank keeps the old rank for the arrow', async ({ page, errors }) => {
        await page.goto('hiw-admin.html');
        await expect.poll(() => fakeDb(page, 'hiw/pub/settings/ordered')).toEqual({ r3: 2 });
        await page.click('[data-a=ot][data-v=more]');
        await page.click('[data-a=sub][data-v=prod]');
        await page.locator('.card[data-a=pedit]', { hasText: 'Rank Item 4' }).click();
        await expect(page.locator('#e_rk')).toHaveValue('4');
        await page.fill('#e_rk', '2');
        await page.fill('#e_hk', 'ຜິວໃສ');
        await page.fill('#e_rt', '4.66');
        await page.fill('#e_rv', '1200');
        await page.click('[data-a=psave]');
        await expect.poll(() => fakeDb(page, 'hiw/pub/products/r4/rank')).toBe(2);
        expect(await fakeDb(page, 'hiw/pub/products/r4/rankPrev')).toBe(4);
        expect(await fakeDb(page, 'hiw/pub/products/r4/hook')).toBe('ຜິວໃສ');
        expect(await fakeDb(page, 'hiw/pub/products/r4/rating')).toBe(4.7);
        expect(await fakeDb(page, 'hiw/pub/products/r4/reviews')).toBe(1200);
        expect(await fakeDb(page, 'hiw/pub/settings/rankAt')).toMatch(/^\d{1,2}\/\d{1,2}$/);
        expect(errors).toEqual([]);
    });
});

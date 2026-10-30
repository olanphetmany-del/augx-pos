// Customer receipts (shared.js): Lao labels (PR #9) and sending to RawBT on
// Android instead of the print dialog.
import { describe, test, expect, vi } from 'vitest';
import { loadScripts } from './helpers/load-script.js';

// A canvas stand-in: every pixel white, so the raster bits are all zero.
const fakeCanvas = () => ({
    width: 0, height: 0,
    getContext: () => ({
        fillStyle: '', fillRect() {}, drawImage() {},
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
    }),
});

function load() {
    const env = loadScripts(['shared.js'], {
        globals: {
            btoa: globalThis.btoa,
            location: { href: 'https://augustxshop.com/cashier.html' },
            document: { createElement: () => fakeCanvas() },
        },
    });
    const { RCPT } = env.get(['RCPT']);
    // The receipt image itself is drawn by receiptCanvas(); stand in a 600×300 one.
    env.ctx.receiptCanvas = async () => ({ width: 600, height: 300 });
    env.ctx.printReceiptDialog = vi.fn();
    return { ...env, RCPT };
}

const bill = {
    orderNo: 12, status: 'paid', paymentMethod: 'cash', timestamp: Date.UTC(2026, 9, 19, 3, 0), paidAt: Date.UTC(2026, 9, 19, 3, 0),
    items: [{ name: 'Latte', price: 30000, quantity: 2 }], subtotal: 60000, discount: 0, total: 60000, cashReceived: 100000, change: 40000,
};

describe('receiptModel (customer receipt, Lao)', () => {
    const { get } = load();
    const { receiptModel, receiptText } = get(['receiptModel', 'receiptText']);
    const labels = (m) => m.filter((r) => r.t === 'r').map((r) => r.l);

    test('labels are Lao, with the Lao default footer', () => {
        const m = receiptModel(bill);
        expect(labels(m)).toEqual(expect.arrayContaining(['ບິນ #12', 'ລວມ', 'ຍອດສຸດທິ', 'ເງິນສົດ', 'ເງິນທອນ']));
        expect(m[m.length - 1]).toEqual({ t: 'c', x: 'ຂອບໃຈທີ່ໃຊ້ບໍລິການ' });
        expect(m.find((r) => r.l === 'ຍອດສຸດທິ').r).toBe('60,000 ₭');
    });

    test('copies and voids are marked in Lao', () => {
        const xs = (m) => m.filter((r) => r.t === 'c').map((r) => r.x);
        expect(xs(receiptModel(bill, true))).toContain('*** ສຳເນົາ (COPY) ***');
        expect(xs(receiptModel({ ...bill, status: 'void' }))).toContain('*** ຍົກເລີກ (VOID) ***');
    });

    test('shared receipt text is Lao', () => {
        const t = receiptText(bill);
        expect(t).toContain('ບິນ #12');
        expect(t).toContain('ຍອດສຸດທິ 60,000 ₭');
    });
});

describe('printReceipt → RawBT', () => {
    const ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
    const IPAD = 'Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 Version/12.1.2 Mobile/15E148 Safari/604.1';
    // BUG-28: each device answers once whether RawBT is installed (localStorage 'augx-rawbt').
    const deviceSaid = (ctx, answer) => { ctx.localStorage = { getItem: (k) => (k === 'augx-rawbt' ? answer : null), setItem() {} }; };

    test.each([
        ['dialog', 'Android', ANDROID, 'on', false],
        ['rawbt', 'Android', ANDROID, 'on', true],
        ['rawbt', 'Android', ANDROID, 'off', false], // BUG-28: this device has no RawBT
        ['rawbt', 'Android', ANDROID, null, false], // BUG-28: not asked yet (printReceipt asks first)
        ['rawbt', 'iPad (iOS 12)', IPAD, 'on', false],
        [undefined, 'Android', ANDROID, 'on', false],
    ])('printMethod %s on %s, device said %s → RawBT: %s', (method, _device, ua, answer, rawbt) => {
        const { get, ctx, RCPT } = load();
        RCPT.s.printMethod = method;
        ctx.navigator.userAgent = ua;
        deviceSaid(ctx, answer);
        expect(get(['rcptRawbtOk']).rcptRawbtOk()).toBe(rawbt);
    });

    test('on a computer, uses the print dialog and still counts the print', () => {
        const { get, ctx, RCPT, log } = load();
        RCPT.s.printMethod = 'rawbt';
        get(['printReceipt']).printReceipt(bill, false, 'b1');
        expect(ctx.printReceiptDialog).toHaveBeenCalledWith(bill, false);
        expect(log).toContainEqual(['transaction', 'orders/b1/printCount']);
        expect(ctx.location.href).toBe('https://augustxshop.com/cashier.html');
    });

    test('on Android with RawBT on, sends ESC/POS straight to RawBT', async () => {
        const { get, ctx, RCPT } = load();
        RCPT.s.printMethod = 'rawbt';
        ctx.navigator.userAgent = ANDROID;
        deviceSaid(ctx, 'on');
        get(['printReceipt']).printReceipt(bill, false, 'b1');
        await vi.waitFor(() => expect(ctx.location.href).toMatch(/^rawbt:base64,/));
        expect(ctx.printReceiptDialog).not.toHaveBeenCalled();

        const bytes = Buffer.from(ctx.location.href.slice('rawbt:base64,'.length), 'base64');
        // 58mm paper → 384 dots wide (48 bytes/row); the 600×300 image scales to 384×192.
        expect([...bytes.subarray(0, 2)]).toEqual([0x1b, 0x40]); // ESC @ (reset)
        expect([...bytes.subarray(2, 10)]).toEqual([0x1d, 0x76, 0x30, 0, 48, 0, 40, 0]); // GS v 0, first 40-row band
        expect(bytes.length).toBe(2 + 5 * 8 + 48 * 192 + 7); // 5 bands of ≤40 rows
        expect([...bytes.subarray(-7)]).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 0x42, 0]); // feed 4 lines, cut
    });

    test('80mm paper → 576 dots wide', async () => {
        const { get, RCPT } = load();
        RCPT.s.paperSize = '80mm';
        const bytes = await get(['rcptEscBytes']).rcptEscBytes(bill, false);
        expect([...bytes.subarray(2, 10)]).toEqual([0x1d, 0x76, 0x30, 0, 72, 0, 40, 0]);
    });

    test('if the receipt image cannot be drawn, falls back to the print dialog', async () => {
        const { get, ctx, RCPT } = load();
        RCPT.s.printMethod = 'rawbt';
        ctx.navigator.userAgent = ANDROID;
        deviceSaid(ctx, 'on');
        ctx.receiptCanvas = async () => { throw new Error('canvas tainted'); };
        get(['printReceipt']).printReceipt(bill, true);
        await vi.waitFor(() => expect(ctx.printReceiptDialog).toHaveBeenCalledWith(bill, true));
        expect(ctx.location.href).toBe('https://augustxshop.com/cashier.html');
    });
});

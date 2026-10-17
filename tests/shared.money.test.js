// Characterization tests for money / FX / payment math in shared.js.
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadScripts } from './helpers/load-script.js';

const NOW = new Date('2026-10-17T14:30:00+07:00').getTime();

function load(data) {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    return loadScripts(['shared.js'], { data });
}
afterEach(() => vi.useRealTimers());

describe('formatting', () => {
    const { get } = loadScripts(['shared.js']);
    const { money, baht, moneyC } = get(['money', 'baht', 'moneyC']);
    test('money/baht/moneyC', () => {
        expect(money(35000)).toBe('35,000 ₭');
        expect(money()).toBe('0 ₭');
        expect(baht(1250.5)).toBe('฿1,250.5');
        expect(moneyC(100, 'THB')).toBe('฿100');
        expect(moneyC(100, 'LAK')).toBe('100 ₭');
    });
});

describe('toLak / approxLak', () => {
    const { get, ctx } = loadScripts(['shared.js']);
    const { toLak, approxLak, FX } = get(['toLak', 'approxLak', 'FX']);
    test('rounds to nearest 500 by default', () => {
        expect(toLak(100, 652)).toBe(65000);
        expect(toLak(100, 652.6)).toBe(65500);
        expect(toLak(1, 749)).toBe(500);
        expect(toLak(1, 750)).toBe(1000);
    });
    test('custom step', () => {
        expect(toLak(100, 652.6, 1000)).toBe(65000);
        expect(toLak(3, 333.3, 1)).toBe(1000);
    });
    test('missing rate yields 0 (root of BUG-1)', () => {
        expect(toLak(100, 0)).toBe(0);
        expect(toLak(100)).toBe(0);
    });
    test('approxLak uses FX.rate fallback and 1,000 step', () => {
        expect(approxLak(100, 652.6)).toBe('≈ 65,000 ₭');
        expect(approxLak(100)).toBe('');
        FX.rate = 700;
        expect(approxLak(100)).toBe('≈ 70,000 ₭');
        FX.rate = 0;
        void ctx;
    });
});

describe('itemsSubtotal / recalcBill / lineLak', () => {
    const { get } = loadScripts(['shared.js']);
    const { itemsSubtotal, recalcBill, lineLak } = get(['itemsSubtotal', 'recalcBill', 'lineLak']);
    const items = [{ price: 30000, quantity: 2 }, { price: 15000, quantity: 1 }, null];

    test('subtotal sums price × qty and tolerates objects/holes', () => {
        expect(itemsSubtotal(items)).toBe(75000);
        expect(itemsSubtotal({ a: { price: 1, quantity: 3 } })).toBe(3);
        expect(itemsSubtotal(undefined)).toBe(0);
    });
    test('LAK bill: total = subtotal − discount, floored at 0', () => {
        expect(recalcBill({ items, discount: 5000 })).toMatchObject({ subtotal: 75000, total: 70000 });
        expect(recalcBill({ items, discount: 999999 }).total).toBe(0);
    });
    test('THB bill: keeps baht totals and converts at the bill rate', () => {
        const o = recalcBill({ currency: 'THB', rate: 650, items: [{ price: 100, quantity: 3 }], discountThb: 20 });
        expect(o).toMatchObject({ subtotalThb: 300, totalThb: 280, subtotal: 195000, total: 182000, discount: 13000 });
    });
    test('lineLak on LAK bill is gross price × qty', () => {
        expect(lineLak({ total: 1 }, { price: 30000, quantity: 2 })).toBe(60000);
    });
    // BUG-3: discounts are not apportioned to lines.
    test('BUG-3: lineLak ignores bill discount', () => {
        const bill = { items: [{ price: 30000, quantity: 2 }], discount: 30000, total: 30000 };
        expect(lineLak(bill, bill.items[0])).toBe(60000);
    });
    test('lineLak on THB bill scales by total/totalThb', () => {
        expect(lineLak({ currency: 'THB', total: 65000, totalThb: 100 }, { price: 50, quantity: 1 })).toBe(32500);
    });
});

describe('payBill (LAK)', () => {
    const open = { status: 'open', items: [{ price: 30000, quantity: 2 }], timestamp: NOW - 3600000 };

    test('cash with change, amount discount', async () => {
        const { get, data } = load({ 'orders/b1': open });
        const bill = await get(['payBill']).payBill('b1', { method: 'cash', discountType: 'amount', discountValue: 5000, cashReceived: 100000 });
        expect(bill).toMatchObject({ status: 'paid', subtotal: 60000, discount: 5000, total: 55000, change: 45000, paymentMethod: 'cash' });
        expect(data['orders/b1'].status).toBe('paid');
    });
    test('percent discount is clamped to 100% and rounded', async () => {
        const { get } = load({ 'orders/b1': open });
        const bill = await get(['payBill']).payBill('b1', { method: 'transfer', discountType: 'percent', discountValue: 150 });
        expect(bill.total).toBe(0);
        expect(bill.cashReceived).toBe(0);
    });
    test('insufficient cash aborts', async () => {
        const { get } = load({ 'orders/b1': open });
        await expect(get(['payBill']).payBill('b1', { method: 'cash', cashReceived: 1000 })).rejects.toThrow();
    });
    test('already paid / void bills are not paid again', async () => {
        const { get } = load({ 'orders/b1': { ...open, status: 'paid' } });
        await expect(get(['payBill']).payBill('b1', { method: 'transfer' })).rejects.toThrow();
    });
    // BUG-13: paying moves the bill to the payment time/day.
    test('BUG-13: payment rewrites timestamp/dayKey to now, keeps openedAt', async () => {
        const opened = new Date('2026-10-16T22:00:00+07:00').getTime();
        const { get } = load({ 'orders/b1': { ...open, timestamp: opened, dayKey: '2026-10-16' } });
        const bill = await get(['payBill']).payBill('b1', { method: 'transfer' });
        expect(bill).toMatchObject({ openedAt: opened, timestamp: NOW, dayKey: '2026-10-17' });
    });
});

describe('payBill (THB bill)', () => {
    const thb = { status: 'open', currency: 'THB', items: [{ price: 100, quantity: 3 }], timestamp: NOW };

    test('paid in LAK at the given rate, rounded to 500', async () => {
        const { get } = load({ 'orders/b1': thb });
        const bill = await get(['payBill']).payBill('b1', { method: 'cash', payCurrency: 'LAK', rate: 651, cashReceived: 200000 });
        expect(bill).toMatchObject({ payCurrency: 'LAK', totalThb: 300, payAmount: 195500, total: 195500, change: 4500, rate: 651 });
    });
    test('paid in THB records LAK total at the rate', async () => {
        const { get } = load({ 'orders/b1': thb });
        const bill = await get(['payBill']).payBill('b1', { method: 'transfer', payCurrency: 'THB', rate: 650 });
        expect(bill).toMatchObject({ payCurrency: 'THB', payAmount: 300, total: 195000 });
    });
    test('paying in LAK without any rate aborts', async () => {
        const { get } = load({ 'orders/b1': thb });
        await expect(get(['payBill']).payBill('b1', { method: 'transfer', payCurrency: 'LAK' })).rejects.toThrow();
    });
    // BUG-1: with no rate anywhere, a THB-paid bill records 0 ₭ revenue.
    test.fails('BUG-1: paying in THB with no rate should not record 0 ₭ revenue', async () => {
        const { get } = load({ 'orders/b1': thb });
        const bill = await get(['payBill']).payBill('b1', { method: 'transfer', payCurrency: 'THB' });
        expect(bill.total).toBeGreaterThan(0);
    });
});

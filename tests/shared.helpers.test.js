// Characterization tests for date, parsing, bill and stock helpers in shared.js.
// Timezone is pinned to Asia/Vientiane (UTC+7) in vitest.config.js.
import { describe, test, expect, afterEach, vi } from 'vitest';
import { loadScripts } from './helpers/load-script.js';

const { get } = loadScripts(['shared.js']);
const H = get([
    'esc', 'dayKey', 'timeHHMM', 'dayRange', 'fmtDate', 'parsePrices', 'parseOptions', 'normalizeModifier',
    'stockKey', 'arr', 'lineDetails', 'isOpenBill', 'billCups', 'billName', 'billCur', 'laoReason',
]);

describe('esc', () => {
    test('escapes the five HTML-significant characters', () => {
        expect(H.esc(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    });
    test('null/undefined → empty, numbers stringified', () => {
        expect(H.esc(null)).toBe('');
        expect(H.esc(undefined)).toBe('');
        expect(H.esc(0)).toBe('0');
    });
});

describe('dates (local = Asia/Vientiane)', () => {
    // 2026-10-17 23:30 in Vientiane is 16:30 UTC.
    const lateNight = Date.UTC(2026, 9, 17, 16, 30);
    const justAfterMidnight = Date.UTC(2026, 9, 17, 17, 5);

    test('dayKey / timeHHMM / fmtDate use local time', () => {
        expect(H.dayKey(lateNight)).toBe('2026-10-17');
        expect(H.dayKey(justAfterMidnight)).toBe('2026-10-18');
        expect(H.timeHHMM(justAfterMidnight)).toBe('00:05');
        expect(H.fmtDate(lateNight)).toBe('17/10/2026');
    });
    test('dayRange spans the local day inclusively', () => {
        const r = H.dayRange('2026-10-17');
        expect(r.start).toBe(Date.UTC(2026, 9, 16, 17, 0));
        expect(r.end - r.start).toBe(86400000 - 1);
        expect(H.dayKey(r.start)).toBe('2026-10-17');
        expect(H.dayKey(r.end)).toBe('2026-10-17');
    });
    test('falsy timestamp means "now"', () => {
        vi.useFakeTimers();
        vi.setSystemTime(lateNight);
        const { dayKey } = loadScripts(['shared.js']).get(['dayKey']);
        expect(dayKey(0)).toBe('2026-10-17');
        vi.useRealTimers();
    });
});

describe('parsePrices (shared.js version)', () => {
    test.each([
        [null, []],
        ['', []],
        ['35000', [{ label: '', price: 35000 }]],
        ['35,000', [{ label: '', price: 35000 }]],
        ['abc', []],
        ['S|30000, M|35000', [{ label: 'S', price: 30000 }, { label: 'M', price: 35000 }]],
        ['A|B|5', [{ label: 'A|B', price: 5 }]],
        ['S|x, M|1', [{ label: 'M', price: 1 }]],
    ])('%j', (raw, expected) => {
        expect(H.parsePrices(raw)).toEqual(expected);
    });
    // Two parsers with different semantics exist (duplicated logic).
    test('diverges from AugustxMenu.parsePrices on empty input', () => {
        const { AugustxMenu } = loadScripts(['augustx-menu.js']).get(['AugustxMenu']);
        expect(H.parsePrices('')).toEqual([]);
        expect(AugustxMenu.parsePrices('')).toEqual([{ label: '', price: 0 }]);
    });
});

describe('parseOptions / normalizeModifier', () => {
    test('parseOptions', () => {
        expect(H.parseOptions('Sweet 50%|0, Extra shot|10000\nOat, |5')).toEqual([
            { name: 'Sweet 50%', price: 0 }, { name: 'Extra shot', price: 10000 }, { name: 'Oat', price: 0 },
        ]);
        expect(H.parseOptions(null)).toEqual([]);
    });
    test('normalizeModifier accepts string, array, and object option shapes', () => {
        expect(H.normalizeModifier({ options: 'A|1, B' }).options).toEqual([{ name: 'A', price: 1 }, { name: 'B', price: 0 }]);
        expect(H.normalizeModifier({ options: { x: { option: 'C', price: '2' }, y: { name: '' } } }).options)
            .toEqual([{ name: 'C', price: 2 }]);
        expect(H.normalizeModifier({ options: ['D|3', 7] }).options).toEqual([{ name: 'D', price: 3 }]);
        expect(H.normalizeModifier({}).options).toEqual([]);
    });
});

describe('stockKey', () => {
    test('sanitizes Firebase-illegal key characters', () => {
        expect(H.stockKey('42.5')).toBe('42_5');
        expect(H.stockKey('')).toBe('one');
        expect(H.stockKey(undefined)).toBe('one');
    });
    test('matches AugustxMenu.sizeKey (duplicated implementation)', () => {
        const { AugustxMenu } = loadScripts(['augustx-menu.js']).get(['AugustxMenu']);
        for (const s of ['42.5', '', null, 'a/b#c$[d]', 'L']) expect(H.stockKey(s)).toBe(AugustxMenu.sizeKey(s));
    });
});

describe('bill helpers', () => {
    test('arr normalizes arrays, objects, and junk', () => {
        expect(H.arr([1, null, 2])).toEqual([1, 2]);
        expect(H.arr({ a: 1, b: 2 })).toEqual([1, 2]);
        expect(H.arr(null)).toEqual([]);
        expect(H.arr('x')).toEqual([]);
    });
    test('lineDetails joins variant and modifier options', () => {
        expect(H.lineDetails({ variant: 'ICED', modifiers: [{ option: 'Less sweet' }, { option: '' }] })).toBe('ICED | Less sweet');
        expect(H.lineDetails({})).toBe('');
    });
    test.each([
        [{ status: 'open' }, true],
        [{ status: 'paid' }, false],
        [{ status: 'void' }, false],
        [{ paid: false }, true],
        [{ paid: false, status: 'void' }, false],
        [null, false],
    ])('isOpenBill(%j) = %s', (o, expected) => {
        expect(H.isOpenBill(o)).toBe(expected);
    });
    test('billCups counts per-line cups, else legacy o.cups', () => {
        expect(H.billCups({ items: [{ quantity: 2, cup: true }, { quantity: 3, cup: false }, { quantity: 1 }] })).toBe(3);
        expect(H.billCups({ items: [{ quantity: 2 }], cups: 5 })).toBe(5);
    });
    test('billName precedence: partner source > table > customer', () => {
        expect(H.billName({ source: 'Grab', appOrderNo: 'G12', table: 3 })).toBe('Grab G12');
        expect(H.billName({ source: 'store', table: 3 })).toBe('โต๊ะ 3');
        expect(H.billName({ customerName: 'Noy' })).toBe('Noy');
        expect(H.billName({})).toBe('');
    });
    test('billCur', () => {
        expect(H.billCur({ currency: 'THB' })).toBe('THB');
        expect(H.billCur({})).toBe('LAK');
        expect(H.billCur(null)).toBe('LAK');
    });
    test('laoReason only exposes whitelisted customer-facing reasons', () => {
        expect(H.laoReason('ของหมด')).toBe('ສິນຄ້າໝົດ');
        expect(H.laoReason('คีย์ผิด')).toBe('');
        expect(H.laoReason('toString')).toBe('');
    });
});

describe('nextOrderNo', () => {
    afterEach(() => vi.useRealTimers());
    test('increments the per-day counter', async () => {
        const { get, data } = loadScripts(['shared.js'], { data: { 'counters/orders/2026-10-17': 41 } });
        await expect(get(['nextOrderNo']).nextOrderNo('2026-10-17')).resolves.toBe(42);
        expect(data['counters/orders/2026-10-17']).toBe(42);
    });
    // BUG-11: if the transaction doesn't resolve within 3s the number falls back
    // to 'T' + last 5 digits of the clock, which is non-sequential and repeats.
    test('BUG-11: falls back to a T-number after 3s', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1792240012345);
        const { ctx, get } = loadScripts(['shared.js']);
        ctx.firebase.database().ref = () => ({ transaction: () => new Promise(() => {}) });
        const p = get(['nextOrderNo']).nextOrderNo('2026-10-17');
        await vi.advanceTimersByTimeAsync(3000);
        await expect(p).resolves.toBe('T15345');
    });
});

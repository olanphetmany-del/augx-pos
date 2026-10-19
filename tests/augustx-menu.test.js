// Characterization tests for augustx-menu.js — the shared menu normalizer and
// the cashier-side re-pricing of online orders (the trust boundary for prices).
import { describe, test, expect } from 'vitest';
import { loadScripts } from './helpers/load-script.js';

const { get } = loadScripts(['augustx-menu.js']);
const { AugustxMenu: M } = get(['AugustxMenu']);

describe('parsePrices', () => {
    test.each([
        [null, [{ label: '', price: 0 }]],
        ['', [{ label: '', price: 0 }]],
        [35000, [{ label: '', price: 35000 }]],
        ['35000', [{ label: '', price: 35000 }]],
        ['M|35000, L|40000', [{ label: 'M', price: 35000 }, { label: 'L', price: 40000 }]],
        ['HOT:30000\nICED:35000', [{ label: 'HOT', price: 30000 }, { label: 'ICED', price: 35000 }]],
        [[{ name: 'S', price: '30000' }, 'L|40000'], [{ label: 'S', price: 30000 }, { label: 'L', price: 40000 }]],
        [{ M: 35000, L: { price: 40000 } }, [{ label: 'M', price: 35000 }, { label: 'L', price: 40000 }]],
    ])('%j', (raw, expected) => {
        expect(M.parsePrices(raw)).toEqual(expected);
    });

    test('thousands separators are split as separate entries (admin UI never writes them)', () => {
        expect(M.parsePrices('M|35,000')).toEqual([{ label: 'M', price: 35 }, { label: '', price: 0 }]);
    });
});

describe('parseOptions', () => {
    test('string form', () => {
        expect(M.parseOptions('Sweet 50%|0, Extra shot|10000, Oat')).toEqual([
            { name: 'Sweet 50%', price: 0 }, { name: 'Extra shot', price: 10000 }, { name: 'Oat', price: 0 },
        ]);
    });
    test('object form drops unavailable options', () => {
        expect(M.parseOptions({ a: { name: 'Shot', price: 10000 }, b: { name: 'Gone', available: false }, Oat: 5000 }))
            .toEqual([{ name: 'Shot', price: 10000 }, { name: 'Oat', price: 5000 }]);
    });
    test('null → []', () => expect(M.parseOptions(null)).toEqual([]));
});

describe('sizeKey', () => {
    test.each([['42.5', '42_5'], ['', 'one'], [null, 'one'], ['a/b#c$[d]', 'a_b_c__d_']])('%j → %j', (i, o) => {
        expect(M.sizeKey(i)).toBe(o);
    });
});

const MENU_DATA = {
    items: {
        latte: { name: 'Latte', category: 'c1', priceOptions: 'HOT|30000,ICED|35000', modifierIds: 'm1,m2', order: 2 },
        tea: { name: 'Tea', category: 'c1', price: 20000, order: 1 },
        hidden: { name: 'Old', category: 'c1', price: 1, available: false },
        noname: { category: 'c1', price: 1 },
        shoe: { name: 'Dunk', category: 'c2', priceOptions: '42|1000,43|1000', currency: 'THB', prePrice: 900, poPrice: { '43': 950 } },
        shoeNoPre: { name: 'Jordan', category: 'c2', price: 2000 },
    },
    groups: {
        m1: { name: 'Sweet', options: 'Normal|0, Less|0' },
        m2: { name: 'Add-on', multi: true, options: [{ name: 'Shot', price: 10000 }, { name: 'Normal', price: 99 }] },
    },
    categories: { c1: { name: 'Coffee', order: 1 }, c2: { name: 'Shoes', order: 0 } },
};
const menu = () => M.buildMenu(MENU_DATA.items, MENU_DATA.groups, MENU_DATA.categories);

describe('buildMenu', () => {
    test('filters unavailable and nameless items, sorts, resolves groups and categories', () => {
        const m = menu();
        expect(m.items.map((i) => i.id)).toEqual(['tea', 'latte', 'shoe', 'shoeNoPre'].sort((a, b) =>
            m.byId[a].sort - m.byId[b].sort || m.byId[a].name.localeCompare(m.byId[b].name)));
        expect(m.byId.hidden).toBeUndefined();
        expect(m.byId.noname).toBeUndefined();
        expect(m.categories).toEqual(['Shoes', 'Coffee']);
        expect(m.byId.latte.groups.map((g) => g.name)).toEqual(['Sweet', 'Add-on']);
        expect(m.byId.latte.groups[0].single).toBe(true);
        expect(m.byId.latte.groups[1].single).toBe(false);
        expect(m.byId.shoe.currency).toBe('THB');
    });

    test('preFrom: PRE-ORDER-only shoes keep the "starting price" flag (PR #2)', () => {
        const m = M.buildMenu({
            poOnly: { name: 'PO Only', category: 'Shoes', priceOptions: '41|4200,42|4200', prePrice: 4200, preFrom: true, preorder: true, currency: 'THB' },
            normal: { name: 'Normal', category: 'Shoes', priceOptions: '41|3500', prePrice: 3000, preorder: true, currency: 'THB' },
            junk: { name: 'Junk', category: 'Shoes', priceOptions: '41|3500', preFrom: 'yes' },
        }, {}, {});
        expect(m.byId.poOnly.preFrom).toBe(true);
        expect(m.byId.normal.preFrom).toBe(false);
        expect(m.byId.junk.preFrom).toBe(false); // only a real `true` counts
        expect(M.unitPrice(m, { itemId: 'poOnly', variant: '42', po: true, qty: 1 })).toBe(4200);
    });
});

describe('unitPrice', () => {
    test('variant + options from the menu, not the client', () => {
        expect(M.unitPrice(menu(), { itemId: 'latte', variant: 'ICED', options: [{ name: 'Shot' }] })).toBe(45000);
    });
    test('single-variant item without a variant label', () => {
        expect(M.unitPrice(menu(), { itemId: 'tea' })).toBe(20000);
    });
    test('option name shared across groups is disambiguated by group', () => {
        const m = menu();
        expect(M.unitPrice(m, { itemId: 'latte', variant: 'HOT', options: [{ name: 'Normal', group: 'Add-on' }] })).toBe(30099);
        expect(M.unitPrice(m, { itemId: 'latte', variant: 'HOT', options: [{ name: 'Normal' }] })).toBe(30000);
    });
    test.each([
        ['unknown item', { itemId: 'nope' }],
        ['unknown variant', { itemId: 'latte', variant: 'XL' }],
        ['multi-variant without variant', { itemId: 'latte' }],
        ['unknown option', { itemId: 'tea', options: [{ name: 'Gold flakes' }] }],
    ])('%s → null', (_, line) => {
        expect(M.unitPrice(menu(), line)).toBeNull();
    });
    test('pre-order price: per-size override, then base prePrice', () => {
        const m = menu();
        expect(M.unitPrice(m, { itemId: 'shoe', variant: '43', po: true })).toBe(950);
        expect(M.unitPrice(m, { itemId: 'shoe', variant: '42', po: true })).toBe(900);
    });
    test('po flag is ignored when the item has no pre-order price', () => {
        expect(M.unitPrice(menu(), { itemId: 'shoeNoPre', po: true })).toBe(2000);
    });
    // SEC-7: po:true is honoured even for in-stock items, so a client can pick the
    // pre-order price for an item on the shelf. Documenting current behaviour.
    test('SEC-7: po:true selects prePrice regardless of stock', () => {
        expect(M.unitPrice(menu(), { itemId: 'shoe', variant: '42', po: true })).toBeLessThan(
            M.unitPrice(menu(), { itemId: 'shoe', variant: '42' }));
    });
});

describe('priceRound', () => {
    test('re-prices lines, flags mismatches, clamps qty to a positive integer', () => {
        const r = M.priceRound(menu(), [
            { itemId: 'tea', qty: 2, unitPrice: 20000 },
            { itemId: 'latte', variant: 'HOT', qty: '1', unitPrice: 1 },
            { itemId: 'tea', qty: -5, unitPrice: 20000 },
            { itemId: 'tea', qty: 2.9, unitPrice: 20000 },
        ]);
        expect(r.lines.map((l) => [l.qty, l.unitPrice])).toEqual([[2, 20000], [1, 30000], [1, 20000], [2, 20000]]);
        expect(r.total).toBe(40000 + 30000 + 20000 + 40000);
        expect(r.problems).toHaveLength(1);
        expect(r.problems[0].reason).toContain('1 → 30000');
    });
    test('missing items are reported and priced at the client-supplied unitPrice', () => {
        const r = M.priceRound(menu(), [{ itemId: 'gone', qty: 1, unitPrice: 5 }]);
        expect(r.problems).toHaveLength(1);
        expect(r.total).toBe(5);
    });
    // SEC-1 root cause: client-supplied fields (including `name`) pass through untouched.
    test('SEC-1: client-supplied line fields are preserved verbatim', () => {
        const evil = '<img src=x onerror=alert(1)>';
        const r = M.priceRound(menu(), [{ itemId: 'tea', qty: 1, unitPrice: 20000, name: evil }]);
        expect(r.lines[0].name).toBe(evil);
    });
});

describe('money', () => {
    test('formats with grouping and up to 2 decimals', () => {
        expect(M.money(1234567.891)).toBe('1,234,567.89');
        expect(M.money(null)).toBe('0');
    });
});

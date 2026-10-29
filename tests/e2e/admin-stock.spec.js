// BUG-8: saving an item in Admin must not put back the stock counts from when
// the editor opened. Sales made meanwhile on the cashier have to survive;
// only the sizes changed in the editor are written.
import { test, expect, OWNER, seedData } from './fixtures.js';

function db() {
    const d = seedData();
    d.categories.c3 = { name: 'NIKE', shoe: true, sizes: '42,43' };
    Object.assign(d.menu_items.latte, { stockOn: true, stock: { HOT: 5, ICED: 5 } });
    d.menu_items.dunk = { name: 'Smoke Dunk', category: 'NIKE', priceOptions: '42|3500,43|3500', currency: 'THB', stockOn: true, stock: { 42: 2, 43: 4 } };
    return d;
}
test.use({ user: OWNER, db: db() });

const stockOf = (page, id) => page.evaluate((id) => window.__fakeDb.get('menu_items/' + id + '/stock'), id);
// A sale on another device while the editor is open.
const sell = (page, path, n) => page.evaluate(([p, n]) => window.__fakeDb.set('menu_items/' + p, n), [path, n]);

test.beforeEach(async ({ page, errors }) => { // `errors` installs the fake Firebase
    await page.goto('admin.html');
    await expect(page.locator('#login-overlay')).toBeHidden();
});

test('item editor: a sale made while editing survives the save', async ({ page, errors }) => {
    await page.evaluate(() => window.openItemModalForEdit('latte'));
    await sell(page, 'latte/stock/HOT', 3);
    await page.locator('#item-modal-overlay input[placeholder="มีกี่ชิ้น"]').nth(1).fill('9'); // ICED, counted by the owner
    await page.locator('#item-modal-overlay button', { hasText: 'บันทึก' }).click();
    await expect(page.locator('#item-modal-overlay')).toBeHidden();
    await expect.poll(() => stockOf(page, 'latte')).toEqual({ HOT: 3, ICED: 9 });
    expect(errors).toEqual([]);
});

test('shoe editor: a sale made while editing survives the save; an edited size is written', async ({ page, errors }) => {
    await page.evaluate(() => window.openShoe('dunk'));
    await sell(page, 'dunk/stock/42', 1);
    await page.locator('#shoe-overlay .sh-tl', { hasText: '43' }).click();
    await page.locator('#shoe-overlay .sh-stp button', { hasText: '+' }).click(); // 43: 4 → 5
    await page.locator('#sh-save').click();
    await expect.poll(() => stockOf(page, 'dunk')).toEqual({ 42: 1, 43: 5 });
    expect(errors).toEqual([]);
});

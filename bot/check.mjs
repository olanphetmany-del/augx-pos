const DB = 'https://augx-d75c2-default-rtdb.asia-southeast1.firebasedatabase.app';
const prods = await (await fetch(DB + '/hiw/pub/products.json')).json();
const r = await fetch(DB + '/hiw/pub/pimg.json?shallow=true'); const keys = r.ok ? await r.json() : null;
console.log('pimg status', r.status, keys ? Object.keys(keys).length : 'none');
for (const [id, p] of Object.entries(prods)) {
  const has = keys ? !!keys[id] : null;
  if (!p.hasImg || !has) console.log('ROW', id, 'hasImg=' + !!p.hasImg, 'pimg=' + has, p.hidden ? 'hidden' : '', '|', p.name);
}
for (const id of ['a_oil350', 'a_toner500', 'pd_02', 'pd_11']) console.log('MINE', id, JSON.stringify({ hasImg: prods[id]?.hasImg, pimg: keys?.[id] }));

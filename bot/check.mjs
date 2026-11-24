const DB = 'https://augx-d75c2-default-rtdb.asia-southeast1.firebasedatabase.app';
const prods = await (await fetch(DB + '/hiw/pub/products.json')).json();
for (const [id, p] of Object.entries(prods)) if (/roche|anthelios|uvmune|LRP/i.test(p.name + ' ' + (p.brand || ''))) console.log('ROW', id, '|', p.name, '|', p.size, '| won', p.won, 'full', p.wonFull, 'sell', p.sell, p.hidden ? 'hidden' : '');

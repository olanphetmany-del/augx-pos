// Discovery: read-only. Count shop products without a photo, probe Olive Young Global search.
const DB = 'https://augx-d75c2-default-rtdb.asia-southeast1.firebasedatabase.app';
const prods = await (await fetch(DB + '/hiw/pub/products.json')).json();
const all = Object.entries(prods || {});
const miss = all.filter(([, p]) => p && !p.hasImg);
console.log('products', all.length, 'without photo', miss.length, 'hidden-without-photo', miss.filter(([, p]) => p.hidden).length);
for (const [id, p] of miss) console.log('MISS', id, '|', p.name, '|', p.brand || '', '|', p.hidden ? 'hidden' : '');
const UA = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'accept-language': 'en-US,en;q=0.9' };
for (const u of ['https://global.oliveyoung.com/', 'https://global.oliveyoung.com/display/search?query=medicube']) {
  try {
    const r = await fetch(u, { headers: UA }); const t = await r.text();
    console.log('GET', u, r.status, t.length);
    const apis = [...new Set(t.match(/[\w./-]*(?:search|Search)[\w./-]*/g) || [])].filter((s) => /api|search/i.test(s)).slice(0, 40);
    console.log('  hints', apis.join(' '));
    const js = [...new Set(t.match(/https?:\/\/[^"' ]+\.js/g) || [])].slice(0, 15);
    console.log('  js', js.join(' '));
    for (const j of js) {
      try { const jt = await (await fetch(j, { headers: UA })).text(); const m = [...new Set(jt.match(/["'`][^"'`]*unified[^"'`]*["'`]/gi) || [])].slice(0, 10); if (m.length) console.log('  JS', j, m.join(' ')); } catch (e) { console.log('  jsfail', j, e.message); }
    }
  } catch (e) { console.log('GET fail', u, e.message); }
}

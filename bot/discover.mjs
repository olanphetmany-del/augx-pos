const H = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', accept: 'application/json', 'content-type': 'application/json', 'accept-language': 'en-US,en;q=0.9', referer: 'https://global.oliveyoung.com/', origin: 'https://global.oliveyoung.com' };
const q = 'VT Reedle Shot 100 Essence 50ml';
const tries = [
  ['POST', '/api/v1/search/unified-search', { query: q, page: 1, size: 5 }],
  ['POST', '/api/v1/search/unified', { query: q }],
  ['GET', '/api/v1/search/unified-search?query=' + encodeURIComponent(q)],
  ['GET', '/api/v1/search/products?query=' + encodeURIComponent(q)],
  ['POST', '/display/search/unified-search', { query: q }],
];
for (const [m, p, b] of tries) {
  try {
    const r = await fetch('https://global.oliveyoung.com' + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
    const t = await r.text();
    console.log('TRY', m, p, r.status, t.slice(0, 600).replace(/\s+/g, ' '));
  } catch (e) { console.log('TRY', m, p, 'ERR', e.message); }
}
// search js bundles for 'unified' in manifest
const man = await (await fetch('https://dist.oliveyoung.com/fo/11abfaf45d/resources/manifest.js', { headers: H })).text();
console.log('MAN', man.length, [...new Set(man.match(/[\w/.-]*search[\w/.-]*/gi) || [])].slice(0, 30).join(' '));

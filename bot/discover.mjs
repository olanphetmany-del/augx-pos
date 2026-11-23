const UA = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'accept-language': 'en-US,en;q=0.9' };
for (const j of ['https://dist.oliveyoung.com/fo/11abfaf45d/resources/js/biz/display/header-search.v2.js', 'https://dist.oliveyoung.com/fo/11abfaf45d/resources/js/biz/display/header-search.tab-layer.v2.js']) {
  const t = await (await fetch(j, { headers: UA })).text();
  console.log('JS', j, t.length);
  const urls = [...new Set(t.match(/["'`]\/[a-zA-Z0-9_\-/.]{3,}["'`]/g) || [])];
  console.log('  urls', urls.join(' '));
  for (const k of ['ajax', 'url:', 'fetch(', 'unified']) { let i = -1, n = 0; while ((i = t.indexOf(k, i + 1)) >= 0 && n++ < 6) console.log('  ' + k, JSON.stringify(t.slice(Math.max(0, i - 80), i + 220))); }
}

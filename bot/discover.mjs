const H = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', accept: 'application/json', 'accept-language': 'en-US,en;q=0.9', referer: 'https://global.oliveyoung.com/' };
for (const q of ['VT Reedle Shot 100', 'Torriden Dive-in Mask']) {
  const r = await fetch('https://global.oliveyoung.com/api/v1/search/keywords/auto-complete?query=' + encodeURIComponent(q), { headers: H });
  const t = await r.text();
  console.log('AC', q, r.status, t.slice(0, 1500));
}

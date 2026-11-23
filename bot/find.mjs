// Read-only on the shop. Finds products without a photo and looks for the product on brand stores'
// public Shopify search (search/suggest.json). Saves candidates to results/ for review.
import fs from 'node:fs';
import sharp from 'sharp';
const DB = 'https://augx-d75c2-default-rtdb.asia-southeast1.firebasedatabase.app';
const prods = await (await fetch(DB + '/hiw/pub/products.json')).json();
const DONE = new Set(['a_oil350', 'a_toner500', 'pd_02', 'pd_11', 'pc_10']);
const miss = Object.entries(prods).filter(([id, p]) => p && !p.hasImg && !DONE.has(id));
const TYPES = ['mist', 'serum', 'cream', 'toner', 'oil', 'mask', 'patch', 'foam', 'balm', 'tint', 'gloss', 'sunscreen', 'sun', 'essence', 'device', 'booster', 'pad'];
const DOM = {
  'dr.g': ['drg.us', 'gowoonsesang.us', 'drgshop.com'], iope: ['iope.us', 'iope.com'],
  medicube: ['medicube.us'], bioderma: ['sokoglam.com'], unove: ['unove.co', 'unoveglobal.com', 'unove.global', 'sokoglam.com'],
  colorgram: ['colorgram.global', 'colorgramglobal.com', 'sokoglam.com'],
  goodal: ['goodalglobal.com', 'goodal.global', 'sokoglam.com'], abib: ['abib.global', 'abibglobal.com', 'sokoglam.com'],
  vt: ['vtcosmetics.global', 'vt-cosmetics.us', 'vtcosmeticsus.com', 'sokoglam.com'], anua: ['anua.us', 'sokoglam.com'],
};
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; augx-photo-finder/1.0)', accept: 'application/json' };
const words = (s) => String(s).toLowerCase().replace(/\(.*?\)|—.*$/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
const STOP = new Set(['ml', 'sheets', 'ea', 'set', 'x2', '1', 'the', 'and', 'with']);
fs.mkdirSync('results', { recursive: true });
const out = [];
for (const [id, p] of miss) {
  const brandKey = Object.keys(DOM).find((b) => p.name.toLowerCase().startsWith(b) || (p.brand || '').toLowerCase() === b);
  if (!brandKey) { out.push({ id, name: p.name, why: 'no brand store' }); continue; }
  const qw = words(p.name).filter((w) => !STOP.has(w) && !brandKey.split(/[ .]/).includes(w));
  let best = null;
  for (const dom of DOM[brandKey]) {
    for (const q of [qw.slice(0, 4).join(' '), qw.slice(0, 2).join(' '), brandKey + ' ' + qw.slice(0, 2).join(' ')]) {
      try {
        const r = await fetch(`https://${dom}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=6`, { headers: UA, signal: AbortSignal.timeout(12000) });
        if (!r.ok) { console.log('  ', dom, r.status); break; }
        const j = await r.json();
        for (const it of j?.resources?.results?.products || []) {
          const tw = new Set(words(it.title));
          let score = qw.filter((w) => tw.has(w)).length / Math.max(qw.length, 1);
          const need = TYPES.filter((t) => qw.includes(t));
          if (need.length && !need.some((t) => tw.has(t))) score = 0;
          if (dom === 'sokoglam.com' && !tw.has(brandKey.split(/[ .]/)[0])) score = 0;
          if (it.image && (!best || score > best.score)) best = { score, title: it.title, img: it.image, url: `https://${dom}${it.url}` };
        }
      } catch (e) { console.log('  ', dom, 'ERR', e.message); break; }
      if (best && best.score >= 0.6) break;
    }
    if (best && best.score >= 0.6) break;
  }
  if (!best) { out.push({ id, name: p.name, why: 'not found' }); console.log('NONE', id, p.name); continue; }
  try {
    const src = best.img.startsWith('//') ? 'https:' + best.img : best.img;
    console.log('TRY', id, best.score.toFixed(2), '|', p.name, '=>', best.title, best.url.split('?')[0], src);
    let r = await fetch(src.replace(/\.(webp|avif)(\?|$)/, '.jpg$2'), { headers: { 'user-agent': UA['user-agent'], accept: 'image/jpeg,image/png,image/*;q=0.8' } });
    if (!r.ok) r = await fetch(src, { headers: { 'user-agent': UA['user-agent'], accept: 'image/jpeg,image/png' } });
    console.log('   ', r.status, r.headers.get('content-type'));
    const buf = Buffer.from(await r.arrayBuffer());
    const jpg = await sharp(buf).flatten({ background: '#ffffff' }).resize(600, 600, { fit: 'contain', background: '#ffffff' }).jpeg({ quality: 80 }).toBuffer();
    fs.writeFileSync(`results/${id}.jpg`, jpg);
    out.push({ id, name: p.name, title: best.title, score: +best.score.toFixed(2), url: best.url, kb: Math.round(jpg.length / 1024) });
    console.log('HIT', id, best.score.toFixed(2), '|', p.name, '=>', best.title, best.url);
  } catch (e) { out.push({ id, name: p.name, title: best.title, url: best.url, why: 'download ' + e.message }); console.log('   FAIL', e.message); }
}
fs.writeFileSync('results/results.json', JSON.stringify(out, null, 1));

// 關鍵字研究：哪些發文用語真的代表價格有優勢？
//   每個候選詞抓 591 全台中結果（標題真的含該詞才算），跟實登（同區同型態相近坪數屋齡）比單價，
//   再跟「一般物件」基準比較。591 單價含車位、實登已扣車位 → 兩組同樣偏高，看「相對基準」的差距。
// 用法：node tools/kw-study.js   （約 10 分鐘，結果寫 state/kw-study.json）
const https = require('https');
const fs = require('fs');
const path = require('path');
const market = require('../lib/market-price');

const CANDIDATES = ['急售', '急讓', '賠售', '認賠', '虧售', '自售', '屋主', '秒殺', '投資', '投資客', '收租',
  '低於行情', '低於實登', '降價', '破盤', '便宜', '超值', '讓利', '出清', '底價', '低總價', '首購', '稀有', '獨家', '專任', '新上架'];
const PAGES = 8;

const get = u => new Promise(r => https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
  let d = ''; res.on('data', c => d += c); res.on('end', () => { try { r(JSON.parse(d).data); } catch { r(null); } });
}).on('error', () => r(null)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = 'https://bff-house.591.com.tw/v1/web/sale/list?type=2&shType=list&regionid=8';

const toL = h => ({ id: h.houseid, title: h.title || '', district: h.section_name, type: h.shape_name,
  unitPrice: parseFloat(h.unitprice) || null, area: parseFloat(h.area) || null,
  age: parseFloat(h.houseage) || null, hurry: h.is_hurry_price, owner: /^屋主/.test(h.nick_name || '') });

async function fetchQuery(q, pages, offsets) {
  const out = [];
  for (const off of offsets || [...Array(pages).keys()].map(p => p * 30)) {
    const d = await get(`${BASE}${q}&firstRow=${off}`);
    if (!d) break;
    const hs = d.house_list.filter(h => h.houseid);
    out.push(...hs.map(toL));
    if (!offsets && hs.length < 30) break;
    await sleep(450);
  }
  return out;
}

const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

function stats(list, mk) {
  const diffs = [];
  for (const l of list) {
    if (!l.unitPrice || !/大樓|華廈|公寓|透天/.test(l.type || '')) continue; // 只看住宅，店面/土地口徑不同
    const c = market.compareWithMarket(l, mk);
    if (c && c.count >= 5 && c.matchLevel !== 'district') diffs.push(c.diff);
  }
  return { n: diffs.length, med: median(diffs), below10: diffs.length ? Math.round(diffs.filter(d => d <= -10).length / diffs.length * 100) : null };
}

(async () => {
  const mk = market.getMarketPrices();
  if (!mk) throw new Error('沒有 state/market-prices.json');

  // 基準：一般列表，分散抽 30 頁
  const first = await get(`${BASE}&firstRow=0`);
  const total = Number(first.total);
  const offs = [...Array(30).keys()].map(i => Math.floor(total / 30 * i / 30) * 30);
  const base = await fetchQuery('', 0, offs);
  const b = stats(base, mk);
  console.log(`基準（一般物件 ${base.length} 筆）：比實登中位 ${b.med}%，低於實登10%以上 ${b.below10}%（n=${b.n}）`);

  const rows = [];
  for (const kw of CANDIDATES) {
    const raw = await fetchQuery(`&keywords=${encodeURIComponent(kw)}`, PAGES);
    const hit = raw.filter(l => l.title.includes(kw));
    const s = stats(hit, mk);
    rows.push({ kw, fetched: raw.length, titled: hit.length, ...s, edge: s.med != null ? Math.round((s.med - b.med) * 10) / 10 : null });
    console.log(`${kw.padEnd(5)} 標題含 ${String(hit.length).padStart(3)}/${raw.length}  比實登中位 ${s.med}%  相對基準 ${rows.at(-1).edge}  低10%以上 ${s.below10}%（n=${s.n}）`);
  }
  rows.sort((x, y) => (x.edge ?? 99) - (y.edge ?? 99));
  const out = { at: new Date().toISOString(), baseline: b, rows };
  fs.writeFileSync(path.join(__dirname, '..', 'state', 'kw-study.json'), JSON.stringify(out, null, 1));
  console.log('\n依「相對基準」排序（越負越便宜）：');
  for (const r of rows) console.log(`${r.kw.padEnd(5)} ${r.edge}  (n=${r.n}, 低10%以上 ${r.below10}%)`);
})();

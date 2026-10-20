// 591 全台中關鍵字搜尋：各關鍵字筆數，以及標題真的含關鍵字的比例（591 搜尋是模糊比對）
const https = require('https');
const { KW } = require('../lib/core');
const get = u => new Promise(r => https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
  let d = ''; res.on('data', c => d += c); res.on('end', () => { try { r(JSON.parse(d).data); } catch { r(null); } });
}).on('error', () => r(null)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const all = KW.map(k => k[1]);
  for (const kw of ['急售', '賠售', '虧售', '認賠', '自售', '降價', '低於行情', '便宜']) {
    let total = 0, n = 0, hit = 0, hurry = 0;
    for (let p = 0; p < 4; p++) {
      const d = await get(`https://bff-house.591.com.tw/v1/web/sale/list?type=2&shType=list&regionid=8&keywords=${encodeURIComponent(kw)}&firstRow=${p * 30}`);
      if (!d) break;
      total = d.total;
      const hs = d.house_list.filter(h => h.houseid);
      for (const h of hs) { n++; if (all.some(re => re.test(h.title))) hit++; if (h.is_hurry_price) hurry++; }
      if (hs.length < 30) break;
      await sleep(500);
    }
    console.log(`${kw.padEnd(5)} 共 ${total} 筆；抽前 ${n} 筆：標題含關鍵字 ${hit}、急售旗標 ${hurry}`);
  }
})();

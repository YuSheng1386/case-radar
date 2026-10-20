// 檢查各來源從這台機器連不連得到（GitHub 機器在美國，台灣網站可能擋海外 IP）
const https = require('https');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const SITES = [
  ['591', 'https://bff-house.591.com.tw/v1/web/sale/list?type=2&regionid=8&shType=list&firstRow=0', d => JSON.parse(d).data.total > 0],
  ['5168', 'https://buy.houseprice.tw/list/台中市_city/', d => d.length > 5000],
  ['信義', 'https://www.sinyi.com.tw/buy/list/Taichung-city/elevator-type/index', d => d.length > 5000],
  ['住商', 'https://www.hbhousing.com.tw/', d => d.length > 5000],
  ['東森', 'https://www.etwarm.com.tw/', d => d.length > 5000],
  ['永慶店家', 'https://shop.yungching.com.tw/0422514311/list?pg=1', d => /list_ids/.test(d)],
  ['永慶物件', 'https://buy.yungching.com.tw/house/7535201', d => /"price"/.test(d)],
  ['實登', 'https://plvr.land.moi.gov.tw/DownloadOpenData', d => d.length > 500]
];
const get = u => new Promise(r => {
  const t = Date.now();
  const req = https.get(encodeURI(u), { headers: { 'User-Agent': UA } }, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => r({ code: res.statusCode, d, ms: Date.now() - t }));
  });
  req.on('error', e => r({ code: e.message, d: '', ms: Date.now() - t }));
  req.setTimeout(20000, () => { req.destroy(); r({ code: 'timeout', d: '', ms: 20000 }); });
});
(async () => {
  let bad = 0;
  for (const [name, url, ok] of SITES) {
    const r = await get(url);
    let pass = false; try { pass = ok(r.d); } catch {}
    if (!pass) bad++;
    console.log(`${pass ? 'OK  ' : 'FAIL'} ${name.padEnd(6)} HTTP ${r.code} ${r.ms}ms ${r.d.length}B`);
  }
  process.exit(bad ? 1 : 0);
})();

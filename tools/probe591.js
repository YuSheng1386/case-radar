// 量 591 各區×房型總筆數與單次回應時間（排查抓取耗時用）
const https = require('https');
const get = u => new Promise(r => {
  const t = Date.now();
  https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => { try { r([JSON.parse(d).data.total, Date.now() - t]); } catch { r([res.statusCode, Date.now() - t]); } });
  }).on('error', e => r([e.message, Date.now() - t]));
});
(async () => {
  for (const q of ['shType=list&shape=2', 'shType=list&shape=3', 'shType=host'])
    console.log(q, await get(`https://bff-house.591.com.tw/v1/web/sale/list?type=2&regionid=8&section=99,100,101,105,107&${q}&firstRow=0`));
})();

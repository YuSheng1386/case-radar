// 看 591 社區成交紀錄 API 的欄位：node tools/probe-community.js [社區id]
const https = require('https');
const id = process.argv[2] || '5925790';
https.get(`https://bff-market.591.com.tw/v1/price/list?community_id=${id}&page=1`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    const j = JSON.parse(d).data;
    console.log('keys', Object.keys(j), 'total_page', j.total_page, 'items', (j.items || []).length);
    console.log(JSON.stringify(j.items[0], null, 1).slice(0, 2500));
  });
});

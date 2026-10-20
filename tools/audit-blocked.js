// 抽查同體系排除：刊登 vs 店家物件 並排比對，看是不是真的同一戶
// 用法：RADAR_STATE=/tmp/radar-seed2 node tools/audit-blocked.js [抽幾筆]
const path = require('path');
const STATE = process.env.RADAR_STATE || path.join(__dirname, '..', 'state');
const data = require(path.join(__dirname, '..', 'docs', 'data.json'));
const yc = require(path.join(STATE, 'yc-listings.json')).listings;
const byId = Object.fromEntries(yc.map(x => [x.id, x]));
const n = +process.argv[2] || 15;
const lv = {}; data.blocked.forEach(b => lv[b.level] = (lv[b.level] || 0) + 1);
console.log(`同體系排除 ${data.blocked.length} 筆，可信度分布`, JSON.stringify(lv));
const pick = data.blocked.filter((_, i) => i % Math.max(1, Math.floor(data.blocked.length / n)) === 0).slice(0, n);
for (const b of pick) {
  const y = byId[(b.ycUrl.match(/(\d+)$/) || [])[1]] || {};
  console.log(`[${b.level}] 刊登：${b.district} ${b.community || ''} ${b.address} ${b.price}萬 ${b.area}坪 ${b.floor}`);
  console.log(`       店家：${y.district} ${y.title || ''} ${y.address} ${y.price}萬 ${y.area}坪 ${y.floorText || y.floor || ''}`);
}

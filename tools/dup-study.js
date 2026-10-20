// 591 同平台重複刊登有多少：同區＋（同社區或同路）＋同樓層＋權狀坪差 ≤1%＋價差 ≤8% 視為同一戶
// 用法：RADAR_STATE=/tmp/radar-e2e node tools/dup-study.js
const path = require('path');
const core = require('../lib/core');
const tr = require(path.join(process.env.RADAR_STATE || path.join(__dirname, '..', 'state'), 'tracker.json'));
const items = Object.values(tr.items).filter(r => !r.removedAt && r.d && r.d.sourceId !== '0').map(r => r.d);
const groups = new Map();
for (const it of items) {
  const fl = core.parseFloor(it.floor);
  const loc = it.community || core.roadOf(it.address);
  if (!loc || !it.area) continue;
  const k = `${it.district}|${loc}|${fl ?? it.floor}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(it);
}
let units = 0, dupListings = 0, maxG = null;
const examples = [];
for (const list of groups.values()) {
  const used = new Set();
  for (let i = 0; i < list.length; i++) {
    if (used.has(i)) continue;
    const g = [list[i]];
    for (let j = i + 1; j < list.length; j++) {
      if (used.has(j)) continue;
      const a = list[i], b = list[j];
      if (Math.abs(a.area - b.area) / a.area <= 0.01 && (!a.price || !b.price || Math.abs(a.price - b.price) / Math.max(a.price, b.price) <= 0.08)) { g.push(b); used.add(j); }
    }
    units++;
    if (g.length > 1) { dupListings += g.length - 1; if (examples.length < 4) examples.push(g); if (!maxG || g.length > maxG.length) maxG = g; }
  }
}
console.log(`591 在架 ${items.length} 筆（可比對 ${[...groups.values()].flat().length}）→ 實際約 ${units} 戶，重複刊登 ${dupListings} 筆`);
for (const g of examples) console.log('例：', g.map(x => `${x.community || x.address} ${x.floor} ${x.area}坪 ${x.price}萬 ${x.agent}`).join(' ／ '));
console.log(`最多一戶被刊 ${maxG.length} 次：`, maxG.map(x => `${x.price}萬 ${x.agent}`).join('、'));

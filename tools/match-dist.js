// 看配對分數分布（調 tools/notify.js 的 MATCH_MIN 用）：node tools/match-dist.js
const M = require('../web/public/match.js');
const pool = require('../docs/pool.json').items;
const samples = [
  { districts: ['南屯區', '大里區', '南區'], types: ['大樓'], priceMin: 1400, priceMax: 2100, floorMin: 4, floorMax: 9, ageMax: 15 },
  { districts: ['西區'], types: ['大樓'], priceMax: 1500 },
  { districts: ['東區', '南區'], types: ['大樓', '華廈'], priceMin: 800, priceMax: 1300, roomsMin: 3 }
];
for (const P of samples) {
  const r = M.run(pool, P, []).items;
  const h = {}; r.forEach(x => { const b = Math.floor(x.ms / 10) * 10; h[b] = (h[b] || 0) + 1; });
  console.log(r.length, JSON.stringify(h), r.slice(0, 2).map(x => `${x.ms} ${x.why.join(',')}`));
}

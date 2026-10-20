// 看 docs/data.json 的統計：node tools/stats.js
const d = require('../docs/data.json');
const t = {};
d.cards.forEach(c => c.tags.forEach(x => t[x] = (t[x] || 0) + 1));
console.log(JSON.stringify(d.totals), '五區', d.cards.filter(c => !c.wide).length, '五區外', d.cards.filter(c => c.wide).length);
console.log('標籤', JSON.stringify(t));
console.log('有同社區比較', d.cards.filter(c => c.comm).length, '；低於社區最低成交', d.cards.filter(c => c.comm && c.comm.belowMin).length);
const buckets = { '≥60': 0, '40-59': 0, '20-39': 0, '<20(自售)': 0 };
d.cards.forEach(c => buckets[c.score >= 60 ? '≥60' : c.score >= 40 ? '40-59' : c.score >= 20 ? '20-39' : '<20(自售)']++);
console.log('分數分布', JSON.stringify(buckets));

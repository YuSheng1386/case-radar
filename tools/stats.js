// 看 docs/data.json 的統計：node tools/stats.js
const d = require('../docs/data.json');
const t = {};
d.cards.forEach(c => c.tags.forEach(x => t[x] = (t[x] || 0) + 1));
console.log(JSON.stringify(d.totals), '五區', d.cards.filter(c => !c.wide).length, '五區外', d.cards.filter(c => c.wide).length);
console.log('標籤', JSON.stringify(t));
console.log('有同社區比較', d.cards.filter(c => c.comm).length, '；低於社區最低成交', d.cards.filter(c => c.comm && c.comm.belowMin).length);
const own = d.cards.filter(c => c.posters && c.posters.owner);
console.log('屋主本人刊登', own.length, '（其中只有屋主、沒仲介', own.filter(c => c.posters.agents === 0).length, '）；標題寫自售但刊登者是仲介',
  d.cards.filter(c => c.tags.includes('自售') && !(c.posters && c.posters.owner)).length);
console.log('合併後一戶多筆', d.cards.filter(c => c.sources.length > 1).length, '；5 位以上仲介在刊', d.cards.filter(c => c.posters && c.posters.agents >= 5).length);
const buckets = { '≥60': 0, '40-59': 0, '20-39': 0, '<20(自售)': 0 };
d.cards.forEach(c => buckets[c.score >= 60 ? '≥60' : c.score >= 40 ? '40-59' : c.score >= 20 ? '20-39' : '<20(自售)']++);
console.log('分數分布', JSON.stringify(buckets));

// 測全市關鍵字抓取：node tools/test-wide.js
const s591 = require('../lib/s591');
const core = require('../lib/core');
const cfg = require('../config.json');
(async () => {
  const t0 = Date.now();
  const L = await s591.scrapeWide({ city: cfg.city, skipDistricts: cfg.districts, keywords: cfg.wideKeywords });
  const tagged = L.filter(x => core.tagsOf(x).size > 0);
  const byD = {};
  tagged.forEach(x => byD[x.district] = (byD[x.district] || 0) + 1);
  const byT = {};
  tagged.forEach(x => core.tagsOf(x).forEach(t => byT[t] = (byT[t] || 0) + 1));
  console.log(`共 ${L.length} 筆（完整=${L.complete}），有標籤 ${tagged.length}，${Math.round((Date.now() - t0) / 1000)} 秒`);
  console.log('標籤', JSON.stringify(byT));
  console.log('區域', JSON.stringify(Object.entries(byD).sort((a, b) => b[1] - a[1]).slice(0, 12)));
  console.log('誤入五區', L.filter(x => cfg.districts.includes(x.district)).length);
})();

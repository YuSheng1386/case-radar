// 測同體系列表頁解析：node tools/test-yc.js [電話]
const yc = require('../lib/yc');
const stores = require('../stores.local.json');
(async () => {
  const s = process.argv[2] ? stores.filter(x => x.phone === process.argv[2]) : stores.slice(3, 4);
  const r = await yc.scrapeStores(s);
  const L = r.listings;
  const has = f => L.filter(x => x[f] != null).length;
  console.log(JSON.stringify(r.storeCounts));
  console.log(`台中 ${L.length} 筆；有價格 ${has('price')}、建物坪 ${has('area')}、樓層 ${has('floor')}、區 ${has('district')}、屋齡 ${has('age')}`);
  console.log(L.slice(0, 3).map(x => JSON.stringify(x)).join('\n'));
})();

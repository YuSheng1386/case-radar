// 核心函式自我檢查：node tools/selftest.js
const assert = require('assert');
const c = require('../lib/core');

assert.strictEqual(c.roadOf('台中市南屯區干城街145巷'), '干城街');
assert.strictEqual(c.roadOf('臺中市南屯區公益路二段51號'), '公益路二段');
assert.strictEqual(c.roadOf('台中市東區大智路'), '大智路');
assert.strictEqual(c.roadOf('台中市西屯區台灣大道三段'), '台灣大道三段');
assert.strictEqual(c.parseFloor('14F/20F'), 14);
assert.strictEqual(c.parseFloor('6/13樓'), 6);
assert.strictEqual(c.parseFloor('1F~4F/4F'), null);
assert.strictEqual(c.parseFloor('3樓'), 3);
assert.strictEqual(c.extractDistrict('台中市南屯區干城街'), '南屯區');

const idx = c.buildStoreIndex([
  { id: '1', address: '台中市東區大智路', district: '東區', community: '寶睿新湛', price: 1388, area: 36.26, floor: 6, stores: ['A'] },
  { id: '2', address: '台中市東區大智路', district: '東區', community: '', price: 1400, area: 30, floor: 9, stores: ['B'] }
]);
// 同社區、坪數樓層都對 → 高
let m = c.matchSameSystem({ district: '東區', address: '台中市東區大智路', community: '寶睿新湛', price: 1398, area: 36.3, floor: '6F/13F' }, idx);
assert.strictEqual(m.level, '高'); assert.deepStrictEqual(m.stores, ['A']);
// 同路同價但坪數差很多 → 不是同一戶（舊版會誤判）
m = c.matchSameSystem({ district: '東區', address: '台中市東區大智路', community: '', price: 1390, area: 45, floor: '6F/13F' }, idx);
assert.strictEqual(m, null);
// 樓層不同 → 不是
m = c.matchSameSystem({ district: '東區', address: '台中市東區大智路', community: '寶睿新湛', price: 1388, area: 36.26, floor: '7F/13F' }, idx);
assert.strictEqual(m, null);
// 只有路名、沒坪數沒樓層 → 證據不足，不排除
m = c.matchSameSystem({ district: '東區', address: '台中市東區大智路', price: 1390 }, idx);
assert.strictEqual(m, null);

const t = c.tagsOf({ title: '屋主急售！低於行情 三房平車', isOwner: true });
assert.ok(t.has('急售') && t.has('自售') && t.has('標低於行情'));
assert.ok(c.tagsOf({ title: '認賠出清 景觀戶' }).has('賠售'));
assert.ok(c.tagsOf({ title: '秒殺價 兩房車位' }).has('急售'));
assert.strictEqual(c.tagsOf({ title: '收租首選 稀有釋出 讓利' }).size, 0); // 實測沒優勢的詞不算
// 急售18＋屋主自售12＋實測降5%（5+10）＋同區實登-12%（25）
assert.strictEqual(c.scoreOf(new Set(['急售', '自售']), { count: 10, diff: -12 }, 5).score, 18 + 12 + 15 + 25);
// 有同社區成交就以它為準，不再看同區：-9% → 30，低於最低成交 +10
assert.strictEqual(c.scoreOf(new Set(), { count: 10, diff: -30 }, 0, { diff: -9, belowMin: true }).score, 40);

console.log('selftest OK');

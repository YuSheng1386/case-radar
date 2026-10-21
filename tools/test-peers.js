// lib/peers.js 實測：拿幾個前段候選，抓社區列表＋附近社區成交，看嚴格比較結果
//   node tools/test-peers.js [候選數=3]   （快取在 /tmp/peers-test.json）
const fs = require('fs');
const peers = require('../lib/peers');
const F = '/tmp/peers-test.json';
const cache = (() => { try { return JSON.parse(fs.readFileSync(F, 'utf8')); } catch { return {}; } })();
const data = require('../docs/data.json');

(async () => {
  console.log('社區列表', await peers.refreshList(cache), '→', cache.list?.items.length);
  const n = +(process.argv[2] || 3);
  const cands = data.cards.filter(c => !c.wide && c.comm && c.comm.url).slice(0, n);
  for (const c of cands) {
    const id = c.comm.url.split('/').pop();
    const near = peers.nearIds(id, cache);
    const t0 = Date.now();
    await peers.refreshDeals([id, ...near], cache, 40);
    fs.writeFileSync(F, JSON.stringify(cache));
    const ps = peers.compare(c, id, cache, { fallbackLevel: c.comm.med });
    console.log(`${c.community} ${c.unitPrice}萬/坪 ${c.layout} ${c.area}坪｜本社區水準 ${peers.levelOf(cache.deals[id]?.v)}｜1.5km 屋齡±5 社區 ${near.length}｜${((Date.now() - t0) / 1000).toFixed(0)}s`);
    console.log('  →', ps ? JSON.stringify(ps) : '資料不足（同等級社區 <2 或成交 <3）');
  }
})();

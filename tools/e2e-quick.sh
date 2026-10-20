#!/bin/bash
# 本機端到端測試（不碰正式 state）：暫存資料夾＋假的已知物件（讓 591 走增量模式而不是 17 分鐘全掃）
set -e
cd "$(dirname "$0")/.."
T=/tmp/radar-e2e; rm -rf $T; mkdir -p $T
cp state/market-prices.json $T/
echo '{"createdAt":"2026-01-01T00:00:00Z","sources":{},"items":{"591_0":{"first":"2026-01-01T00:00:00Z","prices":[],"d":{"sourceId":"0","price":1}}}}' > $T/tracker.json
RADAR_STATE=$T node run.js > /tmp/radar-e2e.log 2>&1
echo "EXIT=$?" >> /tmp/radar-e2e.log
node -e "
const d=require('./docs/data.json');
console.log('totals',JSON.stringify(d.totals));
console.log('run',JSON.stringify(d.run.sources));
const t={};d.cards.forEach(c=>c.tags.forEach(x=>t[x]=(t[x]||0)+1));console.log('tags',JSON.stringify(t));
console.log('有同社區比較',d.cards.filter(c=>c.comm).length,'；五區外',d.cards.filter(c=>c.wide).length);
for(const c of d.cards.slice(0,5))console.log(c.score,c.district,c.title.slice(0,24),c.price+'萬',JSON.stringify(c.why));
"

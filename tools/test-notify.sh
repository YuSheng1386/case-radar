#!/bin/bash
# tools/notify.js 本機測試：假網站（回一位測試客戶）＋乾跑，不推 LINE、不碰正式網站
# 用法：bash tools/test-notify.sh（需要 docs/data.json、docs/pool.json）
set -u
cd "$(dirname "$0")/.."
S=/tmp/nt-test; rm -rf $S; mkdir -p $S
node -e '
const http=require("http");let posted=0;
http.createServer((q,r)=>{
  if(q.url==="/api/ingest/clients"){r.end(JSON.stringify({clients:[{id:7,name:"測試客",owner_name:"我",prefs:JSON.stringify({districts:["南屯區","南區"],types:["大樓"],priceMax:1800})}],items:[]}));}
  else if(q.url==="/api/ingest/alerts"){let b="";q.on("data",d=>b+=d).on("end",()=>{posted+=JSON.parse(b).alerts.length;require("fs").writeFileSync("/tmp/nt-test/posted",String(posted));r.end("{\"ok\":true}")});}
  else{r.statusCode=404;r.end("{}");}
}).listen(8798);' &
SRV=$!; sleep 0.5
export RADAR_STATE=$S RADAR_URL=http://127.0.0.1:8798 INGEST_KEY=x
ok() { echo "  ✓ $1"; }; bad() { echo "  ✗ $1"; FAIL=1; }; FAIL=0
node tools/notify.js | grep -q '1 位，0 位有新配對' && ok "第一次：客戶建基準、不提醒" || bad "基準"
# 從基準拿掉 3 件 → 下次應該變成新配對；開發清單拿掉 2 件 → 變成新案
node -e 'const f=process.argv[1];const s=require(f);const ids=Object.keys(s.clients[7].ids);ids.slice(0,3).forEach(k=>delete s.clients[7].ids[k]);Object.keys(s.cards).slice(0,2).forEach(k=>delete s.cards[k]);require("fs").writeFileSync(f,JSON.stringify(s))' $S/notify.json
OUT=$(NOTIFY_DRY=1 node tools/notify.js)
echo "$OUT" | grep -q '1 位有新配對共 3 件' && ok "新配對 3 件" || bad "新配對：$OUT"
echo "$OUT" | grep -q '測試客：3 件' && ok "LINE 摘要含客戶新配對" || bad "摘要客戶"
echo "$OUT" | grep -q '新的可開發】2 件' && ok "LINE 摘要含新可開發 2 件" || bad "摘要開發"
[ "$(NOTIFY_DRY=1 node tools/notify.js | grep -c 'LINE 訊息預覽')" = 0 ] && ok "推過的不再推" || bad "重複推"
# 非乾跑、沒有 LINE 金鑰：寫網站
node -e 'const f=process.argv[1];const s=require(f);Object.keys(s.clients[7].ids).slice(0,2).forEach(k=>delete s.clients[7].ids[k]);require("fs").writeFileSync(f,JSON.stringify(s))' $S/notify.json
node tools/notify.js | grep -q '只寫網站不推' && [ "$(cat $S/posted)" = 2 ] && ok "沒設 LINE 時新配對寫到網站" || bad "寫網站"
kill $SRV
[ $FAIL = 0 ] && echo "全部通過"

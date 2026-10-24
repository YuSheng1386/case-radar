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
# 推播時段＋推給 2 人（假 LINE：tools/fake-line.js；NOTIFY_NOW 假裝現在幾點）
#   newcards N [分數]：開發清單拿掉 N 件（下次變新案）；給分數就把那幾件改成該分數（測特急件）
export FAKE_LINE_LOG=$S/line.log LINE_TOKEN=t LINE_TO=Ua,Ub
mkdir -p $S/docs; cp docs/data.json docs/pool.json $S/docs/ 2>/dev/null; export RADAR_DOCS=$S/docs
newcards() { node -e '
const [f,df,n,sc]=process.argv.slice(1);const s=require(f);const d=require(df);
const used=new Set([...s.pending.cards,...(s.testUsed||[])]);   // 挑沒用過的，免得跟已累積的重複（同一件不會算兩次）
const q=d.cards.filter(c=>s.cards[c.id]&&!used.has(c.id)&&c.score<85&&c.score>=60).slice(0,+n);   // 只挑 85 分以下，免得意外變特急
s.testUsed=[...(s.testUsed||[]),...q.map(c=>c.id)];
q.forEach(c=>{delete s.cards[c.id];if(sc)c.score=+sc;});
require("fs").writeFileSync(f,JSON.stringify(s));if(sc)require("fs").writeFileSync(df,JSON.stringify(d));' $S/notify.json $S/docs/data.json "$1" "${2:-}"; }
pushes() { [ -s $S/line.log ] && wc -l < $S/line.log || echo 0; }
run() { NOTIFY_NOW=$1 node -r ./tools/fake-line.js tools/notify.js 2>&1; }
newcards 2; run 2026-10-25T07:10 | grep -q '只累積' && [ "$(pushes)" = 0 ] && ok "07:10 早上 9 點前：只累積" || bad "9 點前不該推"
OUT=$(run 2026-10-25T09:20); [ "$(pushes)" = 1 ] && echo "$OUT" | grep -q '早上第一則' && grep -q 'multicast 2' $S/line.log && ok "09:20 早上第一則（multicast 2 人）" || bad "早上第一則：$OUT"
newcards 3; run 2026-10-25T11:10 | grep -q '先不推' && [ "$(pushes)" = 1 ] && ok "11:10 白天 3 件：不推" || bad "白天未滿 5 件不該推"
newcards 2; OUT=$(run 2026-10-25T13:10); [ "$(pushes)" = 2 ] && echo "$OUT" | grep -q '滿 5 件' && ok "13:10 累積到 5 件：推" || bad "滿 5 件：$OUT"
newcards 1 95; OUT=$(run 2026-10-25T15:10); [ "$(pushes)" = 3 ] && echo "$OUT" | grep -q '特急件' && ok "15:10 1 件 95 分：特急件馬上推" || bad "特急件：$OUT"
newcards 1; run 2026-10-25T17:10 >/dev/null; [ "$(pushes)" = 3 ] && ok "17:10 1 件：不推" || bad "17:10 不該推"
OUT=$(run 2026-10-25T20:15); [ "$(pushes)" = 4 ] && echo "$OUT" | grep -q '晚上收尾' && ok "20:15 晚上收尾：剩的全推" || bad "收尾：$OUT"
newcards 1 95; run 2026-10-25T21:10 | grep -q '只累積' && [ "$(pushes)" = 4 ] && ok "21:10 收尾後就算特急也只累積" || bad "收尾後不該推"
newcards 1; run 2026-10-25T23:10 | grep -q '只累積' && [ "$(pushes)" = 4 ] && ok "23:10 只累積" || bad "23 點不該推"
OUT=$(run 2026-10-26T09:05); [ "$(pushes)" = 5 ] && echo "$OUT" | grep -q '早上第一則' && ok "隔天 09:05 推昨晚累積的" || bad "隔天早上：$OUT"
run 2026-10-26T11:10 >/dev/null; [ "$(pushes)" = 5 ] && ok "沒新的不推" || bad "重複推"
kill $SRV
[ $FAIL = 0 ] && echo "全部通過"

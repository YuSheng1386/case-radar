#!/bin/bash
# tools/notify.js 本機測試：假網站（回一位測試客戶、收新案）＋乾跑，不推 LINE、不碰正式網站
#   什麼時候推 LINE 的規則在網站（web/src/pushq.mjs），那部分測 bash web/test-pushq.sh
# 用法：bash tools/test-notify.sh（需要 docs/data.json、docs/pool.json）
set -u
cd "$(dirname "$0")/.."
S=/tmp/nt-test; rm -rf $S; mkdir -p $S
node -e '
const http=require("http"),fs=require("fs");let posted=0;
http.createServer((q,r)=>{
  if(q.url==="/api/ingest/clients"){r.end(JSON.stringify({clients:[{id:7,name:"測試客",owner_name:"我",prefs:JSON.stringify({districts:["南屯區","南區"],types:["大樓"],priceMax:1800})}],items:[]}));}
  else if(q.url==="/api/ingest/alerts"){let b="";q.on("data",d=>b+=d).on("end",()=>{posted+=JSON.parse(b).alerts.length;fs.writeFileSync("/tmp/nt-test/posted",String(posted));r.end("{\"ok\":true}")});}
  // 交新案：記下這次交了幾件／幾位客戶；有 fail 檔就回 500（測交不出去會不會留著下次再交）
  else if(q.url==="/api/ingest/notify"){let b="";q.on("data",d=>b+=d).on("end",()=>{
    if(fs.existsSync("/tmp/nt-test/fail")){r.statusCode=500;return r.end("{}");}
    const j=JSON.parse(b);fs.writeFileSync("/tmp/nt-test/sent",`${j.cards.length} ${j.clients.length} ${j.test?"test":""} ${j.cards.every(c=>c.id&&c.sc!=null&&c.x)?"ok":"bad"}`);
    r.end(JSON.stringify({queued:j.cards.length,pushed:0,note:"累積中"}));});}
  else{r.statusCode=404;r.end("{}");}
}).listen(8798);' &
SRV=$!; sleep 0.5
export RADAR_STATE=$S RADAR_URL=http://127.0.0.1:8798 INGEST_KEY=x
ok() { echo "  ✓ $1"; }; bad() { echo "  ✗ $1"; FAIL=1; }; FAIL=0
sent() { cat $S/sent 2>/dev/null; }
# 開發清單拿掉 N 件 → 下次變新案；客戶基準拿掉 N 件 → 下次變新配對
dropCards() { node -e 'const [f,n]=process.argv.slice(1);const s=require(f);Object.keys(s.cards).slice(0,+n).forEach(k=>delete s.cards[k]);require("fs").writeFileSync(f,JSON.stringify(s))' $S/notify.json $1; }
dropMatch() { node -e 'const [f,n]=process.argv.slice(1);const s=require(f);Object.keys(s.clients[7].ids).slice(0,+n).forEach(k=>delete s.clients[7].ids[k]);require("fs").writeFileSync(f,JSON.stringify(s))' $S/notify.json $1; }

node tools/notify.js | grep -q '1 位，0 位有新配對' && ok "第一次：客戶建基準、不提醒" || bad "基準"
dropMatch 3; dropCards 2
OUT=$(NOTIFY_DRY=1 node tools/notify.js)
echo "$OUT" | grep -q '1 位有新配對共 3 件' && ok "新配對 3 件" || bad "新配對：$OUT"
echo "$OUT" | grep -q '測試客：3 件' && ok "LINE 預覽含客戶新配對" || bad "預覽客戶"
echo "$OUT" | grep -q '新的可開發】2 件' && ok "LINE 預覽含新可開發 2 件" || bad "預覽開發"
[ "$(NOTIFY_DRY=1 node tools/notify.js | grep -c 'LINE 訊息預覽')" = 0 ] && ok "交過的不再交" || bad "重複交"
# 非乾跑：新配對寫網站＋新案交給網站推播佇列
dropMatch 2; dropCards 2
node tools/notify.js | grep -q '網站累積 2 件' && [ "$(cat $S/posted)" = 2 ] && [ "$(sent)" = "2 1  ok" ] && ok "新配對寫網站、交 2 件＋1 位客戶給推播佇列（欄位齊）" || bad "交給網站：$(sent)"
# 網站掛了 → 留著，下次一起交（不會漏）
touch $S/fail; dropCards 1
node tools/notify.js 2>&1 | grep -q '交給網站失敗' && ok "交不出去：先留著" || bad "失敗處理"
rm $S/fail; dropCards 1
node tools/notify.js >/dev/null; [ "$(sent)" = "2 0  ok" ] && ok "下次一起交（上次 1 件＋這次 1 件）" || bad "重交：$(sent)"
# 10/27 前的舊版 state（pending 在本機）→ 升級後第一次照樣交出去
node -e 'const f=process.argv[1];const s=require(f);const ids=Object.keys(s.cards).slice(0,3);s.pending={cards:ids,clients:{}};require("fs").writeFileSync(f,JSON.stringify(s))' $S/notify.json
node tools/notify.js >/dev/null; [ "$(sent)" = "3 0  ok" ] && ok "舊版留著沒推的 3 件也交出去" || bad "舊 pending：$(sent)"
# 測試推播：沒新案也拿最近 3 件、帶 test 旗標
NOTIFY_TEST=1 node tools/notify.js >/dev/null; [ "$(sent)" = "3 0 test ok" ] && ok "測試推播：沒新案拿最近 3 件、帶 test" || bad "測試推播：$(sent)"
kill $SRV
[ $FAIL = 0 ] && echo "全部通過"

#!/bin/bash
# LINE 新案推播規則測試（web/src/pushq.mjs）：本機 wrangler dev＋假的 LINE，模擬一整天
#   用法：bash web/test-pushq.sh   （不碰正式網站、不推真的 LINE）
set -u
cd "$(dirname "$0")"
P=/tmp/wr-pushq; rm -rf $P; mkdir -p $P
PORT=8797; B=http://127.0.0.1:$PORT; LP=8796
# 假 LINE：額度 200／已用 17；推播記到 $P/line.log（推給幾人＋第二行標題）
node -e '
const http=require("http"),fs=require("fs");
http.createServer((q,r)=>{let b="";q.on("data",d=>b+=d).on("end",()=>{
  if(q.url.endsWith("/quota/consumption")){let u=17;try{u=+fs.readFileSync("'$P'/used","utf8")}catch{};return r.end(JSON.stringify({totalUsage:u}));}
  if(q.url.endsWith("/quota"))return r.end(JSON.stringify({type:"limited",value:200}));
  const j=JSON.parse(b||"{}");const t=j.messages?.[0]?.text||"";
  fs.appendFileSync("'$P'/line.log",`${q.url.split("/").pop()} ${[].concat(j.to).length}｜${t.split("\n")[1]||""}｜${(t.match(/【新的可開發】(\d+)/)||[])[1]||0}件\n`);
  r.end("{}");});}).listen('$LP');' &
FAKE=$!
printf "INGEST_KEY=k\nLINE_SECRET=s\nLINE_TOKEN=t\nLINE_ALLOW=Ua,Ub\nTEST_NOW=1\nNO_LINKCHECK=1\nLINE_API=http://127.0.0.1:$LP\n" > .dev.vars
npx wrangler d1 execute radar-db --local --persist-to $P --file=schema.sql >/dev/null 2>&1
npx wrangler dev --local --persist-to $P --port $PORT --test-scheduled > $P/dev.log 2>&1 &
DEV=$!
for i in $(seq 1 40); do curl -s $B/ >/dev/null 2>&1 && break; sleep 1; done
ok() { echo "  ✓ $1"; }; bad() { echo "  ✗ $1"; FAIL=1; }; FAIL=0
pushes() { [ -s $P/line.log ] && wc -l < $P/line.log | tr -d ' ' || echo 0; }
last() { tail -1 $P/line.log 2>/dev/null; }
# card 編號 分數 → 一件假案件
card() { echo "{\"id\":\"$1\",\"sc\":$2,\"own\":0,\"x\":\"・$2分｜南屯區 測試$1 1000萬\",\"ll\":[24.14,120.64],\"ap\":0,\"u\":\"https://example.com/$1\",\"k\":\"good\"}"; }
# add 時間 案件… ；flush 時間 原因
add() { local t=$1; shift; local cs=$(IFS=,; echo "$*"); curl -s -X POST $B/api/ingest/notify -H 'X-Ingest-Key: k' -H 'Content-Type: application/json' -d "{\"now\":\"$t\",\"cards\":[$cs]}"; }
flush() { curl -s -X POST $B/api/ingest/notify -H 'X-Ingest-Key: k' -H 'Content-Type: application/json' -d "{\"now\":\"$1\",\"flush\":\"$2\"}"; }

add 2026-10-28T07:10 "$(card a1 70)" "$(card a2 75)" >/dev/null; [ "$(pushes)" = 0 ] && ok "07:10 早上 9 點前 2 件：只累積" || bad "9 點前不該推"
add 2026-10-28T08:50 "$(card a3 96)" >/dev/null; [ "$(pushes)" = 0 ] && ok "08:50 就算 96 分也等 9 點" || bad "9 點前特急也不該推"
flush 2026-10-28T09:00 start >/dev/null; [ "$(pushes)" = 1 ] && last | grep -q 'multicast 2｜🌅.*｜3件' && ok "09:00 準點：整晚 3 件一起推給 2 人（不管幾件）" || bad "早上第一則：$(last)"
# 11/07 規則：每天只有 9 點推＋白天 85 分以上即時推（只推那幾件）；不再滿 5 件就推、20 點不收尾
add 2026-10-28T11:10 "$(card b1 70)" "$(card b2 70)" "$(card b3 70)" >/dev/null; [ "$(pushes)" = 1 ] && ok "11:10 白天 3 件：累積" || bad "白天一般件不該推"
add 2026-10-28T13:10 "$(card b3 70)" >/dev/null; add 2026-10-28T13:20 "$(card b4 70)" "$(card b5 70)" >/dev/null
[ "$(pushes)" = 1 ] && ok "13:20 累積到 5 件：不推（滿 5 件規則取消）" || bad "滿 5 件不該推：$(last)"
add 2026-10-28T14:10 "$(card c2 86)" >/dev/null
[ "$(pushes)" = 2 ] && last | grep -q '🔥.*｜1件' && ok "14:10 有 86 分：只推那 1 件（其餘 5 件留到明天）" || bad "特急件：$(last)"
P0=$(pushes); flush 2026-10-28T20:00 end >/dev/null; [ "$(pushes)" = $P0 ] && ok "20:00 不再收尾" || bad "20 點不該推：$(last)"
add 2026-10-28T21:10 "$(card f1 99)" >/dev/null; add 2026-10-28T23:30 "$(card f2 70)" >/dev/null
[ "$(pushes)" = $P0 ] && ok "21:10 99 分、23:30 一件：晚上都只累積" || bad "晚上不該推"
flush 2026-10-29T09:00 start >/dev/null; [ "$(pushes)" = $((P0 + 1)) ] && last | grep -q '🌅.*｜7件' && ok "隔天 09:00 推昨天白天＋晚上累積的 7 件（同一件不重複）" || bad "隔天早上：$(last)"
P0=$(pushes); flush 2026-10-29T09:30 start >/dev/null; [ "$(pushes)" = $P0 ] && ok "沒有累積就不推" || bad "空的也推了"
# 下架過濾：交 3 件，再告訴網站只剩 1 件還符合
add 2026-10-29T10:00 "$(card g1 70)" "$(card g2 70)" "$(card g3 70)" >/dev/null
curl -s -X POST $B/api/ingest/notify -H 'X-Ingest-Key: k' -H 'Content-Type: application/json' -d '{"now":"2026-10-29T11:00","cards":[],"qual":["g2"]}' >/dev/null
# 測試推播：只推給 1 人、正式累積不動
add 2026-10-29T22:00 "$(card h1 70)" >/dev/null
P0=$(pushes); curl -s -X POST $B/api/ingest/notify -H 'X-Ingest-Key: k' -H 'Content-Type: application/json' -d "{\"now\":\"2026-10-29T22:10\",\"test\":true,\"cards\":[$(card t1 70)]}" >/dev/null
[ "$(pushes)" = $((P0 + 1)) ] && last | grep -q '^push 1｜🧪.*｜3件' && ok "測試推播：半夜也推、只給 1 人（累積的 2 件＋測試的）" || bad "測試推播：$(last)"
P0=$(pushes); flush 2026-10-30T09:00 start >/dev/null; last | grep -q '🌅.*｜2件' && ok "下架的拿掉（3 件剩 g2）＋測試件沒進正式累積（早上推 g2、h1）" || bad "下架過濾／測試推播：$(last)"
# 額度：本月剩 12 則（2 人）→ 特急件要先留「月底前每天早上」的份，不推；早上那則照推
echo 188 > $P/used
P0=$(pushes); add 2026-10-30T10:00 "$(card k1 90)" >/dev/null; [ "$(pushes)" = $P0 ] && ok "額度快用完：特急件先不推（留給之後每天早上）" || bad "額度不夠還推特急：$(last)"
flush 2026-10-31T09:00 start >/dev/null; [ "$(pushes)" = $((P0 + 1)) ] && last | grep -q '🌅.*｜1件' && ok "隔天早上那則照推（含沒推出去的特急件）" || bad "早上那則被額度擋：$(last)"
echo 17 > $P/used
# 準點觸發（Worker 定時）：/__scheduled 模擬 09:00 的 cron
add 2026-10-30T07:00 "$(card s1 70)" >/dev/null; P0=$(pushes)
curl -s "$B/__scheduled?cron=0+12+*+*+*" >/dev/null; sleep 2
[ "$(pushes)" = $P0 ] && ok "Worker 20 點定時觸發不再推" || bad "20 點定時觸發推了"
curl -s "$B/__scheduled?cron=0+1+*+*+*" >/dev/null; sleep 2
[ "$(pushes)" = $((P0 + 1)) ] && ok "Worker 定時觸發（cron 0 1 * * *＝台灣 9 點）會推" || bad "定時觸發沒推"
grep -iE "error|exception" $P/dev.log | grep -v "api.line.me" | head -3
kill $DEV $FAKE 2>/dev/null; rm -f .dev.vars
[ $FAIL = 0 ] && echo "全部通過" || { echo "有失敗，看 $P/dev.log、$P/line.log"; exit 1; }

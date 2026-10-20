#!/bin/bash
# 本機端到端測試（wrangler dev，本機 D1/KV，測試用金鑰與帳號，不碰正式網站）
# 用法：bash web/test-local.sh
set -u
cd "$(dirname "$0")"
P=/tmp/wr-test; rm -rf $P; mkdir -p $P
PORT=8799; B=http://127.0.0.1:$PORT
printf 'INGEST_KEY=test-ingest-key\nSETUP_CODE=test-setup\n' > .dev.vars
npx wrangler d1 execute radar-db --local --persist-to $P --file=schema.sql >/dev/null 2>&1
npx wrangler dev --local --persist-to $P --port $PORT > /tmp/wr-dev.log 2>&1 &
DEV=$!
for i in $(seq 1 30); do curl -s $B/api/setup >/dev/null 2>&1 && break; sleep 1; done
ok() { echo "  ✓ $1"; }; bad() { echo "  ✗ $1"; FAIL=1; }; FAIL=0
J=/tmp/wr-cookies; rm -f $J

echo "1. 第一次設定與登入"
[ "$(curl -s $B/api/setup)" = '{"needed":true}' ] && ok "需要設定" || bad "setup 狀態"
curl -s -X POST $B/api/setup -H 'Content-Type: application/json' -d '{"code":"wrong","username":"t","name":"T","password":"12345678"}' | grep -q 設定碼不對 && ok "錯的設定碼被擋" || bad "錯設定碼"
curl -s -X POST $B/api/setup -H 'Content-Type: application/json' -d '{"code":"test-setup","username":"tester","name":"測試員","password":"test-pass-123"}' | grep -q ok && ok "建立管理者" || bad "建立管理者"
curl -s -X POST $B/api/setup -H 'Content-Type: application/json' -d '{"code":"test-setup","username":"x","name":"X","password":"12345678"}' | grep -q 已經設定過 && ok "第二次設定被擋" || bad "重複設定"
curl -s -o /dev/null -w '%{http_code}' $B/api/me | grep -q 401 && ok "未登入 401" || bad "未登入應 401"
curl -s -X POST $B/api/login -H 'Content-Type: application/json' -d '{"username":"tester","password":"nope"}' | grep -q 錯誤 && ok "錯密碼被擋" || bad "錯密碼"
curl -s -c $J -X POST $B/api/login -H 'Content-Type: application/json' -d '{"username":"tester","password":"test-pass-123"}' | grep -q ok && ok "登入" || bad "登入"
curl -s -b $J $B/api/me | grep -q tester && ok "/api/me" || bad "/api/me"

echo "2. 上傳案件資料（模擬 GitHub Actions）並讀回"
cd ..
RADAR_URL=$B INGEST_KEY=wrong node tools/sync.js push >/dev/null 2>&1 && bad "錯金鑰竟可上傳" || ok "錯金鑰上傳被擋"
RADAR_STATE=/tmp/radar-seed2 RADAR_URL=$B INGEST_KEY=test-ingest-key node tools/sync.js push 2>&1 | grep -q pool && ok "上傳 cards/pool/state" || bad "上傳"
cd web
N=$(curl -s -b $J --compressed $B/api/blob/pool | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).items.length)}catch(e){console.log('ERR '+s.slice(0,80))}})")
[[ "$N" =~ ^[0-9]+$ ]] && ok "讀案件池 $N 筆（gzip 解壓正常）" || bad "讀案件池：$N"
curl -s -o /dev/null -w '%{http_code}' $B/api/blob/pool | grep -q 401 && ok "未登入讀不到案件池" || bad "案件池未保護"
ITEM=$(curl -s -b $J --compressed $B/api/blob/pool | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).items;console.log(JSON.stringify(p.slice(0,3).map(x=>({id:x.id,t:x.t,d:x.d,a:x.a,c:x.c,p:x.p,ar:x.ar,fl:x.fl}))))})")

echo "3. 客戶、分享、客人反應、帶看"
CID=$(curl -s -b $J -X POST $B/api/clients -H 'Content-Type: application/json' -d '{"name":"測試客戶","prefs":{"districts":["南屯區"]}}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
[[ "$CID" =~ ^[0-9]+$ ]] && ok "建客戶 id=$CID" || bad "建客戶"
SH=$(curl -s -b $J -X POST $B/api/clients/$CID/share -H 'Content-Type: application/json' -d "{\"title\":\"測試\",\"items\":$ITEM}")
TOK=$(echo "$SH" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
[[ "$TOK" =~ ^[a-f0-9]{24}$ ]] && ok "分享連結 $TOK" || bad "分享：$SH"
curl -s -o /dev/null -w '%{http_code}' $B/s/$TOK | grep -q 200 && ok "分享頁 HTML" || bad "分享頁"
I1=$(echo "$ITEM" | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].id'); I2=$(echo "$ITEM" | node -pe 'JSON.parse(require("fs").readFileSync(0))[1].id')
curl -s $B/api/share/$TOK | grep -q '"items"' && ok "客人讀分享內容（免登入）" || bad "讀分享"
curl -s -X POST $B/api/share/$TOK/react -H 'Content-Type: application/json' -d "{\"item_id\":\"$I1\",\"reaction\":\"visit\"}" | grep -q ok && ok "客人按想去看" || bad "想去看"
curl -s -X POST $B/api/share/$TOK/react -H 'Content-Type: application/json' -d "{\"item_id\":\"$I2\",\"reaction\":\"dislike\",\"reasons\":[\"社區/建案不喜歡\"],\"note\":\"<script>x</script>\"}" | grep -q ok && ok "客人按不喜歡＋原因" || bad "不喜歡"
curl -s -X POST $B/api/share/$TOK/react -H 'Content-Type: application/json' -d '{"item_id":"not-in-list","reaction":"like"}' | grep -q 不在 && ok "清單外的案件不能按" || bad "清單外"
curl -s -b $J $B/api/visits | grep -q visit_req && ok "帶看待辦出現「想去看」" || bad "帶看待辦"
curl -s -b $J -X PUT $B/api/clients/$CID/items/$I1 -H 'Content-Type: application/json' -d '{"status":"booked","visit_at":"2026-10-25T14:00"}' | grep -q ok && ok "改成已約帶看" || bad "約帶看"
curl -s -X POST $B/api/share/$TOK/react -H 'Content-Type: application/json' -d "{\"item_id\":\"$I1\",\"reaction\":\"dislike\"}" | grep -q kept && ok "已約後客人按鈕不會倒退狀態" || bad "狀態倒退"

echo "4. 權限：成員只看自己的客戶"
curl -s -b $J -X POST $B/api/users -H 'Content-Type: application/json' -d '{"username":"member1","name":"成員一","password":"member-pass-1"}' | grep -q ok && ok "管理者建成員" || bad "建成員"
J2=/tmp/wr-cookies2; rm -f $J2
curl -s -c $J2 -X POST $B/api/login -H 'Content-Type: application/json' -d '{"username":"member1","password":"member-pass-1"}' >/dev/null
[ "$(curl -s -b $J2 $B/api/clients)" = "[]" ] && ok "成員看不到管理者的客戶" || bad "成員看到別人客戶"
curl -s -b $J2 $B/api/clients/$CID/items | grep -q 沒有權限 && ok "成員不能讀別人客戶紀錄" || bad "越權讀取"
curl -s -b $J2 $B/api/users | grep -q 只有管理者 && ok "成員不能管帳號" || bad "成員管帳號"
curl -s -b $J2 -X PUT $B/api/dev/$I1 -H 'Content-Type: application/json' -d '{"status":"已聯絡","note":"t"}' | grep -q ok && ok "成員可更新開發進度" || bad "開發進度"
curl -s -b $J $B/api/dev | grep -q 成員一 && ok "管理者看得到誰在跟" || bad "開發進度共用"

echo "5. 登入鎖定"
for i in $(seq 1 8); do curl -s -X POST $B/api/login -H 'Content-Type: application/json' -d '{"username":"member1","password":"bad"}' >/dev/null; done
curl -s -X POST $B/api/login -H 'Content-Type: application/json' -d '{"username":"member1","password":"member-pass-1"}' | grep -q 太多次 && ok "連錯 8 次鎖 15 分鐘" || bad "沒有鎖定"

kill $DEV 2>/dev/null; wait $DEV 2>/dev/null
rm -f .dev.vars
echo; [ $FAIL = 0 ] && echo "全部通過" || { echo "有失敗，wrangler 日誌："; grep -iE "error|exception" /tmp/wr-dev.log | head -20; }

#!/bin/bash
# 本機測 LINE webhook（wrangler dev，本機 KV；回覆會打到 LINE 但用假 token，所以只驗收／擋與資料讀取）
# 用法：bash web/test-line.sh
set -u
cd "$(dirname "$0")"
P=/tmp/wr-line; rm -rf $P; mkdir -p $P
PORT=8798; B=http://127.0.0.1:$PORT
printf 'INGEST_KEY=k\nLINE_SECRET=s\nLINE_TOKEN=t\nLINE_ALLOW=Utest\n' > .dev.vars
npx wrangler d1 execute radar-db --local --persist-to $P --file=schema.sql >/dev/null 2>&1   # LINE 索引存 D1 blobs
npx wrangler dev --local --persist-to $P --port $PORT > /tmp/wr-line.log 2>&1 &
DEV=$!
for i in $(seq 1 30); do curl -s $B/ >/dev/null 2>&1 && break; sleep 1; done
ok() { echo "  ✓ $1"; }; bad() { echo "  ✗ $1"; FAIL=1; }; FAIL=0
(cd .. && RADAR_URL=$B INGEST_KEY=k node tools/line-index.js) 2>&1 | grep -q 失敗 && bad "上傳索引" || ok "上傳 LINE 索引"
curl -s -H 'X-Ingest-Key: k' $B/api/ingest/blob/line-meta | grep -q '"districts"' && ok "索引存進 D1、讀得回來" || bad "D1 讀不到索引"
sig() { printf '%s' "$1" | openssl dgst -sha256 -hmac s -binary | base64; }
EV='{"events":[{"type":"message","replyToken":"r","source":{"userId":"Utest"},"message":{"type":"text","text":"東區優質透天"}}]}'
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/line/webhook -H 'x-line-signature: bad' -d "$EV")" = 401 ] && ok "錯簽章 401" || bad "錯簽章沒擋"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/line/webhook -H "x-line-signature: $(sig "$EV")" -d "$EV")" = 200 ] && ok "正確簽章 200（查詢＋回覆）" || bad "正確簽章失敗"
EV2='{"events":[{"type":"message","replyToken":"r","source":{"userId":"Ux"},"message":{"type":"text","text":"太平"}}]}'
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/line/webhook -H "x-line-signature: $(sig "$EV2")" -d "$EV2")" = 200 ] && ok "名單外的人 200（只回 ID）" || bad "名單外"
grep -iE "error|exception" /tmp/wr-line.log | grep -v "api.line.me" | head -3
kill $DEV 2>/dev/null; rm -f .dev.vars
[ $FAIL = 0 ] && echo "全部通過" || { echo "有失敗，看 /tmp/wr-line.log"; exit 1; }

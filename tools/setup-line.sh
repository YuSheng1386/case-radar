#!/bin/bash
# 案件雷達專用 LINE 官方帳號（跟 NBA 那個分開）。金鑰不會印在畫面上。在 WSL 跑：
#   cd /home/YuSheng/仲介開發/radar && bash tools/setup-line.sh
# 先在 LINE Developers 建好新的 Messaging API channel（步驟見 交接.md「LINE 官方帳號」）
# 做的事：
#   1. Channel secret／access token → 網站（LINE_SECRET、LINE_TOKEN）＋ GitHub（LINE_TOKEN，推播用）
#   2. 自動把 webhook 網址設成網站 /api/line/webhook 並開啟
#   3. 你傳一句話給新帳號 → 它回你的 LINE ID → 貼回來 → 網站查詢名單（LINE_ALLOW）＋ GitHub 推播對象（LINE_TO）
#   之後要加同事：bash tools/setup-line.sh allow <你的ID>,<同事ID>
set -e
cd "$(dirname "$0")/.."
GH=~/.local/bin/gh; R=YuSheng1386/case-radar
SITE=https://case-radar.yusheng1386.workers.dev

allow() {
  printf '%s' "$1" | (cd web && npx wrangler secret put LINE_ALLOW >/dev/null)
  printf '%s' "${1%%,*}" | $GH secret set LINE_TO -R $R
  echo "✓ 查詢名單 $(echo "$1" | tr ',' '\n' | wc -l) 人；推播對象＝第一個 ID"
}
if [ "$1" = allow ]; then allow "$2"; exit; fi

read -rsp 'Channel secret（Basic settings 頁）：' SECRET; echo
read -rsp 'Channel access token（Messaging API 頁，long-lived）：' TOKEN; echo
printf '%s' "$SECRET" | (cd web && npx wrangler secret put LINE_SECRET >/dev/null)
printf '%s' "$TOKEN" | (cd web && npx wrangler secret put LINE_TOKEN >/dev/null)
printf '%s' "$TOKEN" | $GH secret set LINE_TOKEN -R $R
echo "✓ LINE_SECRET／LINE_TOKEN（網站）、LINE_TOKEN（GitHub）"

curl -sf -X PUT https://api.line.me/v2/bot/channel/webhook/endpoint -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"endpoint\":\"$SITE/api/line/webhook\"}" >/dev/null
curl -s -X POST https://api.line.me/v2/bot/channel/webhook/test -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}' | grep -q '"success":true' && echo "✓ webhook 已設好並測試通過" \
  || echo "⚠ webhook 測試沒過：到 LINE Developers → Messaging API → Webhook 按 Verify 看原因，並確認 Use webhook 有打開"

echo
echo "現在用手機加新帳號好友，傳任何一句話，它會回「你的 LINE ID：U…」"
read -rp '把那串 ID 貼上（多人用逗號分隔，第一個收推播）：' IDS
allow "$IDS"
echo "完成。傳「說明」給新帳號看可以怎麼查；下次排程跑完推播就會改從新帳號發。"

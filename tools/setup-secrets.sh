#!/bin/bash
# 一次設好雲端需要的秘密值（金鑰都不會印在畫面上）。在 WSL 跑：
#   cd /home/YuSheng/仲介開發/radar && bash tools/setup-secrets.sh
# 做的事：
#   1. LINE_TOKEN／LINE_TO：從 land-dev 的 LINE bot 設定放進 GitHub Secret（雲端推 LINE 用）
#   2. BACKUP_PASS：產生備份加密密碼，本機存 web/.backup-pass（要自己另外保存一份！遺失就解不開備份），放進 GitHub Secret
#   3. INGEST_KEY：重新產生上傳金鑰，同時更新網站（Cloudflare）、GitHub Secret、本機 web/.ingest-key
#      （10/21 發現本機那份已經對不上網站，雲端那份沒問題但讀不回來）
set -e
cd "$(dirname "$0")/.."
GH=~/.local/bin/gh; R=YuSheng1386/case-radar
CFG=/home/uheng/land-dev/data/config.json

node -e "process.stdout.write(require('$CFG').line.channelAccessToken)" | $GH secret set LINE_TOKEN -R $R
node -e "process.stdout.write(require('$CFG').line.allowedUserIds[0])" | $GH secret set LINE_TO -R $R
echo "✓ LINE_TOKEN／LINE_TO"

if [ ! -s web/.backup-pass ]; then (umask 077; openssl rand -base64 32 | tr -d '\n' > web/.backup-pass); fi
$GH secret set BACKUP_PASS -R $R < web/.backup-pass
echo "✓ BACKUP_PASS（本機 web/.backup-pass，請另存一份到安全的地方）"

(umask 077; openssl rand -hex 32 | tr -d '\n' > web/.ingest-key.new)
(cd web && npx wrangler secret put INGEST_KEY < .ingest-key.new >/dev/null)
$GH secret set INGEST_KEY -R $R < web/.ingest-key.new
mv web/.ingest-key.new web/.ingest-key
echo "✓ INGEST_KEY 已更新（網站、GitHub、本機一致）"
$GH secret list -R $R

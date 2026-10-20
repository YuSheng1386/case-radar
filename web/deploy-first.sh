#!/bin/bash
# 第一次部署：建表、產生金鑰（存本機，不印出來）、上線、把金鑰設到 GitHub
set -e
cd "$(dirname "$0")"
npx wrangler d1 execute radar-db --remote --file=schema.sql 2>&1 | grep -E "Executed|error|ERROR" || true

INGEST=$(openssl rand -hex 32)
SETUP=$(openssl rand -hex 6)
umask 077
echo "$SETUP" > .setup-code.txt
echo "$INGEST" | npx wrangler secret put INGEST_KEY 2>&1 | grep -E "Success|error|ERROR" || true
echo "$SETUP"  | npx wrangler secret put SETUP_CODE 2>&1 | grep -E "Success|error|ERROR" || true

npx wrangler deploy 2>&1 | grep -E "https://|Uploaded|error|ERROR|subdomain" || true

URL=$(npx wrangler deployments list 2>/dev/null | grep -o 'https://[^ ]*workers.dev' | head -1)
echo "URL=$URL"
echo "$INGEST" | ~/.local/bin/gh secret set INGEST_KEY -R YuSheng1386/case-radar
echo "$URL"    | ~/.local/bin/gh secret set RADAR_URL -R YuSheng1386/case-radar
echo "GitHub secrets set"

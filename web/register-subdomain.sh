#!/bin/bash
# 註冊帳號的 workers.dev 子網域（一次性），用 wrangler 登入的 OAuth token
ACC=a13e851a05f9036da2f8e4f82b6e1178
SUB=${1:-yusheng1386}
TOKEN=$(grep -o 'oauth_token = "[^"]*"' ~/.config/.wrangler/config/default.toml | cut -d'"' -f2)
[ -z "$TOKEN" ] && { echo "找不到 wrangler token"; exit 1; }
curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACC/workers/subdomain" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data "{\"subdomain\":\"$SUB\"}" | head -c 400; echo

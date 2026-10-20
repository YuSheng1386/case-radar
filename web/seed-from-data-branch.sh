#!/bin/bash
# 一次性搬家：把 GitHub 公開 data 分支上的追蹤狀態搬到 Cloudflare，並用新程式重算案件清單／案件池後上傳
set -e
cd "$(dirname "$0")"
umask 077
# 上傳金鑰：換一把新的，本機留存（web/.ingest-key，已 gitignore），同步設到 Worker 與 GitHub
INGEST=$(openssl rand -hex 32)
echo "$INGEST" > .ingest-key
echo "$INGEST" | npx wrangler secret put INGEST_KEY 2>&1 | grep -E "Success|ERROR" || true
echo "$INGEST" | ~/.local/bin/gh secret set INGEST_KEY -R YuSheng1386/case-radar

T=/tmp/radar-seed; rm -rf $T
git clone -q --depth 1 --branch data https://github.com/YuSheng1386/case-radar.git $T
ls -la $T | grep json
cd ..
cp state/kw-study.json $T/ 2>/dev/null || true
RADAR_STATE=$T RADAR_SKIP=591,591全市 node run.js 2>&1 | tail -3
RADAR_STATE=$T RADAR_URL=https://case-radar.yusheng1386.workers.dev INGEST_KEY=$INGEST node tools/sync.js push

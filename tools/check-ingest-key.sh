#!/bin/bash
# 檢查本機 web/.ingest-key 是否跟網站一致（200 = 一致，401 = 不一致）
K=$(cat "$(dirname "$0")/../web/.ingest-key")
curl -s -o /dev/null -w "upload key check: %{http_code}\n" -H "X-Ingest-Key: $K" \
  https://case-radar.yusheng1386.workers.dev/api/ingest/blob/state-community

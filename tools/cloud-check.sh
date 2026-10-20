#!/bin/bash
# 看雲端某次執行各來源筆數與網頁是否上線：bash tools/cloud-check.sh [run id]
GH=~/.local/bin/gh; R=YuSheng1386/case-radar
id=${1:-$($GH run list -R $R -w radar.yml -L1 --json databaseId --jq '.[0].databaseId')}
$GH run view "$id" -R $R --log 2>&1 | grep -E '\{"ok"|\[同體系\]|完成：' | sed 's/^.*Z //' | cut -c1-220 | head -20
echo "page: $(curl -s -o /dev/null -w '%{http_code}' https://yusheng1386.github.io/case-radar/)"
curl -s https://yusheng1386.github.io/case-radar/data.json | head -c 200; echo

#!/bin/bash
# 等最近一次指定 workflow 跑完並印出結果：bash tools/watch-run.sh probe.yml
GH=~/.local/bin/gh
R=YuSheng1386/case-radar
WF=${1:-radar.yml}
id=$($GH run list -R $R -w "$WF" -L1 --json databaseId --jq '.[0].databaseId')
$GH run watch "$id" -R $R --exit-status > /dev/null 2>&1
echo "結論: $($GH run view "$id" -R $R --json conclusion --jq .conclusion)"
$GH run view "$id" -R $R --log 2>&1 | grep -E "${2:-OK  |FAIL|完成|失敗|\[591\]|\[同體系\]|Error}" | sed 's/^.*Z //' | tail -40

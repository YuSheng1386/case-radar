#!/bin/bash
# 等最新一次雷達排程跑完，印結果與重點：bash tools/watch-latest.sh
GH=~/.local/bin/gh; R=YuSheng1386/case-radar
ID=$($GH run list -R $R -w radar.yml -L 1 --json databaseId -q '.[0].databaseId')
$GH run watch "$ID" -R $R >/dev/null 2>&1
$GH run view "$ID" -R $R --json conclusion -q .conclusion
$GH run view "$ID" -R $R --log 2>/dev/null | grep -E 'LINE 索引|完成：|失敗' | sed 's/^.*Z //'

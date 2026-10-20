#!/bin/bash
# 把本機 LINE bot 設定（land-dev config.json）放進 GitHub Secret，讓雲端排程能推 LINE
# 用法（WSL）：bash tools/set-line-secret.sh   — 金鑰不會印在畫面上
set -e
CFG=/home/uheng/land-dev/data/config.json
GH=~/.local/bin/gh
node -e "process.stdout.write(require('$CFG').line.channelAccessToken)" | $GH secret set LINE_TOKEN -R YuSheng1386/case-radar
node -e "process.stdout.write(require('$CFG').line.allowedUserIds[0])" | $GH secret set LINE_TO -R YuSheng1386/case-radar
$GH secret list -R YuSheng1386/case-radar

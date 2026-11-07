#!/bin/bash
# 把本機同體系店家名單（stores.local.json）寫進 GitHub Secret EXCLUDED_STORES（雲端排程才會用新名單）
# 用戶自己跑（Claude 自動模式不准寫 Secret）。PowerShell：
#   wsl -d Ubuntu --cd /home/YuSheng/仲介開發/radar -- bash -lc "bash tools/set-stores-secret.sh"
cd "$(dirname "$0")/.."
node -e 'process.stdout.write(JSON.stringify(require("./stores.local.json")))' | ~/.local/bin/gh secret set EXCLUDED_STORES -R YuSheng1386/case-radar && echo "已更新 EXCLUDED_STORES"

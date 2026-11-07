#!/bin/bash
# 11/07 起不用跑了：管理者選單改成「上排管理＋下面使用規則」合併版，網站自己裝（web/src/rules.mjs ensureMenus）
#   改版面：web/src/menus.mjs（admin）→ python3 tools/friends-menu.py 重畫圖 → 把 admin.ver 改掉 → 部署
#   部署後收到下一則 LINE 訊息（或早上 9 點定時）就會換上新選單
#   舊做法（只有 4 格管理、會蓋掉合併版）已停用，避免誤跑
echo "管理者選單現在由網站自動安裝，不用跑這支（說明見 tools/admin-menu.sh 開頭）"

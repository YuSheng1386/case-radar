#!/bin/bash
# 等本機雷達跑完（log 出現 EXIT=），印出重點行
LOG=${1:-/tmp/radar-full.log}
until grep -q "EXIT=" "$LOG"; do sleep 20; done
grep -E "^\[(591|5168|信義|住商|東森|同體系)\]|完成|EXIT=|Error|失敗|錯誤" "$LOG" | grep -v "詳細頁 [0-9]" | tail -40

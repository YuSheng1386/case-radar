#!/bin/bash
# 10/24 一次性：正式 D1 加 blobs 表（LINE 索引／地圖／翻頁／地點快取改存這裡，不吃 KV 每天 1000 次寫入）
cd "$(dirname "$0")"
npx wrangler d1 execute radar-db --remote --command "CREATE TABLE IF NOT EXISTS blobs (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER)" 2>&1 | grep -vE 'npm notice|update to the latest' | tail -4

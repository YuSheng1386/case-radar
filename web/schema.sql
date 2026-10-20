-- 案件雷達網站資料庫（Cloudflare D1）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',      -- admin | member
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);

-- 客戶（買方）：prefs = 客需 JSON
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  contact TEXT DEFAULT '',
  note TEXT DEFAULT '',
  prefs TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 客戶 × 案件 的進度：sent 已推送 / liked 喜歡 / disliked 不喜歡 / visit_req 想去看
--                    / booked 已約帶看 / visited 已帶看 / offer 出價斡旋 / dropped 放棄
CREATE TABLE IF NOT EXISTS client_items (
  client_id INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL,
  reasons TEXT DEFAULT '',                  -- 不喜歡的原因（逗號分隔）
  note TEXT DEFAULT '',
  visit_at TEXT DEFAULT '',
  snapshot TEXT NOT NULL,                   -- 推送當下的案件內容（案件下架後還看得到）
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (client_id, item_id)
);

-- 分享給客人的連結（不用登入）
CREATE TABLE IF NOT EXISTS shares (
  token TEXT PRIMARY KEY,
  client_id INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  title TEXT DEFAULT '',
  item_ids TEXT NOT NULL,                   -- JSON 陣列
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- 開發進度（屋主端）：大家共用，避免同事撞案
CREATE TABLE IF NOT EXISTS dev_status (
  item_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,                     -- 未聯絡 已聯絡 約見面 簽委託 放棄
  user_id INTEGER NOT NULL,
  note TEXT DEFAULT '',
  snapshot TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 登入失敗紀錄：15 分鐘內同帳號或同 IP 失敗 8 次就暫停
CREATE TABLE IF NOT EXISTS login_fails (
  username TEXT,
  ip TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients(owner_id);
CREATE INDEX IF NOT EXISTS idx_ci_status ON client_items(status);
CREATE INDEX IF NOT EXISTS idx_shares_client ON shares(client_id);

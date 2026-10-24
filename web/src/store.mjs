// 寫入頻繁的小資料改存 D1 表 blobs（10/24：KV 免費方案每天只能寫 1000 次，LINE 索引一次排程就要寫 ~220 次會爆；D1 每天 10 萬列）
//   LINE 索引 line-*、查詢地圖 map-*、翻頁 lq-*、地點快取 geo-*；案件清單／爬蟲狀態（每次排程 10 次）仍在 KV
//   用法跟 KV 一樣：get(k, 'json'|'text')、put(k, 字串, { expirationTtl: 秒 })
export function store(env) {
  return {
    async get(k, type = 'text') {
      const r = await env.DB.prepare('SELECT v, exp FROM blobs WHERE k = ?').bind(k).first();
      if (!r || (r.exp && r.exp < Date.now() / 1000)) return null;
      return type === 'json' ? JSON.parse(r.v) : r.v;
    },
    async put(k, v, opt = {}) {
      const exp = opt.expirationTtl ? Math.floor(Date.now() / 1000) + opt.expirationTtl : null;
      await env.DB.prepare('INSERT INTO blobs (k, v, exp) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp')
        .bind(k, v, exp).run();
    },
    // 過期的清掉（排程上傳 line-meta 時順便做）
    async sweep() { await env.DB.prepare('DELETE FROM blobs WHERE exp IS NOT NULL AND exp < ?').bind(Math.floor(Date.now() / 1000)).run(); }
  };
}

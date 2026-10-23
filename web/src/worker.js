// 案件雷達網站（Cloudflare Worker）
//   登入後：開發系統（案件清單＋開發進度）、客戶（客需＋配對＋分享）、帶看、帳號管理
//   公開：客人分享頁 /s/<token>（喜歡／不喜歡／想去看）
//   GitHub Actions：/api/ingest/*（帶 X-Ingest-Key）上傳案件資料與爬蟲狀態
// 注意：免費方案每次請求 CPU 約 10ms → 大檔（案件池）一律原封不動串流，不在這裡解析

import { webhook as lineWebhook } from './line.mjs';
import { geocode } from './geo.mjs';

const SESSION_DAYS = 30;
const PBKDF2_ITER = 20000;
const BLOB_NAMES = /^(cards|pool|state-[a-z0-9-]+|backup-w[0-7]|line-(meta|roads|(?:x|p|px|pt)?\d{1,2}))$/;
const CLIENT_STATUSES = ['sent', 'liked', 'disliked', 'visit_req', 'booked', 'visited', 'offer', 'dropped'];
const DEV_STATUSES = ['未聯絡', '已聯絡', '約見面', '簽委託', '放棄'];

// ---------- 小工具 ----------
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
const err = (msg, status = 400) => json({ error: msg }, status);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));

async function hashPassword(password, saltHex) {
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256);
  return hex(bits);
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function cookie(req, name) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

const sessionCookie = (token, maxAge) =>
  `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

function validPassword(p) {
  return typeof p === 'string' && p.length >= 8;
}

// ---------- 登入狀態 ----------
async function currentUser(req, env) {
  const token = cookie(req, 'sid');
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.id, u.username, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`
  ).bind(token).first();
}

async function canAccessClient(env, user, clientId) {
  const c = await env.DB.prepare('SELECT id, owner_id FROM clients WHERE id = ? AND active = 1').bind(clientId).first();
  if (!c) return null;
  return user.role === 'admin' || c.owner_id === user.id ? c : null;
}

// ---------- 路由 ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    const m = req.method;
    let r0;
    try {
      // 分享頁（公開）
      if (m === 'GET' && /^\/s\/[a-f0-9]{24}$/.test(p)) {
        // 注意要用 /share 不是 /share.html：靜態檔服務會把 .html 307 轉址到 /share，客人就拿不到 token
        return env.ASSETS.fetch(new Request(new URL('/share', url), req));
      }
      // LINE 查詢結果地圖（公開、連結本身就是鑰匙，14 天失效）：頁面 /m/<token>，資料 /api/map/<token>
      if (m === 'GET' && /^\/m\/[a-f0-9]{24}$/.test(p)) return env.ASSETS.fetch(new Request(new URL('/map', url), req));
      if (m === 'GET' && (r0 = p.match(/^\/api\/map\/([a-f0-9]{24})$/))) {
        const v = await env.BLOBS.get(`map-${r0[1]}`, 'text');
        return v ? new Response(v, { headers: { 'Content-Type': 'application/json; charset=utf-8' } }) : err('地圖連結已失效', 404);
      }
      // LINE 官方帳號對話查詢（LINE 平台打過來，用 LINE_SECRET 驗簽）
      if (p === '/api/line/webhook' && m === 'POST') return await lineWebhook(req, env);
      if (p.startsWith('/api/')) return await api(req, env, url, p, m);
      return env.ASSETS.fetch(req);
    } catch (e) {
      return err('伺服器錯誤：' + e.message, 500);
    }
  }
};

async function api(req, env, url, p, m) {
  let r;

  // ===== GitHub Actions 上傳／下載（INGEST_KEY）=====
  if ((r = p.match(/^\/api\/ingest\/blob\/([\w-]+)$/))) {
    if (!env.INGEST_KEY || !safeEqual(req.headers.get('X-Ingest-Key') || '', env.INGEST_KEY)) return err('unauthorized', 401);
    const name = r[1];
    if (!BLOB_NAMES.test(name)) return err('bad name');
    if (m === 'PUT') {
      await env.BLOBS.put(name, req.body, { metadata: { at: new Date().toISOString(), size: Number(req.headers.get('Content-Length') || 0) } });
      return json({ ok: true });
    }
    if (m === 'GET') {
      const v = await env.BLOBS.get(name, 'stream');
      return v ? new Response(v, { headers: { 'Content-Type': 'application/octet-stream' } }) : err('not found', 404);
    }
  }

  // GitHub Actions 算新配對用：客需＋客人反應（tools/notify.js；Actions 日誌是公開的，那邊不印任何客戶資料）
  if (p === '/api/ingest/clients' && m === 'GET') {
    if (!env.INGEST_KEY || !safeEqual(req.headers.get('X-Ingest-Key') || '', env.INGEST_KEY)) return err('unauthorized', 401);
    const [cs, its] = await env.DB.batch([
      env.DB.prepare('SELECT c.id, c.name, c.prefs, u.name AS owner_name FROM clients c JOIN users u ON u.id = c.owner_id WHERE c.active = 1'),
      env.DB.prepare('SELECT ci.client_id, ci.item_id, ci.status, ci.reasons, ci.snapshot FROM client_items ci JOIN clients c ON c.id = ci.client_id WHERE c.active = 1')
    ]);
    return json({ clients: cs.results, items: its.results });
  }
  // 每週備份（tools/backup.js 在 Actions 加密後存回 KV backup-w0..7 輪替）：客戶相關資料，不含密碼雜湊與登入狀態
  if (p === '/api/ingest/backup' && m === 'GET') {
    if (!env.INGEST_KEY || !safeEqual(req.headers.get('X-Ingest-Key') || '', env.INGEST_KEY)) return err('unauthorized', 401);
    const T = ['clients', 'client_items', 'shares', 'dev_status', 'same_override', 'match_alerts'];
    const rs = await env.DB.batch([...T.map(t => env.DB.prepare(`SELECT * FROM ${t}`)),
      env.DB.prepare('SELECT id, username, name, role, active, created_at FROM users')]);
    return json({ at: new Date().toISOString(), tables: Object.fromEntries([...T, 'users'].map((t, i) => [t, rs[i].results])) });
  }
  // 雷達讀「同體系比對錯了」清單（只有案件 id，沒有個資）
  if (p === '/api/ingest/overrides' && m === 'GET') {
    if (!env.INGEST_KEY || !safeEqual(req.headers.get('X-Ingest-Key') || '', env.INGEST_KEY)) return err('unauthorized', 401);
    return json((await env.DB.prepare('SELECT item_id FROM same_override').all()).results.map(x => x.item_id));
  }
  // 推播用地圖（tools/notify.js 新案件）：存 KV map-<token> 14 天，回傳 token；頁面 /m/<token>
  if (p === '/api/ingest/map' && m === 'POST') {
    if (!env.INGEST_KEY || !safeEqual(req.headers.get('X-Ingest-Key') || '', env.INGEST_KEY)) return err('unauthorized', 401);
    const b = await body(req);
    const tok = randHex(12);
    await env.BLOBS.put(`map-${tok}`, JSON.stringify({ t: String(b.t || '').slice(0, 100), at: b.at, n: +b.n || 0, c: null, r: null,
      items: (b.items || []).slice(0, 200) }), { expirationTtl: 14 * 86400 });
    return json({ token: tok });
  }
  if (p === '/api/ingest/alerts' && m === 'POST') {
    if (!env.INGEST_KEY || !safeEqual(req.headers.get('X-Ingest-Key') || '', env.INGEST_KEY)) return err('unauthorized', 401);
    const b = await body(req);
    const al = (b.alerts || []).slice(0, 500);
    if (al.length) await env.DB.batch(al.map(a => env.DB.prepare(
      `INSERT INTO match_alerts (client_id, item_id, ms, why) VALUES (?, ?, ?, ?) ON CONFLICT(client_id, item_id) DO NOTHING`
    ).bind(+a.client_id, String(a.item_id), Math.round(+a.ms || 0), String(a.why || '').slice(0, 300))));
    // 看過超過 30 天的清掉
    await env.DB.prepare(`DELETE FROM match_alerts WHERE seen_at IS NOT NULL AND seen_at < datetime('now', '-30 days')`).run();
    return json({ ok: true, n: al.length });
  }

  // ===== 第一次設定：建立管理者（需要 SETUP_CODE，且資料庫還沒有任何帳號）=====
  if (p === '/api/setup' && m === 'GET') {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    return json({ needed: n.n === 0 });
  }
  if (p === '/api/setup' && m === 'POST') {
    const b = await body(req);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
    if (n.n > 0) return err('已經設定過了', 403);
    if (!env.SETUP_CODE || !safeEqual(String(b.code || ''), env.SETUP_CODE)) return err('設定碼不對', 403);
    if (!b.username || !b.name || !validPassword(b.password)) return err('帳號、名字必填，密碼至少 8 碼');
    const salt = randHex(16);
    await env.DB.prepare('INSERT INTO users (username, name, pw_hash, pw_salt, role) VALUES (?, ?, ?, ?, ?)')
      .bind(String(b.username).trim(), String(b.name).trim(), await hashPassword(b.password, salt), salt, 'admin').run();
    return json({ ok: true });
  }

  // ===== 登入／登出 =====
  if (p === '/api/login' && m === 'POST') {
    const b = await body(req);
    const username = String(b.username || '').trim();
    const ip = req.headers.get('CF-Connecting-IP') || '';
    const fails = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM login_fails WHERE (username = ? OR ip = ?) AND at > datetime('now', '-15 minutes')`
    ).bind(username, ip).first();
    if (fails.n >= 8) return err('嘗試太多次，請 15 分鐘後再試', 429);
    const u = await env.DB.prepare('SELECT * FROM users WHERE username = ? AND active = 1').bind(username).first();
    if (!u || !safeEqual(await hashPassword(String(b.password || ''), u.pw_salt), u.pw_hash)) {
      await env.DB.prepare('INSERT INTO login_fails (username, ip) VALUES (?, ?)').bind(username, ip).run();
      return err('帳號或密碼錯誤', 401);
    }
    const token = randHex(32);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).bind(token, u.id),
      env.DB.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`),
      env.DB.prepare(`DELETE FROM login_fails WHERE at < datetime('now', '-1 day')`)
    ]);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
  }
  if (p === '/api/logout' && m === 'POST') {
    const token = cookie(req, 'sid');
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }

  // ===== 客人分享頁（公開，用 token）=====
  if ((r = p.match(/^\/api\/share\/([a-f0-9]{24})(\/react)?$/))) {
    const share = await env.DB.prepare(`SELECT * FROM shares WHERE token = ? AND expires_at > datetime('now')`).bind(r[1]).first();
    if (!share) return err('連結已失效', 404);
    const ids = JSON.parse(share.item_ids);
    if (!r[2] && m === 'GET') {
      const rows = (await env.DB.prepare(
        `SELECT item_id, status, reasons, note, snapshot FROM client_items WHERE client_id = ? AND item_id IN (${ids.map(() => '?').join(',')})`
      ).bind(share.client_id, ...ids).all()).results;
      const byId = Object.fromEntries(rows.map(x => [x.item_id, x]));
      const sender = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(share.created_by).first();
      return json({
        title: share.title, from: sender?.name || '', expires: share.expires_at,
        items: ids.filter(id => byId[id]).map(id => ({ id, status: byId[id].status, reasons: byId[id].reasons,
          note: byId[id].note, ...JSON.parse(byId[id].snapshot) }))
      });
    }
    if (r[2] && m === 'POST') {
      const b = await body(req);
      if (!ids.includes(b.item_id)) return err('不在這份清單裡');
      const map = { like: 'liked', dislike: 'disliked', visit: 'visit_req' };
      const status = map[b.reaction];
      if (!status) return err('bad reaction');
      // 仲介已經推進到約看以後，客人的按鈕不會把狀態倒退
      const cur = await env.DB.prepare('SELECT status FROM client_items WHERE client_id = ? AND item_id = ?').bind(share.client_id, b.item_id).first();
      if (cur && ['booked', 'visited', 'offer'].includes(cur.status)) return json({ ok: true, kept: cur.status });
      await env.DB.prepare(
        `UPDATE client_items SET status = ?, reasons = ?, note = ?, updated_at = datetime('now') WHERE client_id = ? AND item_id = ?`
      ).bind(status, (b.reasons || []).slice(0, 8).join(','), String(b.note || '').slice(0, 500), share.client_id, b.item_id).run();
      return json({ ok: true });
    }
  }

  // ===== 以下都要登入 =====
  const user = await currentUser(req, env);
  if (!user) return err('請先登入', 401);

  if (p === '/api/me' && m === 'GET') return json(user);
  if (p === '/api/me/password' && m === 'POST') {
    const b = await body(req);
    const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    if (!safeEqual(await hashPassword(String(b.old || ''), u.pw_salt), u.pw_hash)) return err('舊密碼不對', 403);
    if (!validPassword(b.new)) return err('新密碼至少 8 碼');
    const salt = randHex(16);
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(await hashPassword(b.new, salt), salt, user.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(user.id, cookie(req, 'sid'))
    ]);
    return json({ ok: true });
  }

  // 案件資料（gzip 原封不動送，瀏覽器自己解壓）
  if ((r = p.match(/^\/api\/blob\/(cards|pool)$/)) && m === 'GET') {
    const v = await env.BLOBS.getWithMetadata(r[1], 'stream');
    if (!v.value) return err('還沒有資料', 404);
    return new Response(v.value, {
      encodeBody: 'manual',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip',
        'Cache-Control': 'private, max-age=300', 'X-Updated-At': v.metadata?.at || '' }
    });
  }

  // ----- 開發進度（大家共用）-----
  if (p === '/api/dev' && m === 'GET') {
    const rows = (await env.DB.prepare(
      `SELECT d.item_id, d.status, d.note, d.updated_at, d.next_contact, d.snapshot, u.name AS by_name, d.user_id FROM dev_status d JOIN users u ON u.id = d.user_id`
    ).all()).results;
    return json(rows);
  }
  if ((r = p.match(/^\/api\/dev\/([\w-]+)$/)) && m === 'PUT') {
    const b = await body(req);
    if (b.status && !DEV_STATUSES.includes(b.status)) return err('bad status');
    const next = /^\d{4}-\d{2}-\d{2}$/.test(b.next_contact || '') ? b.next_contact : '';
    await env.DB.prepare(
      `INSERT INTO dev_status (item_id, status, user_id, note, snapshot, next_contact) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET status = excluded.status, user_id = excluded.user_id, note = excluded.note,
       snapshot = excluded.snapshot, next_contact = excluded.next_contact, updated_at = datetime('now')`
    ).bind(r[1], b.status || '未聯絡', user.id, String(b.note || '').slice(0, 1000), JSON.stringify(b.snapshot || {}), next).run();
    return json({ ok: true });
  }

  // ----- 地標定位（客需通勤距離）：①內政部 NLSC 門牌定位 ②OSM Nominatim（學校、公司名稱等）-----
  //   回傳候選讓仲介確認（NLSC 會模糊比對到隔壁路，畫面上顯示定位到的地址）
  if (p === '/api/geocode' && m === 'POST') {
    const b = await body(req);
    if (!String(b.q || '').trim()) return err('請輸入地址或地標');
    return json(await geocode(b.q));
  }

  // ----- 同體系比對錯了（大家共用）：標了之後雷達下次跑會把該案改回可開發 -----
  if (p === '/api/same-override' && m === 'GET') {
    return json((await env.DB.prepare('SELECT o.item_id, o.note, o.created_at, u.name AS by_name FROM same_override o JOIN users u ON u.id = o.user_id').all()).results);
  }
  if ((r = p.match(/^\/api\/same-override\/([\w-]+)$/))) {
    if (m === 'PUT') {
      const b = await body(req);
      await env.DB.prepare(`INSERT INTO same_override (item_id, user_id, note, snapshot) VALUES (?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET user_id = excluded.user_id, note = excluded.note`)
        .bind(r[1], user.id, String(b.note || '').slice(0, 300), JSON.stringify(b.snapshot || {})).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      await env.DB.prepare('DELETE FROM same_override WHERE item_id = ?').bind(r[1]).run();
      return json({ ok: true });
    }
  }

  // ----- 客戶 -----
  if (p === '/api/clients' && m === 'GET') {
    const NEWC = `(SELECT COUNT(*) FROM match_alerts a WHERE a.client_id = c.id AND a.seen_at IS NULL) AS new_count`;
    const q = user.role === 'admin'
      ? env.DB.prepare(`SELECT c.*, u.name AS owner_name, ${NEWC} FROM clients c JOIN users u ON u.id = c.owner_id WHERE c.active = 1 ORDER BY c.updated_at DESC`)
      : env.DB.prepare(`SELECT c.*, u.name AS owner_name, ${NEWC} FROM clients c JOIN users u ON u.id = c.owner_id WHERE c.active = 1 AND c.owner_id = ? ORDER BY c.updated_at DESC`).bind(user.id);
    return json((await q.all()).results);
  }
  if (p === '/api/clients' && m === 'POST') {
    const b = await body(req);
    if (!b.name) return err('客戶名稱必填');
    const res = await env.DB.prepare('INSERT INTO clients (owner_id, name, contact, note, prefs) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, String(b.name).slice(0, 50), String(b.contact || '').slice(0, 100), String(b.note || '').slice(0, 2000), JSON.stringify(b.prefs || {})).run();
    return json({ ok: true, id: res.meta.last_row_id });
  }
  if ((r = p.match(/^\/api\/clients\/(\d+)$/))) {
    const c = await canAccessClient(env, user, +r[1]);
    if (!c) return err('找不到客戶或沒有權限', 404);
    if (m === 'PUT') {
      const b = await body(req);
      await env.DB.prepare(`UPDATE clients SET name = ?, contact = ?, note = ?, prefs = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(String(b.name || '').slice(0, 50), String(b.contact || '').slice(0, 100), String(b.note || '').slice(0, 2000), JSON.stringify(b.prefs || {}), c.id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      await env.DB.prepare('UPDATE clients SET active = 0 WHERE id = ?').bind(c.id).run();
      return json({ ok: true });
    }
  }
  if ((r = p.match(/^\/api\/clients\/(\d+)\/items$/)) && m === 'GET') {
    const c = await canAccessClient(env, user, +r[1]);
    if (!c) return err('找不到客戶或沒有權限', 404);
    return json((await env.DB.prepare('SELECT * FROM client_items WHERE client_id = ? ORDER BY updated_at DESC').bind(c.id).all()).results);
  }
  if ((r = p.match(/^\/api\/clients\/(\d+)\/items\/([\w-]+)$/)) && m === 'PUT') {
    const c = await canAccessClient(env, user, +r[1]);
    if (!c) return err('找不到客戶或沒有權限', 404);
    const b = await body(req);
    if (!CLIENT_STATUSES.includes(b.status)) return err('bad status');
    await env.DB.prepare(
      `INSERT INTO client_items (client_id, item_id, status, note, visit_at, snapshot) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(client_id, item_id) DO UPDATE SET status = excluded.status, note = excluded.note,
       visit_at = excluded.visit_at, updated_at = datetime('now')`
    ).bind(c.id, r[2], b.status, String(b.note || '').slice(0, 1000), String(b.visit_at || ''), JSON.stringify(b.snapshot || {})).run();
    return json({ ok: true });
  }
  // 建分享連結：這些案件標成「已推送」（已有更進一步狀態的不動）
  if ((r = p.match(/^\/api\/clients\/(\d+)\/share$/)) && m === 'POST') {
    const c = await canAccessClient(env, user, +r[1]);
    if (!c) return err('找不到客戶或沒有權限', 404);
    const b = await body(req);
    const items = (b.items || []).slice(0, 40);
    if (!items.length) return err('至少選一個案件');
    const token = randHex(12);
    const days = Math.min(Math.max(parseInt(b.days || 14, 10), 1), 90);
    const stmts = items.map(it => env.DB.prepare(
      `INSERT INTO client_items (client_id, item_id, status, snapshot) VALUES (?, ?, 'sent', ?)
       ON CONFLICT(client_id, item_id) DO UPDATE SET snapshot = excluded.snapshot`
    ).bind(c.id, String(it.id), JSON.stringify(it)));
    stmts.push(env.DB.prepare(`INSERT INTO shares (token, client_id, created_by, title, item_ids, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now', '+${days} days'))`)
      .bind(token, c.id, user.id, String(b.title || '').slice(0, 100), JSON.stringify(items.map(it => String(it.id)))));
    stmts.push(env.DB.prepare(`UPDATE clients SET updated_at = datetime('now') WHERE id = ?`).bind(c.id));
    await env.DB.batch(stmts);
    return json({ ok: true, token, url: `${url.origin}/s/${token}` });
  }
  // 新配對提醒：GET 取還沒看的；POST .../seen 全部標已看
  if ((r = p.match(/^\/api\/clients\/(\d+)\/alerts(\/seen)?$/))) {
    const c = await canAccessClient(env, user, +r[1]);
    if (!c) return err('找不到客戶或沒有權限', 404);
    if (!r[2] && m === 'GET') return json((await env.DB.prepare('SELECT item_id, ms, why, created_at FROM match_alerts WHERE client_id = ? AND seen_at IS NULL').bind(c.id).all()).results);
    if (r[2] && m === 'POST') {
      await env.DB.prepare(`UPDATE match_alerts SET seen_at = datetime('now') WHERE client_id = ? AND seen_at IS NULL`).bind(c.id).run();
      return json({ ok: true });
    }
  }
  if ((r = p.match(/^\/api\/clients\/(\d+)\/shares$/)) && m === 'GET') {
    const c = await canAccessClient(env, user, +r[1]);
    if (!c) return err('找不到客戶或沒有權限', 404);
    return json((await env.DB.prepare('SELECT token, title, item_ids, created_at, expires_at FROM shares WHERE client_id = ? ORDER BY created_at DESC').bind(c.id).all()).results);
  }

  // ----- 帶看待辦：客人按了喜歡／想去看，以及已約、已看、出價中的 -----
  if (p === '/api/visits' && m === 'GET') {
    const own = user.role === 'admin' ? '' : 'AND c.owner_id = ?';
    const q = env.DB.prepare(
      `SELECT ci.*, c.name AS client_name, c.owner_id FROM client_items ci JOIN clients c ON c.id = ci.client_id
       WHERE c.active = 1 AND ci.status IN ('visit_req', 'liked', 'booked', 'visited', 'offer') ${own}
       ORDER BY CASE ci.status WHEN 'visit_req' THEN 0 WHEN 'liked' THEN 1 WHEN 'booked' THEN 2 WHEN 'offer' THEN 3 ELSE 4 END, ci.updated_at DESC`
    );
    return json((await (own ? q.bind(user.id) : q).all()).results);
  }

  // ----- 帳號管理（管理者）-----
  if (p.startsWith('/api/users')) {
    if (user.role !== 'admin') return err('只有管理者可以', 403);
    if (p === '/api/users' && m === 'GET') {
      return json((await env.DB.prepare('SELECT id, username, name, role, active, created_at FROM users ORDER BY id').all()).results);
    }
    if (p === '/api/users' && m === 'POST') {
      const b = await body(req);
      if (!b.username || !b.name || !validPassword(b.password)) return err('帳號、名字必填，密碼至少 8 碼');
      const salt = randHex(16);
      try {
        await env.DB.prepare('INSERT INTO users (username, name, pw_hash, pw_salt, role) VALUES (?, ?, ?, ?, ?)')
          .bind(String(b.username).trim(), String(b.name).trim(), await hashPassword(b.password, salt), salt, b.role === 'admin' ? 'admin' : 'member').run();
      } catch { return err('帳號已存在'); }
      return json({ ok: true });
    }
    if ((r = p.match(/^\/api\/users\/(\d+)$/)) && m === 'PUT') {
      const b = await body(req);
      const id = +r[1];
      if (id === user.id && (b.active === 0 || b.role === 'member')) return err('不能停用或降級自己');
      const stmts = [];
      if (b.active === 0 || b.active === 1) {
        stmts.push(env.DB.prepare('UPDATE users SET active = ? WHERE id = ?').bind(b.active, id));
        if (b.active === 0) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
      }
      if (b.role === 'admin' || b.role === 'member') stmts.push(env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(b.role, id));
      if (b.password) {
        if (!validPassword(b.password)) return err('密碼至少 8 碼');
        const salt = randHex(16);
        stmts.push(env.DB.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(await hashPassword(b.password, salt), salt, id));
        stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
      }
      if (stmts.length) await env.DB.batch(stmts);
      return json({ ok: true });
    }
  }

  return err('not found', 404);
}

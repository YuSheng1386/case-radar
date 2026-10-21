// 新案件／新配對提醒（GitHub Actions：run.js 之後、sync push 之前跑）
//   1. 開發：主力五區新出現「只有屋主在賣」或分數 ≥ NOTIFY_SCORE 的案件
//   2. 客戶：每位客戶用網站同一套配對規則（web/public/match.js）算，新出現配對分數 ≥ MATCH_MIN 的案件
//      → 寫進網站（客戶列表顯示「X 件新配對」）
//   3. 以上合併成「一則」LINE 摘要推給自己；只推沒推過的
// LINE 免費方案每月推播則數有限：先查本月剩餘額度，平均分到月底每天能用幾則，超過就先存著，下次合併推
// 環境變數：RADAR_URL、INGEST_KEY（讀客需／寫提醒）、LINE_TOKEN、LINE_TO（沒有就只寫網站、不推）
//           NOTIFY_DRY=1 → 不推 LINE、不寫網站，訊息印在畫面上（本機測試用）
// 注意：Actions 日誌是公開的 → 這裡只印數量，不印客戶名稱、客需、訊息內容
const fs = require('fs');
const path = require('path');
const Match = require('../web/public/match.js');

const ROOT = path.join(__dirname, '..');
const STATE = process.env.RADAR_STATE || path.join(ROOT, 'state');
const F = path.join(STATE, 'notify.json');
const { RADAR_URL, INGEST_KEY, LINE_TOKEN, LINE_TO } = process.env;
const DRY = process.env.NOTIFY_DRY === '1';
const NOTIFY_SCORE = +(process.env.NOTIFY_SCORE || 60);
const MATCH_MIN = +(process.env.MATCH_MIN || 30);
const PER_CLIENT_MAX = 10;     // 每位客戶每次最多記幾件新配對（避免資料大變動時洗版）
const LINE_RESERVE = 10;       // 本月額度留給手動／其他用途
const SITE = (RADAR_URL || 'https://case-radar.yusheng1386.workers.dev').replace(/\/$/, '');

const load = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const twNow = () => new Date(Date.now() + 8 * 3600e3);
const twDate = () => twNow().toISOString().slice(0, 10);
const H = { 'X-Ingest-Key': INGEST_KEY || '' };

// 客需雜湊：客需改了就重新建基準（不把改條件後「本來就在」的案件當成新配對）
function hashPrefs(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return String(h); }

const ownerOnly = c => c.posters && c.posters.owner && c.posters.agents === 0;
const cardLine = c => {
  const tag = ownerOnly(c) ? '只有屋主' : c.peer && c.peer.diff < 0 ? `同等級低${-c.peer.diff}%` : (c.tags || []).slice(0, 2).join('/');
  const url = (c.sources || []).slice().sort((a, b) => (a.price || 1e9) - (b.price || 1e9))[0]?.url || '';
  return `・${tag}｜${c.district}${c.community || c.title.slice(0, 14)} ${c.price}萬 ${c.area ?? '—'}坪 ${c.floor || ''}（${c.score}分）\n  ${url}`;
};

async function lineQuota() {
  const h = { Authorization: `Bearer ${LINE_TOKEN}` };
  const [q, u] = await Promise.all([
    fetch('https://api.line.me/v2/bot/message/quota', { headers: h }).then(r => r.json()),
    fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers: h }).then(r => r.json())
  ]);
  if (q.type !== 'limited') return { left: Infinity };
  return { left: q.value - u.totalUsage, limit: q.value, used: u.totalUsage };
}

async function linePush(text) {
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST', headers: { Authorization: `Bearer ${LINE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: LINE_TO, messages: [{ type: 'text', text: text.slice(0, 4900) }] })
  });
  if (!r.ok) throw new Error(`LINE 推播失敗 HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
}

async function main() {
  const st = load(F, { cards: {}, clients: {}, pushes: {}, pending: { cards: [], clients: {} } });
  st.pending = st.pending || { cards: [], clients: {} };
  const data = load(path.join(ROOT, 'docs', 'data.json'), null);
  const pool = load(path.join(ROOT, 'docs', 'pool.json'), null);
  if (!data || !pool) { console.log('[通知] 沒有 data.json／pool.json，略過'); return; }
  const now = new Date().toISOString();
  const firstRun = !st.init;

  // ---- 1. 開發：新出現的好案 ----
  const qual = data.cards.filter(c => !c.wide && (ownerOnly(c) || c.score >= NOTIFY_SCORE));
  const newCards = qual.filter(c => !st.cards[c.id]);
  for (const c of qual) st.cards[c.id] = st.cards[c.id] || now;
  const qualIds = new Set(qual.map(c => c.id));
  for (const [id, at] of Object.entries(st.cards)) if (!qualIds.has(id) && Date.now() - Date.parse(at) > 60 * 864e5) delete st.cards[id];
  if (!firstRun) st.pending.cards = [...new Set([...st.pending.cards, ...newCards.map(c => c.id)])];

  // ---- 2. 客戶新配對 ----
  let clientsData = null;
  if (RADAR_URL && INGEST_KEY) {
    const r = await fetch(`${SITE}/api/ingest/clients`, { headers: H });
    if (r.ok) clientsData = await r.json(); else console.error(`[通知] 讀客需失敗 HTTP ${r.status}`);
  }
  const alerts = [];
  let nClientsNew = 0;
  for (const cl of clientsData?.clients || []) {
    const prefs = JSON.parse(cl.prefs || '{}');
    const hist = clientsData.items.filter(x => x.client_id === cl.id);
    const res = Match.run(pool.items, prefs, hist).items.filter(x => x.ms >= MATCH_MIN);
    const h = hashPrefs(cl.prefs);
    const rec = st.clients[cl.id];
    if (!rec || rec.h !== h) {      // 新客戶或客需改了 → 現有的當基準，不提醒
      st.clients[cl.id] = { h, ids: Object.fromEntries(res.map(x => [x.id, 1])) };
      continue;
    }
    const fresh = res.filter(x => !rec.ids[x.id]).slice(0, PER_CLIENT_MAX);
    for (const x of res) rec.ids[x.id] = 1;
    if (!fresh.length) continue;
    nClientsNew++;
    for (const x of fresh) alerts.push({ client_id: cl.id, item_id: x.id, ms: x.ms, why: x.why.join('、') });
    const p = st.pending.clients[cl.id] || (st.pending.clients[cl.id] = { name: cl.name, owner: cl.owner_name, items: [] });
    p.name = cl.name;
    for (const x of fresh) p.items.push({ id: x.id, c: x.c || x.t || x.a, p: x.p, ms: x.ms, d: x.d });
  }
  // 刪掉已不存在的客戶
  if (clientsData) {
    const live = new Set(clientsData.clients.map(c => String(c.id)));
    for (const id of Object.keys(st.clients)) if (!live.has(String(id))) { delete st.clients[id]; delete st.pending.clients[id]; }
  }
  if (alerts.length && !DRY) {
    const r = await fetch(`${SITE}/api/ingest/alerts`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ alerts }) });
    if (!r.ok) console.error(`[通知] 寫入新配對失敗 HTTP ${r.status}`);
  }
  console.log(`[通知] 開發符合 ${qual.length}、新 ${firstRun ? '0（第一次只建基準）' : newCards.length}；客戶 ${clientsData?.clients.length ?? '—'} 位，${nClientsNew} 位有新配對共 ${alerts.length} 件`);

  // ---- 3. 合併成一則 LINE ----
  const cardById = Object.fromEntries(data.cards.map(c => [c.id, c]));
  const pc = st.pending.cards.map(id => cardById[id]).filter(c => c && qualIds.has(c.id)); // 已下架或不再符合的就不推
  const pcl = Object.values(st.pending.clients).filter(x => x.items.length);
  st.init = st.init || now;
  if (!pc.length && !pcl.length) { st.pending.cards = []; return save(st); }

  pc.sort((a, b) => ownerOnly(b) - ownerOnly(a) || b.score - a.score);
  const t = twNow();
  let msg = `🏠 案件雷達 ${t.getUTCMonth() + 1}/${t.getUTCDate()} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}\n`;
  if (pc.length) {
    msg += `\n【新的可開發】${pc.length} 件（只有屋主 ${pc.filter(ownerOnly).length}）\n` + pc.slice(0, 8).map(cardLine).join('\n');
    if (pc.length > 8) msg += `\n…另 ${pc.length - 8} 件`;
    msg += '\n';
  }
  if (pcl.length) {
    msg += `\n【客戶新配對】\n` + pcl.map(x => {
      const top = x.items.slice().sort((a, b) => b.ms - a.ms)[0];
      return `・${x.name}：${x.items.length} 件（最高 ${top.c} ${top.p}萬，配對${top.ms}）`;
    }).join('\n') + '\n';
  }
  msg += `\n${SITE}/#${pc.length ? 'dev' : 'clients'}`;

  if (DRY) { console.log('----- LINE 訊息預覽 -----\n' + msg); st.pending = { cards: [], clients: {} }; return save(st); }
  if (!LINE_TOKEN || !LINE_TO) { console.log('[通知] 沒設 LINE_TOKEN／LINE_TO，只寫網站不推'); st.pending = { cards: [], clients: {} }; return save(st); }

  // 額度：本月剩餘平均到月底，每天最多推幾則；今天用完就先存著
  try {
    const q = await lineQuota();
    const day = twDate();
    const used = st.pushes[day] || 0;
    const daysLeft = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate() - t.getUTCDate() + 1;
    const perDay = q.left === Infinity ? 99 : Math.max(0, Math.floor((q.left - LINE_RESERVE + used) / daysLeft));
    if (used >= perDay || q.left <= LINE_RESERVE) {
      console.log(`[通知] 今天推播額度已用完（今天 ${used}／每天 ${perDay}，本月剩 ${q.left}），先存著下次合併`);
      return save(st);
    }
    await linePush(msg);
    st.pushes = { [day]: used + 1 };   // 只留今天
    st.pending = { cards: [], clients: {} };
    console.log(`[通知] 已推 LINE（今天第 ${used + 1}／${perDay} 則，本月剩 ${q.left - 1}）`);
  } catch (e) {
    console.error('[通知]', e.message, '— 下次再推');
  }
  save(st);
}

function save(st) { fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(F, JSON.stringify(st)); }

main().catch(e => { console.error('[通知] 失敗（不影響雷達）:', e.message); });

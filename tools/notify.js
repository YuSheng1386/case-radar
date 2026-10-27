// 新案件／新配對提醒（GitHub Actions：run.js 之後、sync push 之前跑）
//   1. 開發：主力區（config.districts）新出現「只有屋主在賣」或分數 ≥ NOTIFY_SCORE 的案件
//   2. 客戶：每位客戶用網站同一套配對規則（web/public/match.js）算，新出現配對分數 ≥ MATCH_MIN 的案件
//      → 寫進網站（客戶列表顯示「X 件新配對」）
//   3. 這次的新案交給網站推播佇列（/api/ingest/notify → web/src/pushq.mjs）：
//      什麼時候推（9 點／白天滿 5 件或 85 分以上／20 點收尾）、推給誰、額度都由網站決定；9 點、20 點由 Worker 定時觸發準點推
// 環境變數：RADAR_URL、INGEST_KEY（讀客需／寫提醒／交新案）
//           NOTIFY_DRY=1 → 不寫網站，訊息預覽印在畫面上（本機測試用）
//           NOTIFY_TEST=1 → 測試推播：不看時段、現在推一則給第一位，正式累積不動
// 注意：Actions 日誌是公開的 → 這裡只印數量，不印客戶名稱、客需、訊息內容
const fs = require('fs');
const path = require('path');
const Match = require('../web/public/match.js');
const { roadKey } = require('./roads');

const ROOT = path.join(__dirname, '..');
const STATE = process.env.RADAR_STATE || path.join(ROOT, 'state');
const F = path.join(STATE, 'notify.json');
const { RADAR_URL, INGEST_KEY } = process.env;
const DRY = process.env.NOTIFY_DRY === '1';
// 測試推播（Actions 手動執行勾 notify_test）：沒有新案就拿最近上架的 3 件來推
const TEST = process.env.NOTIFY_TEST === '1';
const NOTIFY_SCORE = +(process.env.NOTIFY_SCORE || 60);
const MATCH_MIN = +(process.env.MATCH_MIN || 30);
const PER_CLIENT_MAX = 10;     // 每位客戶每次最多記幾件新配對（避免資料大變動時洗版）
const SITE = (RADAR_URL || 'https://case-radar.yusheng1386.workers.dev').replace(/\/$/, '');

const load = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const H = { 'X-Ingest-Key': INGEST_KEY || '' };

// 客需雜湊：客需改了就重新建基準（不把改條件後「本來就在」的案件當成新配對）
function hashPrefs(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return String(h); }

const ownerOnly = c => c.posters && c.posters.owner && c.posters.agents === 0;
// 照「字」切，不照 UTF-16 切：.slice 會把標題裡的 emoji 切成半個，LINE 收到不合法的文字整則拒收（10/24 查詢沒回應就是這個）
const cut = (s, n) => Array.from(String(s || '')).slice(0, n).join('');
// 每件一行：分數＋物件，下一行列出「為什麼值得看」的全部理由（用戶 10/21：不要只貼一個標籤像在分類）
// 各平台網址，開價最低的先（推播時 pickLinks 會跳過失效的）
const srcUrls = c => (c.sources || []).slice().sort((a, b) => (a.price || 1e9) - (b.price || 1e9)).map(s => s.url).filter(Boolean);
// 傳出前測連結：c._url 設成第一個還在的；全部失效照樣推（優質案件不能漏），改附案件快照頁（不用登入）；回傳失效件數
async function pickLinks(cards) {
  const { pickAlive, deadNote } = await import('../web/src/linkcheck.mjs');
  const got = await Promise.all(cards.map(c => pickAlive(srcUrls(c))));
  let dead = 0;
  for (const [i, c] of cards.entries()) {
    if (got[i] !== null) { c._url = got[i]; continue; }
    dead++;
    c._url = await caseLink(c, deadNote);
  }
  return dead;
}
// 案件快照存到網站（/c/<token>）；寫不進去（本機乾跑、網站掛了）就只註明，至少案件資料照推
async function caseLink(c, deadNote) {
  const t = cardLine({ ...c, _url: '' }).split('\n').filter(l => l.trim()).join('\n');
  try {
    if (!DRY && RADAR_URL && INGEST_KEY) {
      const r = await fetch(`${SITE}/api/ingest/case`, { method: 'POST', headers: { 'X-Ingest-Key': INGEST_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ t, us: srcUrls(c), q: c.community || '', at: new Date().toISOString() }) });
      if (r.ok) return deadNote(SITE, (await r.json()).token);
    }
  } catch {}
  return `⚠️平台刊登可能已下架（${c.address || c.district || ''}）`;
}

const cardLine = c => {
  const why = [];
  if (ownerOnly(c)) why.push('只有屋主在賣');
  else if (c.posters && c.posters.owner) why.push(`屋主＋${c.posters.agents}位仲介`);
  if (c.peer && c.peer.diff < 0) why.push(`比同等級社區低${-c.peer.diff}%`);
  if (c.comm && c.comm.diff < 0) why.push(`開價比同社區成交低${-c.comm.diff}%`);
  if (c.drop >= 2) why.push(`降價${c.drop}%`);
  // 自售／低於實登／同等級仍低 上面已寫成具體數字；降價有實測降幅時也已寫過
  for (const t of c.tags || []) if (!['自售', '低於實登', '同等級仍低', '降價'].includes(t) || (t === '降價' && !(c.drop >= 2))) why.push(t === '標低於行情' ? '標示低於行情' : t);
  const url = c._url ?? srcUrls(c)[0] ?? '';
  return `・${c.score}分｜${c.district} ${c.community || cut(c.title, 14)} ${c.price}萬 ${c.area ?? '—'}坪 ${c.floor || ''}\n  ${[...new Set(why)].join('・') || '分數高'}\n  ${url}`;
};

async function main() {
  const st = load(F, { cards: {}, clients: {} });
  // 10/27 前在這裡累積、還沒推的（或上次交給網站失敗的），這次一起交出去
  const old = st.pending || { cards: [], clients: {} };
  delete st.pending; delete st.pushes; delete st.startDay; delete st.endDay; delete st.wait;
  const DOCS = process.env.RADAR_DOCS || path.join(ROOT, 'docs');   // 測試用另一份資料
  const data = load(path.join(DOCS, 'data.json'), null);
  const pool = load(path.join(DOCS, 'pool.json'), null);
  if (!data || !pool) { console.log('[通知] 沒有 data.json／pool.json，略過'); return; }
  const now = new Date().toISOString();
  const firstRun = !st.init;

  // ---- 1. 開發：新出現的好案 ----
  const qual = data.cards.filter(c => !c.wide && c.ownerGone == null && (ownerOnly(c) || c.score >= NOTIFY_SCORE));
  // 剛加進主力區的區（例如 10/24 加太平）：這次當基準不推，免得原本就在的好案一次全被當新案
  const prevDs = st.districts || ['南區', '西區', '南屯區', '大里區', '東區'];   // 還沒記錄過＝加太平之前的五區
  const newCards = qual.filter(c => !st.cards[c.id] && prevDs.includes(c.district));
  st.districts = data.districts;
  for (const c of qual) st.cards[c.id] = st.cards[c.id] || now;
  const qualIds = new Set(qual.map(c => c.id));
  for (const [id, at] of Object.entries(st.cards)) if (!qualIds.has(id) && Date.now() - Date.parse(at) > 60 * 864e5) delete st.cards[id];

  // ---- 2. 客戶新配對 ----
  let clientsData = null;
  if (RADAR_URL && INGEST_KEY) {
    const r = await fetch(`${SITE}/api/ingest/clients`, { headers: H });
    if (r.ok) clientsData = await r.json(); else console.error(`[通知] 讀客需失敗 HTTP ${r.status}`);
  }
  const alerts = [], freshBy = [];
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
    freshBy.push({ id: cl.id, name: cl.name, items: fresh.map(({ id, c, t, a, p, ms }) => ({ id, c: c || t || a, p, ms })) });
  }
  // 刪掉已不存在的客戶
  if (clientsData) {
    const live = new Set(clientsData.clients.map(c => String(c.id)));
    for (const id of Object.keys(st.clients)) if (!live.has(String(id))) { delete st.clients[id]; delete old.clients[id]; }
  }
  if (alerts.length && !DRY) {
    const r = await fetch(`${SITE}/api/ingest/alerts`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ alerts }) });
    if (!r.ok) console.error(`[通知] 寫入新配對失敗 HTTP ${r.status}`);
  }
  console.log(`[通知] 開發符合 ${qual.length}、新 ${firstRun ? '0（第一次只建基準）' : newCards.length}；客戶 ${clientsData?.clients.length ?? '—'} 位，${nClientsNew} 位有新配對共 ${alerts.length} 件`);

  // ---- 3. 交給網站推播佇列（什麼時候推、推給誰、額度都在 web/src/pushq.mjs；9 點、20 點由 Worker 定時觸發準點推）----
  const cardById = Object.fromEntries(data.cards.map(c => [c.id, c]));
  const ids = [...new Set([...old.cards, ...(firstRun ? [] : newCards.map(c => c.id))])];
  const pc = ids.map(id => cardById[id]).filter(c => c && qualIds.has(c.id));   // 已下架或不再符合的就不交
  if (TEST && !pc.length) pc.push(...qual.slice().sort((a, b) => (Date.parse(b.firstSeen) || 0) - (Date.parse(a.firstSeen) || 0)).slice(0, 3));
  // 傳出前測連結：同一案多個平台時傳打得開的那個
  if (pc.length) {
    const dead = await pickLinks(pc);
    if (dead) console.log(`[通知] ${dead} 件各平台連結都打不開，改附案件快照頁`);
  }
  const clients = [...Object.entries(old.clients).map(([id, x]) => ({ id, name: x.name, items: x.items || [] })), ...freshBy].filter(x => x.items.length);
  // 每件：分數、推播文字、地圖座標（社區座標；沒有的用路名座標 state/roads.json，標成大約）、總價、連結、地圖顏色
  const roads = load(path.join(STATE, 'roads.json'), { items: {} });
  const cards = pc.map(c => {
    const rp = c.ll ? null : roads.items[roadKey(c.district, c.address)]?.pts;
    const ll = c.ll || (rp && rp[Math.floor(rp.length / 2)]) || null;
    const p = c.price;
    return { id: c.id, sc: c.score, own: ownerOnly(c) ? 1 : 0, x: cardLine(c), ll, ap: c.ll ? 0 : 1, p, u: c._url || '',
      k: ownerOnly(c) ? 'own' : c.score >= NOTIFY_SCORE ? 'good' : '' };
  });
  st.init = st.init || now;
  if (!cards.length && !clients.length) { save(st); return console.log('[通知] 沒有新的要交'); }

  if (DRY) {
    const { merge, buildMsg } = await import('../web/src/pushq.mjs');
    console.log('----- LINE 訊息預覽 -----\n' + buildMsg(merge(null, { cards, clients }), Date.now(), TEST ? 'test' : 'min'));
    return save(st);
  }
  if (!RADAR_URL || !INGEST_KEY) { console.log('[通知] 沒設 RADAR_URL／INGEST_KEY，不交推播'); return save(st); }
  // NOTIFY_NOW（台灣時間，例 2026-10-27T13:10）只在本機測試網站有效（.dev.vars TEST_NOW=1），正式網站不理
  const r = await fetch(`${SITE}/api/ingest/notify`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cards, clients, qual: [...qualIds], test: TEST, now: process.env.NOTIFY_NOW }) }).catch(e => ({ ok: false, status: e.message }));
  if (!r.ok) {   // 交不出去 → 留在本機下次再交（不會漏）；測試推播不留
    if (!TEST) st.pending = { cards: ids, clients: Object.fromEntries(clients.map(x => [x.id, { name: x.name, items: x.items }])) };
    console.error(`[通知] 交給網站失敗 ${r.status}，下次再交`);
    return save(st);
  }
  const j = await r.json();
  console.log(`[通知] 交 ${cards.length} 件、客戶配對 ${clients.length} 位 → 網站累積 ${j.queued ?? '—'} 件；${j.pushed ? `已推 ${j.pushed} 人（${j.why}）` : j.note || '先不推'}`);
  save(st);
}

function save(st) { fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(F, JSON.stringify(st)); }

if (require.main === module) main().catch(e => { console.error('[通知] 失敗（不影響雷達）:', e.message); });
module.exports = { cardLine, cut, srcUrls };

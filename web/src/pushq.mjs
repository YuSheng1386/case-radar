// LINE 新案推播：累積佇列＋時段規則（用戶 10/24 定）
//   GitHub 排程常晚 10–30 分鐘 → 準點的 9 點、20 點改由 Worker 定時觸發（wrangler.toml crons）推；
//   GitHub 每次排程只把這次的新案交進來（/api/ingest/notify，tools/notify.js），白天符合條件當下就推
//   ・20:00–隔天 9:00 只累積（特急也等早上）
//   ・09:00 準點：推整晚累積的全部（不管幾件）
//   ・白天：有 85 分以上（屋主自售 85 分以上也是）→ 連同之前累積的馬上推；累積滿 5 件 → 馬上推
//   ・20:00 準點：收尾，剩的全推
//   額度：本月剩餘平均到月底每天可用幾則（推給 n 人算 n 則），留 10 則不用；超過就留著下次合併 → 不會用到付費
// 佇列存 D1 blobs `nq`：{ cards:[{id,sc,own,x,ll,ap,p,u,k}], clients:{id:{name,items:[{id,c,p,ms}]}}, pushes:{日期:則數} }
import { store } from './store.mjs';

export const RULE = { start: 9, end: 20, min: 5, urgent: 85, reserve: 10 };
const SITE = 'https://case-radar.yusheng1386.workers.dev';
const tw = ms => new Date(ms + 8 * 3600e3);   // 用 getUTC* 讀台灣時間
const cut = (s, n) => Array.from(String(s || '')).slice(0, n).join('');

// 新案併進佇列（同一件只算一次、以新的為準）；qual＝現在還符合推播條件的 id，下架／不再符合的拿掉
export function merge(q, add = {}) {
  q = q || { cards: [], clients: {}, pushes: {} };
  const byId = new Map(q.cards.map(c => [c.id, c]));
  for (const c of add.cards || []) byId.set(c.id, c);
  q.cards = [...byId.values()];
  if (add.qual) { const ok = new Set(add.qual); q.cards = q.cards.filter(c => ok.has(c.id)); }
  for (const cl of add.clients || []) {
    const p = q.clients[cl.id] || (q.clients[cl.id] = { name: cl.name, items: [] });
    p.name = cl.name;
    const seen = new Set(p.items.map(x => x.id));
    for (const x of cl.items || []) if (!seen.has(x.id)) { p.items.push(x); seen.add(x.id); }
  }
  return q;
}
export const count = q => (q?.cards.length || 0) + Object.values(q?.clients || {}).reduce((a, x) => a + x.items.length, 0);

// 交進新案時要不要馬上推（9 點、20 點的準點推由定時觸發做）
export function decide(q, ms, R = RULE) {
  const h = tw(ms).getUTCHours();
  if (!count(q) || h < R.start || h >= R.end) return null;
  if (q.cards.some(c => c.sc >= R.urgent)) return 'urgent';
  if (count(q) >= R.min) return 'min';
  return null;
}

const HEAD = { start: '🌅 早上第一則（整晚累積）', urgent: '🔥 有特急件（85 分以上），連同累積的一起推', min: '📦 累積滿 5 件', end: '🌙 今天收尾', test: '🧪 測試推播・只推給你' };
export function buildMsg(q, ms, why, mapUrl = '') {
  const t = tw(ms);
  const cards = q.cards.slice().sort((a, b) => b.sc - a.sc);
  const cls = Object.values(q.clients).filter(x => x.items.length);
  let msg = `🏠 案件雷達 ${t.getUTCMonth() + 1}/${t.getUTCDate()} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}\n${HEAD[why] || ''}\n`;
  if (cards.length) {
    msg += `\n【新的可開發】${cards.length} 件\n` + cards.slice(0, 8).map(c => c.x).join('\n');
    if (cards.length > 8) msg += `\n…另 ${cards.length - 8} 件（地圖／網站看全部）`;
    msg += '\n';
  }
  if (cls.length) {
    msg += `\n【客戶新配對】\n` + cls.map(x => {
      const top = x.items.slice().sort((a, b) => b.ms - a.ms)[0];
      return `・${x.name}：${x.items.length} 件（最高 ${top.c} ${top.p}萬，配對${top.ms}）`;
    }).join('\n') + '\n';
  }
  if (mapUrl) msg += `\n🗺 地圖：${mapUrl}`;
  return cut(msg + `\n${SITE}/#${cards.length ? 'dev' : 'clients'}`, 4900);
}

const api = env => env.LINE_API || 'https://api.line.me';   // 測試時指到假的 LINE
const recipients = env => String(env.LINE_TO || env.LINE_ALLOW || '').split(',').map(s => s.trim()).filter(Boolean);

// 把佇列推出去：查額度 → 建地圖 → 推 → 清空佇列；額度不夠就留著
//   qIn：測試推播用自己那份（不碰正式佇列）
export async function flush(env, why, ms = Date.now(), qIn = null) {
  const S = store(env);
  const q = qIn || merge(await S.get('nq', 'json'));
  if (!count(q)) return { pushed: 0, why, note: '沒有累積的' };
  const to = why === 'test' ? recipients(env).slice(0, 1) : recipients(env);
  if (!to.length || !env.LINE_TOKEN) return { pushed: 0, why, note: '沒設 LINE_TOKEN／推播對象' };
  const H = { Authorization: `Bearer ${env.LINE_TOKEN}` };
  const day = tw(ms).toISOString().slice(0, 10), used = q.pushes[day] || 0;
  if (why !== 'test') {
    const [qa, qu] = await Promise.all([fetch(`${api(env)}/v2/bot/message/quota`, { headers: H }).then(r => r.json()),
      fetch(`${api(env)}/v2/bot/message/quota/consumption`, { headers: H }).then(r => r.json())]);
    if (qa.type === 'limited') {
      const left = qa.value - qu.totalUsage, t = tw(ms);
      const daysLeft = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate() - t.getUTCDate() + 1;
      const perDay = Math.max(0, Math.floor((left - RULE.reserve + used) / daysLeft));
      if (used + to.length > perDay || left - to.length < RULE.reserve)
        return { pushed: 0, why, n: count(q), note: `額度不夠先留著（今天 ${used}／每天 ${perDay} 則，本月剩 ${left}）` };
    }
  }
  // 地圖（有座標的才標）
  let mapUrl = '';
  const pts = q.cards.filter(c => c.ll).slice(0, 150)
    .map(c => [c.ll[0], c.ll[1], c.ap ? 1 : 0, c.x.split('\n').filter(l => !/^\s*https?:/.test(l)).join('\n').slice(0, 300), c.p ?? null, c.u || '', c.k || '']);
  if (pts.length) {
    const tok = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
    await S.put(`map-${tok}`, JSON.stringify({ t: `新的可開發 ${q.cards.length} 件`, at: new Date(ms).toISOString(), n: q.cards.length, c: null, r: null, items: pts }),
      { expirationTtl: 14 * 86400 });
    mapUrl = `${SITE}/m/${tok}`;
  }
  const text = buildMsg(q, ms, why, mapUrl);
  const multi = to.length > 1;
  const r = await fetch(`${api(env)}/v2/bot/message/${multi ? 'multicast' : 'push'}`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: multi ? to : to[0], messages: [{ type: 'text', text: text.toWellFormed() }] })
  });
  if (!r.ok) return { pushed: 0, why, n: count(q), note: `LINE 推播失敗 ${r.status} ${(await r.text()).slice(0, 200)}` };
  const n = count(q);
  if (!qIn) await S.put('nq', JSON.stringify({ cards: [], clients: {}, pushes: { [day]: used + to.length } }));   // 測試推播不清累積
  return { pushed: to.length, why, n };
}

// GitHub 排程交進新案：併進佇列，白天符合條件就馬上推
//   add.test：測試推播（Actions 手動勾 notify_test）→ 不看時段、只推給第一位，內容是累積的＋這次的，正式累積不動
export async function ingest(env, add, ms = Date.now()) {
  const S = store(env);
  const q = merge(await S.get('nq', 'json'), add);
  if (add.test) return { queued: count(q) - (add.cards || []).length, ...(await flush(env, 'test', ms, q)) };
  await S.put('nq', JSON.stringify(q));
  const why = decide(q, ms);
  if (!why) return { queued: count(q), pushed: 0, note: tw(ms).getUTCHours() >= RULE.end || tw(ms).getUTCHours() < RULE.start ? '晚上只累積，早上 9 點推' : `累積中（滿 ${RULE.min} 件或 ${RULE.urgent} 分以上才推）` };
  return { queued: count(q), ...(await flush(env, why, ms)) };
}

// Worker 定時觸發：台灣 09:00（UTC 01:00）推整晚累積的、20:00（UTC 12:00）收尾
export const CRON = { '0 1 * * *': 'start', '0 12 * * *': 'end' };

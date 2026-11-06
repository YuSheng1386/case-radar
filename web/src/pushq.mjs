// LINE 新案推播：累積佇列＋時段規則（用戶 10/24 定；11/07 改：每天只有 9 點推＋白天 85 分以上即時推，4 人都收，見 decide()）
//   下面是 10/24 舊規則說明，「滿 5 件」「20:00 收尾」已取消
//   GitHub 排程常晚 10–30 分鐘 → 準點的 9 點、20 點改由 Worker 定時觸發（wrangler.toml crons）推；
//   GitHub 每次排程只把這次的新案交進來（/api/ingest/notify，tools/notify.js），白天符合條件當下就推
//   ・20:00–隔天 9:00 只累積（特急也等早上）
//   ・09:00 準點：推整晚累積的全部（不管幾件）
//   ・白天：有 85 分以上（屋主自售 85 分以上也是）→ 連同之前累積的馬上推；累積滿 5 件 → 馬上推
//   ・20:00 準點：收尾，剩的全推
//   額度：本月剩餘平均到月底每天可用幾則（推給 n 人算 n 則），留 10 則不用；超過就留著下次合併 → 不會用到付費
// 佇列存 D1 blobs `nq`：{ cards:[{id,sc,own,x,ll,ap,p,u,k}], clients:{id:{name,items:[{id,c,p,ms}]}}, pushes:{日期:則數} }
import { store } from './store.mjs';
import { pushIds } from './line.mjs';

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

// 交進新案時要不要馬上推（9 點的準點推由定時觸發做）
//   11/07 用戶改規則（4 人都收、每天約 4 則額度）：每天只有早上 9 點推一次＝今天要做的事；
//   白天只有 85 分以上才即時推（只推那幾件，其餘留到隔天早上）；不再「滿 5 件就推」，20 點不再收尾
export function decide(q, ms, R = RULE) {
  const h = tw(ms).getUTCHours();
  if (!count(q) || h < R.start || h >= R.end) return null;
  if (q.cards.some(c => c.sc >= R.urgent)) return 'urgent';
  return null;
}

const HEAD = { start: '🌅 今天的開發清單（昨天 9 點後新出現的）', urgent: '🔥 特急件（85 分以上），先看這幾件', min: '📦 累積滿 5 件', end: '🌙 今天收尾', test: '🧪 測試推播・只推給你' };
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

// 早上推播附的開發查詢小抄（11/07 用戶：朋友白天自己查，用開發方向當關鍵字；件數是 11/07 正式資料實測）
const TIP_Q = ['新上架', '這週 降價', '只有屋主 這週', '這週 優質', '降價 優質透天', '分數80以上', '急售', '低於行情 優質'];
const TIP = {
  type: 'text',
  text: `💡 開發查詢小抄（點下面按鈕或直接打字，查詢不花推播額度）
・新上架：24 小時內新出現的可開發案
・這週 降價：這 7 天有降價的
・只有屋主 這週：這週屋主自己賣、沒仲介的
・這週 優質：這週出現、60 分以上
・降價 優質透天：可換成大樓、公寓
・分數80以上／急售／賠售／低於行情
・加區域更準：「南屯 這週」「太平 只有屋主」
・前面加「配對」＝幫客人找，不看分數
打「說明」看全部條件；查不到想要的打「回報 …」`,
  quickReply: { items: TIP_Q.map(t => ({ type: 'action', action: { type: 'message', label: t, text: t } })) }
};

const api = env => env.LINE_API || 'https://api.line.me';   // 測試時指到假的 LINE
// 推播對象：LINE_TO（沒設＝LINE_ALLOW）＋核准過、自己打「訂閱推播」的朋友（line.mjs pushIds）
const recipients = (env, why) => pushIds(env, why);

// 把佇列推出去：查額度 → 建地圖 → 推 → 清空佇列；額度不夠就留著
//   qIn：測試推播用自己那份（不碰正式佇列）
export async function flush(env, why, ms = Date.now(), qIn = null) {
  const S = store(env);
  if (why === 'end') return { pushed: 0, why, note: '20 點不再收尾（11/07 改規則），留到明天 9 點一起推' };
  const qAll = qIn || merge(await S.get('nq', 'json'));
  // 特急：只推 85 分以上那幾件，其餘（含客戶新配對）留到明天早上
  const isU = c => c.sc >= RULE.urgent;
  const q = why === 'urgent' ? { cards: qAll.cards.filter(isU), clients: {}, pushes: qAll.pushes } : qAll;
  const rest = why === 'urgent' ? { cards: qAll.cards.filter(c => !isU(c)), clients: qAll.clients } : { cards: [], clients: {} };
  if (!count(q)) return { pushed: 0, why, note: '沒有累積的' };
  const all = await recipients(env, why), to = why === 'test' ? all.slice(0, 1) : all;
  if (!to.length || !env.LINE_TOKEN) return { pushed: 0, why, note: '沒設 LINE_TOKEN／推播對象' };
  const H = { Authorization: `Bearer ${env.LINE_TOKEN}` };
  const day = tw(ms).toISOString().slice(0, 10), used = q.pushes[day] || 0;
  if (why !== 'test') {
    const [qa, qu] = await Promise.all([fetch(`${api(env)}/v2/bot/message/quota`, { headers: H }).then(r => r.json()),
      fetch(`${api(env)}/v2/bot/message/quota/consumption`, { headers: H }).then(r => r.json())]);
    if (qa.type === 'limited') {
      const left = qa.value - qu.totalUsage, t = tw(ms);
      const daysLeft = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate() - t.getUTCDate() + 1;
      // 早上那則優先：只要扣完還剩保留的 10 則就推；特急件要先留足「月底前每天早上」的份（剩幾天 × 人數）才推
      const keep = RULE.reserve + (why === 'start' ? 0 : (daysLeft - 1) * to.length);
      if (left - to.length < keep)
        return { pushed: 0, why, n: count(q), note: `額度不夠先留著（本月剩 ${left} 則，要先留 ${keep} 則給之後每天早上）` };
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
    body: JSON.stringify({ to: multi ? to : to[0], messages: [{ type: 'text', text: text.toWellFormed() },
      // 早上 9 點附開發查詢小抄（同一次推送的第二個對話框：LINE 額度算「次數×人數」，一次最多 5 框都算 1 則；按鈕點了是查詢＝回覆，不花額度）
      ...(why === 'start' ? [TIP] : [])] })
  });
  if (!r.ok) return { pushed: 0, why, n: count(q), note: `LINE 推播失敗 ${r.status} ${(await r.text()).slice(0, 200)}` };
  const n = count(q);
  if (!qIn) await S.put('nq', JSON.stringify({ ...rest, pushes: { [day]: used + to.length } }));   // 測試推播不清累積；特急只拿掉推過的
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
  if (!why) return { queued: count(q), pushed: 0, note: tw(ms).getUTCHours() >= RULE.end || tw(ms).getUTCHours() < RULE.start ? '晚上只累積，早上 9 點推' : `累積到明天 9 點（白天只有 ${RULE.urgent} 分以上才即時推）` };
  return { queued: count(q), ...(await flush(env, why, ms)) };
}

// Worker 定時觸發：台灣 09:00（UTC 01:00）推整晚累積的、20:00（UTC 12:00）收尾
export const CRON = { '0 1 * * *': 'start', '0 12 * * *': 'end' };

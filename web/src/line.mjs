// LINE 官方帳號對話查詢（webhook：/api/line/webhook）
//   例：「太平可開發案件」「太平優質大樓」「東區優質透天」「20年內透天」「南屯 1500萬以下 3房」「更多」
//   資料：tools/line-index.js 在 Actions 上傳的 KV line-meta／line-<n>（每區一小份，Worker 不解析大檔）
//   回覆（reply）不算 LINE 每月推播額度
// 秘密值：LINE_SECRET（驗簽）、LINE_TOKEN（回覆）、LINE_ALLOW（可以查的 LINE userId，逗號分隔）
const PAGE = 8;
const GOOD = 60;   // 「優質」＝分數 ≥60，跟推播門檻一樣（tools/notify.js NOTIFY_SCORE）
const SITE = 'https://case-radar.yusheng1386.workers.dev';

const HELP = `🏠 案件雷達查詢
直接打條件，可以混著用：
・區域：太平、東區、南屯大里…（不打＝主力五區）
・類型：大樓／透天／公寓
・優質：分數 ≥${GOOD}
・屋齡：20年內、少於10年、10年以上
・總價：1500萬以下、1000-2000萬
・坪數：30坪以上
・房數：3房、3房以上
・屋主：有屋主在賣；只有屋主：沒有仲介
・新：24 小時內新上架；這週：7 天內
・降價、急售、賠售、低於實登
例：「東區優質透天」「20年內透天」「太平屋主 1500萬以下」
回「更多」看下一頁`;

// 中文數字（二十年、十五年）→ 阿拉伯數字
function cnum(s) {
  const D = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  return s.replace(/[一二兩三四五六七八九]?十[一二三四五六七八九]?|[零一二兩三四五六七八九]/g, m => {
    if (!m.includes('十')) return String(D[m]);
    const [a, b] = m.split('十');
    return String((a ? D[a] : 1) * 10 + (b ? D[b] : 0));
  });
}

export function parse(text, districts, main) {
  let s = cnum(String(text).replace(/\s+/g, ' ').trim()).replace(/[，,、]/g, ' ')
    // 「少於10年」「超過30坪」「不到1500萬」→ 統一成「10年以下」「30坪以上」再往下解析
    .replace(/(?:少於|小於|低於|不到|未滿|不超過|不超出|<|＜)\s*(\d+(?:\.\d+)?)\s*(年|千萬|萬|坪|房)?/g, (_, n, u) => `${n}${u || ''}以下`)
    .replace(/(?:大於|超過|高於|多於|至少|>|＞)\s*(\d+(?:\.\d+)?)\s*(年|千萬|萬|坪|房)?/g, (_, n, u) => `${n}${u || ''}以上`);
  const q = { ds: [], label: [] };
  // 區域：完整區名優先；三字區名可省略「區」（太平、南屯）；東區／南區這種二字的要打「區」
  const ds = [...districts].sort((a, b) => b.length - a.length);
  for (const d of ds) {
    const short = d.length >= 3 ? d.replace(/區$/, '') : null;
    if (s.includes(d)) { q.ds.push(d); s = s.replace(d, ' '); }
    else if (short && s.includes(short)) { q.ds.push(d); s = s.replace(short, ' '); }
  }
  if (!q.ds.length) { q.ds = main.filter(d => districts.includes(d)); q.label.push('主力五區'); }
  else q.label.push(q.ds.join('、'));

  if (/透天|別墅/.test(s)) q.ty = '透天';
  else if (/公寓/.test(s)) q.ty = '公寓';
  else if (/大樓|華廈|電梯/.test(s)) q.ty = '大樓';
  if (q.ty) q.label.push(q.ty);

  if (/優質|精選|好案|高分/.test(s)) { q.good = true; q.label.push(`優質（分數≥${GOOD}）`); }

  let m;
  if ((m = s.match(/(\d+)\s*年\s*(?:內|以內|以下|之內)/) || s.match(/屋齡\s*(\d+)\s*(?:內|以內|以下)/))) {
    q.ageMax = +m[1]; q.label.push(`屋齡≤${q.ageMax}年`);
  }
  if ((m = s.match(/(?:屋齡)?\s*(\d+)\s*年\s*以上/))) { q.ageMin = +m[1]; q.label.push(`屋齡≥${q.ageMin}年`); }
  if (/新成屋|新古屋/.test(s) && q.ageMax == null) { q.ageMax = 5; q.label.push('屋齡≤5年'); }

  // 總價（萬）：1000-2000萬、1500萬以下、2000萬以上、預算1500
  const wan = x => /千萬/.test(x) ? parseFloat(x) * 1000 : parseFloat(x);
  if ((m = s.match(/(\d+(?:\.\d+)?)\s*(?:萬)?\s*[-~～到至]\s*(\d+(?:\.\d+)?)\s*(千萬|萬)/))) {
    q.pMin = wan(m[1] + m[3]); q.pMax = wan(m[2] + m[3]);
  } else {
    if ((m = s.match(/(\d+(?:\.\d+)?)\s*(千萬|萬)\s*(?:以下|以內|內)/) || s.match(/預算\s*(\d+(?:\.\d+)?)\s*(千萬|萬)?/))) q.pMax = wan(m[1] + (m[2] || '萬'));
    if ((m = s.match(/(\d+(?:\.\d+)?)\s*(千萬|萬)\s*以上/))) q.pMin = wan(m[1] + m[2]);
  }
  if (q.pMin != null || q.pMax != null) q.label.push(`總價${q.pMin ?? ''}–${q.pMax ?? ''}萬`);

  if ((m = s.match(/(\d+(?:\.\d+)?)\s*坪\s*以上/))) { q.aMin = +m[1]; q.label.push(`≥${q.aMin}坪`); }
  if ((m = s.match(/(\d+(?:\.\d+)?)\s*坪\s*(?:以下|以內|內)/))) { q.aMax = +m[1]; q.label.push(`≤${q.aMax}坪`); }

  if ((m = s.match(/(\d)\s*房\s*(以上)?/))) { q.r = +m[1]; q.rUp = !!m[2]; q.label.push(`${q.r}房${q.rUp ? '以上' : ''}`); }

  if (/只有屋主|純屋主|沒有仲介/.test(s)) { q.own = 2; q.label.push('只有屋主在賣'); }
  else if (/屋主|自售/.test(s)) { q.own = 1; q.label.push('有屋主在賣'); }

  if (/這週|本週|7天|1週/.test(s)) { q.since = 7; q.label.push('7天內新上架'); }
  else if (/新案|新的|最新|今天|新上架/.test(s)) { q.since = 1; q.label.push('24小時內新上架'); }

  for (const [re, t] of [[/降價/, '降價'], [/急售|秒殺/, '急售'], [/賠售|認賠/, '賠售'], [/低於實登|低於行情/, '低於實登']]) {
    if (re.test(s)) (q.tags = q.tags || []).push(t);
  }
  if (q.tags) q.label.push(q.tags.join('＋'));
  // 沒打區域也沒任何條件（例如「你好」）→ 回說明，不把五區全部丟出來
  q.none = q.label.length === 1 && q.label[0] === '主力五區' && !/可開發|案件|全部|列出|有哪些/.test(s);
  return q;
}

export function filter(items, q, now = Date.now()) {
  return items.filter(x =>
    (!q.ty || x.ty === q.ty) &&
    (!q.good || x.sc >= GOOD) &&
    (q.ageMax == null || (x.ag != null && x.ag <= q.ageMax)) &&
    (q.ageMin == null || (x.ag != null && x.ag >= q.ageMin)) &&
    (q.pMax == null || (x.p != null && x.p <= q.pMax)) &&
    (q.pMin == null || (x.p != null && x.p >= q.pMin)) &&
    (q.aMin == null || (x.ar != null && x.ar >= q.aMin)) &&
    (q.aMax == null || (x.ar != null && x.ar <= q.aMax)) &&
    (q.r == null || (x.r != null && (q.rUp ? x.r >= q.r : x.r === q.r))) &&
    (!q.own || x.own >= q.own) &&
    (!q.since || (x.g == null && now - x.f <= q.since * 864e5)) &&
    (!q.tags || q.tags.every(t => t === '降價' ? (x.dr > 0 || x.tg.includes('降價')) : t === '急售' ? x.tg.includes('急售') || x.tg.includes('秒殺') : x.tg.includes(t)))
  ).sort((a, b) => b.sc - a.sc);
}

export function page(res, q, off, at) {
  const t = new Date(Date.parse(at) + 8 * 3600e3);
  const when = `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
  if (!res.length) return `${q.label.join('・')}\n目前沒有符合的可開發案件（資料 ${when}）\n\n打「說明」看可以用的條件`;
  const sl = res.slice(off, off + PAGE);
  let msg = `${q.label.join('・')}\n共 ${res.length} 件，第 ${off + 1}–${off + sl.length} 件（照分數排；資料 ${when}）\n\n` + sl.map(x => x.x).join('\n');
  msg += off + PAGE < res.length ? `\n\n回「更多」看下 ${Math.min(PAGE, res.length - off - PAGE)} 件` : '\n\n（已經是最後一頁）';
  return msg.slice(0, 4900);
}

// ---------- webhook ----------
async function verify(raw, sig, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, raw));
  const b64 = btoa(String.fromCharCode(...mac));
  if (!sig || sig.length !== b64.length) return false;
  let r = 0;
  for (let i = 0; i < b64.length; i++) r |= b64.charCodeAt(i) ^ sig.charCodeAt(i);
  return r === 0;
}

async function reply(env, token, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST', headers: { Authorization: `Bearer ${env.LINE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyToken: token, messages: [{ type: 'text', text }] })
  });
}

async function answer(env, uid, text) {
  const t = text.trim();
  if (/^(說明|help|\?|？|怎麼用|指令)$/i.test(t)) return HELP;
  const meta = await env.BLOBS.get('line-meta', 'json');
  if (!meta) return '還沒有資料，等下一次排程更新後再試';
  const stKey = `lq-${uid}`;
  let q, off = 0;
  if (/^(更多|下一頁|more|下頁)$/i.test(t)) {
    const st = await env.BLOBS.get(stKey, 'json');
    if (!st) return '沒有上一次的查詢，直接打條件，例如「東區優質透天」';
    q = st.q; off = st.off + PAGE;
  } else {
    q = parse(t, meta.districts, meta.main);
    if (q.none) return HELP;
  }
  const parts = await Promise.all(q.ds.map(d => env.BLOBS.get(`line-${meta.districts.indexOf(d)}`, 'json')));
  const items = parts.filter((p, i) => p && p.d === q.ds[i]).flatMap(p => p.items);
  const res = filter(items, q);
  if (off >= res.length && off) return '已經是最後一頁了';
  await env.BLOBS.put(stKey, JSON.stringify({ q, off }), { expirationTtl: 3600 });
  return page(res, q, off, meta.at) + `\n${SITE}/#dev`;
}

export async function webhook(req, env) {
  const raw = await req.arrayBuffer();
  if (!env.LINE_SECRET || !(await verify(raw, req.headers.get('x-line-signature'), env.LINE_SECRET)))
    return new Response('bad signature', { status: 401 });
  const ev = JSON.parse(new TextDecoder().decode(raw)).events || [];
  const allow = new Set(String(env.LINE_ALLOW || '').split(',').map(s => s.trim()).filter(Boolean));
  for (const e of ev) {
    if (!e.replyToken) continue;
    const uid = e.source?.userId || '';
    if (!allow.has(uid)) {
      // 還沒開權限：回對方的 ID，讓管理者加進 LINE_ALLOW（tools/setup-line.sh）
      if (e.type === 'message' || e.type === 'follow') await reply(env, e.replyToken, `你的 LINE ID：\n${uid}\n\n請管理者把這串加進查詢名單後就能用`);
      continue;
    }
    if (e.type === 'follow') { await reply(env, e.replyToken, HELP); continue; }
    if (e.type !== 'message' || e.message?.type !== 'text') continue;
    await reply(env, e.replyToken, await answer(env, uid, e.message.text));
  }
  return new Response('ok');
}

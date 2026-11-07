// LINE 智能客服（11/07 用戶：「能不能像客服 agent 隨時智能回答，排除沒辦法回答的問題」）
//   規則先跑（快、準、不花額度）；規則答不好的才問 AI：看不懂／找不到地點／0 件／只回了說明或整份規則
//   AI 只做三件事，輸出 JSON：
//     search：把口語翻成系統看得懂的寫法（「雙主臥」→雙衛、「公司還沒簽」→預設就排除），再照規則查 → 結果一樣是真的案件
//     answer：用法／規則問題，只能根據 rules.mjs 的 KNOW＋查詢說明回答（不准編案件、數字）
//     none：跟系統無關或系統沒有的資料（貸款、稅、法規、某案屋主電話、議價空間…）→ 老實說答不了，記進管理者「問題」
//   模型：Cloudflare Workers AI（wrangler.toml [ai]，免費方案每天 1 萬 neurons，用完當天就不叫，不會收費、不用金鑰）
//   每人每天最多 AI_DAY 次（D1 blobs ai-<userId>-<日期>）
import { KNOW } from './rules.mjs';

const MODELS = ['@cf/qwen/qwen3-30b-a3b-fp8', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'];
const AI_DAY = 60;
const TIMEOUT = 20000;

const sys = help => `你是「案件雷達」LINE 官方帳號的客服。案件雷達是台中房仲用的找房系統：每天抓 591、5168、信義、住商、東森的台中售屋，給仲介找「開發案」（有機會簽委託的）跟幫客人「配對」。
使用者是房仲同事。你只會收到「系統規則看不懂、或查不到」的句子，你的工作是判斷要怎麼處理，只輸出一個 JSON，不要其他文字。

三種輸出：
1. 找房／找案件／配對 → {"type":"search","q":"改寫後的查詢","note":"哪些條件系統沒有、怎麼替代的（沒有就空字串）"}
2. 問系統用法、規則、分數、同公司、推播、連結 → {"type":"answer","text":"回答"}
3. 系統沒辦法回答的 → {"type":"none","text":"一句話說為什麼答不了，以及可以怎麼做"}

【search 改寫規則】
- q 只能用下面「查詢寫法」裡有的條件，用空格分開，例：「配對 西區 4房以上 雙衛 雙車位 8000萬以下」
- 保留使用者所有條件；系統看不懂的說法換成最接近的寫法；完全沒有對應的就拿掉，寫進 note
- 常見對照：雙主臥→雙衛；三車位以上→雙車位（系統最多到雙車位）；大坪數→40坪以上；小坪數→25坪以下；預算X萬內→X萬以下；X分鐘車程→「地標 開車X分鐘」；走路→「地標 走路X分鐘」；好學區→學區；有景觀→景觀
- 「公司還沒簽」「沒有同體系」「還沒被開發」＝開發預設就排除同公司 → 不用寫
- 原句有「配對／客戶／客人／買方」，或明顯是買方需求（預算、要幾房幾車位、帶客人看）→ q 前面加「配對」；找開發案、屋主、降價、分數 → 不加
- 「超過80分」→「分數80以上」；「這一週」→「這週」；「或」連接的多個區域 → 全部列出（「西區或七期」→「西區 西屯 七期」，七期在西屯）
- 貼了一大段社區介紹 → 只取社區名／路名／區域當條件
- 使用者說「那大里呢」「改成透天」這種接續的話 → 拿「上一次查詢」的全部條件，只換掉他說要改的那一項。例：上一次「配對 南屯 3房 1500萬以下 平面車位」＋「那大里呢」→「配對 大里 3房 1500萬以下 平面車位」；＋「改成透天」→「配對 南屯 3房 1500萬以下 平面車位 透天」
- 不要自己加使用者沒說的條件：沒說區域就不寫區域（系統會查主力區）、沒說類型就不寫透天／大樓、沒說房數就不寫房數
- 捷運X線附近／捷運站附近→近捷運；新一點／新的→10年內；老公寓→公寓 30年以上；便宜→最便宜（排序，不要自己編總價）；只打一個總價（「1500萬」）→「1500萬左右」
- 打錯字照意思改：三防→3房、透天厝→透天、電梯大樓→大樓
- note 只寫「拿掉的條件」跟「意思被換掉的條件」（例：三車位→雙車位），寫法格式的改變不用寫，最多 2 句
- 附近地點要用找得到的：路名、學校、公園、美術館、百貨等知名地標；社區名、建案名不要拿來當附近地點（找不到），改用它所在的路名或旁邊的地標

【answer 規則】
- 只能根據下面「系統說明」回答，3～6 行，口語、繁體中文
- 系統說明裡有提到的就一定用 answer（例：資料準不準、連結打不開、可不可以查租屋／土地／台北、怎麼加同事、地圖、推播、為什麼某件沒出現），不要用 none；說明寫「沒有」的就照實說沒有
- 不准編造案件、價格、數字、功能；說明裡沒寫的就改用 none
- 問特定一件案子的細節（屋主是誰、能不能議價、為什麼這件幾分）→ 依說明講分數怎麼算，細節請他點連結或打「回報」

【none 的情況】
- 跟找房系統無關：貸款試算、稅費、法規、契約、天氣、閒聊、寫文案
- 系統沒有的資料：屋主電話、內部成交、實際議價空間、還沒上架的物件
- 要改系統、加帳號、管理功能
text 要客氣，最後提醒可以打「回報 ＋你想要的功能」

=== 查詢寫法 ===
${help}

=== 系統說明 ===
${Object.values(KNOW).join('\n\n')}`;

let SYS = null;

// LINE 的「輸入中…」動畫（一對一聊天才有，不算推播額度）
async function typing(env, uid) {
  if (!env.LINE_TOKEN || env.LINE_API || !uid.startsWith('U')) return;
  try {
    await fetch('https://api.line.me/v2/bot/chat/loading/start', {
      method: 'POST', headers: { Authorization: `Bearer ${env.LINE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: uid, loadingSeconds: 20 })
    });
  } catch { }
}

const textOf = r => typeof r === 'string' ? r : typeof r?.response === 'string' ? r.response
  : r?.response && typeof r.response === 'object' ? JSON.stringify(r.response) : r?.choices?.[0]?.message?.content || '';

// 模型輸出 → JSON（去掉 <think>、```、前後廢話）
export function pick(s) {
  s = String(s || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try {
    const j = JSON.parse(s.slice(a, b + 1));
    return ['search', 'answer', 'none'].includes(j?.type) ? j : null;
  } catch { return null; }
}

async function callAI(env, help, user) {
  SYS = SYS || sys(help);
  for (const model of MODELS) {
    try {
      const run = env.AI.run(model, {
        messages: [{ role: 'system', content: SYS }, { role: 'user', content: user + (model.includes('qwen3') ? ' /no_think' : '') }],
        max_tokens: 700, temperature: 0.2
      });
      const r = await Promise.race([run, new Promise((_, no) => setTimeout(() => no(new Error('逾時')), TIMEOUT))]);
      const j = pick(textOf(r));
      if (j) return { ...j, model };
      console.log(`[AI] ${model} 輸出不是 JSON：${textOf(r).slice(0, 200)}`);
    } catch (e) { console.log(`[AI] ${model} 失敗：${e.message}`); }
  }
  return null;
}

// 改寫裡出現、原句（含上一句）沒提到的區域／類型／房數
const DIST = '中區 東區 南區 西區 北區 北屯 西屯 南屯 太平 大里 霧峰 烏日 豐原 后里 石岡 東勢 和平 新社 潭子 大雅 神岡 大肚 沙鹿 龍井 梧棲 清水 大甲 外埔 大安'.split(' ');
const TYPES = ['透天', '大樓', '公寓', '華廈', '套房', '別墅'];
const GROUP = /屯區|海線|山城|山線|舊市區|三屯|全台中|七期|十期|重劃/;
export function invented(q, src) {
  const out = [];
  for (const d of DIST) if (q.includes(d) && !src.includes(d) && !(d === '西屯' && /七期|逢甲|中科|西屯/.test(src)) && !(GROUP.test(src))) out.push(d);
  for (const ty of TYPES) if (q.includes(ty) && !src.includes(ty) && !(ty === '大樓' && /電梯|大廈|豪宅/.test(src)) && !(ty === '透天' && /透天|別墅/.test(src)) && !(ty === '公寓' && /公寓/.test(src))) out.push(ty);
  if (/\d房/.test(q) && !/房|[一二三四五六七八九\d]\s*[房防]/.test(src)) out.push(q.match(/\d房\S*/)[0]);
  // 「便宜」→ 自己編總價（11/07 模擬：「東區便宜的老公寓」→「1500萬以下」）
  if (/\d+萬/.test(q) && !/\d|[一二三四五六七八九十百千]+萬|預算/.test(src)) out.push(q.match(/\S*\d+萬\S*/)[0]);
  return out;
}

const twDay = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const norm = s => String(s).replace(/\s+/g, ' ').trim();

// 規則的回覆不夠好時才叫（out＝規則的回覆、r＝outcome 分類）
//   answerFor：line.mjs 的查詢函式（用改寫後的句子再查一次）；outcome：分類
//   回傳 null＝維持規則的回覆
// 學起來（11/07 用戶：持續學習、累積的問題持續優化）
//   AI 改寫後查得到的句子 → learn-<句子>（90 天）：下次同一句不叫 AI、直接用（快、不花額度）
//   最近學到的 LEARN_MAX 組放進 learn-list，當範例一起給 AI（越用越懂這群朋友的說法）
//   接續上一句的（「那大里呢」）跟上一句有關，不學
const LEARN_MAX = 30, LEARN_DAYS = 90;
const learnKey = t => `learn-${norm(t).slice(0, 80)}`;
async function learn(S, t, q) {
  await S.put(learnKey(t), JSON.stringify({ q, at: twDay() }), { expirationTtl: LEARN_DAYS * 86400 });
  const list = ((await S.get('learn-list', 'json')) || []).filter(([a]) => a !== norm(t));
  list.push([norm(t).slice(0, 120), q]);
  await S.put('learn-list', JSON.stringify(list.slice(-LEARN_MAX)), { expirationTtl: LEARN_DAYS * 86400 });
}

export async function aiAssist(env, S, uid, t, out, r, { answerFor, outcome, help, last, follow }) {
  // 學過的句子：直接用，不叫 AI
  if (!follow) {
    const got = await S.get(learnKey(t), 'json');
    // 學到的也要過同樣的檢查（之前學到的可能是舊規則下的錯改寫）
    if (got?.q && !invented(got.q, t).length) {
      if (/客戶|客人|買方|首購|幫.*找房|配對/.test(t) && !/^(配對|客戶)/.test(got.q)) got.q = `配對 ${got.q}`;
      const out2 = await answerFor(S, uid, got.q);
      const r2 = outcome(out2);
      if (typeof r2 === 'number' && r2 > 0) return { out: `🤖 我理解成：「${got.q}」\n\n${out2}`, r: r2, ai: got.q, model: 'learned' };
    }
  }
  if (!env.AI) return null;
  const k = `ai-${uid}-${twDay()}`;
  const n = Number(await S.get(k)) || 0;
  if (n >= AI_DAY && !uid.startsWith('Xai-')) return null;   // 測試 ID（tools/line-ai.sh）不限次數
  await S.put(k, String(n + 1), { expirationTtl: 2 * 86400 });
  await typing(env, uid);
  const why = r === 'x' ? '系統看不懂' : r === 'geo' ? '找不到地點' : r === 0 ? '查到 0 件' : typeof r === 'number' ? '系統只照這一句查，可能漏了上一次的條件或看不懂的字' : '系統只回了說明';
  const ex = (await S.get('learn-list', 'json')) || [];
  const user = (ex.length ? `以前改寫成功的例子（同樣說法照這樣改）：\n${ex.slice(-15).map(([a, b]) => `「${a}」→「${b}」`).join('\n')}\n\n` : '')
    + `${last?.text && last.text !== t ? `上一次查詢：「${last.text}」\n` : ''}使用者說：「${t.slice(0, 1500)}」\n（${why}）`;
  let a = await callAI(env, help, user);
  if (!a) return null;
  // 改寫後還是找不到地點／0 件 → 把結果告訴 AI 再改一次（最多 2 輪）
  let best = null;
  for (let round = 0; round < 2 && a?.type === 'search' && a.q && norm(a.q) !== norm(t); round++) {
    let q = norm(a.q).slice(0, 200);
    // 講到客人／買方就一定是配對（11/07 模擬：「有個客戶要找南屯惠文國小附近」AI 漏了配對）
    if (/客戶|客人|買方|首購|幫.*找房|配對/.test(t) && !/^(配對|客戶)/.test(q)) q = `配對 ${q}`;
    // AI 自己加了使用者沒說的區域／類型／房數 → 退回去重改（11/07 模擬：「1500萬」→「北屯 1500萬以下」）
    const added = invented(q, t + ' ' + (last?.text || ''));
    if (added.length) {
      if (round === 1) { a = null; break; }
      a = await callAI(env, help, `${user}\n\n你上次改寫成「${q}」，但加了使用者沒說的「${added.join('、')}」。拿掉這些，再輸出一次 JSON。`);
      continue;
    }
    const out2 = await answerFor(S, uid, q);
    const r2 = outcome(out2);
    const note = a.note ? `\n（${String(a.note).slice(0, 200)}）` : '';
    const res = { out: `🤖 我理解成：「${q}」${note}\n\n${out2}`, r: r2, ai: q, model: a.model };
    if (typeof r2 === 'number' && r2 > 0) {
      if (!follow && t.length <= 200) await learn(S, t, q).catch(e => console.log(`[AI] 學習寫入失敗 ${e.message}`));
      return res;
    }
    if (r2 === 0 && !best) best = res;
    if (round === 1) break;
    const fail = r2 === 'geo' ? `找不到地點（${out2.split('\n')[0]}）。地點請換成附近的路名或知名地標（學校、美術館、百貨、公園），或拿掉附近條件`
      : r2 === 0 ? '查到 0 件。把最不重要的條件拿掉或放寬（例如房數改「以上」、坪數放寬），寫進 note' : '系統還是看不懂，只用查詢寫法裡有的詞';
    a = await callAI(env, help, `${user}\n\n你上次改寫成「${q}」，結果：${fail}。請再輸出一次 JSON。`);
  }
  if (best && r !== 0) return best;
  if (a?.type === 'search') return null;
  if (!a) return null;
  if (a.type === 'answer' && a.text)
    return { out: `🤖 ${String(a.text).slice(0, 1500)}\n\n（AI 依使用規則回答，細節以「規則」為準；不對請打「回報」）`, r: 'ai', model: a.model };
  if (a.type === 'none')
    return { out: `🤖 ${String(a.text || '這個問題我沒辦法回答').slice(0, 600)}`, r: 'ai-x', model: a.model };
  return null;
}

// 使用規則（11/07 用戶：朋友看了還不完全清楚作業方式 → 開發、配對、同公司都寫清楚，放在對話底下的選單＝置頂）
//   LINE 打「規則」「開發規則」「配對規則」「同公司」「推播規則」回這些；完整版網頁 /guide（public/guide.html，免登入）
//   數字跟程式一致：lib/core.js scoreOf（分數）、tools/notify.js（推播條件）、pushq.mjs（推播時段）、core.matchSameSystem（同體系）
//   改規則時兩邊一起改
const SITE = 'https://case-radar.yusheng1386.workers.dev';
export const GUIDE_URL = `${SITE}/guide`;

const OVERVIEW = `📖 案件雷達作業方式
系統每天多次自動抓台中售屋（591、5168、信義、住商、東森），同一戶在好幾個平台會合併成一件，分三種用法：

🔎 開發：找「有機會簽」的案子
只列有競爭力的（屋主自售、急售、降價、比社區成交低…），每件有分數，60 分以上＝優質。同公司已經在賣的不列。

🤝 配對：幫客人找房
前面加「配對」，所有在架物件只要符合條件就列，不看分數，同公司的也會列（標🔒）。

🔒 同公司物件
我們體系的店已經在賣的，開發不列、不推播，避免重複踩；配對時照列。

🔔 推播：每天早上 9 點更新，其他時間點「今天的案件」或打字自己找。

點下面按鈕看各項細節，完整說明：${GUIDE_URL}`;

const DEV = `🔎 開發怎麼看
【列哪些】主力 8 區：南屯、南區、西區、東區、大里、太平、北屯、西屯（打路名、社區名或「全台中」可查全部）
有屋主刊登的都列；其他要 20 分以上

【分數怎麼來】加總、最高 100
・賠售 +25、標示低於行情 +25、急售 +18、超值 +12
・屋主自售 +12；只有屋主在賣、沒有仲介 再 +8（最好開發）
・降價：系統實測降幅越大分越高（最多 +25）；只有平台標「降價」+10
・開價比同社區實價登錄成交低：低一點 +20、低 8% +30、低 15% +40；比社區最低成交還低 再 +10
・跟附近同等級社區同房數、坪數相近的成交比還是低：+10～+30（最強訊號）
・5 位以上仲介在刊 −5（多半一般約、競爭大）
60 分以上＝優質，85 分以上＝特急

【每件寫的理由】分數下一行就是為什麼值得看，例如「只有屋主在賣・降價6%・比同等級社區低9%」

【連結跟數字】
同一戶有好幾個平台時，優先給房仲品牌（信義、住商、東森），再來 5168，591 最後；推之前會再測一次，下架了就換同一戶的其他平台。總價也以品牌平台為準。
⚠️ 591 多半是仲介自己填，坪數、價格不一定正確，只有 591 的案子數字請以現場、謄本為準。

查法：「東區優質透天」「只有屋主 這週」「這週 降價」「分數80以上」`;

const MATCH = `🤝 配對怎麼用（幫客人找房）
前面加「配對」或「客戶」，後面打客人的條件：
「配對 南屯 3房 1500萬以下 平面車位」
「配對 大里 2000萬內 透天 20年內」
「配對 科博館 開車10分鐘 大樓 2房」

【跟開發差在哪】
・開發只列有競爭力的；配對是所有在架物件，只要符合條件就列，不看分數
・配對預設含同公司的物件（標🔒，可以直接帶客人看）；不要的話加「不要同體系」
・排序：「最便宜」「單價最低」「最新」「坪數最大」
・回「更多」看下一頁，每次附地圖

條件可以混著打：區域、類型、總價、單價、坪數、主建物、房數、屋齡、樓層、車位、附近地標、特色（近捷運、學區、邊間…）。打「說明」看全部寫法。`;

const SAME = `🔒 同公司（同體系）物件
我們體系的店已經在賣的物件，系統會自動比對出來：
・同一區，而且同社區或同路段
・總價差 8% 內；兩邊都有坪數 → 坪差 5% 內；兩邊都有樓層 → 樓層相同
・坪數、樓層都比不了 → 只認同社區、價差 3% 內
・另外，591 刊登寫的是我們體系的分店、經紀業公司名、經紀業證號或店電話 → 直接算同公司（體系共 10 家店）；同一戶在信義、住商等別的平台的刊登也一起算

【怎麼處理】
・開發：預設不列、不推播（同公司已經有了，不重複踩）
・要看就打「含同體系」一起列（標🔒），「只看同體系」只列同公司的
・配對：預設照列（標🔒），可以直接帶客人看；「不要同體系」排除

【比對錯了】
看到明明是同公司的卻被當開發案、或不是同一戶卻被標🔒 → 打「回報 ＋案件＋哪裡錯」，會人工確認後修正。`;

// 11/07 用戶：使用者的推播規則不用講那麼多，知道「每天 9 點更新、其他時間自己找」就好（85 分特急等細節只寫在程式／交接）
const PUSH = `🔔 推播
・每天早上 9 點更新一次
・其他時間自己找：點選單「今天的案件」（24 小時內新上架的），或直接打字查，例如「這週 降價」「只有屋主 這週」`;

export const RULE_BTNS = ['開發規則', '配對規則', '同公司', '推播規則', '範例'];
export function rulesFor(t) {
  if (/^(規則|使用規則|作業方式|怎麼運作|運作方式|系統說明)$/.test(t)) return OVERVIEW;
  if (/^(開發規則|開發怎麼看|開發說明|分數|分數怎麼算|評分)$/.test(t)) return DEV;
  if (/^(配對規則|配對怎麼用|配對說明)$/.test(t)) return MATCH;
  if (/^(同公司|同體系|同公司物件|同體系規則|同公司規則|同體系說明)$/.test(t)) return SAME;
  if (/^(推播規則|推播說明|推播)$/.test(t)) return PUSH;
  return null;
}

const LINK = `🔗 連結打不開／資料怪怪的
・同一戶有好幾個平台時，連結優先給房仲品牌（信義、住商、東森），再來 5168，591 最後；傳出去前會再測一次，下架就換同一戶的其他平台
・全部平台都下架才附「案件快照」頁（不用登入），可能已經賣掉或廣告到期
・591 多半是仲介自己填，坪數、價格不一定正確；只有 591 的案子請以現場、謄本為準
・還是打不開或資料明顯錯 → 打「回報 ＋案件＋哪裡錯」`;

// 常見問題（11/07 模擬使用者問題補的；只給 AI 客服當知識，不另外顯示）
const FAQ = `❓ 常見問題
・範圍：只有台中市的「售屋」；租屋、土地、廠房、農地、台中以外（台北等）目前都沒有
・類型：大樓、華廈、公寓、透天、別墅、套房；店面用「店面」查
・資料來源：591、5168、信義、住商、東森，每天自動抓好幾次；實價登錄 7 天更新一次
・地圖：每次查詢最後都有「🗺 地圖」連結，不用登入，點標記看案件、再點連結看刊登
・翻頁：回「更多」看下一頁
・推播：選單或打「訂閱推播」開、「取消推播」關（每天早上 9 點）
・加同事：請同事加這個官方帳號、傳任何一句話，管理者核准後就能用
・找不到某一件：可能是同公司在賣（開發不列，打「含同體系」）、分數不到 20、已下架、或不在主力區（加區名或「全台中」）
・資料錯或連結打不開：打「回報 ＋案件＋哪裡錯」
・網站（客戶、帶看、開發進度）要帳號登入，LINE 查詢不用`;

// AI 客服的知識庫（web/src/ai.mjs）：只能根據這些回答；改規則時這裡自動跟著變
export const KNOW = { OVERVIEW, DEV, MATCH, SAME, PUSH, LINK, FAQ };

// 朋友用問句問「怎麼用」（11/07 用戶：有問題除了回報，能不能線上解決）→ 直接回對應的規則
//   只在句子不像查詢時才用（answerFor 先 parse：沒有區域、沒有任何條件，只剩看不懂的字）
const ASK = /怎麼|怎樣|如何|為什麼|為何|什麼|甚麼|意思|是指|幾點|多久|會不會|可不可以|能不能|有沒有辦法|嗎|呢|？|\?/;
const TOPICS = [
  [/租屋|出租|土地|廠房|農地|建地|台北|新北|桃園|新竹|苗栗|彰化|南投|雲林|嘉義|台南|高雄|屏東|宜蘭|花蓮|台東|外縣市|其他縣市|沒有出現|沒出現|找不到.*(那|這)件|為什麼.*沒(有)?(列|出現)/, FAQ],
  [/連結|網址|打不開|點不開|下架|過期|登入|帳號|591|資料.*(錯|怪|不對)|價格.*(錯|不對)|坪數.*(錯|不對)/, LINK],
  [/同公司|同體系|🔒|鎖頭|自己公司|我們公司/, SAME],
  [/推播|通知|幾點|更新|今天的案件|今日案件|訂閱/, PUSH],
  [/配對|客人|客戶|幫.*找/, MATCH],
  [/分數|評分|幾分|優質|特急|開發|排序|怎麼排|列哪些|為什麼.*(有|沒有|列)/, DEV],
  [/規則|用法|怎麼用|怎麼查|怎麼問|怎麼打|作業|運作|功能/, OVERVIEW]
];
export function answerQuestion(t) {
  if (!ASK.test(t)) return null;
  for (const [re, txt] of TOPICS) if (re.test(t)) return txt;
  return null;
}

// 看不懂時的短提示（取代整份「說明」；下面附範例按鈕）
export const SHORT_HELP = `條件可以混著打：區域、類型（透天／大樓／公寓）、總價、坪數、房數、屋齡、車位、附近地標、屋主自售、降價…
例：「東區優質透天」「太平 30年內 透天 4房以上」「配對 南屯 3房 1500萬以下」
打「說明」看全部寫法、「規則」看作業方式；還是查不到打「回報 ＋你想找的」`;

// LINE 對話選單（常駐聊天室底下，selected:true＝打開就展開；用戶 11/07）
//   朋友：預設選單（所有好友）＝使用規則 6 格
//   管理者：綁自己的合併選單＝上排管理 4 格＋下面同樣 6 格（LINE 一人只能掛一個選單；用戶 11/07 要兩種都有）
//   版面在 menus.mjs（tools/friends-menu.py 畫圖也讀它）；ver 改了，Worker 收到下一則 LINE 訊息或 9 點定時時自己重裝（不用跑腳本、不用金鑰）
import MENUS from './menus.mjs';
export const MENU = MENUS.friends;
async function install(env, S, m, adminId) {
  const to = m.to === 'admin' ? adminId : 'all';
  if (!to) return { skip: true };
  const key = `menu-${m.to}`;
  if ((await S.get(key, 'text')) === `${m.ver}|${to}`) return { same: true };
  const H = { Authorization: `Bearer ${env.LINE_TOKEN}` };
  const r1 = await fetch('https://api.line.me/v2/bot/richmenu', {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ size: { width: 2500, height: 1686 }, selected: true, name: m.name, chatBarText: m.bar,
      areas: m.cells.map(c => ({ bounds: { x: c.x, y: c.y, width: c.w, height: c.h },
        action: c.uri ? { type: 'uri', uri: c.uri } : { type: 'message', text: c.text } })) })
  });
  if (!r1.ok) return { ok: false, step: '建選單', error: `${r1.status} ${(await r1.text()).slice(0, 200)}` };
  const { richMenuId } = await r1.json();
  const png = await env.ASSETS.fetch(new Request(`${SITE}/${m.png}`));
  if (!png.ok) return { ok: false, step: '讀圖', error: String(png.status) };
  const r2 = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, { method: 'POST', headers: { ...H, 'Content-Type': 'image/png' }, body: await png.arrayBuffer() });
  if (!r2.ok) return { ok: false, step: '傳圖', error: `${r2.status} ${(await r2.text()).slice(0, 200)}` };
  const r3 = await fetch(to === 'all' ? `https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}` : `https://api.line.me/v2/bot/user/${to}/richmenu/${richMenuId}`, { method: 'POST', headers: H });
  if (!r3.ok) return { ok: false, step: '綁定', error: `${r3.status} ${(await r3.text()).slice(0, 200)}` };
  // 同名的舊選單刪掉（含 tools/admin-menu.sh 裝的舊 4 格管理選單）
  const list = await fetch('https://api.line.me/v2/bot/richmenu/list', { headers: H }).then(r => r.json()).catch(() => ({ richmenus: [] }));
  for (const x of list.richmenus || []) if (x.name === m.name && x.richMenuId !== richMenuId)
    await fetch(`https://api.line.me/v2/bot/richmenu/${x.richMenuId}`, { method: 'DELETE', headers: H });
  await S.put(key, `${m.ver}|${to}`);
  return { ok: true, richMenuId };
}
export async function ensureMenus(env, S, adminId) {
  if (!env.LINE_TOKEN || env.LINE_API) return { skip: true };   // 測試環境（假 LINE）不裝
  return { friends: await install(env, S, MENUS.friends, adminId), admin: await install(env, S, MENUS.admin, adminId) };
}

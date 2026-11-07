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

🔔 推播：每天早上 9 點一則（昨天 9 點後新出現的），白天只有 85 分以上會即時推。

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

【怎麼處理】
・開發：預設不列、不推播（同公司已經有了，不重複踩）
・要看就打「含同體系」一起列（標🔒），「只看同體系」只列同公司的
・配對：預設照列（標🔒），可以直接帶客人看；「不要同體系」排除

【比對錯了】
看到明明是同公司的卻被當開發案、或不是同一戶卻被標🔒 → 打「回報 ＋案件＋哪裡錯」，會人工確認後修正。`;

const PUSH = `🔔 推播規則
・每天 09:00 一則：昨天 9 點以後新出現、值得開發的全部（只有屋主在賣的，或 60 分以上）
・白天有 85 分以上的特急件 → 馬上推那幾件，其他留到隔天早上
・晚上 8 點到隔天 9 點不推（特急也等早上）
・只推主力 8 區；同公司已經在賣的不推
・每件都附物件連結（還在架的平台，信義、住商、東森優先）跟地圖，不用登入
・推播要自己開：打「訂閱推播」開、「取消推播」關
・不想收推播也可以：點選單「今天的案件」自己看（點了是回覆，不花推播額度）
・白天想查自己打字查（查詢不花推播額度）：「新上架」「這週 降價」「只有屋主 這週」`;

export const RULE_BTNS = ['開發規則', '配對規則', '同公司', '推播規則', '範例'];
export function rulesFor(t) {
  if (/^(規則|使用規則|作業方式|怎麼運作|運作方式|系統說明)$/.test(t)) return OVERVIEW;
  if (/^(開發規則|開發怎麼看|開發說明|分數|分數怎麼算|評分)$/.test(t)) return DEV;
  if (/^(配對規則|配對怎麼用|配對說明)$/.test(t)) return MATCH;
  if (/^(同公司|同體系|同公司物件|同體系規則|同公司規則|同體系說明)$/.test(t)) return SAME;
  if (/^(推播規則|推播說明|推播)$/.test(t)) return PUSH;
  return null;
}

// 朋友用的對話選單（LINE 預設 rich menu，所有好友都看得到；管理者綁了自己的管理選單會蓋掉這個）
//   圖：public/menu-friends.png（tools/friends-menu.py 畫，2500×1686，3×2 格）
//   selected:true＝打開聊天室就展開（用戶 11/07：選單要常駐）；使用者自己收起來後點底下那條就再打開
//   版本號改了，Worker 收到下一則 LINE 訊息或 9 點定時時就自己重裝（不用跑腳本、不用金鑰）
export const MENU = {
  ver: '2026-11-07b', name: '案件雷達使用規則', bar: '📖 使用規則',
  cells: [
    { type: 'uri', uri: GUIDE_URL }, { type: 'message', text: '開發規則' }, { type: 'message', text: '配對規則' },
    { type: 'message', text: '同公司' }, { type: 'message', text: '推播規則' }, { type: 'message', text: '今天的案件' }
  ]
};
export async function ensureFriendMenu(env, S) {
  if (!env.LINE_TOKEN || env.LINE_API) return { skip: true };   // 測試環境（假 LINE）不裝
  if ((await S.get('menu-friends', 'text')) === MENU.ver) return { ok: true, same: true };
  const H = { Authorization: `Bearer ${env.LINE_TOKEN}` };
  const W = 2500, Hh = 1686, w = W / 3, h = Hh / 2;
  const r1 = await fetch('https://api.line.me/v2/bot/richmenu', {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ size: { width: W, height: Hh }, selected: true, name: MENU.name, chatBarText: MENU.bar,
      areas: MENU.cells.map((a, i) => ({ bounds: { x: Math.round((i % 3) * w), y: Math.round(Math.floor(i / 3) * h), width: Math.round(w), height: Math.round(h) },
        action: a.type === 'uri' ? { type: 'uri', uri: a.uri } : { type: 'message', text: a.text } })) })
  });
  if (!r1.ok) return { ok: false, step: '建選單', error: `${r1.status} ${(await r1.text()).slice(0, 200)}` };
  const { richMenuId } = await r1.json();
  const png = await env.ASSETS.fetch(new Request(`${SITE}/menu-friends.png`));
  if (!png.ok) return { ok: false, step: '讀圖', error: String(png.status) };
  const r2 = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, { method: 'POST', headers: { ...H, 'Content-Type': 'image/png' }, body: await png.arrayBuffer() });
  if (!r2.ok) return { ok: false, step: '傳圖', error: `${r2.status} ${(await r2.text()).slice(0, 200)}` };
  const r3 = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST', headers: H });
  if (!r3.ok) return { ok: false, step: '設成預設', error: `${r3.status} ${(await r3.text()).slice(0, 200)}` };
  const list = await fetch('https://api.line.me/v2/bot/richmenu/list', { headers: H }).then(r => r.json()).catch(() => ({ richmenus: [] }));
  for (const m of list.richmenus || []) if (m.name === MENU.name && m.richMenuId !== richMenuId)
    await fetch(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: 'DELETE', headers: H });
  await S.put('menu-friends', MENU.ver);
  return { ok: true, richMenuId };
}

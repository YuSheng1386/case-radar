// LINE 官方帳號對話查詢（webhook：/api/line/webhook）
//   條件參考 591／永慶／信義的篩選標籤：區域（含屯區、海線等群組）、類型、總價、單價、坪數（權狀／主建物）、
//   格局、屋齡、樓層、車位、特色（近捷運、邊間…）、排序；認不得的字當關鍵字比對標題／社區／路名
//   例：「太平可開發優質大樓」「東區優質透天」「20年內透天」「南屯 1500萬以下 3房 有車位」「崇德路 最便宜」「更多」
//   查不到時會試著拿掉單一條件，告訴你「拿掉 X 有 N 件」
//   資料：tools/line-index.js 在 Actions 上傳的 KV line-meta／line-<n>（每區一小份，Worker 不解析大檔）
//   回覆（reply）不算 LINE 每月推播額度
// 秘密值：LINE_SECRET（驗簽）、LINE_TOKEN（回覆）、LINE_ALLOW（可以查的 LINE userId，逗號分隔）
import { findPlace, km } from './geo.mjs';
import { store } from './store.mjs';

const PAGE = 8;
const MAP_MAX = 150;   // 地圖最多標幾件
const GOOD = 60;   // 「優質」＝分數 ≥60，跟推播門檻一樣（tools/notify.js NOTIFY_SCORE）
const SITE = 'https://case-radar.yusheng1386.workers.dev';

const HELP = `🏠 案件雷達查詢
直接打字，條件可以混著用：
・區域：太平、東區、南屯大里、屯區、海線、山城、舊市區、三屯、全台中（不打＝主力區：南屯、南區、西區、東區、大里、太平；打路名或社區名＝全台中）
・類型：大樓、華廈、公寓、透天、別墅、套房
・總價：1500萬以下、1000-2000萬、1500萬左右
・單價：單價30萬以下
・坪數：30坪以上、25-35坪、主建物20坪以上
・格局：3房、2-3房、4房以上
・屋齡：10年內、少於10年、10-20年、30年以上、新成屋、老屋
・樓層：1樓、5樓以上、高樓層、低樓層、頂樓
・車位：有車位、平面車位、機械車位、坡道平面、雙車位、不要機械車位、不要車位
・優質（分數≥${GOOD}）、分數80以上
・屋主在賣、只有屋主（沒有仲介）
・新上架（24小時）、這週、這個月
・降價、急售、賠售、低於行情
・附近：東平國小附近、靠近東平路、科博館 開車5分鐘、北屯好事多 2公里內、走路10分鐘（只說附近＝開車約5分鐘）
・特色／地點：近捷運、學區、公園、景觀、邊間、採光、陽台、制震、品牌建商、車庫、店面、路名、社區名
・排序：最便宜、單價最低、最新、坪數最大（不打＝分數高的先）
・同體系：開發預設不列；打「含同體系」一起列（標🔒），「只看同體系」只列
・配對：前面加「配對」或「客戶」＝所有在架物件，只要符合就列（不看分數），預設含同體系（「不要同體系」排除）
例（配對）：「配對 南屯 3房 1500萬以下 平面車位」
例：「東區優質透天」「屯區 20年內 透天 有車位」「崇德路 3房 最便宜」
回「更多」看下一頁；每次查詢都附地圖連結`;

// 群組區域
const GROUPS = {
  屯區: ['太平區', '大里區', '霧峰區', '烏日區'],
  海線: ['清水區', '梧棲區', '沙鹿區', '大甲區', '龍井區', '大肚區', '外埔區', '大安區'],
  山城: ['豐原區', '潭子區', '神岡區', '大雅區', '后里區', '石岡區', '東勢區', '新社區', '和平區'],
  山線: ['豐原區', '潭子區', '神岡區', '大雅區', '后里區', '石岡區', '東勢區', '新社區', '和平區'],
  舊市區: ['中區', '東區', '南區', '西區', '北區'],
  三屯: ['北屯區', '西屯區', '南屯區']
};
// 特色 → 標題／社區／地址要出現的字
const FEATURES = [
  [/近?捷運|MRT/i, '近捷運', '捷運|MRT'], [/學區|近學校|明星學區/, '學區', '學區|國小|國中|學校|明星'],
  [/近?公園|綠地/, '近公園', '公園|綠地'], [/景觀|視野|view/i, '景觀', '景觀|視野|view|景'],
  [/邊間/, '邊間', '邊間|三面採光'], [/採光/, '採光', '採光|明亮|邊間'], [/陽台/, '陽台', '陽台'],
  [/車庫/, '車庫', '車庫'], [/店面|店住|金店/, '店面', '店面|店住|金店|商用'], [/大面寬|面寬|臨路|角地/, '面寬臨路', '面寬|臨路|角地|三角窗'],
  [/重劃區/, '重劃區', '重劃'], [/近?市場|生活機能/, '生活機能', '市場|機能|商圈'], [/近?醫院/, '近醫院', '醫院|醫學'],
  [/近?(?:交流道|高鐵)/, '近交流道', '交流道|高鐵|國道|快速道路'], [/裝潢|全新裝潢|裝修/, '有裝潢', '裝潢|裝修|翻新'],
  [/孝親房/, '孝親房', '孝親'], [/雙衛|雙套/, '雙衛', '雙衛|雙套|2衛|兩衛'],
  [/制震|防震|隔震/, '制震宅', '制震|防震|隔震'], [/品牌建商|知名建商|大建商/, '品牌建商', '品牌建商|知名建商'], [/有?陽台/, '有陽台', '陽台']
];
// 認不得但沒意義的字（不當關鍵字）
const STOP = ['可開發', '開發', '案件', '物件', '房子', '房屋', '我要', '我想', '幫我', '請', '想找', '想要', '想看', '找', '列出', '列表', '全部', '所有',
  '有哪些', '有什麼', '推薦', '看看', '一下', '給我', '查詢', '區域', '台中市', '台中', '還有', '在賣', '出售', '的', '嗎', '呢', '吧', '喔'];

// 中文數字（二十年、三房、五樓）→ 阿拉伯數字；只換後面接單位的，避免「七期」「三民路」被改掉
function cnum(s) {
  const D = { 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const v = m => {
    if (!m.includes('十')) return D[m];
    const [a, b] = m.split('十');
    return (a ? D[a] : 1) * 10 + (b ? D[b] : 0);
  };
  return s.replace(/([一二兩三四五六七八九]?十[一二三四五六七八九]?|[一二兩三四五六七八九])(?=\s*(?:年|房|樓|坪|萬|千萬|億|天|週|個月|廳|衛))/g, m => String(v(m)));
}

function normalize(text) {
  return cnum(String(text).normalize('NFKC').replace(/臺/g, '台').replace(/\s+/g, ' ').trim())
    .replace(/[，,、;；]/g, ' ')
    .replace(/(\d)\s*[wW](?![a-z])/g, '$1萬')
    .replace(/(\d+(?:\.\d+)?)\s*億/g, (_, n) => `${+n * 10000}萬`)
    .replace(/(\d+(?:\.\d+)?)\s*千萬/g, (_, n) => `${+n * 1000}萬`)
    .replace(/(\d)\s*[~～到至]\s*(\d)/g, '$1-$2')
    // 「少於10年」「超過30坪」「不到1500萬」→「10年以下」「30坪以上」
    .replace(/(?:少於|小於|低於|不到|未滿|不超過|不超出|<)\s*(\d+(?:\.\d+)?)\s*(年|萬|坪|房|樓)?/g, (_, n, u) => `${n}${u || ''}以下`)
    .replace(/(?:大於|超過|高於|多於|至少|>)\s*(\d+(?:\.\d+)?)\s*(年|萬|坪|房|樓)?/g, (_, n, u) => `${n}${u || ''}以上`)
    .replace(/(\d|年|萬|坪|房|樓)\s*(?:以內|之內|內)/g, '$1以下');
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const range = (a, b, u) => a != null && b != null ? `${a}–${b}${u}` : a != null ? `≥${a}${u}` : `≤${b}${u}`;

export function parse(text, districts, main, where = {}) {
  let s = normalize(text);
  const conds = [];
  const q = { ds: [], conds, sort: null, scope: '', mode: 'dev' };
  // ---- 開發／配對 ----
  //   開發（預設）：有競爭力、分數夠的案件；配對：案件池裡所有在架物件，只要符合條件都列（幫客人找房）
  if (/配對|買方|客戶|客人|買家|幫客|所有物件|全部物件|不限分數|一般物件/.test(s)) {
    q.mode = 'match';
    s = s.replace(/配對|買方|客戶|客人|買家|幫客|所有物件|全部物件|不限分數|一般物件/g, ' ');
  }
  // 預設：開發不列同體系、配對照網站客戶配對的規則一起列（標🔒）
  if (q.mode === 'match') q.sm = 'inc';
  take0(/(?:不要|排除|不含|去掉)(?:同)?體系(?:內的|內|的)?(?:案件|物件)?/, () => { q.sm = null; });
  function take0(re, fn) { if (re.test(s)) { fn(); s = s.replace(new RegExp(re.source, 'g'), ' '); } }
  // 吃掉符合的字串，回傳有沒有吃到
  const take = (re, fn) => {
    let hit = false;
    s = s.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), (...a) => { hit = true; fn(...a); return ' '; });
    return hit;
  };
  const add = (k, l, a = null, b = null) => conds.push({ k, l, a, b });

  // ---- 同體系：預設不列（不能開發）；「含同體系」一起列、「只看同體系」只列 ----
  take(/只(?:看|要|列)(?:同)?體系(?:內的|內|的)?(?:案件|物件)?/, () => { q.sm = 'only'; })
    || take(/(?:包含|含|加上|也要|連)(?:同)?體系(?:內的|內|的)?(?:案件|物件)?(?:也要|一起)?|(?:同)?體系(?:內的|內|的)?(?:也要|一起)/, () => { q.sm = 'inc'; });

  // ---- 排序 ----
  take(/最便宜|便宜的先|總價(?:最)?低|價格低到高|由低到高/, () => { q.sort = 'p'; });
  take(/單價(?:最)?低/, () => { q.sort = 'up'; });
  take(/最新(?:上架)?|新到舊/, () => { q.sort = 'f'; });
  take(/坪數最大|最大坪|坪數大的?先/, () => { q.sort = 'ar'; });
  take(/分數最高|高分的?先/, () => { q.sort = null; });

  // ---- 附近／車程（地標、路名、社區）----
  //   「東平國小附近」「科博館 開車5分鐘」「靠近東平路」「北屯好事多 2公里內」→ 以那個點／那條路為中心算直線距離
  //   市區開車 1 分鐘約直線 400 公尺、走路 1 分鐘約 80 公尺；只說「附近」＝開車 5 分鐘
  const ds = new Set();
  let dist = null, kmL = '';
  take(new RegExp(`(?:走路|步行)\\s*${NUM}\\s*分鐘?(?:以下|內)?`), (_, n) => { dist = n * 0.08; kmL = `走路${n}分鐘`; })
    || take(new RegExp(`(?:開車|車程|騎車|機車)?\\s*${NUM}\\s*分鐘(?:車程)?(?:以下|內)?`), (_, n) => { dist = n * 0.4; kmL = `開車${n}分鐘`; });
  take(new RegExp(`${NUM}\\s*(?:公里|km)(?:以下|內)?`, 'i'), (_, n) => { dist = +n; kmL = `${n}公里內`; })
    || take(new RegExp(`${NUM}\\s*(?:公尺|米)(?:以下|內)?`), (_, n) => { dist = n / 1000; kmL = `${n}公尺內`; });
  let target = null;
  take(/(?:靠近|鄰近|接近|離)\s*(\S+?)\s*(?:附近|周邊|周圍|旁邊|一帶)?(?=\s|$)/, (_, w) => { target = w; })
    || take(/(\S+?)\s*(?:附近|周邊|周圍|旁邊|一帶)(?=\s|$)/, (_, w) => { target = w; });
  const setNear = w => {
    // 黏在前面的區名／類型拆掉（「太平透天東平國小」）；區公所、區運動中心這種保留區名
    let t = w;
    for (let again = true; again;) {
      again = false;
      for (const d of [...districts].sort((a, b) => b.length - a.length)) for (const n of [d, d.length >= 3 ? d.replace(/區$/, '') : null]) {
        if (n && t.startsWith(n) && t.length > n.length + 1 && !/^區?(?:公所|運動中心|圖書館|戶政|衛生所|農會|區民)/.test(t.slice(n.length))) { ds.add(d); t = t.slice(n.length); again = true; }
      }
      const m = t.match(/^(電梯大樓|大樓|透天厝|透天|公寓|華廈|別墅|可開發)/);
      if (m && t.length > m[1].length + 1) { s += ' ' + m[1]; t = t.slice(m[1].length); again = true; }
    }
    const k = dist ?? 2;
    add('near', `${t} ${kmL || '附近'}（直線約${Math.round(k * 10) / 10}公里）`, t, k);
  };
  if (target) setNear(target);

  // ---- 區域 ----
  take(/全台中|全市|全部區域|所有區域/, () => districts.forEach(d => ds.add(d)));
  take(/主力[五六]?區|[五六]區/, () => main.forEach(d => ds.add(d)));
  for (const [g, list] of Object.entries(GROUPS)) take(new RegExp(g), () => list.forEach(d => ds.add(d)));
  // 完整區名優先；三字區名可省略「區」（太平、南屯）；東區／南區這種二字的要打「區」
  for (const d of [...districts].sort((a, b) => b.length - a.length)) {
    if (!take(new RegExp(d), () => ds.add(d)) && d.length >= 3) take(new RegExp(d.replace(/區$/, '')), () => ds.add(d));
  }
  q.ds = [...ds].filter(d => districts.includes(d));
  if (!q.ds.length && conds.some(c => c.k === 'near')) { q.ds = [...districts]; q.scope = ''; q.nearAuto = true; }   // 範圍內的區 Worker 再算
  else if (!q.ds.length) { q.ds = main.filter(d => districts.includes(d)); q.scope = '主力區'; }
  else q.scope = q.ds.length > 4 ? `${q.ds.length}區` : q.ds.join('、');

  // ---- 單價（先處理，免得被當總價）----
  take(new RegExp(`單價\\s*${NUM}\\s*-\\s*${NUM}\\s*萬?`), (_, a, b) => add('up', `單價${a}–${b}萬`, +a, +b))
    || take(new RegExp(`單價\\s*${NUM}\\s*萬?\\s*以下`), (_, b) => add('up', `單價≤${b}萬`, null, +b))
    || take(new RegExp(`單價\\s*${NUM}\\s*萬?\\s*以上`), (_, a) => add('up', `單價≥${a}萬`, +a, null));

  // ---- 總價 ----
  take(new RegExp(`${NUM}\\s*萬?\\s*-\\s*${NUM}\\s*萬`), (_, a, b) => add('p', `總價${a}–${b}萬`, +a, +b))
    || take(new RegExp(`${NUM}\\s*萬\\s*(?:左右|上下|附近)`), (_, n) => add('p', `總價${n}萬左右`, Math.round(n * 0.9), Math.round(n * 1.1)))
    || take(new RegExp(`(?:預算|總價)?\\s*${NUM}\\s*萬\\s*以下|預算\\s*${NUM}\\s*萬?`), (_, b, b2) => add('p', `總價≤${b || b2}萬`, null, +(b || b2)));
  take(new RegExp(`${NUM}\\s*萬\\s*以上`), (_, a) => add('p', `總價≥${a}萬`, +a, null));

  // ---- 坪數（主建物／室內 → 主建物坪；其他 → 權狀坪）----
  for (const [pre, k, nm] of [['(?:主建物|主建|室內|實坪)\\s*', 'ma', '主建物'], ['(?:權狀|建坪|總坪)?\\s*', 'ar', '']]) {
    take(new RegExp(`${pre}${NUM}\\s*坪?\\s*-\\s*${NUM}\\s*坪`), (_, a, b) => add(k, `${nm}${a}–${b}坪`, +a, +b))
      || take(new RegExp(`${pre}${NUM}\\s*坪\\s*(?:左右|上下)`), (_, n) => add(k, `${nm}${n}坪左右`, n * 0.85, n * 1.15))
      || take(new RegExp(`${pre}${NUM}\\s*坪\\s*以下`), (_, b) => add(k, `${nm}≤${b}坪`, null, +b));
    take(new RegExp(`${pre}${NUM}\\s*坪\\s*以上`), (_, a) => add(k, `${nm}≥${a}坪`, +a, null));
  }

  // ---- 屋齡 ----
  take(new RegExp(`(?:屋齡)?\\s*${NUM}\\s*年?\\s*-\\s*${NUM}\\s*年`), (_, a, b) => add('age', `屋齡${a}–${b}年`, +a, +b))
    || take(new RegExp(`屋齡\\s*${NUM}\\s*-\\s*${NUM}`), (_, a, b) => add('age', `屋齡${a}–${b}年`, +a, +b))
    || take(new RegExp(`(?:屋齡)?\\s*${NUM}\\s*年\\s*以下|屋齡\\s*${NUM}\\s*以下`), (_, b, b2) => add('age', `屋齡≤${b || b2}年`, null, +(b || b2)))
    || take(/新成屋|新古屋|新建案|新屋/, () => add('age', '屋齡≤5年', null, 5));
  take(new RegExp(`(?:屋齡)?\\s*${NUM}\\s*年\\s*以上|屋齡\\s*${NUM}\\s*以上`), (_, a, a2) => add('age', `屋齡≥${a || a2}年`, +(a || a2), null))
    || take(/老屋|老公寓/, () => add('age', '屋齡≥30年', 30, null));

  // ---- 樓層 ----
  take(/高樓層|高樓/, () => add('flp', '高樓層', 'high'))
    || take(/低樓層|低樓/, () => add('flp', '低樓層', 'low'))
    || take(/中樓層/, () => add('flp', '中樓層', 'mid'))
    || take(/頂樓(?!加蓋)/, () => add('flp', '頂樓', 'top'));
  take(new RegExp(`${NUM}\\s*樓?\\s*-\\s*${NUM}\\s*樓`), (_, a, b) => add('fl', `${a}–${b}樓`, +a, +b))
    || take(new RegExp(`${NUM}\\s*樓\\s*以上`), (_, a) => add('fl', `${a}樓以上`, +a, null))
    || take(new RegExp(`${NUM}\\s*樓\\s*以下`), (_, b) => add('fl', `${b}樓以下`, null, +b))
    || take(new RegExp(`(?<![\\d.])${NUM}\\s*樓(?!中樓)`), (_, n) => add('fl', `${n}樓`, +n, +n));

  // ---- 格局 ----
  take(new RegExp(`${NUM}\\s*房?\\s*-\\s*${NUM}\\s*房`), (_, a, b) => add('r', `${a}–${b}房`, +a, +b))
    || take(new RegExp(`${NUM}\\s*房\\s*以上`), (_, a) => add('r', `${a}房以上`, +a, null))
    || take(new RegExp(`${NUM}\\s*房\\s*以下`), (_, b) => add('r', `${b}房以下`, null, +b))
    || take(new RegExp(`${NUM}\\s*房(?:\\s*\\d+\\s*廳)?(?:\\s*\\d+\\s*衛)?`), (_, n) => add('r', `${n}房`, +n, +n));

  // ---- 車位 ----
  //   型式：591 欄位 cartmodel（平面式／機械式…）；其他平台看標題有沒有寫
  take(/雙車位|2車位|兩個車位|2個車位/, () => add('kw', '雙車位', '雙車位|2車位|兩車位|2個車位|雙平車'));
  take(/(?:不要|不含|排除|非)\s*(機械|平面)\s*式?\s*(?:車位)?/, (_, t) => add('pkn', `有車位但不要${t}`, t));
  take(/(?:不要|不用|沒有|無|不含)\s*車位/, () => add('pk', '不要車位', 0))
    || take(/(?:有|含|附|要|帶)?\s*(坡道平面|坡道機械|平面|機械|坡道|升降|塔式)\s*式?\s*(?:車位)?/, (_, t) => add('pkt', `${t}車位`, t))
    || take(/(?:有|含|附|要|帶)?\s*車位/, () => add('pk', '有車位', 1));

  // ---- 類型 ----
  const hasTown = /透天|別墅/.test(s);
  take(/電梯大樓|大樓/, () => add('ty', '大樓', '大樓'))
    || take(/華廈/, () => add('rt', '華廈', '華廈'))
    || take(/公寓/, () => add('ty', '公寓', '公寓'))
    || take(/別墅/, () => add('rt', '別墅', '別墅'))
    || take(/透天厝|透天/, () => add('ty', '透天', '透天'))
    || take(/套房/, () => add('r', '套房／1房', null, 1));
  if (hasTown) take(/電梯/, () => add('kw', '電梯', '電梯'));
  else take(/電梯/, () => add('ty', '有電梯（大樓／華廈）', '大樓'));

  // ---- 分數／屋主／新上架／標籤 ----
  take(new RegExp(`分數\\s*${NUM}\\s*(?:分)?\\s*以上`), (_, a) => add('sc', `分數≥${a}`, +a))
    || take(/優質|精選|好案|高分|超值好案/, () => add('sc', `優質（分數≥${GOOD}）`, GOOD));
  take(/只有屋主|純屋主|沒有仲介|無仲介|屋主獨賣/, () => add('own', '只有屋主在賣', 2))
    || take(/屋主自售|屋主|自售|自賣/, () => add('own', '有屋主在賣', 1));
  take(/這個月|本月|30天|1個月/, () => add('since', '30天內新上架', 30))
    || take(/這週|本週|這禮拜|7天|1週/, () => add('since', '7天內新上架', 7))
    || take(/新上架|新案|新的|今天|24小時|剛上架/, () => add('since', '24小時內新上架', 1));
  for (const [re, t, l] of [[/降價|有降|砍價/, '降價', '降價'], [/急售|急賣|秒殺/, '急售', '急售'], [/賠售|認賠|賠錢/, '賠售', '賠售'],
    [/低於實登|低於行情|比行情低|低於市價|便宜/, '低於實登', '低於行情']]) take(re, () => add('tag', l, t));

  // ---- 特色 ----
  for (const [re, l, kw] of FEATURES) take(re, () => add('kw', l, kw));

  // ---- 剩下的字 → 關鍵字（路名、社區名、特色）----
  for (const w of [...STOP].sort((a, b) => b.length - a.length)) s = s.split(w).join(' ');
  const free = [];
  for (let w of s.split(/\s+/)) {
    // 「靠近東平路」「東平路附近」「在崇德路上」→ 東平路
    w = w.replace(/^(?:靠近|鄰近|接近|附近的?|周邊的?|位於|在|近|沿著?)/, '').replace(/(?:附近|周邊|旁邊|一帶|沿線|上|旁|邊)$/, '');
    if (w.length < 2 || /^\d+$/.test(w)) continue;
    // 有說距離（開車5分鐘、2公里）但沒說「附近」→ 第一個認不得的字就是中心點（「科博館 開車5分鐘」）
    if (dist != null && !conds.some(c => c.k === 'near')) {
      setNear(w);
      if (q.scope === '主力區') { q.ds = [...districts]; q.scope = ''; q.nearAuto = true; }
      continue;
    }
    free.push(w); add('kw', `「${w}」`, w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }
  // 沒打區域但打了路名／社區名 → 用地名表找在哪幾區（崇德路在北屯，不在主力五區）；表裡沒有就找全台中
  if (free.length && q.scope === '主力區') {
    const hit = new Set();
    for (const w of free) for (const [k, ix] of Object.entries(where)) if (k.includes(w) || (w.length >= 3 && w.includes(k))) ix.forEach(i => hit.add(districts[i]));
    q.ds = hit.size ? [...hit].filter(Boolean) : [...districts];
    q.scope = hit.size && hit.size <= 4 ? q.ds.join('、') : '全台中';
  }
  // 什麼都沒打（例如「你好」只會剩關鍵字「你好」）→ 回說明
  q.none = q.scope === '主力區' && !conds.length && !q.sort && (q.mode === 'match' || (!q.sm && !/可開發|案件|全部|列出|有哪些/.test(String(text))));
  // 配對只打「配對」沒有任何條件 → 主力區幾千件沒意義，回說明
  return q;
}

// 一組點到中心點（們）的最短直線距離
function nearKm(c, pts) {
  let best = Infinity;
  for (const a of pts) for (const b of c.pts) { const d = km(a, b); if (d < best) best = d; }
  return best;
}
// 案件在地圖上的位置：社區座標；只有路名的取那條路離中心最近的一段（沒有中心就取第一段）
export function posOf(x, road, center) {
  if (x.lc) return { ll: x.lc, approx: 0 };
  if (x.rk == null) return null;
  const pts = road(x.rk) || [];
  if (!pts.length) return null;
  let best = pts[0], bd = Infinity;
  if (center) for (const a of pts) for (const b of center) { const d = km(a, b); if (d < bd) { bd = d; best = a; } }
  return { ll: best, approx: 1 };
}

function test(c, x) {
  const inR = v => v != null && (c.a == null || v >= c.a) && (c.b == null || v <= c.b);
  switch (c.k) {
    case 'ty': return x.ty === c.a;
    case 'rt': return (x.rt || '').includes(c.a);
    case 'sc': return x.sc >= c.a;
    case 'age': return inR(x.ag);
    case 'p': return inR(x.p);
    case 'up': return inR(x.up);
    case 'ar': return inR(x.ar);
    case 'ma': return inR(x.ma);
    case 'r': return inR(x.r);
    case 'pk': return x.pk === c.a;
    case 'pkt': return (x.pt || '').includes(c.a) || (!x.pt && new RegExp(`${c.a}.{0,2}車位`).test(x.t || ''));
    case 'pkn': return x.pk === 1 && !(x.pt || '').includes(c.a) && !new RegExp(`${c.a}.{0,2}車位`).test(x.t || '');
    case 'own': return x.own >= c.a;
    case 'since': return x.g == null && Date.now() - x.f <= c.a * 864e5;
    case 'tag': return c.a === '降價' ? x.dr > 0 || x.tg.includes('降價')
      : c.a === '急售' ? x.tg.includes('急售') || x.tg.includes('秒殺')
      : c.a === '低於實登' ? ['低於實登', '標低於行情', '同等級仍低'].some(t => x.tg.includes(t)) : x.tg.includes(c.a);
    case 'near': {
      // c.pts：中心點（地標一點、路名多點）；案件位置＝社區座標，沒有就用它那條路（c.road(rk) 回傳那條路的各段）
      if (!c.pts) return true;
      if (x.lc) return nearKm(c, [x.lc]) <= c.b;
      if (x.rk != null) { const m = c.memo || (c.memo = new Map()); if (!m.has(x.rk)) m.set(x.rk, nearKm(c, c.road(x.rk))); return m.get(x.rk) <= c.b; }
      return false;
    }
    case 'kw': return (c.re || (c.re = new RegExp(c.a, 'i'))).test(x.t || '');
    case 'fl': {
      if (!x.fl) return false;
      const [lo, hi] = x.fl;
      return c.a === c.b ? lo <= c.a && c.a <= hi : (c.a == null || lo >= c.a) && (c.b == null || lo <= c.b);
    }
    case 'flp': {
      if (!x.fl) return false;
      const [lo, hi, tot] = x.fl;
      if (c.a === 'top') return !!tot && lo === tot && hi === tot;
      if (!tot || tot < 6 || lo !== hi) return false;   // 透天整棟、矮樓不分高低樓層
      return c.a === 'high' ? lo >= tot * 2 / 3 : c.a === 'low' ? lo <= 3 : lo > 3 && lo < tot * 2 / 3;
    }
  }
  return true;
}

const SORTS = { p: (a, b) => (a.p ?? 1e9) - (b.p ?? 1e9), up: (a, b) => (a.up ?? 1e9) - (b.up ?? 1e9), f: (a, b) => b.f - a.f, ar: (a, b) => (b.ar ?? 0) - (a.ar ?? 0) };
const SORT_L = { p: '總價低的先', up: '單價低的先', f: '最新上架的先', ar: '坪數大的先' };

export function filter(items, q, conds = q.conds) {
  const smOk = x => q.sm === 'inc' || (q.sm === 'only' ? x.sm : !x.sm);
  return items.filter(x => smOk(x) && conds.every(c => test(c, x))).sort((a, b) => (q.sort ? SORTS[q.sort](a, b) : q.mode === 'match' ? SORTS.p(a, b) : 0) || b.sc - a.sc);
}

// 查不到 → 每次拿掉一個條件，看各有幾件
export function relax(items, q) {
  return q.conds.map((c, i) => [c.l, filter(items, q, q.conds.filter((_, j) => j !== i)).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 3);
}

export function page(res, q, off, at, items) {
  const t = new Date(Date.parse(at) + 8 * 3600e3);
  const when = `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
  const head = [q.mode === 'match' ? '【配對】' + q.scope : '【開發】' + q.scope, ...q.conds.map(c => c.l), ...(q.sm ? [q.sm === 'only' ? '只看同體系' : '含同體系'] : [])].join('・');
  if (!res.length) {
    const rx = items ? relax(items, q) : [];
    return `${head}\n${q.mode === 'match' ? '目前沒有符合的物件' : '目前沒有符合的可開發案件'}（資料 ${when}）` +
      (rx.length ? '\n\n放寬看看：\n' + rx.map(([l, n]) => `・拿掉「${l.replace(/[「」]/g, '')}」有 ${n} 件`).join('\n') : '') +
      '\n\n打「說明」看可以用的條件';
  }
  const sl = res.slice(off, off + PAGE);
  let msg = `${head}\n共 ${res.length} 件，第 ${off + 1}–${off + sl.length} 件（${SORT_L[q.sort] || (q.mode === 'match' ? '總價低的先' : '分數高的先')}；資料 ${when}）\n\n` + sl.map(x => x.x).join('\n');
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

// 案件池陣列 → 物件（欄位順序 meta.pkeys，tools/line-index.js PKEYS）
//   不逐欄複製（6000 件 × 18 欄太耗 CPU），改成包一層、欄位用 getter 直接讀陣列
const NONE = [];
let Pool = null, PoolKeys = '';
export function poolItem(a, keys, d) {
  if (PoolKeys !== keys.join()) {
    Pool = function (a, d) { this.a = a; this._d = d; };
    keys.forEach((k, i) => Object.defineProperty(Pool.prototype, k, {
      get: k === 'f' ? function () { return this.a[i] * 1000; } : k === 'tg' ? function () { return this.a[i] || NONE; } : function () { return this.a[i]; }
    }));
    Object.defineProperty(Pool.prototype, 'dr', { get: () => 0 });
    PoolKeys = keys.join();
  }
  return new Pool(a, d);
}

// 配對模式每件一行（案件池沒有預先排好的文字）：總價先，客人最在意
export function matchLine(x) {
  const url = String(x.u || '').replace(/^591:/, 'https://sale.591.com.tw/home/house/detail/');
  const bits = [x.ar != null ? `${x.ar}坪` : '', x.fs, x.ly, x.ag != null ? `屋齡${x.ag}年` : '', x.pt ? `🚗${x.pt.replace(/式$/, '')}車位` : x.pk ? '🚗含車位' : ''].filter(Boolean);
  return `${x.sm ? '🔒同體系 ' : ''}・${x.p ?? '—'}萬｜${x._d} ${x.n || ''}\n  ${bits.join(' ')}${x.own === 2 ? '・只有屋主在賣' : x.own ? '・有屋主在賣' : ''}\n  ${url}`;
}

async function answer(env, uid, text) {
  const S = store(env);
  const t = text.trim();
  if (/^(說明|help|\?|？|怎麼用|指令|用法)$/i.test(t)) return HELP;
  const meta = await S.get('line-meta', 'json');
  if (!meta) return '還沒有資料，等下一次排程更新後再試';
  // 「更多」：重新解析上一次的查詢文字，從下一頁開始（資料更新過也照新的排）
  const stKey = `lq-${uid}`;
  let src = t, off = 0;
  if (/^(更多|下一頁|more|下頁|繼續)$/i.test(t)) {
    const st = await S.get(stKey, 'json');
    if (!st) return '沒有上一次的查詢，直接打條件，例如「東區優質透天」';
    src = st.text; off = st.off + PAGE;
  }
  const q = parse(src, meta.districts, meta.main, meta.where || {});
  if (q.none) return HELP;
  // 案件只有路名時的位置：路名座標表（tools/roads.js → line-index 的 line-roads），附近查詢或畫地圖時才讀
  let R = null;
  const roadsOf = async () => R || (R = (await S.get('line-roads', 'json')) || { keys: [], pts: [] });
  const near = q.conds.find(c => c.k === 'near');
  if (near) {
    const rd = await roadsOf();
    near.road = i => rd.pts[i];
    near.pts = await locate(S, near.a, rd, q.nearAuto ? null : q.ds, meta.districts, meta.box);
    if (!near.pts) return `找不到「${near.a}」在哪裡，換個說法試試（例如加上區名、寫全名：「太平東平國小」「北屯好事多」）`;
    if (q.nearAuto) {
      // 只讀範圍碰得到的區（各區案件位置外框，tools/line-index.js meta.box）
      const pad = near.b / 100 + 0.005;
      q.ds = meta.districts.filter((d, i) => { const b = meta.box?.[i];
        return b && near.pts.some(([la, ln]) => la >= b[0] - pad && la <= b[2] + pad && ln >= b[1] - pad && ln <= b[3] + pad); });
      q.scope = q.ds.length <= 4 ? q.ds.join('、') : `${q.ds.length}區`;
    }
  }
  const pre = q.mode === 'match' ? 'line-p' : 'line-';
  const parts = await Promise.all(q.ds.map(d => S.get(`${pre}${meta.districts.indexOf(d)}`, 'json')));
  // 配對模式：關鍵字欄位（路名、社區、特色）另存，條件有用到才讀
  const needT = q.mode === 'match' && q.conds.some(c => c.k === 'kw' || c.k === 'pkt' || c.k === 'pkn');
  const tks = needT ? await Promise.all(q.ds.map(d => S.get(`line-pt${meta.districts.indexOf(d)}`, 'json'))) : [];
  const items = parts.flatMap((p, i) => !p || p.d !== q.ds[i] ? [] : q.mode === 'match'
    ? p.items.map((a, j) => { const o = poolItem(a, meta.pkeys, p.d); if (needT) o.t = tks[i]?.t[j] || ''; return o; })
    : p.items.map(x => (x._d = p.d, x)));
  const res = filter(items, q);
  // 附近：每件算距離；沒指定排序就近的先
  let noLoc = 0;
  if (near) {
    for (const x of res) x._km = Math.round(nearKm(near, x.lc ? [x.lc] : near.road(x.rk)) * 10) / 10;
    if (!q.sort) res.sort((a, b) => a._km - b._km);
    // 其他條件都符合、但沒有位置資料（地址只有區名）的有幾件
    noLoc = filter(items, q, q.conds.filter(c => c !== near)).filter(x => !x.lc && x.rk == null).length;
  }
  const sl = res.slice(off, off + PAGE);
  // 顯示文字：這一頁＋地圖（最多 MAP_MAX 件）用到的區才讀
  const mapItems = off ? [] : res.slice(0, MAP_MAX);
  const show = [...new Set([...sl, ...mapItems])];
  const need = [...new Set(show.map(x => x._d))];
  const tx = await Promise.all(need.map(d => S.get(`${q.mode === 'match' ? 'line-px' : 'line-x'}${meta.districts.indexOf(d)}`, 'json')));
  const byD = Object.fromEntries(tx.filter(Boolean).map(t => [t.d, t.x]));
  for (const x of show) {
    if (q.mode === 'match') { [x.n, x.fs, x.ly, x.u] = byD[x._d]?.[x.id] || []; x.x = matchLine(x); }
    else x.x = x.x || byD[x._d]?.[x.id] || `・${x.sc}分｜${x._d} ${x.p}萬`;
    if (x._km != null) x.x = x.x.replace('\n', ` 📍${x._km}公里\n`);
  }
  // 地圖：案件標在地圖上（社區座標；只有路名的標在那條路離中心最近的一段）
  let mapUrl = '';
  if (mapItems.length) {
    const rd = mapItems.some(x => !x.lc && x.rk != null) ? await roadsOf() : null;
    const pts = [];
    for (const x of mapItems) {
      const pos = posOf(x, i => rd?.pts[i], near?.pts);
      if (!pos) continue;
      const lines = x.x.split('\n');
      const url = (x.x.match(/https?:\/\/\S+/) || [])[0] || '';
      pts.push([pos.ll[0], pos.ll[1], pos.approx, lines.filter(l => !/^\s*https?:/.test(l)).join('\n').slice(0, 300), x.p ?? null, url,
        x.sm ? 'sm' : x.own === 2 ? 'own' : x.sc >= GOOD ? 'good' : '']);
    }
    if (pts.length) {
      const tok = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('');
      const head = [q.mode === 'match' ? '配對' : '開發', q.scope, ...q.conds.map(c => c.l)].filter(Boolean).join('・');
      await S.put(`map-${tok}`, JSON.stringify({ t: head, at: meta.at, n: res.length, c: near?.pts?.slice(0, 40) || null, r: near?.b || null, items: pts }),
        { expirationTtl: 14 * 86400 });
      mapUrl = `\n🗺 地圖（${pts.length} 件${res.length > pts.length ? `，共 ${res.length} 件` : ''}）：${SITE}/m/${tok}`;
    }
  }
  // 只有認不得的字、又什麼都沒對到（例如「你好」）→ 回說明
  if (!res.length && q.scope === '全台中' && q.conds.every(c => c.k === 'kw'))
    return `看不懂「${q.conds.map(c => c.l.replace(/[「」]/g, '')).join(' ')}」\n\n` + HELP;
  if (off && off >= res.length) return '已經是最後一頁了';
  await S.put(stKey, JSON.stringify({ text: src, off }), { expirationTtl: 3600 });
  return page(res, q, off, meta.at, items) + (noLoc ? `\n（另有 ${noLoc} 件地址只寫到區，算不出距離）` : '') + mapUrl
    + `\n${SITE}/#${q.mode === 'match' ? 'clients' : 'dev'}`;
}

// 中心點：①路名座標表裡的路（整條路的各段）②快取 ③即時定位（內政部／OpenStreetMap：學校、賣場、地標）
async function locate(S, w, rd, ds, districts, box) {
  const pts = [];
  rd.keys.forEach((k, i) => {
    const [d, r] = k.split('|');
    const isRoad = w === r || (w.startsWith(r) && /^[一二三四五六七八九十\d]+段$/.test(w.slice(r.length)));
    if (isRoad && (!ds || ds.includes(d))) pts.push(...rd.pts[i]);
  });
  if (pts.length) return pts;
  const ck = `geo-${w.slice(0, 40)}`;
  const hit = await S.get(ck, 'json');
  if (hit) return hit.length ? hit : null;
  // 有指定區（「北屯好事多」）→ 挑離那區最近的那家
  const b = ds && ds.length <= 3 && box ? box[districts.indexOf(ds[0])] : null;
  const g = await findPlace(w, b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null);
  const out = g ? [g] : [];
  await S.put(ck, JSON.stringify(out), { expirationTtl: (out.length ? 30 : 1) * 86400 });
  return out.length ? out : null;
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

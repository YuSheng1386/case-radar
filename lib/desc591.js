// 591 物件內文 → 特色標籤（景觀／邊間…），補列表只看得到標題的不足
//   用戶 10/30：「視野要看文內介紹，無限視野、市景之類的」；591 關鍵字搜尋實測幾乎只比對標題（北屯「無限視野」669 件只有 27 件標題沒寫）
//   API: https://bff-house.591.com.tw/v1/web/sale/detail?id=<編號>（JSON 約 36 KB，內文在 remark，HTML）
//   只存抽出來的標籤（不存內文），state/desc591.json：{ <591編號>: [標籤字串, 抓的日期(天)] }
//   每次排程只抓還沒抓過的（新的先），抓完一輪後只有新上架的要抓

const https = require('https');

// 標籤 → 內文要出現的字；排除建案廣告常見的公設用語（景觀中庭、景觀設計…）
const RULES = [
  ['景觀', /無限視野|無敵視野|視野|景觀戶|景觀宅|[山湖河海夜市園溪]景|棟距|無遮蔽|前無遮|遠眺|俯瞰|樹海|樹梢|觀景/, /景觀(?:中庭|設計|大師|植栽|公設|綠化|庭園)|中庭景觀/],
  ['邊間', /邊間|三面採光/],
  ['制震', /制震|隔震/],
  ['孝親房', /孝親房/],
  ['雙衛', /雙衛|兩衛|2衛|雙套房/]
];

function labelsOf(html) {
  const t = String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, '');
  return RULES.filter(([, re, not]) => {
    if (!not) return re.test(t);
    // 把排除的公設用語拿掉再比，免得「景觀中庭」讓整篇都算有景觀
    return re.test(t.replace(new RegExp(not.source, 'g'), ''));
  }).map(r => r[0]);
}

function fetchRemark(id) {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://bff-house.591.com.tw/v1/web/sale/detail?id=${id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json', 'Referer': 'https://sale.591.com.tw/' }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      // 一次解碼，免得中文切在兩個封包中間變亂碼（10/27 列表遇過）
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { code: res.statusCode }));
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          // 下架／不存在：{"status":0,"data":{}} → 當成沒有內文
          resolve(j.remark ?? j.ware?.remark ?? '');
        } catch { reject(new Error('不是 JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = () => Math.floor(Date.now() / 864e5);

// ids：要有標籤的 591 編號（新的先）；max：這次最多抓幾件；conc：同時幾個
async function update(state, ids, { max = 400, conc = 3, gap = 150 } = {}) {
  const todo = ids.filter(id => !(id in state)).slice(0, max);
  let ok = 0, fail = 0, streak = 0, stop = '';
  for (let i = 0; i < todo.length && !stop; i += conc) {
    await Promise.all(todo.slice(i, i + conc).map(async id => {
      try { state[id] = [labelsOf(await fetchRemark(id)).join(' '), today()]; ok++; streak = 0; }
      catch (e) {
        fail++; streak++;
        // 被擋（403／429）或連續失敗 → 這次先停，下次再抓
        if (e.code === 403 || e.code === 429 || streak >= 6) stop = e.message;
      }
    }));
    await sleep(gap);
  }
  return { todo: todo.length, ok, fail, stop, left: ids.filter(id => !(id in state)).length };
}

// 不在架上的清掉（state 不要越長越大）
function prune(state, keep) {
  let n = 0;
  for (const id of Object.keys(state)) if (!keep.has(id)) { delete state[id]; n++; }
  return n;
}

const labels = (state, id) => (state[id]?.[0] || '').split(' ').filter(Boolean);

module.exports = { update, prune, labels, labelsOf, fetchRemark };

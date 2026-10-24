// 東森房屋爬蟲 (etwarm.com.tw)
// 2026-10-24 改版：舊的地圖詳情 API /getMapSearchDetailJson.php 回 500、物件頁 object_detail.php 回 404
// 現在用網站搜尋頁自己的列表 API（Laravel）：
//   GET  /houses?searchKind=buy      → 取 csrf-token（<meta>）＋ cookie
//   POST /houses/buy-list-json {area:'台中市南區', page} → {data[10 筆], last_page, total}（一頁固定 10 筆；area 多區用 - 串接沒作用，逐區查）
// 物件網址 /houses/buy/{編號}；下架的回 200、標題「東森房屋－找不到頁面」
// 「編號」跟舊 API 的 id 是同一個數字，追蹤紀錄的 key（東森_<編號>）不會變

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE = 'https://www.etwarm.com.tw';

async function session() {
  const r = await fetch(`${BASE}/houses?searchKind=buy`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  const token = (/name="csrf-token" content="([^"]+)"/.exec(html) || [])[1];
  if (!token) throw new Error(`取不到 csrf-token（HTTP ${r.status}）`);
  return { token, cookie: r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
}

async function listPage(sess, area, page) {
  const r = await fetch(`${BASE}/houses/buy-list-json`, {
    method: 'POST',
    headers: {
      'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': sess.token, Cookie: sess.cookie,
      Referer: `${BASE}/houses?searchKind=buy`
    },
    body: JSON.stringify({ area, page }),
    signal: AbortSignal.timeout(20000)
  });
  if (r.status === 419) { const e = new Error('CSRF 過期'); e.csrf = true; throw e; }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const num = v => { const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

// 「格局」有時是陣列 ["3房","2廳","2衛"]、有時是物件或字串；只留有數字的（「開放空間」不算）
function layout(h) {
  const g = h['格局'];
  const parts = Array.isArray(g) ? g : g && typeof g === 'object' ? Object.values(g) : [g || h.show_item?.['格局'] || ''];
  return parts.filter(x => /\d/.test(String(x))).join('');
}

function toListing(h) {
  const media = h['多媒體'] || {};
  return {
    source: '東森',
    sourceId: String(h['編號']),
    title: h['案名'] || '',
    address: h['地址'] || '',
    community: '',
    price: num(h['刊登售價']),
    priceUnit: '萬',
    unitPrice: num(h['每坪單價']),   // 「約26.96 萬/坪」＝總價÷總坪數
    area: num(h['總坪數']) || num(h['建物坪數']),   // 總坪數＝權狀總坪（含公設），跟 591 area 同口徑
    mainArea: null,                   // 「建物坪數」不確定是不是主建物，不填免得配對誤判
    layout: layout(h),
    floor: '',                        // 列表沒有樓層（詳細頁才有）
    age: h['屋齡'] || '',
    type: h['物件類別'] || '',
    photo: (media['照片'] || [])[0] || '',
    url: h['物件詳細頁'] || `${BASE}/houses/buy/${h['編號']}`,
    lat: null,
    lng: null,
    district: h['鄉鎮市區'] || '',
    scrapedAt: new Date().toISOString()
  };
}

// filters: { city, districts[], propertyTypes[] }
async function scrape(filters = {}) {
  const city = filters.city || '台中市';
  const areas = (filters.districts && filters.districts.length ? filters.districts : ['']).map(d => city + d);
  const typeMap = { '大樓': '大樓', '透天': '透天', '公寓': '公寓' };
  const targetTypes = (filters.propertyTypes || []).map(t => typeMap[t]).filter(Boolean);

  let sess = await session();
  const listings = [];
  const seen = new Set();
  let complete = true;
  let renew = 3;   // CSRF 過期最多重拿 3 次

  for (const area of areas) {
    let page = 1, last = 1, total = 0, got = 0;
    while (page <= last && page <= 300) {
      let res;
      try {
        res = await listPage(sess, area, page);
      } catch (e) {
        if (e.csrf && renew-- > 0) { sess = await session(); continue; }
        // 重試一次，還是失敗就跳過這區（並標記不完整 → 這次不判下架）
        try { await new Promise(r => setTimeout(r, 2000)); res = await listPage(sess, area, page); }
        catch (e2) { console.error(`[東森] ${area} 第${page}頁失敗:`, e2.message); complete = false; break; }
      }
      last = res.last_page || 1;
      total = res.total || 0;
      for (const h of res.data || []) {
        if (h['租售類型'] && h['租售類型'] !== 'buy') continue;
        const it = toListing(h);
        if (!it.sourceId || seen.has(it.sourceId)) continue;
        seen.add(it.sourceId);
        got++;
        if (targetTypes.length && !targetTypes.some(t => it.type.includes(t))) continue;
        listings.push(it);
      }
      page++;
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`[東森] ${area} ${got}/${total} 筆`);
  }

  listings.complete = complete;
  return listings;
}

module.exports = { scrape };

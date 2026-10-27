// 信義房屋爬蟲
// URL: /buy/list/{City}/{zip}-zip/{type}-type/default-desc/{page}（一頁 18 筆，資料在 __NEXT_DATA__ 的 buyReducer）
// 2026-10-27 修：舊版大幅漏抓——
//   - 第 1 頁抓完就 return，價格拆分後每段都只抓第 1 頁
//   - 價格網址寫成 price-1000-1500（沒作用，總數不變），正確是 1000-1500-price
//   → 8 區大樓／透天實際約 1.6 萬筆，舊版一直卡在 1995 筆
//   現在：逐區×房型直接翻完全部頁（可一直翻到最後一頁、排序穩定，不必拆價格）
// 注意：列表頁 HTTP 狀態碼是 404，但內容正常（信義網站本身就這樣），不能看狀態碼判斷
// 物件頁 /buy/house/{houseNo}，下架回 404

const { CITIES } = require('./regions');

// 房型網址：regions.js 的 elevator-type 不是信義的分類（等於不篩選，連公寓、店面、土地都抓進來）
//   大樓＝dalou-type（L）＋華廈 huaxia-type（M）；透天＝villa-type（D 透天、E 別墅）
const TYPE_SLUGS = { '大樓': ['dalou-type', 'huaxia-type'], '透天': ['villa-type'], '公寓': ['apartment-type'], '套房': ['flat-type'] };
const TYPE_NAME = { L: '大樓', M: '華廈', A: '公寓', D: '透天', E: '別墅' };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const GAP_MS = 500;
const MAX_PAGES = 600;   // 單一查詢安全上限（北屯大樓約 200 頁）
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchList(path) {
  const r = await fetch(`https://www.sinyi.com.tw/buy/list/${path}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(30000)
  });
  const html = await r.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`HTTP ${r.status} 沒有 __NEXT_DATA__`);
  const b = JSON.parse(m[1]).props?.initialReduxState?.buyReducer;
  if (!b || !Array.isArray(b.list)) throw new Error('沒有 buyReducer.list');
  return b;
}

function toListing(item, zipName) {
  return {
    source: '信義',
    sourceId: item.houseNo || '',
    title: item.name || '',
    address: item.address || '',
    community: item.commName || '',
    price: item.totalPrice ? parseFloat(item.totalPrice) : null,
    priceUnit: '萬',
    unitPrice: null,
    area: item.areaBuilding ? parseFloat(item.areaBuilding) : null,
    mainArea: item.pingUsed ? parseFloat(item.pingUsed) : null,
    layout: item.layout || '',
    floor: item.floor && item.totalfloor ? `${item.floor}F/${item.totalfloor}F` : '',
    age: item.age || '',
    type: TYPE_NAME[(item.houselandtype || [])[0]] || '',
    photo: item.image ? (Array.isArray(item.image) ? item.image[0] : item.image) : '',
    url: `https://www.sinyi.com.tw/buy/house/${item.houseNo}`,
    lat: item.latitude || null,
    lng: item.longitude || null,
    district: zipName[item.zipCode] || '',
    scrapedAt: new Date().toISOString()
  };
}

// filters: { city, districts[], propertyTypes[] }
// 第二個參數（舊版最多頁數）不再使用：一律翻完
async function scrape(filters = {}) {
  const cityName = filters.city || '台中市';
  const cityData = CITIES[cityName];
  if (!cityData) throw new Error(`未知城市: ${cityName}`);
  const zipName = Object.fromEntries(Object.entries(cityData.districts).map(([d, v]) => [String(v.zip), d]));

  // 信義一次只能一個區+一個房型
  const zips = (filters.districts || []).filter(d => cityData.districts[d]).map(d => cityData.districts[d].zip);
  const types = (filters.propertyTypes || []).flatMap(t => TYPE_SLUGS[t] || []);
  const combos = [];
  for (const zip of zips.length ? zips : [null]) {
    for (const type of types.length ? types : [null]) {
      combos.push([cityData.slugSinyi, zip && `${zip}-zip`, type].filter(Boolean).join('/'));
    }
  }

  const allListings = [];
  const seenIds = new Set();
  let complete = true;

  for (const combo of combos) {
    let total = '?', got = 0;
    for (let page = 1, last = 1; page <= last && page <= MAX_PAGES; page++) {
      let b;
      try {
        try { b = await fetchList(`${combo}/default-desc/${page}`); }
        catch { await sleep(5000); b = await fetchList(`${combo}/default-desc/${page}`); }
      } catch (err) {
        console.error(`[信義] ${combo} 第${page}頁失敗:`, err.message);
        complete = false;
        break;
      }
      if (!b.list.length) break;
      total = b.totalCnt || 0;
      if (page === 1) last = Math.ceil(total / b.list.length) || 1;
      for (const item of b.list) {
        got++;
        if (!item.houseNo || seenIds.has(item.houseNo)) continue;
        seenIds.add(item.houseNo);
        allListings.push(toListing(item, zipName));
      }
      await sleep(GAP_MS);
    }
    console.log(`[信義] ${combo} ${got}/${total} 筆`);
    // 翻頁途中有新上架／下架，筆數會差一點；差超過 2% 才算沒抓完
    if (typeof total === 'number' && got < total * 0.98) complete = false;
  }

  allListings.complete = complete;   // 有查詢沒翻完 → run.js 這次不判下架
  return allListings;
}

module.exports = { scrape };

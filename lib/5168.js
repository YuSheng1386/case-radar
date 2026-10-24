// 5168 實價登錄比價王爬蟲 (houseprice.tw)
// API: https://buy.houseprice.tw/ws/BuyCaseList/Search/{path}?p={page}
// Path format: /{city}_city/{district}_zip/{type}_type/
// 2026-10-24 修：
//   - 一頁固定 20 筆（size 參數無效），但可以一直翻到最後一頁、排序穩定
//   - 舊版每個價格區間最多 30 頁（600 筆）→ 8 區大樓 1.9 萬筆只抓到約 5600 筆；改逐區×房型翻完全部頁，不再拆價格
//   - 照片欄位叫 pictureInfo（舊寫 picInfo 一直是空的）
// 物件網址 /house/{sid}_{xxx}/，下架回 404（標題「此物件已下架」）
// ⚠ 只能從台灣 IP 抓：前面的 AWS 負載平衡器（awselb）依來源地區擋，GitHub Actions（美國）連 favicon 都回 403，
//   換 headers／X-Forwarded-For／http 都沒用（10/24 實測）→ 雲端用 RADAR_SKIP=5168 略過

const https = require('https');

function fetch5168(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}${res.statusCode === 403 ? '（5168 擋海外 IP）' : ''}`));
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

const typeMap = { '大樓': '電梯大樓', '透天': '透天', '公寓': '無電梯公寓' };
const MAX_PAGES = 1000;   // 單一查詢安全上限（北屯大樓約 340 頁）

function toListing(item) {
  const caseUrl = item.caseUrl || '';
  return {
    source: '5168',
    sourceId: String(item.sid || ''),
    title: item.caseName || '',
    address: `${item.city || ''}${item.district || ''}${item.road || ''}`,
    community: item.communityInfo ? item.communityInfo.communityName || '' : '',
    price: item.totalPrice ? parseFloat(item.totalPrice) : null,
    priceUnit: '萬',
    unitPrice: item.unitPrice ? parseFloat(item.unitPrice) : null,
    area: item.buildPin ? parseFloat(item.buildPin) : null,
    mainArea: item.mainPin ? parseFloat(item.mainPin) : null,
    layout: [
      item.rm ? `${item.rm}房` : '',
      item.livingRm ? `${item.livingRm}廳` : '',
      item.bathRm ? `${item.bathRm}衛` : ''
    ].filter(Boolean).join(''),
    floor: item.fromFloor && item.totalFloor ? `${item.fromFloor}F/${item.totalFloor}F` : '',
    age: item.buildAge || '',
    type: item.caseType || '',
    photo: (item.pictureInfo || item.picInfo || {}).coverUrl || '',
    url: caseUrl.startsWith('http') ? caseUrl : `https://buy.houseprice.tw${caseUrl}`,
    district: item.district || '',
    scrapedAt: new Date().toISOString()
  };
}

// 一個查詢（某區＋某房型）翻完全部頁；失敗重試一次，還是失敗回 complete=false
async function scrapeQuery(city, district, typeName, type5168) {
  const e = encodeURIComponent;
  const baseUrl = `https://buy.houseprice.tw/ws/BuyCaseList/Search/${e(city)}_city/` +
    (district ? `${e(district)}_zip/` : '') + (type5168 ? `${e(type5168)}_type/` : '');
  const listings = [];
  let total = '?', complete = true;
  for (let page = 1, last = 1; page <= last && page <= MAX_PAGES; page++) {
    const url = page > 1 ? `${baseUrl}?p=${page}` : baseUrl;
    let result;
    try {
      try { result = await fetch5168(url); }
      catch (err) { if (/403/.test(err.message)) throw err; await new Promise(r => setTimeout(r, 3000)); result = await fetch5168(url); }
    } catch (err) {
      console.error(`[5168] ${district}/${typeName} 第${page}頁失敗:`, err.message);
      complete = false;
      if (/403/.test(err.message)) throw err;   // 整個被擋 → 讓 run.js 記成這個來源失敗
      break;
    }
    const items = result.caseInfo || [];
    if (items.length === 0) break;
    last = result.page ? result.page.totalPageCount : page;
    total = result.page?.totalItemCount ?? total;
    for (const item of items) listings.push(toListing(item));
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`[5168] ${city}${district}/${typeName} ${listings.length}/${total} 筆`);
  return { listings, complete };
}

// filters: { city, districts[], propertyTypes[] }
// 第二個參數（舊版每段最多頁數）不再使用：一律翻完
async function scrape(filters = {}) {
  const city = filters.city || '台中市';
  const districts = filters.districts && filters.districts.length ? filters.districts : [''];
  const types = (filters.propertyTypes || []).filter(t => typeMap[t]).map(t => ({ name: t, code: typeMap[t] }));
  if (!types.length) types.push({ name: '全部', code: null });

  const allListings = [];
  const seenIds = new Set();
  let complete = true;
  for (const d of districts) {
    for (const type of types) {
      const r = await scrapeQuery(city, d, type.name, type.code);
      if (!r.complete) complete = false;
      for (const item of r.listings) {
        if (item.sourceId && !seenIds.has(item.sourceId)) {
          seenIds.add(item.sourceId);
          allListings.push(item);
        }
      }
    }
  }
  allListings.complete = complete;   // 有查詢沒翻完 → run.js 這次不判下架
  return allListings;
}

module.exports = { scrape };

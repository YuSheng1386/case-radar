// 5168 實價登錄比價王爬蟲 (houseprice.tw)
// API: https://buy.houseprice.tw/ws/BuyCaseList/Search/{path}?p={page}
// Path format: /{city}_city/{district}_zip/{type}_type/

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
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

const typeMap = { '大樓': '電梯大樓', '透天': '透天', '公寓': '無電梯公寓' };

// 爬取單一房型
async function scrapeByType(city, districtPath, typeName, type5168, maxPages) {
  const listings = [];
  let pathParts = `/${encodeURIComponent(city)}_city/`;
  if (districtPath) pathParts += districtPath;
  if (type5168) pathParts += `${encodeURIComponent(type5168)}_type/`;

  const baseUrl = `https://buy.houseprice.tw/ws/BuyCaseList/Search${pathParts}`;

  for (let page = 1; page <= maxPages; page++) {
    try {
      const url = page > 1 ? `${baseUrl}?p=${page}` : baseUrl;
      const result = await fetch5168(url);
      const items = result.caseInfo || [];
      if (items.length === 0) break;

      const totalPages = result.page ? result.page.totalPageCount : maxPages;

      for (const item of items) {
        const caseUrl = item.caseUrl || '';
        listings.push({
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
          photo: item.picInfo ? item.picInfo.coverUrl || '' : '',
          url: caseUrl.startsWith('http') ? caseUrl : `https://buy.houseprice.tw${caseUrl}`,
          district: item.district || '',
          scrapedAt: new Date().toISOString()
        });
      }

      console.log(`[5168] ${city}/${typeName} 第${page}頁, ${items.length} 筆 (共 ${result.page?.totalItemCount || '?'})`);
      if (page >= totalPages) break;
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[5168] ${typeName} 第${page}頁失敗:`, err.message);
      break;
    }
  }

  return listings;
}

// 價格區間（萬）— 分段查詢突破頁數限制
const PRICE_RANGES = [
  { min: 0, max: 1000, label: '0-1000萬' },
  { min: 1000, max: 1500, label: '1000-1500萬' },
  { min: 1500, max: 2000, label: '1500-2000萬' },
  { min: 2000, max: 3000, label: '2000-3000萬' },
  { min: 3000, max: 10000, label: '3000萬以上' },
];

// filters: { city, districts[], propertyTypes[] }
async function scrape(filters = {}, maxPages = 20) {
  const city = filters.city || '台中市';

  // 區域路徑
  let districtPath = '';
  if (filters.districts && filters.districts.length > 0) {
    districtPath = `${encodeURIComponent(filters.districts.join('-'))}_zip/`;
  }

  // 每個房型獨立查詢
  const types = [];
  if (filters.propertyTypes && filters.propertyTypes.length > 0) {
    for (const t of filters.propertyTypes) {
      if (typeMap[t]) types.push({ name: t, code: typeMap[t] });
    }
  }

  if (types.length === 0) {
    return scrapeByType(city, districtPath, '全部', null, maxPages);
  }

  const allListings = [];
  const seenIds = new Set();

  for (const type of types) {
    // 先查第一頁取得總頁數，決定是否需要價格拆分
    const testUrl = `https://buy.houseprice.tw/ws/BuyCaseList/Search/${encodeURIComponent(city)}_city/${districtPath}${type.code ? encodeURIComponent(type.code) + '_type/' : ''}`;
    let needSplit = false;
    try {
      const result = await fetch5168(testUrl);
      const totalPages = result.page ? result.page.totalPageCount : 0;
      needSplit = totalPages > maxPages;
      console.log(`[5168] ${type.name} 共 ${result.page?.totalItemCount || '?'} 筆 (${totalPages}頁)${needSplit ? ' → 價格拆分' : ''}`);
    } catch {}

    if (needSplit) {
      // 價格區間拆分
      for (const pr of PRICE_RANGES) {
        const pricePath = `${pr.min}-${pr.max}_price/`;
        const fullDistrictPath = districtPath + (type.code ? `${encodeURIComponent(type.code)}_type/` : '') + pricePath;
        const prItems = await scrapeByType(city, fullDistrictPath, `${type.name}/${pr.label}`, null, maxPages);
        for (const item of prItems) {
          if (!seenIds.has(item.sourceId)) {
            seenIds.add(item.sourceId);
            allListings.push(item);
          }
        }
      }
    } else {
      const items = await scrapeByType(city, districtPath, type.name, type.code, maxPages);
      for (const item of items) {
        if (!seenIds.has(item.sourceId)) {
          seenIds.add(item.sourceId);
          allListings.push(item);
        }
      }
    }
  }
  return allListings;
}

module.exports = { scrape };

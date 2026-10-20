// 信義房屋爬蟲
// URL: /buy/list/{City}/{zip}-zip/{type}-type/default-desc/{page}

const https = require('https');
const { CITIES, PROPERTY_TYPES } = require('./regions');

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html'
      }
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        const full = loc.startsWith('http') ? loc : `https://www.sinyi.com.tw${loc}`;
        return fetchPage(full).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try { return JSON.parse(match[1]); }
  catch { return null; }
}

// filters: { city, districts[], propertyTypes[] }
async function scrape(filters = {}, maxPages = 20) {
  const cityName = filters.city || '台中市';
  const cityData = CITIES[cityName];
  if (!cityData) throw new Error(`未知城市: ${cityName}`);

  // 建立篩選 URL 片段
  const slugParts = [cityData.slugSinyi];

  // 區域（信義一次只能篩一個區）
  const districtZips = [];
  if (filters.districts && filters.districts.length > 0) {
    for (const d of filters.districts) {
      if (cityData.districts[d]) districtZips.push(cityData.districts[d].zip);
    }
  }

  // 房型
  let typeSlugs = [];
  if (filters.propertyTypes && filters.propertyTypes.length > 0) {
    for (const t of filters.propertyTypes) {
      if (PROPERTY_TYPES[t]) typeSlugs.push(PROPERTY_TYPES[t].slugSinyi);
    }
  }

  // 價格區間（用於拆分大量結果）
  const PRICE_RANGES = [
    { slug: 'price-0-1000', label: '0-1000萬' },
    { slug: 'price-1000-1500', label: '1000-1500萬' },
    { slug: 'price-1500-2000', label: '1500-2000萬' },
    { slug: 'price-2000-3000', label: '2000-3000萬' },
    { slug: 'price-3000-5000', label: '3000萬以上' },
  ];

  // 信義一次只能一個區+一個房型，需要多次爬取組合
  const combinations = [];
  const districts = districtZips.length > 0 ? districtZips : [null];
  const types = typeSlugs.length > 0 ? typeSlugs : [null];

  for (const zip of districts) {
    for (const type of types) {
      const parts = [cityData.slugSinyi];
      if (zip) parts.push(`${zip}-zip`);
      if (type) parts.push(type);
      combinations.push(parts.join('/'));
    }
  }

  const allListings = [];
  const seenIds = new Set();

  async function scrapeCombo(combo, label, maxPg) {
    for (let page = 1; page <= maxPg; page++) {
      const url = `https://www.sinyi.com.tw/buy/list/${combo}/default-desc/${page}`;
      try {
        const html = await fetchPage(url);
        const nextData = extractNextData(html);
        if (!nextData) break;

        const buyReducer = nextData.props?.initialReduxState?.buyReducer;
        if (!buyReducer || !buyReducer.list) break;

        const items = buyReducer.list;
        if (items.length === 0) break;

        const totalCount = buyReducer.totalCnt || 0;
        const totalPages = Math.ceil(totalCount / 20);

        for (const item of items) {
          if (seenIds.has(item.houseNo)) continue;
          seenIds.add(item.houseNo);

          allListings.push({
            source: '信義',
            sourceId: item.houseNo || '',
            title: item.name || '',
            address: item.address || '',
            community: '',
            price: item.totalPrice ? parseFloat(item.totalPrice) : null,
            priceUnit: '萬',
            unitPrice: null,
            area: item.areaBuilding ? parseFloat(item.areaBuilding) : null,
            mainArea: item.pingUsed ? parseFloat(item.pingUsed) : null,
            layout: item.layout || '',
            floor: item.floor && item.totalfloor ? `${item.floor}F/${item.totalfloor}F` : '',
            age: item.age || '',
            type: '',
            photo: item.image ? (Array.isArray(item.image) ? item.image[0] : item.image) : '',
            url: `https://www.sinyi.com.tw/buy/house/${item.houseNo}`,
            lat: item.latitude || null,
            lng: item.longitude || null,
            district: item.zipCode ? '' : '',
            scrapedAt: new Date().toISOString()
          });
        }

        console.log(`[信義] ${label} 第${page}頁, ${items.length} 筆 (共 ${totalCount})`);
        if (page >= totalPages) break;
        await new Promise(r => setTimeout(r, 1200));

        // 回傳 totalPages 讓外層判斷是否需要拆分
        if (page === 1) return { totalCount, totalPages };
      } catch (err) {
        console.error(`[信義] ${label} 第${page}頁失敗:`, err.message);
        break;
      }
    }
    return null;
  }

  for (const combo of combinations) {
    // 先測第一頁取得總數
    const firstResult = await scrapeCombo(combo, combo, 1);

    if (firstResult && firstResult.totalPages > maxPages) {
      // 總頁數超過限制，用價格拆分
      console.log(`[信義] ${combo} ${firstResult.totalCount}筆/${firstResult.totalPages}頁 → 價格拆分`);
      for (const pr of PRICE_RANGES) {
        await scrapeCombo(`${combo}/${pr.slug}`, `${combo}/${pr.label}`, maxPages);
      }
    } else {
      // 第一頁已經抓了，繼續剩餘頁
      if (firstResult) {
        for (let page = 2; page <= Math.min(firstResult.totalPages, maxPages); page++) {
          const url = `https://www.sinyi.com.tw/buy/list/${combo}/default-desc/${page}`;
          try {
            const html = await fetchPage(url);
            const nextData = extractNextData(html);
            if (!nextData) break;
            const buyReducer = nextData.props?.initialReduxState?.buyReducer;
            if (!buyReducer || !buyReducer.list || buyReducer.list.length === 0) break;

            for (const item of buyReducer.list) {
              if (seenIds.has(item.houseNo)) continue;
              seenIds.add(item.houseNo);
              allListings.push({
                source: '信義', sourceId: item.houseNo || '', title: item.name || '',
                address: item.address || '', community: '',
                price: item.totalPrice ? parseFloat(item.totalPrice) : null, priceUnit: '萬', unitPrice: null,
                area: item.areaBuilding ? parseFloat(item.areaBuilding) : null,
                mainArea: item.pingUsed ? parseFloat(item.pingUsed) : null,
                layout: item.layout || '',
                floor: item.floor && item.totalfloor ? `${item.floor}F/${item.totalfloor}F` : '', age: item.age || '',
                type: '', photo: item.image ? (Array.isArray(item.image) ? item.image[0] : item.image) : '',
                url: `https://www.sinyi.com.tw/buy/house/${item.houseNo}`,
                lat: item.latitude || null, lng: item.longitude || null, district: '', scrapedAt: new Date().toISOString()
              });
            }
            console.log(`[信義] ${combo} 第${page}頁, ${buyReducer.list.length} 筆`);
            await new Promise(r => setTimeout(r, 1200));
          } catch (err) {
            console.error(`[信義] ${combo} 第${page}頁失敗:`, err.message);
            break;
          }
        }
      }
    }
  }

  return allListings;
}

module.exports = { scrape };

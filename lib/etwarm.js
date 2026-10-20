// 東森房屋爬蟲 (etwarm.com.tw)
// Map API: POST /getMapSearchDataJson.php → cluster IDs
// Detail API: POST /getMapSearchDetailJson.php → listing details

const https = require('https');
const { CITIES } = require('./regions');

// 各城市的地圖邊界
const CITY_BOUNDS = {
  '台中市': { lat1: 24.03, lng1: 120.45, lat2: 24.35, lng2: 120.85 },
  '台北市': { lat1: 25.00, lng1: 121.45, lat2: 25.12, lng2: 121.62 },
  '新北市': { lat1: 24.85, lng1: 121.28, lat2: 25.30, lng2: 121.62 },
  '桃園市': { lat1: 24.85, lng1: 121.10, lat2: 25.12, lng2: 121.42 },
  '高雄市': { lat1: 22.50, lng1: 120.20, lat2: 22.80, lng2: 120.45 },
  '台南市': { lat1: 22.88, lng1: 120.10, lat2: 23.15, lng2: 120.42 },
};

// 台中各區經緯度範圍（縮小搜尋範圍用）
const DISTRICT_BOUNDS = {
  '台中市': {
    '北屯區': { lat1: 24.155, lng1: 120.660, lat2: 24.210, lng2: 120.720 },
    '西屯區': { lat1: 24.155, lng1: 120.595, lat2: 24.200, lng2: 120.660 },
    '南屯區': { lat1: 24.120, lng1: 120.595, lat2: 24.165, lng2: 120.660 },
    '北區':   { lat1: 24.155, lng1: 120.670, lat2: 24.175, lng2: 120.700 },
    '南區':   { lat1: 24.120, lng1: 120.660, lat2: 24.150, lng2: 120.700 },
    '西區':   { lat1: 24.135, lng1: 120.650, lat2: 24.160, lng2: 120.680 },
    '東區':   { lat1: 24.130, lng1: 120.690, lat2: 24.155, lng2: 120.720 },
    '中區':   { lat1: 24.137, lng1: 120.670, lat2: 24.150, lng2: 120.690 },
    '太平區': { lat1: 24.125, lng1: 120.700, lat2: 24.195, lng2: 120.780 },
    '大里區': { lat1: 24.080, lng1: 120.660, lat2: 24.130, lng2: 120.720 },
    '豐原區': { lat1: 24.230, lng1: 120.700, lat2: 24.280, lng2: 120.740 },
    '潭子區': { lat1: 24.200, lng1: 120.690, lat2: 24.240, lng2: 120.730 },
    '大雅區': { lat1: 24.200, lng1: 120.620, lat2: 24.250, lng2: 120.670 },
    '沙鹿區': { lat1: 24.210, lng1: 120.550, lat2: 24.260, lng2: 120.600 },
    '烏日區': { lat1: 24.070, lng1: 120.600, lat2: 24.130, lng2: 120.660 },
    '霧峰區': { lat1: 24.030, lng1: 120.680, lat2: 24.090, lng2: 120.750 },
  }
};

function postRequest(path, body) {
  return new Promise((resolve, reject) => {
    const postData = typeof body === 'string' ? body :
      Object.entries(body).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

    const options = {
      hostname: 'www.etwarm.com.tw',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.etwarm.com.tw/map_search.php',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

// 並行取得單筆詳情（限制同時連線數）
async function fetchDetailsConcurrent(ids, concurrency = 10) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < ids.length) {
      const id = ids[idx++];
      try {
        const result = await postRequest('/getMapSearchDetailJson.php', {
          sort: 'price_asc',
          ids: id
        });
        const items = result.n || [];
        if (items.length > 0) results.push(items[0]);
      } catch (e) {
        // skip failed
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, ids.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// filters: { city, districts[], propertyTypes[] }
async function scrape(filters = {}) {
  const city = filters.city || '台中市';
  const targetDistricts = filters.districts || [];

  // 有選區域時，用區域的 bounds 縮小範圍
  const boundsList = [];
  if (targetDistricts.length > 0 && DISTRICT_BOUNDS[city]) {
    for (const d of targetDistricts) {
      if (DISTRICT_BOUNDS[city][d]) {
        boundsList.push({ name: d, ...DISTRICT_BOUNDS[city][d] });
      }
    }
  }
  // 沒選區域或沒有區域 bounds，用整個城市
  if (boundsList.length === 0) {
    const cityBounds = CITY_BOUNDS[city];
    if (!cityBounds) {
      console.log(`[東森] ${city} 無地圖邊界設定，跳過`);
      return [];
    }
    boundsList.push({ name: city, ...cityBounds });
  }

  const listings = [];

  for (const bounds of boundsList) {
    console.log(`[東森] 查詢 ${bounds.name} 物件...`);
    let clusters;
    try {
      clusters = await postRequest('/getMapSearchDataJson.php', {
        lat1: bounds.lat1, lng1: bounds.lng1,
        lat2: bounds.lat2, lng2: bounds.lng2,
        zoom: 14, dealType: 1
      });
    } catch (e) {
      console.error(`[東森] ${bounds.name} 查詢失敗:`, e.message);
      continue;
    }

    if (!Array.isArray(clusters) || clusters.length === 0) continue;

    // 收集所有 ID
    const allIds = [];
    for (const c of clusters) {
      if (c.ids) {
        const ids = c.ids.split('||').filter(Boolean);
        allIds.push(...ids);
      }
    }
    console.log(`[東森] ${bounds.name} 共 ${allIds.length} 筆物件，逐筆取得詳情...`);
    if (allIds.length === 0) continue;

    // API 每次只回傳 1 筆，改為並行逐筆查詢
    const items = await fetchDetailsConcurrent(allIds, 10);
    console.log(`[東森] ${bounds.name} 取得 ${items.length} 筆有效詳情`);

    const typeMap = { '大樓': '大樓', '透天': '透天', '公寓': '公寓' };
    const targetTypes = (filters.propertyTypes || []).map(t => typeMap[t]).filter(Boolean);

    for (const h of items) {
      const addr = h.ads || '';
      const hType = h.type || '';

      // 篩選房型
      if (targetTypes.length > 0) {
        const matchType = targetTypes.some(t => hType.includes(t));
        if (!matchType) continue;
      }

      // 篩選區域
      if (targetDistricts.length > 0) {
        const matchDist = targetDistricts.some(d => addr.includes(d.replace('區', '')));
        if (!matchDist) continue;
      }

      const district = addr.replace(/^(台中市|台北市|新北市|桃園市|高雄市|台南市)/, '')
        .match(/^([\u4e00-\u9fa5]{1,4}[區鄉鎮市])/);

      const priceStr = typeof h.price === 'string' ? h.price.replace(/,/g, '') : h.price;

      listings.push({
        source: '東森',
        sourceId: h.id || h.oid || '',
        title: h.title || '',
        address: addr,
        community: '',
        price: priceStr ? parseFloat(priceStr) : null,
        priceUnit: '萬',
        unitPrice: null,
        area: h.ping || null,
        mainArea: null,
        layout: h.pattern || '',
        floor: '',
        age: h.old ? `${h.old}年` : '',
        type: hType,
        photo: '',
        url: `https://www.etwarm.com.tw/object_detail.php?obj_id=${h.oid || h.id}`,
        lat: null,
        lng: null,
        district: district ? district[1] : '',
        scrapedAt: new Date().toISOString()
      });
    }
  } // end boundsList loop

  return listings;
}

module.exports = { scrape };

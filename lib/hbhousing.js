// 住商不動產爬蟲 (hbhousing.com.tw)
// POST API: /proxy/api/HB/BuyHouseRelated/GetHouseDataCount
// 支援 cityNo + zipCode 篩選

const https = require('https');
const { CITIES } = require('./regions');

// 住商城市代碼（與 591 不同）
const HB_CITY_CODES = {
  '台北市': 1, '基隆市': 2, '新北市': 3, '桃園市': 5,
  '新竹市': 6, '新竹縣': 7, '苗栗縣': 8, '台中市': 9,
  '南投縣': 11, '彰化縣': 12, '雲林縣': 13, '嘉義市': 14,
  '嘉義縣': 15, '台南市': 16, '高雄市': 17, '屏東縣': 18,
  '宜蘭縣': 19, '花蓮縣': 20, '台東縣': 21
};

function postJSON(path, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const options = {
      hostname: 'www.hbhousing.com.tw',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

// filters: { city, districts[], propertyTypes[] }
async function scrape(filters = {}, maxPages = 20) {
  const city = filters.city || '台中市';
  const cityNo = HB_CITY_CODES[city];
  if (!cityNo) {
    console.log(`[住商] ${city} 無對應代碼，跳過`);
    return [];
  }

  const cityData = CITIES[city];
  const listings = [];

  // 區域篩選 (zip codes)
  const zipCodes = [];
  if (filters.districts && filters.districts.length > 0 && cityData) {
    for (const d of filters.districts) {
      if (cityData.districts[d]) zipCodes.push(String(cityData.districts[d].zip));
    }
  }

  // 房型篩選
  const styleMap = { '大樓': '大樓', '透天': '透天', '公寓': '公寓' };
  const targetTypes = (filters.propertyTypes || []).map(t => styleMap[t]).filter(Boolean);

  for (let page = 1; page <= maxPages; page++) {
    try {
      const body = {
        cityNo,
        zipCode: zipCodes,
        vrType: 0,
        sort: 0,
        page,
        pageRows: 30,
        style: [],
        type: []
      };

      const result = await postJSON('/proxy/api/HB/BuyHouseRelated/GetHouseDataCount', body);
      const respData = result.data || {};
      const items = respData.buyHouseListDatas || [];
      const total = respData.cnts || 0;

      if (items.length === 0) break;

      const totalPages = Math.ceil(total / 30);

      for (const h of items) {
        const doorplate = h.doorplate || h.address || '';
        const style = h.style || '';

        // 房型篩選
        if (targetTypes.length > 0) {
          const matchType = targetTypes.some(t => style.includes(t));
          if (!matchType) continue;
        }

        const district = doorplate.match(/^([\u4e00-\u9fa5]{1,4}[區鄉鎮市])/);

        listings.push({
          source: '住商',
          sourceId: h.sn || '',
          title: h.objName || '',
          address: `${city}${doorplate}`,
          community: '',
          price: h.price || null,
          priceUnit: '萬',
          unitPrice: h.mainArea && h.price ? Math.round(h.price / h.mainArea * 100) / 100 : null,
          area: h.area || null,
          mainArea: h.mainArea || null,
          layout: h.special || [
            h.room ? `${h.room}房` : '',
            h.hall ? `${h.hall}廳` : '',
            h.bath ? `${h.bath}衛` : ''
          ].filter(Boolean).join(''),
          floor: h.floor && h.floorTotal ? `${h.floor}F/${h.floorTotal}F` : '',
          age: h.age ? `${h.age}年` : '',
          type: style,
          photo: h.photo1 || '',
          url: `https://www.hbhousing.com.tw/buyhouse/detail/${h.sn}/`,
          lat: h.lat || null,
          lng: h.lon || null,
          district: district ? district[1] : '',
          scrapedAt: new Date().toISOString()
        });
      }

      console.log(`[住商] ${city}${zipCodes.length ? ` (${zipCodes.join(',')})` : ''} 第${page}頁, ${items.length} 筆 (共 ${total})`);
      if (page >= totalPages || page >= maxPages) break;
      await new Promise(r => setTimeout(r, 800));
    } catch (err) {
      console.error(`[住商] 第${page}頁失敗:`, err.message);
      break;
    }
  }

  return listings;
}

module.exports = { scrape };

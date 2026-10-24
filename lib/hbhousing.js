// 住商不動產爬蟲 (hbhousing.com.tw)
// POST API: /proxy/api/HB/BuyHouseRelated/GetHouseDataCount
// 支援 cityNo + zipCode 篩選
// 2026-10-24 修：
//   - sort 0 每次排序不同，翻頁會重複／漏（南區 895 筆翻完只有 589 筆不重複）→ 改 sort 1（穩定）
//   - 舊版一次查全部區、最多 30 頁×30 筆＝900 筆，但 8 區有 1.3 萬筆 → 每次抓到不同子集，
//     追蹤紀錄 2498 筆有 1959 筆被誤判下架（抽 40 筆有 38 筆其實還在）→ 改逐區查、一頁 1000 筆抓完整
//   - 住商網站也列合作品牌的物件（storeID O 開頭：OSIN 信義、OCTH 中信、OPAC 太平洋…）
//     信義我們直接抓（資料更準）→ 略過 OSIN 免得重複；中信等其他品牌沒有別的來源，保留
// 物件在不在：POST /proxy/api/HB/BuyHouseRelated/GetHouseDetailData {sn} → 在架 code 200＋data；下架 code 201「No Data」
//   （網頁 /buyhouse/detail/{sn}/ 是前端渲染，在不在都回同一頁，看不出來）

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

const PAGE_ROWS = 1000;
const SKIP_STORES = new Set(['OSIN']);   // 信義（直接抓信義官網）

// filters: { city, districts[], propertyTypes[] }
// maxPages：每區最多翻幾頁（一頁 1000 筆）
async function scrape(filters = {}, maxPages = 20) {
  const city = filters.city || '台中市';
  const cityNo = HB_CITY_CODES[city];
  if (!cityNo) {
    console.log(`[住商] ${city} 無對應代碼，跳過`);
    return [];
  }

  const cityData = CITIES[city];
  const listings = [];
  const seen = new Set();
  let complete = true;

  // 區域篩選 (zip codes)：逐區查（全部一起查時翻頁不穩）
  const zips = [];   // [zip, 區名]
  if (filters.districts && filters.districts.length > 0 && cityData) {
    for (const d of filters.districts) {
      if (cityData.districts[d]) zips.push([String(cityData.districts[d].zip), d]);
    }
  }
  if (!zips.length) zips.push([null, '']);

  // 房型篩選
  const styleMap = { '大樓': '大樓', '透天': '透天', '公寓': '公寓' };
  const targetTypes = (filters.propertyTypes || []).map(t => styleMap[t]).filter(Boolean);

  for (const [zip, dName] of zips) {
    let got = 0, skipped = 0, total = 0;
    for (let page = 1; page <= maxPages; page++) {
      const body = { cityNo, zipCode: zip ? [zip] : [], vrType: 0, sort: 1, page, pageRows: PAGE_ROWS, style: [], type: [] };
      let result;
      try {
        try { result = await postJSON('/proxy/api/HB/BuyHouseRelated/GetHouseDataCount', body); }
        catch { await new Promise(r => setTimeout(r, 3000)); result = await postJSON('/proxy/api/HB/BuyHouseRelated/GetHouseDataCount', body); }
      } catch (err) {
        console.error(`[住商] ${dName || city} 第${page}頁失敗:`, err.message);
        complete = false;
        break;
      }
      const respData = result.data || {};
      const items = respData.buyHouseListDatas || [];
      total = respData.cnts || 0;
      if (items.length === 0) break;

      for (const h of items) {
        got++;
        if (!h.sn || seen.has(h.sn)) continue;
        seen.add(h.sn);
        if (SKIP_STORES.has(h.storeID)) { skipped++; continue; }
        const doorplate = h.doorplate || h.address || '';
        const style = h.style || '';

        // 房型篩選
        if (targetTypes.length > 0) {
          const matchType = targetTypes.some(t => style.includes(t));
          if (!matchType) continue;
        }

        // 區名用查詢的那區（舊版從門牌抓，「南屯區市政路」會抓成「南屯區市」）
        const district = dName || (doorplate.match(/^([一-龥]{1,3}?[區鄉鎮市])/) || [])[1] || '';

        listings.push({
          source: '住商',
          sourceId: h.sn,
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
          district,
          scrapedAt: new Date().toISOString()
        });
      }

      if (page >= Math.ceil(total / PAGE_ROWS)) break;
      if (page >= maxPages) { complete = false; break; }
      await new Promise(r => setTimeout(r, 800));
    }
    console.log(`[住商] ${city}${dName} ${got}/${total} 筆（略過信義 ${skipped}）`);
    if (got < total) complete = false;
    await new Promise(r => setTimeout(r, 800));
  }

  listings.complete = complete;   // 有區沒抓完 → run.js 這次不判下架
  return listings;
}

module.exports = { scrape };

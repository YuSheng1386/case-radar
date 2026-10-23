// 591 售屋（雷達版）— 比主系統多保留：急售旗標、降價旗標、屋主自售、專任、社區、主建物
// API: https://bff-house.591.com.tw/v1/web/sale/list
//   shType=list 一般列表（含仲介＋屋主）、shType=host 只有屋主自售

const https = require('https');
const { CITIES, PROPERTY_TYPES } = require('./regions');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`591 回應不是 JSON (HTTP ${res.statusCode})`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function toListing(h, fromHost) {
  const nick = h.nick_name || '';
  return {
    source: '591',
    sourceId: String(h.houseid),
    title: h.title || '',
    address: `${h.region_name || ''}${h.section_name || ''}${h.address || ''}`,
    district: h.section_name || '',
    community: h.community_name || '',
    communityId: (String(h.community_link || '').match(/(\d+)\/?$/) || [])[1] || null,
    price: h.price ? parseFloat(h.price) : null,
    unitPrice: h.unitprice ? parseFloat(h.unitprice) : null,
    area: h.area ? parseFloat(h.area) : null,
    mainArea: h.mainarea ? parseFloat(h.mainarea) : null,
    layout: h.room || '',
    floor: h.floor || '',
    age: h.houseage ? parseFloat(h.houseage) : null,
    type: h.shape_name || '',
    photo: h.photo_url || '',
    url: `https://sale.591.com.tw/home/house/detail/${h.houseid}.html`,
    agent: nick,
    isOwner: fromHost || /^屋主/.test(nick),
    flagHurry: h.is_hurry_price === 1,
    flagDown: h.is_down_price === 1,
    exclusive: h.show_exclusive === 1,
    hasCarport: h.has_carport === 1,
    // 車位型式（平面式、機械式、坡道平面…）與 591 特色標籤（明星學區、近捷運、有陽台…）：LINE 查詢用
    carModel: h.cartmodel || '',
    features: Array.isArray(h.tag) ? h.tag.filter(t => typeof t === 'string') : [],
    postTime: h.posttime ? new Date(Number(h.posttime) * 1000).toISOString() : null
  };
}

// known: Map(sourceId → 上次價格)；有給就啟用「增量模式」：
//   連續 stopAfter 頁都沒有新物件、也沒有變價 → 後面都是看過的，提早停
async function pageThrough(baseUrl, label, fromHost, maxPages, known = null, stopAfter = 3) {
  const out = [];
  let total = 0;
  let quiet = 0;
  out.complete = false;
  for (let page = 0; page < maxPages; page++) {
    const url = `${baseUrl}&firstRow=${page * 30}&totalRows=${total}`;
    let j;
    try { j = await getJSON(url); }
    catch (e) { await sleep(3000); j = await getJSON(url); } // 重試一次
    const list = j?.data?.house_list;
    if (!list) throw new Error(`${label} 第${page + 1}頁無資料`);
    total = Number(j.data.total) || total;
    const houses = list.filter(h => h.houseid);
    if (houses.length === 0 || (page + 1) * 30 >= total) {
      for (const h of houses) out.push(toListing(h, fromHost));
      out.complete = true;
      break;
    }
    for (const h of houses) out.push(toListing(h, fromHost));
    if ((page + 1) % 50 === 0) console.log(`[591] ${label} 第${page + 1}頁／共約${Math.ceil(total / 30)}頁`);
    if (known) {
      const changed = houses.some(h => {
        const p = known.get(String(h.houseid));
        return p === undefined || (h.price && parseFloat(h.price) !== p);
      });
      quiet = changed ? 0 : quiet + 1;
      if (quiet >= stopAfter) { console.log(`[591] ${label} 第${page + 1}頁起都看過，提早停`); break; }
    }
    await sleep(500);
  }
  return out;
}

// 依區域×房型抓一般列表，再加屋主自售專區（全市，量小）
async function scrape({ city = '台中市', districts = [], propertyTypes = ['大樓', '透天'], maxPages = 40, known = null } = {}) {
  const cityData = CITIES[city];
  if (!cityData) throw new Error(`未知城市: ${city}`);
  const sections = districts.map(d => cityData.districts[d]?.sec591).filter(Boolean);
  const base = `https://bff-house.591.com.tw/v1/web/sale/list?type=2&regionid=${cityData.code591}`;
  const sec = sections.length ? `&section=${sections.join(',')}` : '';

  const byId = new Map();
  let complete = true;
  for (const t of propertyTypes) {
    const shape = PROPERTY_TYPES[t]?.shape591;
    if (!shape) continue;
    const items = await pageThrough(`${base}&shType=list${sec}&shape=${shape}`, `591/${t}`, false, maxPages, known);
    for (const it of items) byId.set(it.sourceId, it);
    complete = complete && items.complete;
    console.log(`[591] ${t}: ${items.length} 筆${items.complete ? '（完整）' : '（前段）'}`);
  }
  // 屋主自售：一般列表也有，但專區保證抓全；同 id 以屋主標記為準
  const host = await pageThrough(`${base}&shType=host${sec}`, '591/屋主', true, 30, known);
  for (const it of host) {
    const prev = byId.get(it.sourceId);
    byId.set(it.sourceId, prev ? { ...prev, isOwner: true } : it);
  }
  console.log(`[591] 屋主自售: ${host.length} 筆`);
  const all = [...byId.values()];
  all.complete = complete && host.complete; // 只有完整抓完才能拿來判斷下架
  return all;
}

// 全市「只抓熱門關鍵字」：五區以外的區域，用 591 關鍵字搜尋＋屋主自售專區
//   591 關鍵字是模糊比對（實測約 9 成標題真的含該字），回來後由 core.tagsOf 再過濾
//   「便宜」太雜（2202 筆只有 1 成相關），不用
async function scrapeWide({ city = '台中市', skipDistricts = [], keywords = ['急售', '賠售', '認賠', '自售', '降價', '低於行情'] } = {}) {
  const cityData = CITIES[city];
  const base = `https://bff-house.591.com.tw/v1/web/sale/list?type=2&regionid=${cityData.code591}`;
  // 591 一次最多只認 5 個 section（給 24 個只回前 5 區）→ 不帶 section 查全市，回來再濾掉五區
  const batches = [''];
  const byId = new Map();
  let complete = true;
  const counts = {};
  for (const sec of batches) {
    for (const kw of keywords) {
      const items = await pageThrough(`${base}&shType=list${sec}&keywords=${encodeURIComponent(kw)}`, `591全市/${kw}`, false, 80);
      for (const it of items) byId.set(it.sourceId, it);
      complete = complete && items.complete;
      counts[kw] = (counts[kw] || 0) + items.length;
    }
    const host = await pageThrough(`${base}&shType=host${sec}`, '591全市/屋主', true, 40);
    for (const it of host) {
      const prev = byId.get(it.sourceId);
      byId.set(it.sourceId, prev ? { ...prev, isOwner: true } : it);
    }
    complete = complete && host.complete;
    counts['屋主自售'] = (counts['屋主自售'] || 0) + host.length;
  }
  console.log(`[591全市] ${JSON.stringify(counts)}`);
  const all = [...byId.values()].filter(x => !skipDistricts.includes(x.district));
  all.complete = complete;
  return all;
}

module.exports = { scrape, scrapeWide };

// 同體系店家物件清單（店家名單來自 Secret EXCLUDED_STORES／本機 stores.local.json）
// 店家列表頁: https://shop.yungching.com.tw/{phone}/list?pg=N  → 物件 id
// 物件詳細頁: https://buy.yungching.com.tw/house/{id}          → 地址/社區/建物坪/樓層/價格（免登入）
// 店家一律用 phone 當 key（不同品牌可能同店名，用店名會被合併成一間）

const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fetchHtml(url, depth = 0) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } }, (res) => {
      if ([301, 302].includes(res.statusCode) && res.headers.location && depth < 3) {
        res.resume();
        const loc = res.headers.location;
        return resolve(fetchHtml(loc.startsWith('http') ? loc : new URL(loc, url).href, depth + 1));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(res.statusCode === 200 ? data : ''));
    });
    req.on('error', () => resolve(''));
    req.setTimeout(15000, () => { req.destroy(); resolve(''); });
  });
}

async function storeIds(phone) {
  const first = await fetchHtml(`https://shop.yungching.com.tw/${phone}/list?pg=1`);
  const grab = html => {
    const m = html.match(/list_ids:\s*\[([0-9,\s]+)\]/);
    return m ? m[1].split(',').map(s => s.trim()).filter(Boolean) : [];
  };
  const ids = grab(first);
  if (!first) throw new Error(`店家頁打不開 ${phone}`);
  const total = parseInt((first.match(/全部\s*\((\d+)\)/) || [])[1] || ids.length, 10);
  for (let pg = 2; pg <= Math.ceil(total / 30); pg++) {
    ids.push(...grab(await fetchHtml(`https://shop.yungching.com.tw/${phone}/list?pg=${pg}`)));
    await sleep(300);
  }
  return { ids: [...new Set(ids)], total };
}

function parseDetail(html, id) {
  if (!html) return null;
  const out = { id };
  const pm = html.match(/"price":\s*(\d+(?:\.\d+)?)/);
  out.price = pm ? parseFloat(pm[1]) : null;

  const nameM = html.match(/"@type":"Product","name":"([^"]+)"/);
  if (nameM) {
    const segs = nameM[1].split(/[｜|]/).map(s => s.trim()).filter(Boolean);
    const addrIdx = segs.findIndex(s => /市.+[區鄉鎮].*(住宅|路|街|大道)/.test(s));
    if (addrIdx > 0) out.community = segs[addrIdx - 1];
    const am = (addrIdx >= 0 ? segs[addrIdx] : '').match(/(台中市|臺中市|[^\s]+?[市縣])([一-龥]+?[區鄉鎮市])([^\s]+)?/);
    if (am) { out.district = am[2]; out.address = (am[1] + am[2] + (am[3] || '')).replace(/住宅.*/, ''); }
  }
  if (!out.address) {
    const dm = html.match(/<meta name="description" content="([^"]+)"/);
    const a = dm && dm[1].match(/位於(.+?)[，,]/);
    if (a) out.address = a[1];
  }

  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const ageM = text.match(/屋齡\s*([\d.]+)\s*年/);
  if (ageM) out.age = parseFloat(ageM[1]);
  const flM = text.match(/(\d+)\s*\/\s*(\d+)\s*樓/);
  if (flM) { out.floor = parseInt(flM[1], 10); out.totalFloor = parseInt(flM[2], 10); }
  // 建物 = 權狀總坪（與 591 area 同口徑）；主+陽 另存
  const areaM = text.match(/建物\s*([\d.]+)\s*坪/);
  if (areaM) out.area = parseFloat(areaM[1]);
  const mpM = text.match(/主\+陽\s*([\d.]+)\s*坪/);
  if (mpM) out.mainPlus = parseFloat(mpM[1]);
  return out.price || out.address ? out : null;
}

// stores: [{name, brand, phone}]；cache: { id: detail }（會被就地更新）
// 回傳 { listings: [{...detail, stores:[phone]}], storeCounts }
async function scrapeStores(stores, cache, { refreshDays = 5, onlyCity = '台中市' } = {}) {
  const idStores = new Map();
  const storeCounts = {};
  for (const s of stores) {
    const { ids, total } = await storeIds(s.phone);
    storeCounts[s.phone] = { name: s.name, brand: s.brand, ids: ids.length, total };
    console.log(`[同體系] ${s.brand} ${s.name}(${s.phone}): ${ids.length}/${total}`);
    for (const id of ids) {
      if (!idStores.has(id)) idStores.set(id, []);
      idStores.get(id).push(s.phone);
    }
    await sleep(800);
  }

  const now = Date.now();
  const stale = [...idStores.keys()].filter(id => {
    const c = cache[id];
    return !c || !c.fetchedAt || now - Date.parse(c.fetchedAt) > refreshDays * 864e5;
  });
  console.log(`[同體系] 共 ${idStores.size} 筆，需抓詳細頁 ${stale.length} 筆`);
  for (let i = 0; i < stale.length; i += 5) {
    const batch = stale.slice(i, i + 5);
    const res = await Promise.all(batch.map(async id =>
      parseDetail(await fetchHtml(`https://buy.yungching.com.tw/house/${id}`), id)));
    res.forEach((d, k) => { if (d) cache[batch[k]] = { ...d, fetchedAt: new Date().toISOString() }; });
    if ((i / 5) % 40 === 0) console.log(`[同體系] 詳細頁 ${Math.min(i + 5, stale.length)}/${stale.length}`);
    await sleep(400);
  }

  const listings = [];
  for (const [id, phones] of idStores) {
    const d = cache[id];
    if (!d || !d.address) continue;
    if (onlyCity && !/^(台|臺)中市/.test(d.address)) continue;
    listings.push({ ...d, stores: phones, url: `https://buy.yungching.com.tw/house/${id}` });
  }
  // 快取只留目前還在架上的
  for (const id of Object.keys(cache)) if (!idStores.has(id)) delete cache[id];
  return { listings, storeCounts };
}

module.exports = { scrapeStores, parseDetail };

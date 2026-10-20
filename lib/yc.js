// 同體系店家物件清單（店家名單來自 Secret EXCLUDED_STORES／本機 stores.local.json）
// 店家列表頁: https://shop.yungching.com.tw/{phone}/list?pg=N
//   每張卡片就有 id、地址、型態、屋齡、樓層、土地／主+陽／建物坪、格局、價格
//   → 不需要抓物件詳細頁（buy.yungching.com.tw/house/{id} 會擋海外 IP，GitHub 抓不到）
// 店家一律用 phone 當 key（不同品牌可能同店名，用店名會被合併成一間）

const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fetchHtml(url, depth = 0) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } }, (res) => {
      if ([301, 302].includes(res.statusCode) && res.headers.location && depth < 3) {
        res.resume();
        return resolve(fetchHtml(new URL(res.headers.location, url).href, depth + 1));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(res.statusCode === 200 ? data : ''));
    });
    req.on('error', () => resolve(''));
    req.setTimeout(20000, () => { req.destroy(); resolve(''); });
  });
}

const num = s => { const v = parseFloat(String(s).replace(/,/g, '')); return isNaN(v) ? null : v; };
const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// 解析一頁列表 → 物件陣列
function parseListPage(html) {
  const out = [];
  const blocks = html.split('<section class="m-search-list-item"').slice(1);
  for (const b of blocks) {
    const idM = b.match(/buy\.yungching\.com\.tw\/house\/(\d+)/);
    if (!idM) continue;
    const it = { id: idM[1] };
    const h1 = (b.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || '';
    // 「標題...　台中市北屯區軍功路二段」：地址在最後，以縣市開頭
    const t = strip(h1);
    const am = t.match(/^(.*?)\s*([一-龥]{2}[市縣][一-龥]{1,4}?[區鄉鎮市]\S*)$/);
    it.title = (am ? am[1] : t).replace(/\.\.\.$/, '');
    it.address = am ? am[2] : '';
    const dm = it.address.match(/^(?:台中市|臺中市|[^\s]{2}[市縣])([一-龥]{1,4}?[區鄉鎮市])/);
    if (dm) it.district = dm[1];

    const lis = [...(b.match(/<ul class="search-list-item-detail">([\s\S]*?)<\/ul>/) || [, ''])[1]
      .matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => strip(m[1])).filter(Boolean);
    for (const li of lis) {
      let m;
      if ((m = li.match(/^([\d.]+)年$/))) it.age = num(m[1]);
      else if ((m = li.match(/^建物\s*([\d.]+)\s*坪/))) it.area = num(m[1]);      // 權狀總坪，與 591 area 同口徑
      else if ((m = li.match(/^主\+陽\s*([\d.]+)\s*坪/))) it.mainPlus = num(m[1]);
      else if ((m = li.match(/^土地\s*([\d.]+)\s*坪/))) it.land = num(m[1]);
      else if ((m = li.match(/^(\d+)(?:\s*~\s*(\d+))?\s*\/\s*(\d+)樓$/))) {
        // 「2 ~ 2 / 12樓」單層；「1 ~ 4 / 4樓」透天整棟 → 不給單一樓層
        if (!m[2] || m[1] === m[2]) it.floor = parseInt(m[1], 10);
        it.floorText = li; it.totalFloor = parseInt(m[3], 10);
      }
      else if (/車位/.test(li)) it.parking = li;
      else if (/房|廳|衛/.test(li)) it.layout = li;
      else if (!it.type && /^[一-龥]{2,6}$/.test(li)) it.type = li;
    }
    if (!it.area) delete it.area; // 土地案建物 0 坪
    const pm = b.match(/search-list-item-discount-price[\s\S]*?<em>([\d,.]+)<\/em>/) || b.match(/<em>([\d,.]+)<\/em>\s*萬/);
    it.price = pm ? num(pm[1]) : null;
    out.push(it);
  }
  return out;
}

async function storeListings(phone) {
  const first = await fetchHtml(`https://shop.yungching.com.tw/${phone}/list?pg=1`);
  if (!first) throw new Error(`店家頁打不開 ${phone}`);
  const total = parseInt((first.match(/全部\s*\((\d+)\)/) || [])[1] || '0', 10);
  const items = parseListPage(first);
  for (let pg = 2; pg <= Math.ceil(total / 30); pg++) {
    await sleep(400);
    items.push(...parseListPage(await fetchHtml(`https://shop.yungching.com.tw/${phone}/list?pg=${pg}`)));
  }
  return { items, total };
}

// stores: [{name, brand, phone}] → { listings: [{...物件, stores:[phone]}], storeCounts }
async function scrapeStores(stores, { onlyCity = '台中市' } = {}) {
  const byId = new Map();
  const storeCounts = {};
  for (const s of stores) {
    const { items, total } = await storeListings(s.phone);
    storeCounts[s.phone] = { name: s.name, brand: s.brand, got: items.length, total };
    console.log(`[同體系] ${s.brand} ${s.name}: ${items.length}/${total}`);
    // 抓到不到九成 → 頁面可能改版或被擋，整批作廢（沿用上次清單比較安全）
    if (total && items.length < total * 0.9) throw new Error(`${s.name} 只抓到 ${items.length}/${total}`);
    for (const it of items) {
      const prev = byId.get(it.id);
      if (prev) prev.stores.push(s.phone);
      else byId.set(it.id, { ...it, stores: [s.phone], url: `https://buy.yungching.com.tw/house/${it.id}` });
    }
    await sleep(800);
  }
  const listings = [...byId.values()].filter(x => !onlyCity || /^(台|臺)中市/.test(x.address));
  return { listings, storeCounts };
}

module.exports = { scrapeStores, parseListPage };

// 同體系店家物件清單（店家名單來自 Secret EXCLUDED_STORES／本機 stores.local.json）
// 店家列表頁: https://shop.yungching.com.tw/{phone}/list?pg=N
//   每張卡片就有 id、地址、社區、型態、屋齡、樓層、主+陽／建坪、格局、價格
//   → 不需要抓物件詳細頁（buy.yungching.com.tw/house/{id} 會擋海外 IP，GitHub 抓不到）
// 店家一律用 phone 當 key（不同品牌可能同店名，用店名會被合併成一間）
// 2026-11-05 店家頁改版（Angular，卡片 <yc-ng-buy-house-card>，不再顯示「全部 (N)」）：
//   舊解析對不到任何卡片、總數 0 → 不會觸發「不到九成」保護，空清單蓋掉舊清單，同體系變 0 件。
//   新版：解析新卡片（舊版卡片保留當備援）、總頁數看分頁列、抓到 0 筆或中間頁不滿 30 筆就整批作廢

const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const PAGE_SIZE = 30;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fetchHtml(url, depth = 0) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } }, (res) => {
      if ([301, 302].includes(res.statusCode) && res.headers.location && depth < 3) {
        res.resume();
        return resolve(fetchHtml(new URL(res.headers.location, url).href, depth + 1));
      }
      let data = '';
      res.setEncoding('utf8'); res.on('data', c => data += c);
      res.on('end', () => resolve(res.statusCode === 200 ? data : ''));
    });
    req.on('error', () => resolve(''));
    req.setTimeout(20000, () => { req.destroy(); resolve(''); });
  });
}

const num = s => { const v = parseFloat(String(s).replace(/,/g, '')); return isNaN(v) ? null : v; };
const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const strip = s => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const districtOf = addr => (addr.match(/^(?:台中市|臺中市|[^\s]{2}[市縣])([一-龥]{1,4}?[區鄉鎮市])/) || [])[1];

// 樓層「20/31樓」「10~11/11樓」「B1~3/16樓」「1~4/4樓」（透天整棟）→ 只有單層才給 floor
function setFloor(it, li) {
  const m = li.match(/^(B?\d+)(?:\s*~\s*(B?\d+))?\s*\/\s*(\d+)\s*樓$/);
  if (!m) return false;
  if ((!m[2] || m[1] === m[2]) && !/^B/.test(m[1])) it.floor = parseInt(m[1], 10);
  it.floorText = li; it.totalFloor = parseInt(m[3], 10);
  return true;
}

// 新版卡片（2026-11-05 起）
function parseNewCard(b) {
  const idM = b.match(/buy\.yungching\.com\.tw\/house\/(\d+)/);
  if (!idM) return null;
  const cls = c => { const m = b.match(new RegExp(`class="${c}"[^>]*>([\\s\\S]*?)</`)); return m ? strip(m[1]) : ''; };
  const it = { id: idM[1], title: cls('caseName'), address: cls('address') };
  const comm = cls('community');
  if (comm) it.community = comm;
  const d = districtOf(it.address);
  if (d) it.district = d;
  const info = (b.match(/class="case-info"[^>]*>([\s\S]*?)<\/div>/) || [, ''])[1];
  const spans = [...info.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map(m => strip(m[1])).filter(Boolean);
  for (const li of spans) {
    let m;
    if ((m = li.match(/^([\d.]+)年$/))) it.age = num(m[1]);
    else if ((m = li.match(/^建坪\s*([\d.]+)/))) it.area = num(m[1]);           // 權狀總坪，與 591 area 同口徑
    else if ((m = li.match(/^主(?:\+陽)?(?:\+露)?\s*([\d.]+)/))) it.mainPlus = num(m[1]);
    else if ((m = li.match(/^地坪\s*([\d.]+)/))) it.land = num(m[1]);
    else if (setFloor(it, li)) { /* 樓層 */ }
    else if (/車位/.test(li)) it.parking = li;
    else if (/房|廳|衛/.test(li)) { if (!/^--房/.test(li)) it.layout = li; }
    else if (!it.type && /^[一-龥]{2,6}$/.test(li)) it.type = li;
  }
  // 現價在 discount-and-price-wrapper 的 .price（原價、車位價在另一個 wrapper）
  const pm = b.match(/discount-and-price-wrapper[\s\S]*?class="price"[^>]*>\s*([\d,.]+)/) || b.match(/class="price"[^>]*>\s*([\d,.]+)/);
  it.price = pm ? num(pm[1]) : null;
  return it;
}

// 舊版卡片（改版前；保留當備援）
function parseOldCard(b) {
  const idM = b.match(/buy\.yungching\.com\.tw\/house\/(\d+)/);
  if (!idM) return null;
  const it = { id: idM[1] };
  const h1 = (b.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || '';
  // 「標題...　台中市北屯區軍功路二段」：地址在最後，以縣市開頭
  const t = strip(h1);
  const am = t.match(/^(.*?)\s*([一-龥]{2}[市縣][一-龥]{1,4}?[區鄉鎮市]\S*)$/);
  it.title = (am ? am[1] : t).replace(/\.\.\.$/, '');
  it.address = am ? am[2] : '';
  const d = districtOf(it.address);
  if (d) it.district = d;
  const lis = [...(b.match(/<ul class="search-list-item-detail">([\s\S]*?)<\/ul>/) || [, ''])[1]
    .matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => strip(m[1])).filter(Boolean);
  for (const li of lis) {
    let m;
    if ((m = li.match(/^([\d.]+)年$/))) it.age = num(m[1]);
    else if ((m = li.match(/^建物\s*([\d.]+)\s*坪/))) it.area = num(m[1]);
    else if ((m = li.match(/^主\+陽\s*([\d.]+)\s*坪/))) it.mainPlus = num(m[1]);
    else if ((m = li.match(/^土地\s*([\d.]+)\s*坪/))) it.land = num(m[1]);
    else if (setFloor(it, li)) { /* 樓層 */ }
    else if (/車位/.test(li)) it.parking = li;
    else if (/房|廳|衛/.test(li)) it.layout = li;
    else if (!it.type && /^[一-龥]{2,6}$/.test(li)) it.type = li;
  }
  const pm = b.match(/search-list-item-discount-price[\s\S]*?<em>([\d,.]+)<\/em>/) || b.match(/<em>([\d,.]+)<\/em>\s*萬/);
  it.price = pm ? num(pm[1]) : null;
  return it;
}

// 解析一頁列表 → 物件陣列
function parseListPage(html) {
  const isNew = html.includes('<yc-ng-buy-house-card');
  const blocks = isNew ? html.split('<yc-ng-buy-house-card').slice(1) : html.split('<section class="m-search-list-item"').slice(1);
  const out = [];
  for (const b of blocks) {
    const it = isNew ? parseNewCard(b) : parseOldCard(b);
    if (!it) continue;
    if (!it.area) delete it.area; // 土地案建物 0 坪
    out.push(it);
  }
  return out;
}

// 總頁數：分頁列最大的 pg=N（新版）；舊版用「全部 (N)」
function pageCount(html) {
  const total = parseInt((html.match(/全部\s*\((\d+)\)/) || [])[1] || '0', 10);
  if (total) return { pages: Math.ceil(total / PAGE_SIZE), total };
  const pgs = [...html.matchAll(/[?&]pg=(\d+)/g)].map(m => parseInt(m[1], 10));
  return { pages: Math.max(1, ...pgs), total: null };
}

async function storeListings(phone) {
  const first = await fetchHtml(`https://shop.yungching.com.tw/${phone}/list?pg=1`);
  if (!first) throw new Error(`店家頁打不開 ${phone}`);
  const { pages, total } = pageCount(first);
  const items = parseListPage(first);
  // 一筆都沒解析到 → 頁面改版或被擋，不要拿空清單蓋掉舊的
  if (!items.length) throw new Error(`店家頁 ${phone} 解析不到任何物件（可能改版或被擋）`);
  let short = 0;
  if (pages > 1 && items.length < PAGE_SIZE) short++;
  for (let pg = 2; pg <= pages; pg++) {
    await sleep(400);
    const got = parseListPage(await fetchHtml(`https://shop.yungching.com.tw/${phone}/list?pg=${pg}`));
    if (pg < pages && got.length < PAGE_SIZE) short++;
    items.push(...got);
  }
  // 沒有總數時用頁數估：中間頁都該滿 30 筆，最後一頁至少 1 筆
  const expect = total || (pages - 1) * PAGE_SIZE + 1;
  return { items, total: total || items.length, pages, short, expect };
}

// stores: [{name, brand, phone}] → { listings: [{...物件, stores:[phone]}], storeCounts }
async function scrapeStores(stores, { onlyCity = '台中市' } = {}) {
  const byId = new Map();
  const storeCounts = {};
  const seen = new Set();
  for (const s of stores) {
    // 同一支電話＝同一個店家頁（11/07 名單：永慶／永義同店同電話，例如文心河南）→ 只抓一次
    if (!s.phone || seen.has(s.phone)) continue;
    seen.add(s.phone);
    const { items, total, pages, short, expect } = await storeListings(s.phone);
    storeCounts[s.phone] = { name: s.name, brand: s.brand, got: items.length, total, pages };
    console.log(`[同體系] ${s.brand} ${s.name}: ${items.length} 筆／${pages} 頁${short ? `（${short} 頁不滿 ${PAGE_SIZE} 筆）` : ''}`);
    // 抓到不到九成、或有頁面缺漏 → 頁面可能改版或被擋，整批作廢（沿用上次清單比較安全）
    if (items.length < expect * 0.9 || short > Math.max(1, pages * 0.1)) throw new Error(`${s.name} 只抓到 ${items.length} 筆（預期約 ${expect}，${short} 頁不完整）`);
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

// 案件雷達主流程（GitHub Actions 排程跑，也可本機 `node run.js [--full]`）
//   quick：只抓 591 增量（翻到連續 3 頁都看過就停，通常 1 分鐘內）
//   full ：再加 5168、信義、住商、東森 ＋ 同體系 7 店清單 ＋ 實登（>7 天才更新）
// 產出：docs/data.json（給網頁）、state/*.json（追蹤狀態，存在 data 分支）

const fs = require('fs');
const path = require('path');
const core = require('./lib/core');
const s591 = require('./lib/s591');
const yc = require('./lib/yc');
const market = require('./lib/market-price');
const community = require('./lib/community');

const ROOT = __dirname;
const STATE = process.env.RADAR_STATE || path.join(ROOT, 'state');
const OUT = path.join(ROOT, 'docs', 'data.json');
const F = {
  tracker: path.join(STATE, 'tracker.json'),
  ycList: path.join(STATE, 'yc-listings.json'),
  community: path.join(STATE, 'community.json'),
  market: path.join(STATE, 'market-prices.json')
};

const load = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const save = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d)); };

// 永慶／信義資料取自地政系統，欄位最可信；仲介手打的平台排後面
const TRUST = ['信義', '永慶', '住商', '東森', '5168', '591'];
const trustRank = s => { const i = TRUST.indexOf(s); return i < 0 ? 99 : i; };

// 網址可用的穩定 id：平台代碼＋平台物件編號（591 與 591全市 是同一個編號空間）
const SRC_CODE = { '591': 'a', '591全市': 'a', '5168': 'f', '信義': 's', '住商': 'h', '東森': 'e' };
const stableId = m => {
  const src = m._key.slice(0, m._key.length - String(m.sourceId).length - 1);
  return `${SRC_CODE[src] || 'x'}-${String(m.sourceId).replace(/[^\w-]/g, '')}`;
};

function loadConfig() {
  const cfg = load(path.join(ROOT, 'config.json'), {});
  // 店家清單可放 GitHub Secret（EXCLUDED_STORES，JSON 陣列），不進公開程式碼
  if (process.env.EXCLUDED_STORES) cfg.excludedStores = JSON.parse(process.env.EXCLUDED_STORES);
  else cfg.excludedStores = load(path.join(ROOT, 'stores.local.json'), cfg.excludedStores || []);
  return cfg;
}

async function main() {
  const full = process.argv.includes('--full') || process.env.RADAR_MODE === 'full';
  const cfg = loadConfig();
  const now = new Date().toISOString();
  const tracker = load(F.tracker, { createdAt: now, sources: {}, items: {} });
  const filters = { city: cfg.city, districts: cfg.districts, propertyTypes: cfg.propertyTypes };
  const runLog = { at: now, mode: full ? 'full' : 'quick', sources: {} };

  // ---- 1. 抓資料 ----
  // 591 三種抓法：
  //   第一次（還沒有追蹤資料）或每週日 full → 全部翻完，順便判定下架（約 17 分鐘）
  //   其他時候 → 增量：從最前面翻，連續 3 頁都是看過且沒變價就停（通常幾頁就停）
  const known591 = new Map();
  for (const [key, rec] of Object.entries(tracker.items)) {
    if (key.startsWith('591_') && !rec.removedAt && rec.d) known591.set(rec.d.sourceId, rec.d.price);
  }
  const twDay = new Date(Date.now() + 8 * 3600e3).getUTCDay();
  const sweep591 = known591.size === 0 || (full && twDay === 0) || process.env.RADAR_591_SWEEP === '1';
  runLog.sweep591 = sweep591;
  const jobs = [['591', () => s591.scrape({ ...filters, maxPages: sweep591 ? 1000 : 60, known: sweep591 ? null : known591 })]];
  // 五區以外：只抓急售／賠售／自售等關鍵字＋屋主自售（量小，每次都完整抓，可直接判斷下架或拿掉關鍵字）
  if (cfg.wideCity !== false) {
    jobs.push(['591全市', () => s591.scrapeWide({ city: cfg.city, skipDistricts: cfg.districts, keywords: cfg.wideKeywords })]);
  }
  if (full) {
    jobs.push(
      ['5168', () => require('./lib/5168').scrape(filters, 30)],
      ['信義', () => require('./lib/sinyi').scrape(filters, 30)],
      ['住商', () => require('./lib/hbhousing').scrape(filters, 30)],
      ['東森', () => require('./lib/etwarm').scrape(filters)]
    );
  }
  const fresh = {};
  const skip = (process.env.RADAR_SKIP || '').split(',').filter(Boolean); // 例：GitHub 上 5168 擋海外 IP
  for (const [name, fn] of jobs.filter(([n]) => !skip.includes(n))) {
    const t0 = Date.now();
    try {
      fresh[name] = await fn();
      runLog.sources[name] = { ok: true, count: fresh[name].length, sec: Math.round((Date.now() - t0) / 1000) };
    } catch (e) {
      runLog.sources[name] = { ok: false, error: e.message };
      console.error(`[${name}] 失敗:`, e.message);
    }
    console.log(`[${name}]`, JSON.stringify(runLog.sources[name]));
  }

  // ---- 2. 更新追蹤狀態（新上架／價格歷史／下架）----
  for (const [src, list] of Object.entries(fresh)) {
    const prev = tracker.sources[src];
    // 沒抓完整（591 快速模式）或筆數掉到上次一半以下（平台異常）→ 不判下架
    const partial = list.complete === false;
    const trustful = !partial && (!prev?.count || list.length >= prev.count * 0.5);
    const seen = new Set();
    for (const it of list) {
      const key = `${src}_${it.sourceId}`;
      seen.add(key);
      const rec = tracker.items[key] || (tracker.items[key] = { first: now, prices: [] });
      rec.last = now;
      delete rec.removedAt;
      const lastP = rec.prices.length ? rec.prices[rec.prices.length - 1][1] : null;
      if (it.price && it.price !== lastP) rec.prices.push([now, it.price]);
      rec.d = { ...it, district: it.district || core.extractDistrict(it.address) };
    }
    if (trustful) {
      for (const [key, rec] of Object.entries(tracker.items)) {
        if (key.startsWith(src + '_') && !seen.has(key) && !rec.removedAt) rec.removedAt = now;
      }
      tracker.sources[src] = { count: list.length, at: now };
    } else if (!partial) {
      runLog.sources[src].warn = `筆數 ${list.length} 遠低於上次 ${prev.count}，不判下架`;
    }
  }
  // 下架超過 14 天的刪掉，控制檔案大小
  for (const [key, rec] of Object.entries(tracker.items)) {
    if (rec.removedAt && Date.now() - Date.parse(rec.removedAt) > 14 * 864e5) delete tracker.items[key];
  }

  // ---- 3. 同體系店家清單（full 才更新）----
  let ycData = load(F.ycList, { at: null, listings: [], storeCounts: {} });
  if (full && cfg.excludedStores.length) {
    try {
      const r = await yc.scrapeStores(cfg.excludedStores);
      ycData = { at: now, ...r };
      save(F.ycList, ycData);
      runLog.sources['同體系'] = { ok: true, count: r.listings.length };
    } catch (e) {
      runLog.sources['同體系'] = { ok: false, error: e.message };
      console.error('[同體系] 失敗，沿用上次清單:', e.message);
    }
  }

  // ---- 4. 實登行情（>7 天才重抓）----
  let mkt = load(F.market, null);
  if (full && (!mkt || Date.now() - Date.parse(mkt.updatedAt) > 7 * 864e5)) {
    try { mkt = await market.updateMarketPrices(cfg.city) || mkt; }
    catch (e) { console.error('[實登] 失敗:', e.message); }
  }

  // ---- 4b. 同社區實登（591 社區成交）：有關鍵字的社區優先，其餘慢慢補 ----
  const commCache = load(F.community, {});
  {
    const hotIds = new Set(), restIds = new Set();
    for (const rec of Object.values(tracker.items)) {
      const id = !rec.removedAt && rec.d?.communityId;
      if (!id) continue;
      (core.tagsOf(rec.d).size ? hotIds : restIds).add(id);
    }
    const ids = [...hotIds, ...[...restIds].filter(x => !hotIds.has(x))];
    const t0 = Date.now();
    const n = await community.refresh(ids, commCache, full ? 800 : 150);
    for (const [id, s] of Object.entries(commCache)) if (Date.now() - s.t > 30 * 864e5) delete commCache[id];
    save(F.community, commCache);
    runLog.sources['社區實登'] = { ok: true, fetched: n, cached: Object.keys(commCache).length, of: ids.length, sec: Math.round((Date.now() - t0) / 1000) };
    console.log('[社區實登]', JSON.stringify(runLog.sources['社區實登']));
  }

  // ---- 5. 組合：去重 → 標籤 → 行情 → 同體系 → 分數 ----
  const active = [];
  for (const [key, rec] of Object.entries(tracker.items)) {
    if (rec.removedAt || !rec.d) continue;
    const hi = Math.max(...rec.prices.map(p => p[1]));
    const cur = rec.d.price;
    active.push({ ...rec.d, _key: key, _first: rec.first,
      _drop: cur && hi > cur ? Math.round((hi - cur) / hi * 1000) / 10 : 0,
      _hist: rec.prices.slice(-6) });
  }
  const groups = core.dedupe(active);
  const storeIdx = core.buildStoreIndex(ycData.listings || []);
  const bootstrapCut = Date.parse(tracker.createdAt) + 6 * 3600e3; // 建檔頭 6 小時看到的不算「新上架」

  const cards = [];
  const blocked = [];
  const pool = [];
  for (const g of groups) {
    const ms = g.members.slice().sort((a, b) => trustRank(a.source) - trustRank(b.source));
    const pick = f => (ms.find(m => m[f] != null && m[f] !== '') || {})[f];
    const rep = {
      title: (ms.find(m => m.title) || {}).title || '',
      address: pick('address'), district: pick('district'), community: pick('community'),
      area: pick('area'), mainArea: pick('mainArea'), floor: pick('floor'), age: pick('age'),
      layout: pick('layout'), type: pick('type'), photo: pick('photo')
    };
    const prices = ms.map(m => m.price).filter(Boolean);
    rep.price = prices.length ? Math.min(...prices) : null;
    rep.unitPrice = rep.price && rep.area ? Math.round(rep.price / rep.area * 100) / 100 : pick('unitPrice');

    const tags = new Set();
    for (const m of ms) for (const t of core.tagsOf(m)) tags.add(t);
    const drop = Math.max(...ms.map(m => m._drop || 0));
    const mk = mkt ? market.compareWithMarket(rep, mkt) : null;
    const commId = pick('communityId');
    const cm = commId ? community.compare(rep.unitPrice, commCache[commId]) : null;
    if (cm && cm.diff < 0) tags.add('低於實登');
    let { score, why } = core.scoreOf(tags, mk, drop, cm);
    // 開發優先順序（用戶指示 2026-10-21）：
    //   只有屋主自己在賣（沒有仲介）→ 額外 +8（連同屋主自售 12 共 20），排最前
    //   屋主＋仲介 → 一樣上榜，但只拿屋主自售 12，主要靠關鍵字／低於行情排序
    //   5 位以上仲介在刊 → −5（一般約、競爭激烈）
    const owner = ms.some(x => x.isOwner);
    const ownerOnly = owner && ms.every(x => x.isOwner);
    const agentCount = new Set(ms.filter(x => !x.isOwner).map(x => x.agent || x.source)).size;
    if (ownerOnly) { score += 8; why.push('只有屋主在賣+8'); }
    if (agentCount >= 5) { score -= 5; why.push(`${agentCount}位仲介在刊-5`); }
    // 門檻 20 分：只有「標示降價」（591 降價旗標很氾濫，實測只便宜約 5%）或只有「超值」不夠格；屋主刊登的都列
    const hot = score >= (cfg.minScore ?? 20) || owner;

    // 穩定 id：最早看到的那筆（後來別的平台加入合併，id 也不會變 → 開發進度、客戶紀錄不會斷）
    const firstM = ms.slice().sort((a, b) => (a._first || '').localeCompare(b._first || '') || a._key.localeCompare(b._key))[0];
    const id = stableId(firstM);
    const first = firstM._first;
    const m = core.matchSameSystem(rep, storeIdx);

    // 案件池（給客需配對）：所有在架物件，精簡欄位
    pool.push({ id, t: rep.title, d: rep.district, a: rep.address, c: rep.community, p: rep.price, up: rep.unitPrice,
      ar: rep.area, fl: rep.floor, ag: rep.age, ly: rep.layout, ty: rep.type, ph: rep.photo,
      u: (ms.find(x => x.source !== '591') || ms[0]).url, s: [...new Set(ms.map(x => x.source))],
      sc: score, tg: [...tags], cm: cm ? cm.diff : null, same: m ? 1 : 0, f: first, own: owner ? (ownerOnly ? 2 : 1) : 0,
      // 車位：591 有欄位；其他平台不知道 → null（配對時「要車位」不會因此被刷掉）
      pk: ms.some(x => x.hasCarport) ? 1 : ms.some(x => x.source === '591') ? 0 : null });

    if (!hot) continue;
    // 同體系店家已有 → 不能開發，關鍵字再好也一樣；另列一份給人工抽查比對有沒有誤判
    // 網頁是公開的：只放店數與可信度，不放店家電話
    if (m) {
      blocked.push({ id, title: rep.title, district: rep.district, address: rep.address, community: rep.community,
        price: rep.price, area: rep.area, floor: rep.floor, tags: [...tags], level: m.level, storeCount: m.storeCount,
        ycUrl: m.url, url: ms[0].url });
      continue;
    }
    cards.push({
      id, ...rep, tags: [...tags], score, why, drop,
      market: mk && { median: mk.median, diff: mk.diff, n: mk.count, level: mk.matchLevel },
      comm: cm && { med: cm.med, n: cm.n, min: cm.min, diff: cm.diff, belowMin: cm.belowMin, recent: cm.recent,
        url: `https://market.591.com.tw/${commId}` },
      sources: ms.map(m => ({ s: m.source, url: m.url, price: m.price, agent: m.agent || '', hist: m._hist })),
      // 幾個人在賣：屋主自己刊、沒有仲介 = 最好開發；十幾個仲介 = 大概是一般約、競爭激烈
      posters: { total: ms.length, agents: agentCount, owner },
      wide: !cfg.districts.includes(rep.district),
      firstSeen: first, isNew: Date.parse(first) > bootstrapCut && Date.now() - Date.parse(first) < 48 * 3600e3
    });
  }
  cards.sort((a, b) => b.score - a.score);

  // ---- 6. 輸出 ----
  const storeCounts = Object.values(ycData.storeCounts || {});
  const out = {
    generatedAt: now, mode: runLog.mode, districts: cfg.districts,
    sources: tracker.sources, run: runLog,
    sameSystem: { at: ycData.at, listings: (ycData.listings || []).length, stores: storeCounts.length },
    market: mkt && { updatedAt: mkt.updatedAt, seasons: mkt.seasons },
    totals: { active: active.length, groups: groups.length, hot: cards.length, blocked: blocked.length },
    cards,
    blocked
  };
  save(OUT, out);
  save(path.join(ROOT, 'docs', 'pool.json'), { generatedAt: now, districts: cfg.districts, items: pool });
  tracker.runs = [runLog, ...(tracker.runs || [])].slice(0, 50);
  save(F.tracker, tracker);
  console.log(`完成：在架 ${active.length} → 去重 ${groups.length} → 有競爭力可開發 ${cards.length}（同體系已有、排除 ${blocked.length}）`);

  // 全部來源都失敗才讓排程標紅
  if (!Object.values(runLog.sources).some(s => s.ok)) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });

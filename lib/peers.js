// 嚴格版「低於行情」＋成交回填（規則沿用 案件說明書/程式/lib/comps.js，這裡是雷達用的精簡版）
//   用戶原則：不同時期、不同等級不能比 →
//     可比社區 = 1.5 公里內、屋齡 ±5 年、社區近 2 年成交單價中位與本社區差 10% 內（同等級）
//     可比成交 = 這些社區近 2 年、同房數、權狀坪 ±25%；至少 2 個社區、3 筆才算數
//   成交回填：雷達追蹤到下架的案子，之後在同社區成交裡找「同樓層、坪數差 ≤3%、下架前 60 天後成交」
//     → 記「最後開價 vs 成交價」，累積各社區議價空間
// 資料：591 社區列表（全台中，一週更新）、591 社區成交（每社區近 2 年明細，精簡存，7 天更新）
const https = require('https');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', device: 'pc', deviceid: '0123456789abcdef0123456789abcdef' };
const DAY = 864e5;
const DEAL_TTL = 7 * DAY;
const MONTHS = 24;

function getJSON(url) {
  return new Promise(resolve => {
    const req = https.get(url, { headers: H }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d).data); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
  });
}
const num = v => { const x = parseFloat(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(x) ? x : null; };
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const r1 = v => v == null ? null : Math.round(v * 10) / 10;
const km = (a, b) => {
  const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const roomsOf = s => { const m = String(s || '').match(/(\d+)\s*房/); return m ? +m[1] : null; };

// ---- 社區列表（全台中住宅社區：id、座標、屋齡）----
async function refreshList(cache) {
  if (cache.list && Date.now() - cache.list.t < 7 * DAY) return 0;
  const items = [];
  for (let page = 1; page <= 120; page++) {
    const d = await getJSON(`https://bff-market.591.com.tw/v2/search/list?regionid=8&build_purpose=1&limit=100&page=${page}`);
    if (!d?.items?.length) { if (page === 1) return 0; break; }
    for (const i of d.items) {
      const t = i.housing_type_str || '';
      if (/預售/.test(t)) continue;                  // 預售是建商價，不比
      const age = /新成屋/.test(t) ? 0 : num(t);
      if (!num(i.lat) || age == null) continue;
      items.push([i.id, +num(i.lat).toFixed(5), +num(i.lng).toFixed(5), age]);
    }
    if (page >= (d.paginate?.total_page || 1)) break;
    await sleep(250);
  }
  if (items.length > 500) cache.list = { t: Date.now(), items };
  return items.length;
}

// ---- 社區近 2 年成交明細（精簡）：[日期, 單價, 權狀坪, 房數, 樓層, 總價] ----
async function fetchDeals(id) {
  const cutoff = Date.now() - MONTHS * 30.4 * DAY;
  const out = [];
  for (let page = 1; page <= 4; page++) {
    const d = await getJSON(`https://bff-market.591.com.tw/v1/price/list?community_id=${id}&page=${page}`);
    if (!d || !Array.isArray(d.items)) { if (page === 1) return null; break; }
    let old = false;
    for (const it of d.items) {
      if (Date.parse(it.trans_date) < cutoff) { old = true; continue; }
      if (it.is_special || it.price_error) continue;
      if (it.build_purpose_str && !/住/.test(it.build_purpose_str)) continue;
      const u = num(it.unit_price?.price);
      if (!u || /^0房/.test(it.layout || '')) continue;
      out.push([it.trans_date, u, num(it.build_area_v?.area), roomsOf(it.layout), num(it.shift_floor_val), num(it.total_price_v)]);
    }
    if (old || page >= (d.total_page || 1)) break;
    await sleep(250);
  }
  return out;
}

// ids 依優先順序；budget = 這次最多查幾個社區
async function refreshDeals(ids, cache, budget) {
  cache.deals = cache.deals || {};
  let done = 0;
  for (const id of ids) {
    if (done >= budget) break;
    const c = cache.deals[id];
    if (c && Date.now() - c.t < DEAL_TTL) continue;
    const v = await fetchDeals(id);
    done++;
    if (v) cache.deals[id] = { t: Date.now(), v };
    await sleep(200);
  }
  return done;
}
// 一段時間沒用到的社區清掉，控制檔案大小
function prune(cache, keepIds) {
  for (const [id, c] of Object.entries(cache.deals || {})) if (!keepIds.has(String(id)) && Date.now() - c.t > 21 * DAY) delete cache.deals[id];
}

const levelOf = deals => deals && deals.length >= 3 ? r1(median(deals.map(d => d[1]))) : null;

// 某社區附近的候選社區 id（給 refreshDeals 排優先順序用）
function nearIds(commId, cache, radius = 1.5) {
  const self = (cache.list?.items || []).find(x => String(x[0]) === String(commId));
  if (!self) return [];
  return cache.list.items.filter(x => x[0] !== self[0] && Math.abs(x[3] - self[3]) <= 5)
    .map(x => [x[0], km({ lat: self[1], lng: self[2] }, { lat: x[1], lng: x[2] })])
    .filter(x => x[1] <= radius).sort((a, b) => a[1] - b[1]).map(x => String(x[0]));
}

// 嚴格比較：rep = {unitPrice, area, layout}；回傳 null（資料不足）或 {diff, med, n, comms, level}
function compare(rep, commId, cache, opt = {}) {
  const tier = opt.tier ?? 0.10, minComm = opt.minComm ?? 2, minDeals = opt.minDeals ?? 3;
  if (!rep.unitPrice || !commId) return null;
  const selfLevel = levelOf(cache.deals?.[commId]?.v) ?? opt.fallbackLevel ?? null;
  if (!selfLevel) return null;
  const rooms = roomsOf(rep.layout);
  const used = [];
  for (const id of nearIds(commId, cache)) {
    const ds = cache.deals?.[id]?.v;
    const level = levelOf(ds);
    if (!level || Math.abs(level - selfLevel) / selfLevel > tier) continue;
    const ok = ds.filter(d => (rooms == null || d[3] == null || d[3] === rooms) && (!rep.area || !d[2] || Math.abs(d[2] - rep.area) / rep.area <= 0.25));
    if (ok.length) used.push({ id, n: ok.length, units: ok.map(d => d[1]) });
    if (used.length >= 8) break;
  }
  const units = used.flatMap(u => u.units);
  if (used.length < minComm || units.length < minDeals) return null;
  const med = r1(median(units));
  return { diff: Math.round((rep.unitPrice - med) / med * 1000) / 10, med, n: units.length, comms: used.length, level: selfLevel };
}

// ---- 成交回填 ----
// sold.watch[key] = {id, comm, price, area, floor, at(下架時間)}；sold.hits[] = {id, comm, ask, deal, gap%, date}
function watchRemoved(sold, key, rec) {
  const d = rec.d || {};
  const fl = num(String(d.floor || '').split('/')[0]);
  if (!d.communityId || !d.price || !d.area || fl == null) return;
  sold.watch[key] = { id: rec.id || key, comm: String(d.communityId), price: d.price, area: d.area, floor: fl, at: rec.removedAt };
}
function matchSold(sold, cache) {
  let n = 0;
  for (const [key, w] of Object.entries(sold.watch)) {
    const at = Date.parse(w.at);
    if (Date.now() - at > 240 * DAY) { delete sold.watch[key]; continue; }   // 8 個月還沒登錄就放棄
    const ds = cache.deals?.[w.comm]?.v || [];
    const hit = ds.find(d => d[4] === w.floor && d[2] && Math.abs(d[2] - w.area) / w.area <= 0.03 && Date.parse(d[0]) >= at - 60 * DAY && d[5]);
    if (!hit) continue;
    sold.hits.push({ id: w.id, comm: w.comm, ask: w.price, deal: hit[5], gap: Math.round((w.price - hit[5]) / w.price * 1000) / 10, date: hit[0] });
    delete sold.watch[key];
    n++;
  }
  sold.hits = sold.hits.slice(-3000);
  return n;
}
// 各社區議價空間：{comm: {n, med}}
function bargainByComm(sold) {
  const by = {};
  for (const h of sold.hits) if (h.gap > -30 && h.gap < 40) (by[h.comm] = by[h.comm] || []).push(h.gap);
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { n: v.length, med: r1(median(v)) }]));
}

module.exports = { refreshList, refreshDeals, prune, nearIds, compare, watchRemoved, matchSold, bargainByComm, levelOf };

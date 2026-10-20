// 同社區實登（591 社區成交紀錄）：判斷「開價低於實登」
// API: https://bff-market.591.com.tw/v1/price/list?community_id=&page=  （每頁 20 筆，新到舊）
// unit_price = 總價÷權狀總坪（含車位），與 591 刊登的 unitprice 同口徑，可以直接比。
// 只存摘要（不存明細），快取 7 天。

const https = require('https');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TTL = 7 * 864e5;
const YEARS = 3;

function getJSON(url) {
  return new Promise(resolve => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d).data); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
  });
}

const n = v => { const x = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(x) ? x : null; };
const q = (s, p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];

async function fetchSummary(id) {
  const cutoff = Date.now() - YEARS * 365 * 864e5;
  const units = [];
  const recent = [];
  for (let page = 1; page <= 3; page++) {
    const d = await getJSON(`https://bff-market.591.com.tw/v1/price/list?community_id=${id}&page=${page}`);
    if (!d || !Array.isArray(d.items)) { if (page === 1) return null; break; }
    let old = false;
    for (const it of d.items) {
      const t = Date.parse(it.trans_date);
      if (t < cutoff) { old = true; continue; }
      if (it.is_special || it.price_error) continue;           // 特殊交易（親友、瑕疵…）不算
      if (it.build_purpose_str && !/住/.test(it.build_purpose_str)) continue;
      const u = n(it.unit_price?.price);
      if (!u) continue;
      units.push(u);
      if (recent.length < 6) recent.push([it.trans_date, u, n(it.shift_floor_val), n(it.build_area_v?.area)]);
    }
    if (old || page >= (d.total_page || 1)) break;
    await sleep(250);
  }
  const s = units.sort((a, b) => a - b);
  return { t: Date.now(), n: s.length, med: s.length ? q(s, 0.5) : null, p25: s.length ? q(s, 0.25) : null,
    min: s[0] ?? null, recent };
}

// ids 依優先順序；budget = 這次最多查幾個社區
async function refresh(ids, cache, budget) {
  let done = 0;
  for (const id of ids) {
    if (done >= budget) break;
    const c = cache[id];
    if (c && Date.now() - c.t < TTL) continue;
    const s = await fetchSummary(id);
    done++;
    if (s) cache[id] = s;
    await sleep(250);
  }
  return done;
}

// 刊登單價 vs 同社區近 3 年成交
function compare(unitPrice, s) {
  if (!unitPrice || !s || !s.med || s.n < 3) return null;
  return { med: s.med, n: s.n, min: s.min, diff: Math.round((unitPrice - s.med) / s.med * 1000) / 10,
    belowMin: unitPrice < s.min, recent: s.recent };
}

module.exports = { refresh, compare, fetchSummary };

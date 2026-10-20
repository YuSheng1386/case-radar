// 雷達核心：地址正規化、跨平台去重、同體系比對、急售/賠售/自售標籤、競爭力分數

// ===== 地址 =====
function normalizeAddress(addr) {
  if (!addr) return '';
  return addr
    .replace(/臺/g, '台')
    .replace(/\s+/g, '')
    .replace(/[號樓之F]/g, '')
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

function extractDistrict(address) {
  if (!address) return '';
  const s = address.replace(/^(台中市|臺中市|台北市|新北市|桃園市|高雄市|台南市|彰化縣|南投縣)/, '');
  const m = s.match(/^([一-龥]{1,4}?[區鄉鎮市])/);
  return m ? m[1] : '';
}

// 路名（含段），去掉縣市與行政區
function roadOf(addr) {
  const n = normalizeAddress(addr).replace(/^[一-龥]{2,3}[市縣]/, '').replace(/^[一-龥]{1,4}?[區鄉鎮市]/, '');
  const m = n.match(/^(.+?(?:大道|路|街))(.{1,2}段)?/);
  return m ? m[1] + (m[2] || '') : '';
}

function normCommunity(c) {
  return (c || '').replace(/\s+/g, '').replace(/[()（）]/g, '').replace(/社區|大樓|大廈$/g, '');
}

// "14F/20F" "6/13樓" "3樓" → 14；透天整棟 "1F~4F/4F" → null
function parseFloor(f) {
  if (f == null || f === '') return null;
  if (typeof f === 'number') return f;
  const s = String(f);
  if (/[~～\-]/.test(s.split('/')[0])) return null;
  const m = s.match(/(\d+)\s*(?:F|樓)?\s*(?:\/|$)/i) || s.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

const pct = (a, b) => Math.abs(a - b) / Math.max(a, b);

// 同平台（591 多個仲介刊同一戶）要更嚴格：同樓層＋權狀坪差 ≤1%＋價差 ≤8%＋同社區（沒社區看同路）
//   實測五區＋全市 5377 筆 → 約 3719 戶，1529 筆是重複刊登（最多一戶 23 個仲介刊）
//   總樓層常打錯（17F/21F、17F/22F、17F/27F 同一戶），所以只比所在樓層
function sameUnitSameSource(a, b) {
  if (!a.area || !b.area || pct(a.area, b.area) > 0.01) return false;
  if (a.price && b.price && pct(a.price, b.price) > 0.08) return false;
  const ca = normCommunity(a.community), cb = normCommunity(b.community);
  const sameComm = ca.length >= 2 && ca === cb;
  if (ca && cb && !sameComm) return false;
  const fa = parseFloor(a.floor), fb = parseFloor(b.floor);
  if (fa != null && fb != null) return fa === fb && (sameComm || roadOf(a.address) === roadOf(b.address));
  // 透天等沒有單一樓層：必須同社區、樓層字串也一樣
  return sameComm && fa == null && fb == null && String(a.floor || '') === String(b.floor || '');
}

// ===== 去重（跨平台沿用主系統規則：同區同路、地址相近、價±10%、坪±15%；同平台用上面嚴格規則）=====
function dedupe(items) {
  const groups = new Map();  // `${district}_${road}` -> [group]
  const loose = [];
  for (const it of items) {
    const district = it.district || extractDistrict(it.address);
    const norm = normalizeAddress(it.address);
    if (!norm || norm.length < 5) { loose.push({ members: [it] }); continue; }
    const key = `${district}_${roadOf(it.address) || norm.slice(0, 10)}`;
    if (!groups.has(key)) groups.set(key, []);
    let hit = null;
    for (const g of groups.get(key)) {
      const head = g.members[0];
      const same = g.members.find(m => m.source === it.source);
      if (same) {
        if (sameUnitSameSource(same, it)) { hit = g; break; }
        continue;
      }
      const hn = normalizeAddress(head.address);
      const addrOk = hn === norm || hn.includes(norm) || norm.includes(hn) ||
        (norm.length > 6 && hn.length > 6 && norm.slice(0, 12) === hn.slice(0, 12));
      // 跨平台：591 地址只到路名，舊規則（坪±15%）會把同路不同戶併在一起（實測 18081→7517 過度合併）
      // → 兩邊都有權狀坪要 ≤5%、社區都有要相同、樓層都有要相同；坪數至少一邊沒有就要求價差 ≤3%
      const priceOk = !head.price || !it.price || pct(head.price, it.price) < 0.1;
      const bothArea = head.area && it.area;
      const areaOk = bothArea ? pct(head.area, it.area) <= 0.05 : (head.price && it.price && pct(head.price, it.price) <= 0.03);
      const ca = normCommunity(head.community), cb = normCommunity(it.community);
      const commOk = !(ca.length >= 2 && cb.length >= 2) || ca === cb || ca.includes(cb) || cb.includes(ca);
      const fa = parseFloor(head.floor), fb = parseFloor(it.floor);
      const floorOk = fa == null || fb == null || fa === fb;
      if (addrOk && priceOk && areaOk && commOk && floorOk) { hit = g; break; }
    }
    if (hit) hit.members.push(it); else groups.get(key).push({ members: [it] });
  }
  return [...[...groups.values()].flat(), ...loose];
}

// ===== 同體系比對 =====
// 規則（10/4 交接：舊版「地址前8字＋價±10%」誤判 44%）：
//   同行政區 + (同社區 或 同路段) + 價差 ≤8%
//   兩邊都有權狀坪 → 坪差須 ≤5%；兩邊都有樓層 → 樓層須相同
//   坪數、樓層都無法比 → 只接受「同社區且價差 ≤3%」
function buildStoreIndex(storeListings) {
  const idx = {};
  for (const e of storeListings) {
    const d = e.district || extractDistrict(e.address);
    (idx[d] = idx[d] || []).push({ ...e, _road: roadOf(e.address), _comm: normCommunity(e.community) });
  }
  return idx;
}

function matchSameSystem(item, storeIdx) {
  const cands = storeIdx[item.district] || [];
  const road = roadOf(item.address);
  const comm = normCommunity(item.community);
  const fl = parseFloor(item.floor);
  const hits = [];
  for (const e of cands) {
    if (!item.price || !e.price) continue;
    const dp = pct(item.price, e.price);
    if (dp > 0.08) continue;
    const sameComm = comm.length >= 2 && e._comm.length >= 2 && (comm === e._comm || comm.includes(e._comm) || e._comm.includes(comm));
    const sameRoad = road && e._road && road === e._road;
    if (!sameComm && !sameRoad) continue;
    const areaCmp = item.area && e.area;
    if (areaCmp && pct(item.area, e.area) > 0.05) continue;
    const floorCmp = fl != null && e.floor != null;
    if (floorCmp && fl !== e.floor) continue;
    if (!areaCmp && !floorCmp && !(sameComm && dp <= 0.03)) continue;
    const level = areaCmp && floorCmp ? '高' : (areaCmp || floorCmp) && (sameComm || dp <= 0.03) ? '中' : '低';
    hits.push({ id: e.id, url: e.url, stores: e.stores, level, price: e.price });
  }
  if (!hits.length) return null;
  const rank = { '高': 3, '中': 2, '低': 1 };
  hits.sort((a, b) => rank[b.level] - rank[a.level]);
  const stores = [...new Set(hits.flatMap(h => h.stores))];
  return { level: hits[0].level, storeCount: stores.length, stores, url: hits[0].url, ycId: hits[0].id };
}

// ===== 標籤 =====
// 依 tools/kw-study.js 實測（2026-10-21，591 全台中各詞約 200 筆，跟實登比單價、再對照一般物件）：
//   一般物件開價中位比實登 +11.7%；以下為「比一般物件便宜幾個百分點」
//   認賠 -14、低於實登 -14、低於行情 -12、便宜 -11、賠售 -9.5、破盤 -9.5、超值 -7.7、秒殺 -7.3、急售 -6.9、
//   降價 -5.6、專任 -5.3、獨家 -4.3、投資 -4.1、低總價/首購 -3.3、自售 -3.2、屋主 -1.4、
//   稀有/底價 ≈0、讓利/投資客 +1.7、收租 +4.3（→ 這些不當訊號）
const KW = [
  ['賠售', /賠售|虧售|認賠|賠本|賠錢賣|斷頭|低於成本|破盤|賠\d/],
  ['標低於行情', /低於行情|低於市價|低於實登|便宜|俗俗賣/],
  ['急售', /急售|急賣|急讓|急求售|快售|急出|秒殺/],
  ['超值', /超值/],
  ['降價', /降價|降售|大降|直降|再降|狂降|砍價|下殺/],
  ['自售', /自售|屋主直售|屋主自賣|免仲介|免服務費/]
];
const KW_WEIGHT = { '賠售': 25, '標低於行情': 25, '急售': 18, '超值': 12, '自售': 12 };

function tagsOf(it) {
  const t = new Set();
  const title = it.title || '';
  for (const [name, re] of KW) if (re.test(title)) t.add(name);
  if (it.flagHurry) t.add('急售');
  if (it.isOwner) t.add('自售');
  if (it.flagDown) t.add('降價');
  return t;
}

// ===== 分數 =====
// market: compareWithMarket（同區相近物件，實登已扣車位 → 刊登含車位會偏高，一般物件中位約 +11.7%）
// drop: 本系統觀察到的降幅 %；comm: 同社區近 3 年成交（同口徑，最可信）
function scoreOf(tags, market, drop, comm) {
  let s = 0;
  const why = [];
  const add = (v, label) => { if (v) { s += v; why.push(`${label}${v > 0 ? '+' : ''}${v}`); } };
  for (const [tag, w] of Object.entries(KW_WEIGHT)) if (tags.has(tag)) add(w, tag === '自售' ? '屋主自售' : tag);
  if (drop >= 2) add(Math.min(25, Math.round(5 + drop * 2)), `實測降${drop}%`);
  else if (tags.has('降價')) add(10, '標示降價');
  if (comm) {
    const d = comm.diff;
    add(d <= -15 ? 40 : d <= -8 ? 30 : d < 0 ? 20 : d >= 15 ? -10 : 0, `開價比同社區成交${d > 0 ? '+' : ''}${d}%`);
    if (comm.belowMin) add(10, '低於社區最低成交');
  } else if (market && market.count >= 5) {
    const d = market.diff;
    add(d <= -10 ? 25 : d <= -5 ? 15 : d <= 0 ? 8 : d >= 25 ? -10 : 0, `比同區實登${d > 0 ? '+' : ''}${d}%`);
  }
  return { score: s, why };
}

module.exports = {
  normalizeAddress, extractDistrict, roadOf, parseFloor, dedupe, sameUnitSameSource,
  buildStoreIndex, matchSameSystem, tagsOf, scoreOf, KW
};

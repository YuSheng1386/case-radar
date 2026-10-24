// LINE 對話查詢用的精簡案件索引（GitHub Actions：notify 之後跑）
//   網站 Worker 免費方案每次只有 10ms CPU → 不能解析整份 cards，這裡先拆成每區一小份
//   line-meta：{at, districts, main, where: {路名/社區: [區序號]}}
//   開發：line-<n>：{d: districts[n], items}（篩選欄位）；line-x<n>：{d, x: {id: LINE 文字}}
//   配對：line-p<n>：{d, items}（案件池，所有在架物件，陣列）；line-pt<n>：{d, t}（關鍵字欄位）；line-px<n>：{d, x}（顯示欄位）
//   每件的 LINE 文字（x）在這裡先排好，Worker 只負責篩選＋接字串
//   本機看：node tools/line-index.js --dry
const fs = require('fs');
const path = require('path');
const { cardLine, cut } = require('./notify');

const ROOT = path.join(__dirname, '..');
const { RADAR_URL, INGEST_KEY } = process.env;
const DRY = process.argv.includes('--dry');

// 類型統一成：大樓（電梯大樓／大樓／華廈）、透天（透天厝／透天／別墅）、公寓
const typeOf = t => /透天|別墅/.test(t || '') ? '透天' : /公寓/.test(t || '') ? '公寓' : /大樓|華廈/.test(t || '') ? '大樓' : '';
const rooms = ly => { const m = String(ly || '').match(/(\d+)\s*房/); return m ? +m[1] : null; };
// 樓層 → [最低, 最高, 總樓層]：「5F/26F」「1F~4F/4F」「B1-4F/4F」「整棟/3F」（B1 算 0）
function floors(s) {
  s = String(s || '');
  const tot = +(s.match(/\/\s*(\d+)/) || [])[1] || null;
  const head = s.split('/')[0];
  if (/整棟/.test(head)) return [1, tot, tot];
  const ns = [...head.matchAll(/(B)?(\d+)/gi)].map(m => m[1] ? 0 : +m[2]);
  if (!ns.length) return null;
  return [Math.min(...ns), Math.max(...ns), tot];
}
// 車位：591 有欄位；沒有的看標題
const parkOf = c => c.parking ?? (/車位|車庫/.test(c.title || '') ? 1 : null);
// 案件池陣列每格的欄位（Worker 依這個還原成物件；f 是秒、tg 沒有標籤時是 0）
//   關鍵字欄位 t 另存 line-pt<n>（同順序），查詢有路名／特色時才讀
//   lc＝社區座標；沒有社區座標的用 rk＝它那條路在 line-roads 的序號
const PKEYS = ['id', 'ty', 'rt', 'ag', 'p', 'ar', 'r', 'up', 'ma', 'fl', 'pk', 'pt', 'sc', 'own', 'tg', 'f', 'sm', 'lc', 'rk'];
const { roadKey } = require('./roads');
const ll5 = v => v ? [Math.round(v[0] * 1e5) / 1e5, Math.round(v[1] * 1e5) / 1e5] : null;

function build(data, pool = null, roads = null) {
  // 位置：社區座標優先；沒有就用路名座標表（tools/roads.js）裡那條路的各段位置
  const rkeys = [], rpts = [], rix = {};
  const rk = (d, a) => {
    const k = roadKey(d, a), v = k && roads?.items[k];
    if (!v || !v.pts.length) return null;
    if (!(k in rix)) { rix[k] = rkeys.length; rkeys.push(k); rpts.push(v.pts); }
    return rix[k];
  };
  const by = {};
  // 同體系已有的也放進來（sm=1），預設不列；查詢打「含同體系」才一起看
  const LV = { high: '高', mid: '中', low: '低' };
  const all = [...data.cards, ...(data.blocked || []).map(b => ({ ...b, _sm: true, score: b.score ?? 0, tags: b.tags || [],
    sources: b.sources || [{ s: '', url: b.url, price: b.price }] }))];
  for (const c of all) {
    const own = c.posters?.owner ? (c.posters.agents === 0 ? 2 : 1) : 0;
    (by[c.district] = by[c.district] || []).push({
      id: c.id, ty: typeOf(c.type), rt: c.type || '', ag: c.age ?? null, p: c.price, ar: c.area ?? null, r: rooms(c.layout),
      up: c.unitPrice ?? null, ma: c.mainArea ?? null, fl: floors(c.floor), pk: parkOf(c), pt: c.parkType || '',
      // 關鍵字比對用（路名、社區、標題、591 特色標籤：近捷運、明星學區、制震宅…）
      t: `${c.title || ''} ${c.community || ''} ${(c.address || '').replace(/^台中市/, '')} ${(c.features || []).join(' ')}`.replace(/臺/g, '台'),
      sc: c.score, own, g: c.ownerGone ?? null, dr: c.drop || 0, tg: c.tags,
      f: Date.parse(c.firstSeen) || 0, sm: c._sm ? 1 : 0, lc: ll5(c.ll), rk: c.ll ? null : rk(c.district, c.address),
      x: (c._sm ? `🔒同體系已有（${c.storeCount || '?'}間店・比對可信度${LV[c.level] || c.level || '?'}）\n` : '') + cardLine(c).replace('\n', c.parkType ? ` 🚗${c.parkType.replace(/式$/, '')}車位\n` : c.parking ? ' 🚗含車位\n' : '\n') + (c.ownerGone != null ? `\n  ⚠️屋主刊登已下架${c.ownerGone}天（可能只是廣告到期）` : '')
    });
  }
  // ---- 配對模式：案件池（所有在架物件，不看分數；用戶 10/24：開發看高分／有競爭力，配對只要符合都列）----
  //   案件池量大（主力五區約 6000 件）→ 篩選欄位存成陣列（順序見 PKEYS，省掉每件重複的欄位名），
  //   顯示用的社區名／樓層／格局／網址另存 line-px<n>，只讀要顯示的那一頁
  const pby = {}, pdisp = {}, ptk = {};
  for (const x of pool?.items || []) {
    const rt = /華廈|別墅|套房|店面|公寓/.test(x.ty || '') ? x.ty : '';   // 一般大樓／透天不用存原始類型
    const t = `${cut(x.t, 24)}${x.c || ''} ${(x.a || '').replace(/^台中市\S{1,3}區/, '')} ${(x.ft || []).join(' ')}`.replace(/臺/g, '台').trim();
    (pby[x.d] = pby[x.d] || []).push([x.id, typeOf(x.ty), rt, x.ag ?? null, x.p ?? null, x.ar ?? null, rooms(x.ly),
      x.up ?? null, x.ma ?? null, floors(x.fl), x.pk ?? null, x.pt ? x.pt.replace(/式$/, '') : '',
      x.sc, x.own || 0, (x.tg || []).length ? x.tg : 0, Math.round((Date.parse(x.f) || 0) / 1000), x.same ? 1 : 0,
      ll5(x.ll), x.ll ? null : rk(x.d, x.a)]);
    (ptk[x.d] = ptk[x.d] || []).push(t);
    (pdisp[x.d] = pdisp[x.d] || {})[x.id] = [x.c || cut(x.t, 14),x.fl || '', x.ly || '',
      String(x.u || '').replace(/^https:\/\/sale\.591\.com\.tw\/home\/house\/detail\/(?:2\/)?/, '591:')];
  }
  const districts = [...new Set([...Object.keys(by), ...Object.keys(pby)])].sort();
  // 路名／社區名 → 在哪幾區（沒打區域、只打「東平路」時只讀那幾區，不用讀全台中）
  const where = {};
  const note = (w, d) => { if (w && w.length >= 2) (where[w] = where[w] || new Set()).add(districts.indexOf(d)); };
  const road = a => (String(a || '').replace(/^台中市/, '').replace(/^\S{1,3}區/, '').match(/^(.+?(?:路|街|大道))/) || [])[1];
  for (const c of all) { note(road(c.address), c.district); note(c.community, c.district); }
  for (const x of pool?.items || []) { note(road(x.a), x.d); note(x.c, x.d); }
  // 各區範圍（案件位置的外框）：「科博館 開車5分鐘」時只讀範圍碰得到的區
  const box = {};
  const grow = (d, pt) => { const b = box[d] || (box[d] = [90, 180, -90, -180]);
    b[0] = Math.min(b[0], pt[0]); b[1] = Math.min(b[1], pt[1]); b[2] = Math.max(b[2], pt[0]); b[3] = Math.max(b[3], pt[1]); };
  const where2 = (d, lc, r) => { if (lc) grow(d, lc); else if (r != null) rpts[r].forEach(pt => grow(d, pt)); };
  for (const d of Object.keys(by)) for (const it of by[d]) where2(d, it.lc, it.rk);
  const iLc = PKEYS.indexOf('lc'), iRk = PKEYS.indexOf('rk');
  for (const d of Object.keys(pby)) for (const a of pby[d]) where2(d, a[iLc], a[iRk]);
  // 篩選欄位和顯示文字分開存：查全台中時只讀篩選欄位，文字只讀要顯示的那一頁
  return {
    roads: { keys: rkeys, pts: rpts },
    meta: { at: data.generatedAt, districts, main: data.districts, pkeys: PKEYS,
      box: Object.fromEntries(Object.entries(box).map(([d, b]) => [districts.indexOf(d), b])),
      where: Object.fromEntries(Object.entries(where).map(([w, s]) => [w, [...s]])) },
    parts: districts.map(d => ({ d, items: (by[d] || []).map(({ x, ...r }) => r) })),
    texts: districts.map(d => ({ d, x: Object.fromEntries((by[d] || []).map(it => [it.id, it.x])) })),
    pparts: districts.map(d => ({ d, items: pby[d] || [] })),
    ptexts: districts.map(d => ({ d, x: pdisp[d] || {} })),
    pkw: districts.map(d => ({ d, t: ptk[d] || [] }))
  };
}

async function put(name, obj) {
  const r = await fetch(`${RADAR_URL.replace(/\/$/, '')}/api/ingest/blob/${name}`, {
    method: 'PUT', headers: { 'X-Ingest-Key': INGEST_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(obj)
  });
  if (!r.ok) throw new Error(`上傳 ${name} 失敗 HTTP ${r.status}`);
}

async function main() {
  const DOCS = process.env.RADAR_DOCS || path.join(ROOT, 'docs');   // 本機補傳可指到 tools/fetch-latest.sh 下載的資料
  const data = JSON.parse(fs.readFileSync(path.join(DOCS, 'data.json'), 'utf8'));
  let pool = null;
  try { pool = JSON.parse(fs.readFileSync(path.join(DOCS, 'pool.json'), 'utf8')); } catch {}
  let roadsSt = null;
  try { roadsSt = JSON.parse(fs.readFileSync(path.join(process.env.RADAR_STATE || path.join(ROOT, 'state'), 'roads.json'), 'utf8')); } catch {}
  const { meta, parts, texts, pparts, ptexts, pkw, roads } = build(data, pool, roadsSt);
  const located = [...parts.flatMap(x => x.items).filter(it => it.lc || it.rk != null), ...pparts.flatMap(x => x.items).filter(a => a[PKEYS.indexOf('lc')] || a[PKEYS.indexOf('rk')] != null)].length;
  console.log(`[LINE 索引] 有位置 ${located} 件（社區座標或路名座標）；路 ${roads.keys.length} 條 ${(JSON.stringify(roads).length / 1024).toFixed(0)} KB`);
  const kb = a => (a.reduce((s, p) => s + JSON.stringify(p).length, 0) / 1024).toFixed(0);
  console.log(`[LINE 索引] ${meta.districts.length} 區、${data.cards.length} 件＋同體系 ${(data.blocked || []).length} 件，篩選欄位共 ${kb(parts)} KB；` +
    `案件池 ${pool?.items.length ?? 0} 件 ${kb(pparts)} KB（最大一區 ${(Math.max(...pparts.map(p => JSON.stringify(p).length)) / 1024).toFixed(0)} KB）；地名 ${Object.keys(meta.where).length} 個 ${(JSON.stringify(meta).length / 1024).toFixed(0)} KB`);
  if (DRY) return;
  if (!RADAR_URL || !INGEST_KEY) { console.log('[LINE 索引] 缺 RADAR_URL／INGEST_KEY，略過'); return; }
  for (let i = 0; i < parts.length; i++) {
    await put(`line-${i}`, parts[i]); await put(`line-x${i}`, texts[i]); await put(`line-p${i}`, pparts[i]); await put(`line-px${i}`, ptexts[i]); await put(`line-pt${i}`, pkw[i]);
  }
  await put('line-roads', roads);
  await put('line-meta', meta);   // 每份都帶區名，Worker 讀到對不上的（區域剛增減）會略過
}

if (require.main === module) main().catch(e => { console.error('[LINE 索引] 失敗（不影響雷達）:', e.message); });
module.exports = { build, typeOf };

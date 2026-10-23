// LINE 對話查詢用的精簡案件索引（GitHub Actions：notify 之後跑）
//   網站 Worker 免費方案每次只有 10ms CPU → 不能解析整份 cards，這裡先拆成每區一小份
//   line-meta：{at, districts, main}；line-<n>：{d: districts[n], items}
//   每件的 LINE 文字（x）在這裡先排好，Worker 只負責篩選＋接字串
//   本機看：node tools/line-index.js --dry
const fs = require('fs');
const path = require('path');
const { cardLine } = require('./notify');

const ROOT = path.join(__dirname, '..');
const { RADAR_URL, INGEST_KEY } = process.env;
const DRY = process.argv.includes('--dry');

// 類型統一成：大樓（電梯大樓／大樓／華廈）、透天（透天厝／透天／別墅）、公寓
const typeOf = t => /透天|別墅/.test(t || '') ? '透天' : /公寓/.test(t || '') ? '公寓' : /大樓|華廈/.test(t || '') ? '大樓' : '';
const rooms = ly => { const m = String(ly || '').match(/(\d+)\s*房/); return m ? +m[1] : null; };

function build(data) {
  const by = {};
  for (const c of data.cards) {
    const own = c.posters?.owner ? (c.posters.agents === 0 ? 2 : 1) : 0;
    (by[c.district] = by[c.district] || []).push({
      id: c.id, ty: typeOf(c.type), ag: c.age ?? null, p: c.price, ar: c.area ?? null, r: rooms(c.layout),
      sc: c.score, own, g: c.ownerGone ?? null, dr: c.drop || 0, tg: c.tags,
      f: Date.parse(c.firstSeen) || 0,
      x: cardLine(c) + (c.ownerGone != null ? `\n  ⚠️屋主刊登已下架${c.ownerGone}天（可能只是廣告到期）` : '')
    });
  }
  const districts = Object.keys(by).sort();
  return { meta: { at: data.generatedAt, districts, main: data.districts }, parts: districts.map(d => ({ d, items: by[d] })) };
}

async function put(name, obj) {
  const r = await fetch(`${RADAR_URL.replace(/\/$/, '')}/api/ingest/blob/${name}`, {
    method: 'PUT', headers: { 'X-Ingest-Key': INGEST_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(obj)
  });
  if (!r.ok) throw new Error(`上傳 ${name} 失敗 HTTP ${r.status}`);
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'data.json'), 'utf8'));
  const { meta, parts } = build(data);
  const kb = parts.map(p => JSON.stringify(p).length / 1024);
  console.log(`[LINE 索引] ${meta.districts.length} 區、${data.cards.length} 件，最大一區 ${Math.max(...kb).toFixed(0)} KB`);
  if (DRY) return;
  if (!RADAR_URL || !INGEST_KEY) { console.log('[LINE 索引] 缺 RADAR_URL／INGEST_KEY，略過'); return; }
  for (let i = 0; i < parts.length; i++) await put(`line-${i}`, parts[i]);
  await put('line-meta', meta);   // 每份都帶區名，Worker 讀到對不上的（區域剛增減）會略過
}

if (require.main === module) main().catch(e => { console.error('[LINE 索引] 失敗（不影響雷達）:', e.message); });
module.exports = { build, typeOf };

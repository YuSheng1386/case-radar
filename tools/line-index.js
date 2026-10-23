// LINE 對話查詢用的精簡案件索引（GitHub Actions：notify 之後跑）
//   網站 Worker 免費方案每次只有 10ms CPU → 不能解析整份 cards，這裡先拆成每區一小份
//   line-meta：{at, districts, main}；line-<n>：{d: districts[n], items}（篩選欄位）；line-x<n>：{d, x: {id: LINE 文字}}
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

function build(data) {
  const by = {};
  for (const c of data.cards) {
    const own = c.posters?.owner ? (c.posters.agents === 0 ? 2 : 1) : 0;
    (by[c.district] = by[c.district] || []).push({
      id: c.id, ty: typeOf(c.type), rt: c.type || '', ag: c.age ?? null, p: c.price, ar: c.area ?? null, r: rooms(c.layout),
      up: c.unitPrice ?? null, ma: c.mainArea ?? null, fl: floors(c.floor), pk: parkOf(c),
      // 關鍵字比對用（路名、社區、標題裡的特色：近捷運、邊間、景觀…）
      t: `${c.title || ''} ${c.community || ''} ${(c.address || '').replace(/^台中市/, '')}`.replace(/臺/g, '台'),
      sc: c.score, own, g: c.ownerGone ?? null, dr: c.drop || 0, tg: c.tags,
      f: Date.parse(c.firstSeen) || 0,
      x: cardLine(c) + (c.ownerGone != null ? `\n  ⚠️屋主刊登已下架${c.ownerGone}天（可能只是廣告到期）` : '')
    });
  }
  const districts = Object.keys(by).sort();
  // 篩選欄位和顯示文字分開存：查全台中時只讀篩選欄位，文字只讀要顯示的那一頁
  return {
    meta: { at: data.generatedAt, districts, main: data.districts },
    parts: districts.map(d => ({ d, items: by[d].map(({ x, ...r }) => r) })),
    texts: districts.map(d => ({ d, x: Object.fromEntries(by[d].map(it => [it.id, it.x])) }))
  };
}

async function put(name, obj) {
  const r = await fetch(`${RADAR_URL.replace(/\/$/, '')}/api/ingest/blob/${name}`, {
    method: 'PUT', headers: { 'X-Ingest-Key': INGEST_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(obj)
  });
  if (!r.ok) throw new Error(`上傳 ${name} 失敗 HTTP ${r.status}`);
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'data.json'), 'utf8'));
  const { meta, parts, texts } = build(data);
  const kb = parts.map(p => JSON.stringify(p).length / 1024);
  console.log(`[LINE 索引] ${meta.districts.length} 區、${data.cards.length} 件，篩選欄位共 ${kb.reduce((a, b) => a + b, 0).toFixed(0)} KB`);
  if (DRY) return;
  if (!RADAR_URL || !INGEST_KEY) { console.log('[LINE 索引] 缺 RADAR_URL／INGEST_KEY，略過'); return; }
  for (let i = 0; i < parts.length; i++) { await put(`line-${i}`, parts[i]); await put(`line-x${i}`, texts[i]); }
  await put('line-meta', meta);   // 每份都帶區名，Worker 讀到對不上的（區域剛增減）會略過
}

if (require.main === module) main().catch(e => { console.error('[LINE 索引] 失敗（不影響雷達）:', e.message); });
module.exports = { build, typeOf };

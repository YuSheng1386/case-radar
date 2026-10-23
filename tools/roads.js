// 路名座標（LINE「東平路附近」「科博館 開車5分鐘」與地圖用）：案件地址的「區＋路名」→ OpenStreetMap Nominatim 查這條路各段的位置
//   沒有社區座標的物件（多半是透天）就用它那條路的位置算距離；你說的地標／路本身在 Worker 即時定位，不靠這張表
//   state/roads.json：{ items: { "太平區|東平路": { t: 查詢時間(秒), pts: [[lat, lng], ...] } } }，查不到的 pts 空陣列，30 天後再試
//   Nominatim 規定每秒最多 1 次 → 每次排程只補一部分（quick 150 條、full 600 條），常用的路先查；查過的不再查
//   用法：node tools/roads.js [最多幾條]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STATE = process.env.RADAR_STATE || path.join(ROOT, 'state');
const F = path.join(STATE, 'roads.json');
const UA = 'case-radar/1.0 (github.com/YuSheng1386/case-radar)';
const MAX = +(process.argv[2] || (process.env.RADAR_MODE === 'full' ? 600 : 150));

const load = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 地址 →「區|路」：台中市太平區東平路 → 太平區|東平路；崇德路二段 → 崇德路
function roadKey(district, address) {
  const a = String(address || '').replace(/^(台|臺)中市/, '');
  const d = district || (a.match(/^(\S{1,3}區)/) || [])[1];
  const r = (a.replace(/^\S{1,3}區/, '').match(/^(.+?(?:路|街|大道))/) || [])[1];
  return d && r && r.length >= 2 ? `${d}|${r}` : null;
}

// 約 100 公尺內的點只留一個
function thin(pts) {
  const out = [];
  for (const a of pts) if (!out.some(b => Math.abs(b[0] - a[0]) < 0.0009 && Math.abs(b[1] - a[1]) < 0.0009)) out.push(a);
  return out;
}

async function lookup(district, road) {
  const qs = [
    `street=${encodeURIComponent(road)}&city=${encodeURIComponent(district)}&county=${encodeURIComponent('臺中市')}`,
    `q=${encodeURIComponent(`${road}, ${district}, 臺中市`)}`
  ];
  for (const q of qs) {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=15&countrycodes=tw&${q}`, { headers: { 'User-Agent': UA } });
    if (r.status === 429 || r.status === 403) throw new Error(`Nominatim HTTP ${r.status}（被限流，下次再補）`);
    const j = r.ok ? await r.json() : [];
    await sleep(1100);
    // 只收台中、同一區的（別區也有同名路）
    const hit = j.filter(x => /臺中市/.test(x.display_name) && x.display_name.includes(district));
    if (hit.length) return thin(hit.map(x => [Math.round(x.lat * 1e5) / 1e5, Math.round(x.lon * 1e5) / 1e5]));
  }
  return [];
}

async function main() {
  const st = load(F, { items: {} });
  const DOCS = process.env.RADAR_DOCS || path.join(ROOT, 'docs');   // 本機測試可指到下載的最新資料
  const data = load(path.join(DOCS, 'data.json'), { cards: [], blocked: [] });
  const pool = load(path.join(DOCS, 'pool.json'), { items: [] });
  // 用到的次數（常用的路先查）
  const need = {};
  for (const c of [...data.cards, ...(data.blocked || [])]) { const k = roadKey(c.district, c.address); if (k) need[k] = (need[k] || 0) + 1; }
  for (const x of pool.items) { const k = roadKey(x.d, x.a); if (k) need[k] = (need[k] || 0) + 1; }
  const now = Math.floor(Date.now() / 1000);
  const todo = Object.keys(need).filter(k => { const r = st.items[k]; return !r || (!r.pts.length && now - r.t > 30 * 86400); })
    .sort((a, b) => need[b] - need[a]).slice(0, MAX);
  let ok = 0, miss = 0;
  try {
    for (const k of todo) {
      const [d, r] = k.split('|');
      const pts = await lookup(d, r);
      st.items[k] = { t: now, pts };
      pts.length ? ok++ : miss++;
    }
  } catch (e) { console.error('[路名座標]', e.message); }
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(F, JSON.stringify(st));
  const have = Object.keys(need).filter(k => st.items[k]?.pts.length).length;
  console.log(`[路名座標] 這次查 ${ok + miss} 條（找到 ${ok}、找不到 ${miss}）；案件用到 ${Object.keys(need).length} 條，已有座標 ${have} 條`);
}

if (require.main === module) main().catch(e => console.error('[路名座標] 失敗（不影響雷達）:', e.message));
module.exports = { roadKey };

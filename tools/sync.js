// 與 Cloudflare 網站同步（取代原本公開的 data 分支）
//   node tools/sync.js pull   下載追蹤狀態到 state/
//   node tools/sync.js push   上傳追蹤狀態＋案件清單（cards）＋案件池（pool）
// 需要環境變數 RADAR_URL（網站網址）、INGEST_KEY（上傳金鑰）；內容一律 gzip
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const STATE = process.env.RADAR_STATE || path.join(ROOT, 'state');
const { RADAR_URL, INGEST_KEY } = process.env;
if (!RADAR_URL || !INGEST_KEY) { console.error('缺 RADAR_URL 或 INGEST_KEY'); process.exit(1); }

const STATE_FILES = ['tracker', 'yc-listings', 'community', 'market-prices', 'notify', 'peers', 'sold'];
const url = name => `${RADAR_URL.replace(/\/$/, '')}/api/ingest/blob/${name}`;
const H = { 'X-Ingest-Key': INGEST_KEY };

async function pull() {
  fs.mkdirSync(STATE, { recursive: true });
  for (const f of STATE_FILES) {
    const r = await fetch(url(`state-${f}`), { headers: H });
    if (r.status === 404) { console.log(`state-${f}: 沒有（第一次）`); continue; }
    if (!r.ok) throw new Error(`下載 state-${f} 失敗 HTTP ${r.status}`);
    const buf = zlib.gunzipSync(Buffer.from(await r.arrayBuffer()));
    fs.writeFileSync(path.join(STATE, `${f}.json`), buf);
    console.log(`state-${f}: ${(buf.length / 1e6).toFixed(1)} MB`);
  }
  // 網站上標「同體系比對錯了」的案件 → run.js 讀 state/overrides.json 改回可開發
  const r = await fetch(`${RADAR_URL.replace(/\/$/, '')}/api/ingest/overrides`, { headers: H });
  if (r.ok) {
    const ids = await r.json();
    fs.writeFileSync(path.join(STATE, 'overrides.json'), JSON.stringify(ids));
    console.log(`同體系人工排除：${ids.length} 筆`);
  } else console.log(`同體系人工排除：讀取失敗 HTTP ${r.status}（沿用規則）`);
}

async function put(name, file) {
  if (!fs.existsSync(file)) { console.log(`${name}: 沒有檔案，略過`); return; }
  const gz = zlib.gzipSync(fs.readFileSync(file), { level: 9 });
  const r = await fetch(url(name), { method: 'PUT', headers: { ...H, 'Content-Length': String(gz.length) }, body: gz });
  if (!r.ok) throw new Error(`上傳 ${name} 失敗 HTTP ${r.status} ${await r.text()}`);
  console.log(`${name}: 上傳 ${(gz.length / 1e6).toFixed(2)} MB（gzip）`);
}

async function push() {
  for (const f of STATE_FILES) await put(`state-${f}`, path.join(STATE, `${f}.json`));
  await put('cards', path.join(ROOT, 'docs', 'data.json'));
  await put('pool', path.join(ROOT, 'docs', 'pool.json'));
}

({ pull, push })[process.argv[2]]?.().catch(e => { console.error(e.message); process.exit(1); })
  ?? (console.error('用法：node tools/sync.js pull|push'), process.exit(1));

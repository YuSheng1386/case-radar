// 每週加密備份網站資料庫（客戶、客需、客人反應、分享、開發進度…；不含密碼雜湊與登入狀態）
//   node tools/backup.js            下載 → gzip → AES-256-GCM 加密 → 存回網站 KV（backup-w0..w7 輪替，約 8 週）
//                                   並留一份 backup/radar-backup-<日期>.enc（Actions 會上傳成 artifact）
//   node tools/backup.js decrypt <檔案.enc> [輸出.json]   還原（需要同一個 BACKUP_PASS）
//   node tools/backup.js fetch <w0..w7> <檔案.enc>        從網站 KV 下載某一週的加密檔
// 環境變數：RADAR_URL、INGEST_KEY、BACKUP_PASS（加密密碼；放 GitHub Secret，本機在 web/.backup-pass）
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const { RADAR_URL, INGEST_KEY, BACKUP_PASS } = process.env;
const SITE = (RADAR_URL || '').replace(/\/$/, '');
const H = { 'X-Ingest-Key': INGEST_KEY || '' };
const MAGIC = Buffer.from('RADARBK1');

function encrypt(buf, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 << 20 });
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), enc]);
}
function decrypt(buf, pass) {
  if (!buf.subarray(0, 8).equals(MAGIC)) throw new Error('不是雷達備份檔');
  const salt = buf.subarray(8, 24), iv = buf.subarray(24, 36), tag = buf.subarray(36, 52);
  const key = crypto.scryptSync(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 << 20 });
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(52)), d.final()]);
}

async function backup() {
  if (!SITE || !INGEST_KEY) throw new Error('缺 RADAR_URL 或 INGEST_KEY');
  if (!BACKUP_PASS || BACKUP_PASS.length < 16) throw new Error('缺 BACKUP_PASS（至少 16 字），先跑 tools/setup-secrets.sh');
  const r = await fetch(`${SITE}/api/ingest/backup`, { headers: H });
  if (!r.ok) throw new Error(`下載資料失敗 HTTP ${r.status}`);
  const raw = Buffer.from(await r.arrayBuffer());
  const counts = Object.entries(JSON.parse(raw).tables).map(([k, v]) => `${k} ${v.length}`).join('、');
  const enc = encrypt(zlib.gzipSync(raw, { level: 9 }), BACKUP_PASS);
  const week = Math.floor(Date.now() / (7 * 864e5)) % 8;
  const put = await fetch(`${SITE}/api/ingest/blob/backup-w${week}`, { method: 'PUT', headers: { ...H, 'Content-Length': String(enc.length) }, body: enc });
  if (!put.ok) throw new Error(`存回網站失敗 HTTP ${put.status}`);
  const dir = path.join(__dirname, '..', 'backup');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `radar-backup-${new Date().toISOString().slice(0, 10)}.enc`);
  fs.writeFileSync(f, enc);
  // 驗證能解回來
  JSON.parse(zlib.gunzipSync(decrypt(enc, BACKUP_PASS)));
  console.log(`備份完成：${counts}；加密 ${(enc.length / 1024).toFixed(1)} KB → 網站 backup-w${week}、${path.basename(f)}（已驗證可解密）`);
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (!cmd) return backup();
  if (cmd === 'decrypt') {
    if (!BACKUP_PASS) throw new Error('缺 BACKUP_PASS');
    const out = zlib.gunzipSync(decrypt(fs.readFileSync(a), BACKUP_PASS));
    if (b) fs.writeFileSync(b, out); else process.stdout.write(out);
    if (b) console.log(`已還原到 ${b}`);
    return;
  }
  if (cmd === 'fetch') {
    const r = await fetch(`${SITE}/api/ingest/blob/backup-${a}`, { headers: H });
    if (!r.ok) throw new Error(`下載失敗 HTTP ${r.status}`);
    fs.writeFileSync(b, Buffer.from(await r.arrayBuffer()));
    return console.log(`已下載 ${b}`);
  }
  throw new Error('用法：node tools/backup.js [decrypt <檔> [輸出] | fetch <w0..w7> <檔>]');
}

main().catch(e => { console.error('[備份]', e.message); process.exit(1); });

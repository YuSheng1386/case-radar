// 本機用正式網站的 LINE 索引模擬一次查詢（不經 LINE、不回覆），看會回什麼、哪裡出錯、花多久
//   用法：node tools/line-ask.mjs "太平 透天 4房以上"   （從 Windows 叫 WSL 時中文參數會被拆掉 → 改用 echo "…" | node tools/line-ask.mjs）
import fs from 'fs';
import { answerFor } from '../web/src/line.mjs';
const SITE = process.env.RADAR_URL || 'https://case-radar.yusheng1386.workers.dev';
const KEY = (process.env.INGEST_KEY || fs.readFileSync(new URL('../web/.ingest-key', import.meta.url), 'utf8')).trim();
const cache = new Map();
const S = {
  async get(k, type) {
    if (!cache.has(k)) {
      const r = await fetch(`${SITE}/api/ingest/blob/${k}`, { headers: { 'X-Ingest-Key': KEY } });
      cache.set(k, r.ok ? await r.text() : null);
    }
    const v = cache.get(k);
    return v == null ? null : type === 'json' ? JSON.parse(v) : v;
  },
  async put(k, v) { cache.set(k, v); }   // 只存在記憶體，不寫正式資料（第二次跑就不再連外定位）
};
const text = process.argv.slice(2).join(' ') || fs.readFileSync(0, 'utf8').trim();
const t0 = Date.now();
try {
  const out = await answerFor(S, 'Ulocal', text);
  console.log(out);
  // 半個 emoji → LINE 整則拒收（Worker reply 會先修掉，這裡提醒索引有切壞）
  if (!out.isWellFormed()) console.error('⚠ 回覆含半個 emoji（索引切字切壞；Worker 送出前會修掉）');
  console.error(`${Array.from(out).length} 字，花 ${Date.now() - t0} ms（含下載）`);
  // 資料都下載過了再跑一次 ≈ Worker 的 CPU 時間（免費方案每次 10ms，超過就被砍、回覆送不出去）
  // 正式環境每次都要 JSON.parse 讀到的資料 → 快取存字串、每次重新 parse，跟 Worker 一樣
  // 跑 3 次取最小（排除第一次 JIT 暖機、GC）
  const ms = [];
  for (let i = 0; i < 3; i++) { const c0 = performance.now(); await answerFor(S, 'Ulocal', text); ms.push(performance.now() - c0); }
  console.error(`CPU 約 ${Math.round(Math.min(...ms))} ms（${ms.map(Math.round).join('/')}）`);
} catch (e) { console.error('✗ 出錯：', e.stack); }

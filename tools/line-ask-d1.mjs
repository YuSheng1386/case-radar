// 跟 line-ask.mjs 一樣模擬一次 LINE 查詢，但資料直接用 wrangler 讀正式 D1（不需要 web/.ingest-key）
//   用法：echo "配對 北屯 3房" | node tools/line-ask-d1.mjs   （LINE_MOD=<另一份 line.mjs> 可比對舊版）
//   讀過的資料存 /tmp/blob-<k>.json，第二次起不再下載（要最新就刪掉）；不寫正式資料
import { execSync } from 'child_process';
import fs from 'fs';
const mod = await import(process.env.LINE_MOD || new URL('../web/src/line.mjs', import.meta.url).href);
const WEB = new URL('../web/', import.meta.url).pathname;
const cache = new Map();
const S = {
  async get(k, type) {
    if (!cache.has(k)) {
      const f = `${process.env.BLOB_DIR || '/tmp'}/blob-${k}.json`;
      let v = null;
      if (fs.existsSync(f)) v = fs.readFileSync(f, 'utf8');
      else {
        const out = execSync(`npx wrangler d1 execute radar-db --remote --json --command "SELECT v FROM blobs WHERE k='${k}'"`,
          { cwd: decodeURIComponent(WEB), maxBuffer: 1e9, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        const r = JSON.parse(out).at(-1).results[0];
        v = r ? r.v : null;
        if (v != null) fs.writeFileSync(f, v);
      }
      cache.set(k, v);
    }
    const v = cache.get(k);
    return v == null ? null : type === 'json' ? JSON.parse(v) : v;
  },
  async put(k, v) { cache.set(k, v); }
};
const text = fs.readFileSync(0, 'utf8').trim();
try { console.log(await mod.answerFor(S, 'Ulocal', text)); } catch (e) { console.log('ERR', e.stack); }
// 資料都在記憶體了再跑幾次 ≈ Worker CPU（免費方案 10ms；正式每次都要 JSON.parse，這裡也是）
//   連結檢查會連外，時間含網路等待，取最小值看趨勢就好
const ms = [];
//   用 process.cpuUsage 量 CPU；連結檢查改成假的立即回應（Worker 等網路不算 CPU，本機 TLS 會算進去）
globalThis.fetch = async () => new Response('', { status: 200 });
for (let i = 0; i < 5; i++) { const c = process.cpuUsage(); await mod.answerFor(S, 'Ulocal', text); const d = process.cpuUsage(c); ms.push((d.user + d.system) / 1000); }
console.error(`CPU 約 ${Math.min(...ms).toFixed(1)} ms（5 次最小）`);

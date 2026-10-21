// 預覽 LINE 每件的寫法（不推播）：從網站讀目前的案件清單，取五區分數最高幾件
// 用法：INGEST_KEY=$(cat web/.ingest-key) node tools/preview-line.js [幾件]
const zlib = require('zlib');
const { cardLine } = require('./notify');
(async () => {
  const key = process.env.INGEST_KEY || require('fs').readFileSync(require('path').join(__dirname, '..', 'web', '.ingest-key'), 'utf8').trim();
  const r = await fetch('https://case-radar.yusheng1386.workers.dev/api/ingest/blob/cards', { headers: { 'X-Ingest-Key': key } });
  const d = JSON.parse(zlib.gunzipSync(Buffer.from(await r.arrayBuffer())));
  const cs = d.cards.filter(c => !c.wide).sort((a, b) => b.score - a.score).slice(0, +process.argv[2] || 4);
  console.log(cs.map(cardLine).join('\n'));
})();

// 檢查各平台照片能不能被我們的網站引用（防盜連會看 Referer）
// 用法：RADAR_STATE=/tmp/radar-seed2 node tools/probe-photos.js
const https = require('https');
const path = require('path');
const pool = require(path.join(__dirname, '..', 'docs', 'pool.json')).items;
const REF = 'https://case-radar.yusheng1386.workers.dev/s/x';
const head = (u, ref) => new Promise(r => {
  const req = https.get(u.startsWith('//') ? 'https:' + u : u, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone)', ...(ref ? { Referer: ref } : {}) } }, res => {
    res.resume(); r(`${res.statusCode} ${res.headers['content-type'] || ''}`.trim());
  });
  req.on('error', e => r('ERR ' + e.code)); req.setTimeout(10000, () => { req.destroy(); r('timeout'); });
});
(async () => {
  const bySrc = {};
  for (const it of pool) {
    if (!it.ph) continue;
    const host = new URL(it.ph.startsWith('//') ? 'https:' + it.ph : it.ph).host;
    (bySrc[host] = bySrc[host] || []).push(it.ph);
  }
  for (const [host, list] of Object.entries(bySrc)) {
    const u = list[Math.floor(list.length / 2)];
    console.log(`${host.padEnd(28)} ${String(list.length).padStart(5)} 張｜無 Referer: ${await head(u)}｜從我們網站: ${await head(u, REF)}`);
  }
  console.log('沒有照片', pool.filter(x => !x.ph).length, '筆');
})();

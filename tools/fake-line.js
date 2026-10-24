// 測試用：node -r ./tools/fake-line.js tools/notify.js → 攔截 api.line.me（額度固定 200／已用 17，推播記到 FAKE_LINE_LOG），其他照常連
const fs = require('fs');
const real = global.fetch;
global.fetch = async (u, o = {}) => {
  u = String(u);
  if (!u.startsWith('https://api.line.me/')) return real(u, o);
  const res = j => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) });
  if (u.endsWith('/quota/consumption')) return res({ totalUsage: 17 });
  if (u.endsWith('/quota')) return res({ type: 'limited', value: 200 });
  const b = JSON.parse(o.body || '{}');
  fs.appendFileSync(process.env.FAKE_LINE_LOG || '/tmp/fake-line.log', `${u.split('/').pop()} ${[].concat(b.to).length}\n`);
  return res({});
};

// LINE 查詢解析測試：各種口語說法 → 應該解析出的條件
//   用法：node tools/test-parse.mjs        （區名表用正式網站的 line-meta，第一次下載後存 /tmp/line-meta.json）
//   每筆：[說法, 期望條件（標籤要包含的字）, 附近中心點（沒有填 null）, 期望區域（可省）]
import fs from 'fs';
import { parse } from '../web/src/line.mjs';

const MF = '/tmp/line-meta.json';
if (!fs.existsSync(MF)) {
  const KEY = (process.env.INGEST_KEY || fs.readFileSync(new URL('../web/.ingest-key', import.meta.url), 'utf8')).trim();
  const r = await fetch('https://case-radar.yusheng1386.workers.dev/api/ingest/blob/line-meta', { headers: { 'X-Ingest-Key': KEY } });
  fs.writeFileSync(MF, await r.text());
}
const meta = JSON.parse(fs.readFileSync(MF, 'utf8'));
// 10/30 起地名表另存 line-where
const WF = '/tmp/line-where.json';
if (!meta.where && !fs.existsSync(WF)) {
  const KEY = (process.env.INGEST_KEY || fs.readFileSync(new URL('../web/.ingest-key', import.meta.url), 'utf8')).trim();
  const r = await fetch('https://case-radar.yusheng1386.workers.dev/api/ingest/blob/line-where', { headers: { 'X-Ingest-Key': KEY } });
  if (r.ok) fs.writeFileSync(WF, await r.text());
}
if (!meta.where && fs.existsSync(WF)) meta.where = JSON.parse(fs.readFileSync(WF, 'utf8'));

const T = [
  // 用戶 10/24 實際打的
  ['太平 少於三十年 靠近太平運動場 透天 大於四房', ['屋齡≤30年', '4房以上', '透天'], '太平運動場', '太平區'],
  // 屋齡
  ['太平 30年內 透天 4房以上', ['屋齡≤30年', '4房以上', '透天'], null, '太平區'],
  ['太平透天4房30年內', ['屋齡≤30年', '4房以上|4房', '透天'], null, '太平區'],
  ['太平 屋齡30年以下 透天 4房+', ['屋齡≤30年', '4房以上', '透天'], null],
  ['太平透天 4房起 屋齡不超過30年', ['屋齡≤30年', '4房以上', '透天'], null],
  ['太平 屋齡小於30 透天', ['屋齡≤30年', '透天'], null],
  ['屋齡三十年以內的太平透天', ['屋齡≤30年', '透天'], null, '太平區'],
  ['太平 透天 至少4房', ['4房以上', '透天'], null],
  ['4房以上的太平透天', ['4房以上', '透天'], null, '太平區'],
  ['太平 透天 4房(含)以上', ['4房以上', '透天'], null],
  ['太平 透天 四房或以上', ['4房以上', '透天'], null],
  ['太平 透天 4~5房', ['4–5房', '透天'], null],
  ['太平 透天 屋齡20年左右', ['屋齡', '透天'], null],
  ['南屯 10年內的新大樓', ['屋齡≤10年', '大樓'], null, '南屯區'],
  ['老透天 大里', ['屋齡≥30年', '透天'], null, '大里區'],
  // 總價
  ['太平 2000萬內 透天', ['總價≤2000萬', '透天'], null],
  ['太平 2000以下 透天', ['總價≤2000萬', '透天'], null],
  ['太平 預算兩千萬 透天', ['總價≤2000萬', '透天'], null],
  ['太平 一千五百萬以下 透天', ['總價≤1500萬', '透天'], null],
  ['太平 1500萬到2000萬 透天', ['總價1500–2000萬', '透天'], null],
  ['太平 1500-2000 透天', ['總價1500–2000萬', '透天'], null],
  ['南區 低於1200萬 大樓 3房', ['總價≤1200萬', '大樓', '3房'], null],
  ['東區 1000萬左右 3房', ['總價1000萬左右', '3房'], null],
  ['南屯 2500萬以上 透天', ['總價≥2500萬', '透天'], null],
  ['大里 1500w 以下 3房', ['總價≤1500萬', '3房'], null],
  ['1.2億以下 透天 南屯', ['總價≤12000萬', '透天'], null],
  // 坪數／格局／車位
  ['北屯 三十坪以上 大樓', ['≥30坪', '大樓'], null, '北屯區'],
  ['南屯 3房2廳 平面車位', ['3房', '平面車位'], null],
  ['東區 3房 大樓 有電梯 平車', ['3房', '大樓', '平面車位'], null],
  ['西屯 三房兩廳兩衛 機械車位以外', ['3房'], null],
  ['大里 透天 不要機械車位', ['透天', '不要機械'], null],
  ['南區 25-35坪 2房', ['25–35坪', '2房'], null],
  ['主建物20坪以上 南屯 大樓', ['主建物≥20坪', '大樓'], null],
  // 附近
  ['太平運動場附近的透天', ['透天'], '太平運動場', '太平區'],
  ['太平運動場附近 透天', ['透天'], '太平運動場', '太平區'],
  ['靠近太平運動場透天4房', ['透天', '4房'], '太平運動場'],
  ['離太平運動場近一點的透天', ['透天'], '太平運動場'],
  ['太平運動場旁 透天', ['透天'], '太平運動場'],
  ['在太平運動場附近 4房透天', ['透天', '4房'], '太平運動場'],
  ['太平運動場 開車5分鐘 透天', ['透天', '開車5分鐘'], '太平運動場'],
  ['太平運動場 走路10分 透天', ['透天', '走路10分鐘'], '太平運動場'],
  ['近太平運動場的透天', ['透天'], '太平運動場'],
  ['新光國小附近 太平 透天', ['透天'], '新光國小', '太平區'],
  ['東平國小附近', [], '東平國小'],
  ['科博館 開車5分鐘 大樓', ['大樓'], '科博館'],
  ['北屯好事多 2公里內', ['2公里內'], '好事多', '北屯區'],
  ['靠近東平路', [], '東平路'],
  ['近捷運 北屯 大樓', ['近捷運', '大樓'], null, '北屯區'],
  // 其他口語
  ['有沒有太平的透天', ['透天'], null, '太平區'],
  ['太平有透天嗎', ['透天'], null, '太平區'],
  ['幫我找太平透天 4房 30年內', ['透天', '4房', '屋齡≤30年'], null, '太平區'],
  ['東區優質透天', ['優質', '透天'], null, '東區'],
  ['屯區 20年內 透天 有車位', ['屋齡≤20年', '透天', '有車位'], null],
  ['配對 南屯 3房 1500萬以下 平面車位', ['3房', '總價≤1500萬', '平面車位'], null, '南屯區'],
  ['太平屋主自售透天', ['屋主', '透天'], null, '太平區'],
  ['南屯 急售 大樓', ['急售', '大樓'], null],
  ['太平 低於行情 透天', ['低於行情', '透天'], null],
  ['太平 新上架的透天', ['新上架', '透天'], null],
  ['北屯 5樓以上 大樓 3房', ['5樓以上', '大樓', '3房'], null],
  ['西區 公寓 不要頂樓', ['公寓'], null],
];

let bad = 0;
for (const [s, want, near, ds] of T) {
  const q = parse(s, meta.districts, meta.main, meta.where || {});
  const ls = q.conds.filter(c => c.k !== 'near').map(c => c.l);
  const nc = q.conds.find(c => c.k === 'near');
  const errs = [];
  for (const w of want) if (!ls.some(l => new RegExp(w).test(l)) && !(nc && new RegExp(w).test(nc.l))) errs.push(`少「${w}」`);
  const kws = q.conds.filter(c => c.k === 'kw' && /^「/.test(c.l)).map(c => c.l);
  if (kws.length) errs.push(`多出關鍵字 ${kws.join('')}`);
  if (near && !(nc && (nc.g || nc.a).includes(near) && (nc.g || nc.a).length <= near.length + 2))errs.push(`中心點應為「${near}」，得到「${nc ? nc.g || nc.a : '無'}」`);
  if (!near && nc) errs.push(`不該有附近「${nc.a}」`);
  if (ds && !q.ds.includes(ds)) errs.push(`區域應含${ds}，得到 ${q.scope || q.ds.length + '區'}`);
  if (errs.length) { bad++; console.log(`✗ ${s}\n    ${errs.join('；')}\n    解析：${q.scope}｜${q.conds.map(c => c.l).join('・')}`); }
}
console.log(`${T.length - bad}/${T.length} 通過`);
process.exit(bad ? 1 : 0);

// 傳出前測連結（用戶 10/24）：同一案有好幾個平台在賣，失效的跳過、改傳還在的那個
//   Worker（LINE 查詢回覆）和 tools/notify.js（Actions 推播）共用
//   只認「確定下架」：HTTP 404／410（591、永慶、信義、5168 下架都回 404），或頁面標題寫找不到（東森 /houses/buy/<編號> 回 200）
//   住商網頁是前端渲染、在不在都同一頁 → 改問它前端用的 API：GetHouseDetailData {sn}，下架回 code 201「No Data」
//   被擋（403，永慶、5168 擋海外 IP）、逾時、連不上 → 當作還在，不誤殺
//   全部失效也照樣傳（優質案件不能漏），改附網站案件頁 deadNote()
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const GONE_TITLE = /找不到頁面|頁面不存在|物件不存在|已關閉或者被刪除/;
// 這些網站下架時回 200，要看標題（其他只看狀態碼，不讀內容，省 Worker CPU）
const READ_TITLE = /etwarm\.com\.tw/;
const HB_DETAIL = /hbhousing\.com\.tw\/buyhouse\/detail\/([\w-]+)/;

async function hbAlive(sn, ms) {
  const r = await fetch('https://www.hbhousing.com.tw/proxy/api/HB/BuyHouseRelated/GetHouseDetailData', {
    method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sn }), signal: AbortSignal.timeout(ms)
  });
  if (!r.ok) { r.body?.cancel(); return true; }
  const j = await r.json();
  return !(j && j.code === 201 && j.data == null);
}

export async function linkAlive(url, ms = 5000) {
  if (!/^https?:\/\//.test(url || '')) return true;
  try {
    const hb = HB_DETAIL.exec(url);
    if (hb) return await hbAlive(hb[1], ms);
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
    if (r.status === 404 || r.status === 410) { r.body?.cancel(); return false; }
    if (!r.ok || !READ_TITLE.test(url)) { r.body?.cancel(); return true; }
    const t = (/<title>([^<]*)/i.exec((await r.text()).slice(0, 8000)) || [])[1] || '';
    return !GONE_TITLE.test(t);
  } catch { return true; }
}

// 各平台連結都打不開時取代網址的那一行（網站 #case/<id> 有雷達最後抓到的資料）
export const deadNote = (site, id) => `⚠️平台刊登可能已下架，案件資料：${site}/#case/${id}`;

// urls 依偏好排好；回第一個還在的，全部失效回 null
export async function pickAlive(urls) {
  // 2026-10-24 前的 591 網址少了 /2/（索引、追蹤檔裡可能還有），先補正再測
  const fix = x => x.replace(/(sale\.591\.com\.tw\/home\/house\/detail\/)(?=\d+\.html)/, '$12/');
  const u = [...new Set((urls || []).filter(Boolean).map(fix))];
  if (!u.length) return '';
  const ok = await Promise.all(u.map(x => linkAlive(x)));
  const i = ok.indexOf(true);
  return i < 0 ? null : u[i];
}

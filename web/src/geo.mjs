// 地標／地址定位（客需通勤地標、LINE「科博館 開車5分鐘」共用）
//   ①內政部 NLSC 門牌／地標 ②OpenStreetMap Nominatim（學校、店名等）；只收台中市
export async function geocode(q, n = 5) {
  q = String(q || '').trim().slice(0, 80);
  if (!q) return [];
  const out = [];
  const full = /^(臺|台)中市/.test(q) ? q.replace(/^台中市/, '臺中市') : '臺中市' + q;
  try {
    const xml = await (await fetch(`https://api.nlsc.gov.tw/MapSearch/QuerySearch?word=${encodeURIComponent(full)}&feedback=XML`,
      { headers: { Referer: 'https://maps.nlsc.gov.tw/', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) })).text();
    for (const it of xml.split('<ITEM>').slice(1, n + 1)) {
      const c = (it.match(/<CONTENT>([^<]*)/) || [])[1], loc = (it.match(/<LOCATION>([^<]*)/) || [])[1];
      if (!c || !loc || !/^臺中市/.test(c)) continue;   // 驗縣市（別縣市也有同名區）
      const [lng, lat] = loc.split(',').map(Number);
      if (lat && lng) out.push({ label: c, lat, lng, src: '內政部' });
    }
  } catch {}
  if (!out.length) {
    try {
      const j = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=${n}&countrycodes=tw&q=${encodeURIComponent(q.replace(/^(臺|台)中市/, '') + ' 臺中市')}`,
        { headers: { 'User-Agent': 'case-radar/1.0 (yusheng1386 real-estate tool)' }, signal: AbortSignal.timeout(6000) })).json();
      for (const x of j) if (/臺中市/.test(x.display_name)) out.push({ label: x.display_name, lat: +x.lat, lng: +x.lon, src: 'OpenStreetMap' });
    } catch {}
  }
  return out;
}

// LINE「附近」的中心點：只要一個最可能的點
//   ①OpenStreetMap（地標名稱準：Costco、中友百貨、國家歌劇院、東平國小）；有指定區就挑離那區最近的
//   ②內政部（名稱要對得上才收：它會模糊比對，「東平國小」會跳到東勢的新成國小）
const ALIAS = [[/好事多|好市多|costco/i, 'Costco'], [/^科博館$/, '國立自然科學博物館'], [/^(?:台中)?高鐵站?$|^高鐵台中站$/, '台中高鐵站'],
  [/^(?:台中)?火車站$|^台中車站$/, '臺中車站'], [/^歌劇院$/, '臺中國家歌劇院'], [/^市政府$/, '臺中市政府'], [/^榮總$/, '臺中榮民總醫院'],
  [/^中國醫$/, '中國醫藥大學附設醫院'], [/^中山醫$/, '中山醫學大學附設醫院'], [/^大遠百$/, '台中大遠百']];
export async function findPlace(w, hint = null) {
  const name = (ALIAS.find(([re]) => re.test(w)) || [])[1] || w;
  try {
    const j = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=8&countrycodes=tw&q=${encodeURIComponent(name + ' 臺中市')}`,
      { headers: { 'User-Agent': 'case-radar/1.0 (yusheng1386 real-estate tool)' }, signal: AbortSignal.timeout(6000) })).json();
    const c = j.filter(x => /臺中市/.test(x.display_name)).map(x => [+x.lat, +x.lon]);
    if (c.length) return hint ? c.sort((a, b) => km(a, hint) - km(b, hint))[0] : c[0];
  } catch {}
  const core = name.replace(/^(臺|台)中市/, '').replace(/國小$/, '');
  const g = (await geocode(name, 5)).filter(x => x.label.includes(core));
  if (g.length) return hint ? g.map(x => [x.lat, x.lng]).sort((a, b) => km(a, hint) - km(b, hint))[0] : [g[0].lat, g[0].lng];
  return null;
}

// 兩點直線距離（公里）
export function km(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

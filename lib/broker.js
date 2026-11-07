// 591 刊登的經紀業資訊 → 直接認出「同體系店家自己刊的」（11/07 用戶：除了店名電話，也從經紀業名、經紀業號篩）
//   來源：591 內文 API（desc591 本來就在抓）
//     linkInfo.companyname／subcompanyname（品牌＋分店，例：永義房屋／烏日中山百富店）、certificateNum（營業員證）
//     remark 內文常寫：經紀業公司名（XX不動產經紀有限公司）、經紀業證號（府授經商字第…號）、經紀人證、店電話
//   店家清單（stores.local.json／Secret EXCLUDED_STORES）每家可填：
//     name、brand、phone（店家頁電話）、company（經紀業公司名）、license（[證號…]，選填）、phones（[其他電話]，選填）

const plain = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
const digits = s => String(s || '').replace(/\D/g, '');

// 證號正規化：年度＋字號最後兩字＋號碼（去前導 0）
//   「府授經商字第10307891210號」→ 經商10307891210；「(102)中市經紀字第00446號」→ 102經紀446；「109年登字第370185號」→ 109登370185
const LIC_RE = /(?:[（(]\s*(\d{2,3})\s*[)）]|(\d{2,3})\s*年)?\s*([一-鿿]{1,8})\s*字\s*第\s*0*(\d{3,})\s*號/g;
function licensesOf(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(LIC_RE)) out.add(`${m[1] || m[2] || ''}${m[3].slice(-2)}${m[4]}`);
  return [...out];
}
const normLicense = s => licensesOf(s)[0] || String(s || '').replace(/\s/g, '');

// 公司名（「…有限公司」，前面最多抓 12 字，比對時用「包含店家公司名」）
const companiesOf = text => [...new Set((plain(text).replace(/\s/g, '').match(/[一-鿿]{2,12}?(?:股份)?有限公司/g) || []))].slice(0, 6);
// 電話（市話／手機，只留數字）
const telsOf = text => [...new Set((String(text || '').match(/\(?0\d{1,2}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/g) || []).map(digits).filter(x => x.length >= 9 && x.length <= 10))].slice(0, 8);

// 591 內文 JSON → 精簡經紀業資訊（存在 state/desc591.json，不存內文）；什麼都沒有 → 0
function extract(j) {
  const li = j?.linkInfo || {};
  const remark = plain(j?.remark ?? j?.ware?.remark ?? '');
  const info = {
    co: li.companyname || '',
    shop: li.subcompanyname || '',
    names: companiesOf(`${remark} ${li.pc_agent_intro?.fallback_company_text || ''}`),
    lics: licensesOf(`${remark} ${li.certificateNum || ''} ${j?.landOfficeInfo?.landoffice_certificate_number || ''}`),
    tels: telsOf(`${remark} ${li.mobile || ''} ${j?.ware?.phone || ''}`)
  };
  for (const k of Object.keys(info)) if (!info[k] || (Array.isArray(info[k]) && !info[k].length)) delete info[k];
  return Object.keys(info).length ? info : 0;
}

// 分店名正規化：去品牌、去「台中」、去「加盟店／直營店／店」→「漢口山西」「14期崇德敦和」
const normShop = s => String(s || '').replace(/\s/g, '').replace(/^(永慶不動產|永慶房屋|永義房屋|永慶)[-－]?/, '')
  .replace(/^(台中|臺中)(?=.{3,})/, '').replace(/(加盟店|直營店|店)$/, '');
const brandKey = s => (String(s || '').match(/永慶|永義|有巢氏|台慶|信義|住商|東森|中信|21世紀|太平洋|大家/) || [''])[0];

// 店家清單 → 比對索引
function buildIndex(stores) {
  const idx = { tel: new Map(), company: [], license: new Map(), shop: new Map() };
  for (const st of stores || []) {
    const key = st.phone;
    for (const t of [st.phone, ...(st.phones || [])].map(digits).filter(Boolean)) idx.tel.set(t, key);
    if (st.company) idx.company.push([st.company.replace(/\s/g, ''), key]);
    for (const l of [].concat(st.license || [])) idx.license.set(normLicense(l), key);
    if (brandKey(st.brand) && normShop(st.name)) idx.shop.set(`${brandKey(st.brand)}|${normShop(st.name)}`, key);
  }
  return idx;
}

// 一筆 591 經紀業資訊 → 命中的店家（店家電話當 key）＋依據；沒有 → null
function match(info, idx) {
  if (!info) return null;
  const hit = (store, by) => ({ store, by });
  if (info.co && info.shop) {
    const k = idx.shop.get(`${brandKey(info.co)}|${normShop(info.shop)}`);
    if (k) return hit(k, `591 分店：${info.co} ${info.shop}`);
  }
  for (const n of info.names || []) for (const [co, k] of idx.company) if (n.includes(co)) return hit(k, `經紀業：${co}`);
  for (const l of info.lics || []) { const k = idx.license.get(l); if (k) return hit(k, `經紀業證號 ${l}`); }
  for (const t of info.tels || []) { const k = idx.tel.get(t); if (k) return hit(k, `店家電話 ${t}`); }
  return null;
}

// 用分店／公司名／電話認出的刊登，內文裡的證號（經紀業證號、經紀人證、營業員證）也算那家店 → 加進索引
//   只看到證號、沒寫店名的刊登也抓得到；回傳新學到幾個
function learnLicenses(infos, idx) {
  let n = 0;
  for (const info of infos) {
    const m = match(info, idx);
    if (!m || /證號/.test(m.by)) continue;
    // 沒年度又只有幾位數的（「經紀1023」）各縣市會重號 → 不學，免得撞到別家
    for (const l of info.lics || []) {
      if (!/^\d/.test(l) && l.replace(/\D/g, '').length < 7) continue;
      if (!idx.license.has(l)) { idx.license.set(l, m.store); n++; }
    }
  }
  return n;
}

module.exports = { extract, buildIndex, match, learnLicenses, licensesOf, normShop };

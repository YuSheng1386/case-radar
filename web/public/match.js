// 客需配對引擎（瀏覽器端跑，對整個案件池）
// 客需欄位來自 ALL HOUSE「買房需求諮詢單／客戶配對單」＋舊系統 matcher.js 的規則：
//   區域 include/exclude、價格帶、建商黑名單（集團展開）、建案級 vs 戶級排除、樓層區間、排掉已推送
// 學習：客人在分享頁按的喜歡／不喜歡（＋原因）回饋到排序與建議

const Match = (() => {
  const BUILDER_GROUPS = {
    寶佳集團: ['寶佳', '合康', '合遠', '合陽', '合磬', '合悅', '合雄', '合宜', '合美', '合多利', '合誠', '合勝', '合家歡',
      '磐興', '磐鈺', '宏盛', '永信', '櫻花', '全陽', '力璽', '翰林', '宜誠', '和築', '力鵬', '明陞', '瑞晟', '丞陽', '橋椿', '合馥', '福地'],
    興富發集團: ['興富發', '潤泰新', '家興', '家瑞']
  };
  const DISLIKE_REASONS = ['價格太高', '區域', '屋齡', '樓層', '格局/坪數', '社區/建案不喜歡', '照片沒感覺', '其他'];
  const TYPES = ['大樓', '華廈', '公寓', '透天', '店面'];

  const expand = list => [...new Set((list || []).flatMap(b => BUILDER_GROUPS[b] || [b]))].filter(Boolean);

  function typeOf(t) {
    t = t || '';
    if (/店面|店鋪/.test(t)) return '店面';
    if (/透天|別墅|店墅/.test(t)) return '透天';
    if (/華廈/.test(t)) return '華廈';
    if (/公寓/.test(t)) return '公寓';
    if (/大樓|電梯/.test(t)) return '大樓';
    return '';
  }
  function layout(ly) {
    const g = re => { const m = String(ly || '').match(re); return m ? parseInt(m[1], 10) : null; };
    return { rooms: g(/(\d+)\s*房/), halls: g(/(\d+)\s*廳/), baths: g(/(\d+)\s*衛/) };
  }
  function floorOf(f) {
    if (f == null || f === '') return null;
    if (typeof f === 'number') return f;
    const s = String(f);
    if (/[~～\-]/.test(s.split('/')[0])) return null;
    const m = s.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }
  const ageOf = a => { const v = parseFloat(a); return isFinite(v) ? v : null; };
  const road = a => { const m = String(a || '').replace(/^.{2,3}[市縣]/, '').replace(/^.{1,4}?[區鄉鎮市]/, '').match(/^(.+?(?:大道|路|街)(?:.{1,2}段)?)/); return m ? m[1] : ''; };
  const norm = s => String(s || '').replace(/\s+/g, '');

  // history: client_items 陣列 [{item_id, status, reasons, snapshot}]
  function digest(history) {
    const seen = new Set(), likedComm = {}, likedRoad = {}, likedDist = {}, dislikedComm = new Set(), likedPrices = [], reasons = {};
    for (const h of history || []) {
      seen.add(h.item_id);
      let s = {}; try { s = typeof h.snapshot === 'string' ? JSON.parse(h.snapshot) : (h.snapshot || {}); } catch {}
      const rs = String(h.reasons || '').split(',').filter(Boolean);
      if (['liked', 'visit_req', 'booked', 'visited', 'offer'].includes(h.status)) {
        if (s.c) likedComm[s.c] = (likedComm[s.c] || 0) + 1;
        const r = road(s.a); if (r) likedRoad[r] = (likedRoad[r] || 0) + 1;
        if (s.d) likedDist[s.d] = (likedDist[s.d] || 0) + 1;
        if (s.p) likedPrices.push(s.p);
      }
      if (h.status === 'disliked') {
        rs.forEach(x => reasons[x] = (reasons[x] || 0) + 1);
        if (rs.includes('社區/建案不喜歡') && s.c) dislikedComm.add(norm(s.c));   // 建案級排除
      }
    }
    likedPrices.sort((a, b) => a - b);
    return { seen, likedComm, likedRoad, likedDist, dislikedComm, reasons,
      likedMid: likedPrices.length ? likedPrices[Math.floor(likedPrices.length / 2)] : null, nLiked: likedPrices.length };
  }

  // 回傳 { items: [{...it, ms, why}], out: {原因: 筆數} }
  function run(pool, prefs, history, { includeSeen = false } = {}) {
    const P = prefs || {};
    const H = digest(history);
    const exKw = expand(P.excludeKeywords).map(norm);
    const nearKw = (P.nearKeywords || []).map(norm).filter(Boolean);
    const anchorComm = norm(P.anchorCommunity);
    const out = {}; const bump = k => out[k] = (out[k] || 0) + 1;
    const res = [];
    for (const it of pool) {
      if (!includeSeen && H.seen.has(it.id)) { bump('已推送過'); continue; }
      if (P.districts?.length && !P.districts.includes(it.d)) { bump('區域'); continue; }
      if (P.districtsExclude?.includes(it.d)) { bump('排除區域'); continue; }
      const ty = typeOf(it.ty);
      if (P.types?.length && !P.types.includes(ty)) { bump('型態'); continue; }
      if (P.priceMin && it.p && it.p < P.priceMin) { bump('價格'); continue; }
      if (P.priceMax && it.p && it.p > P.priceMax * 1.05) { bump('價格'); continue; }   // 超過 5% 內保留（可議價）
      if (P.areaMin && it.ar && it.ar < P.areaMin) { bump('坪數'); continue; }
      if (P.areaMax && it.ar && it.ar > P.areaMax) { bump('坪數'); continue; }
      const L = layout(it.ly);
      if (P.roomsMin && L.rooms != null && L.rooms < P.roomsMin) { bump('房數'); continue; }
      if (P.bathsMin && L.baths != null && L.baths < P.bathsMin) { bump('衛浴'); continue; }
      const age = ageOf(it.ag);
      if (P.ageMax != null && P.ageMax !== '' && age != null && age > +P.ageMax) { bump('屋齡'); continue; }
      if (P.kinds?.length && age != null) {
        const k = age <= 3 ? '新成屋' : '中古屋';
        if (!P.kinds.includes(k)) { bump('新成屋/中古'); continue; }
      }
      const fl = floorOf(it.fl);
      if (fl != null && ((P.floorMin && fl < P.floorMin) || (P.floorMax && fl > P.floorMax))) { bump('樓層'); continue; }
      if (fl != null && (P.floorAvoid || []).map(Number).includes(fl)) { bump('不要的樓層'); continue; }
      if (P.parking === 'need' && it.pk === 0) { bump('車位'); continue; }
      const text = norm(`${it.c} ${it.t} ${it.a}`);
      if (exKw.length && exKw.some(k => k && text.includes(k))) { bump('排除建商/建案'); continue; }
      if (it.c && H.dislikedComm.has(norm(it.c))) { bump('客人不喜歡的社區'); continue; }
      if (P.excludeSameSystem && it.same) { bump('同體系物件'); continue; }

      // ---- 排序分數 ----
      let ms = 0; const why = [];
      const add = (v, w) => { if (v) { ms += v; why.push(w); } };
      add(Math.min(30, Math.round((it.sc || 0) * 0.4)), `競爭力${it.sc}`);
      if (it.cm != null && it.cm < 0) add(10, `開價低於同社區實登${it.cm}%`);
      if (P.priceMax && it.p) {
        const mid = ((+P.priceMin || P.priceMax * 0.7) + +P.priceMax) / 2;
        add(Math.max(0, 10 - Math.round(Math.abs(it.p - mid) / mid * 40)), '價格貼近預算');
        if (it.p > P.priceMax) add(-8, '略超預算');
      }
      if (nearKw.some(k => text.includes(k))) add(15, '靠近指定地段');
      if (anchorComm && norm(it.c) === anchorComm) add(20, '跟客人最喜歡的同社區');
      if (it.c && H.likedComm[it.c]) add(20, `客人喜歡過同社區(${H.likedComm[it.c]})`);
      else if (H.likedRoad[road(it.a)]) add(8, '客人喜歡過同路段');
      if (H.likedDist[it.d]) add(Math.min(6, H.likedDist[it.d] * 2), '客人偏好的區');
      if (H.likedMid && it.p && Math.abs(it.p - H.likedMid) / H.likedMid <= 0.1) add(8, '跟喜歡的案價位相近');
      if ((H.reasons['價格太高'] || 0) >= 2 && P.priceMax && it.p > P.priceMax * 0.9) add(-10, '客人嫌貴過→偏預算上緣扣分');
      if (fl == null && (P.floorMin || P.floorMax)) add(-3, '樓層不明');
      if (it.same) why.push('同體系物件');
      if (it.own === 2) why.push('屋主自售');
      res.push({ ...it, ms, why });
    }
    res.sort((a, b) => b.ms - a.ms);
    return { items: res, out, H };
  }

  // 「系統學到的」：給仲介看的建議（不自動改客需，由人確認）
  function learn(history, prefs) {
    const H = digest(history);
    const tips = [];
    const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (H.nLiked) tips.push(`喜歡 ${H.nLiked} 件，價位中位 <b>${H.likedMid} 萬</b>`);
    const lc = top(H.likedComm); if (lc.length) tips.push(`喜歡的社區：${lc.map(([k, v]) => `<b>${k}</b>(${v})`).join('、')}`);
    const ld = top(H.likedDist); if (ld.length) tips.push(`喜歡的區：${ld.map(([k, v]) => `${k}(${v})`).join('、')}`);
    const rs = top(H.reasons); if (rs.length) tips.push(`不喜歡的原因：${rs.map(([k, v]) => `<b>${k}</b>×${v}`).join('、')}`);
    if (H.dislikedComm.size) tips.push(`已整個排除的社區：${[...H.dislikedComm].join('、')}`);
    if ((H.reasons['價格太高'] || 0) >= 2 && H.likedMid && prefs?.priceMax > H.likedMid * 1.1)
      tips.push(`建議：預算上限可考慮調到 <b>${Math.round(H.likedMid * 1.1)} 萬</b>（嫌貴 ${H.reasons['價格太高']} 次）`);
    if ((H.reasons['樓層'] || 0) >= 2) tips.push('建議：樓層被嫌過 2 次以上，確認一下「喜好樓層／不要樓層」');
    if ((H.reasons['屋齡'] || 0) >= 2) tips.push('建議：屋齡被嫌過 2 次以上，考慮把「屋齡上限」調低');
    return tips;
  }

  // 給客人看的內容（不含內部分數、同體系、來源仲介）
  function snapshot(it) {
    return { id: it.id, t: it.t, d: it.d, a: it.a, c: it.c, p: it.p, up: it.up, ar: it.ar, fl: it.fl, ag: it.ag, ly: it.ly, ty: it.ty, ph: it.ph };
  }

  return { run, learn, snapshot, typeOf, layout, DISLIKE_REASONS, TYPES, BUILDER_GROUPS };
})();

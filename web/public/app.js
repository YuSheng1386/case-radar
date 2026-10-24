// 案件雷達網站前端：登入、開發系統、客戶（客需配對＋分享）、帶看、帳號
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = iso => { if (!iso) return '—'; const t = Date.parse(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const m = (Date.now() - t) / 6e4; return m < 60 ? `${Math.max(1, Math.round(m))} 分鐘前` : m < 1440 ? `${Math.round(m / 60)} 小時前` : `${Math.round(m / 1440)} 天前`; };
const sign = v => `${v > 0 ? '+' : ''}${v}%`;
const LS = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2200); }

async function api(path, opt = {}) {
  const r = await fetch(path, { ...opt, headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) },
    body: opt.body && typeof opt.body !== 'string' ? JSON.stringify(opt.body) : opt.body });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/api/login') { boot(); throw new Error('請先登入'); }
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const TAICHUNG = ['中區', '東區', '南區', '西區', '北區', '北屯區', '西屯區', '南屯區', '太平區', '大里區', '霧峰區', '烏日區', '豐原區', '后里區',
  '石岡區', '東勢區', '新社區', '潭子區', '大雅區', '神岡區', '大肚區', '沙鹿區', '龍井區', '梧棲區', '清水區', '大甲區', '外埔區', '大安區', '和平區'];
const DEV_ST = ['未聯絡', '已聯絡', '約見面', '簽委託', '放棄'];
const CI_ST = { sent: '已推送', liked: '喜歡', disliked: '不喜歡', visit_req: '想去看', booked: '已約帶看', visited: '已帶看', offer: '出價斡旋', dropped: '放棄' };

let ME = null;
const cache = {};
async function blob(name) {
  if (!cache[name]) cache[name] = fetch(`/api/blob/${name}`).then(async r => {
    if (r.status === 401) { boot(); throw new Error('請先登入'); }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '讀取失敗');
    return { at: r.headers.get('X-Updated-At'), ...(await r.json()) };
  });
  return cache[name];
}

// ================= 登入 / 第一次設定 =================
async function boot() {
  try { ME = await (await fetch('/api/me')).json(); if (!ME.id) throw 0; }
  catch {
    ME = null;
    const s = await fetch('/api/setup').then(r => r.json()).catch(() => ({}));
    return s.needed ? showSetup() : showLogin();
  }
  renderShell();
  route();
}

function showLogin() {
  $('#root').innerHTML = `<div class="login"><h1>案件雷達</h1>
    <form id="f"><input name="username" placeholder="帳號" autocomplete="username" required>
    <input name="password" type="password" placeholder="密碼" autocomplete="current-password" required>
    <div class="err" id="e"></div><button class="pri">登入</button></form></div>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api('/api/login', { method: 'POST', body: Object.fromEntries(f) }); boot(); }
    catch (x) { $('#e').textContent = x.message; }
  };
}

function showSetup() {
  $('#root').innerHTML = `<div class="login"><h1>第一次設定</h1><p class="meta">建立管理者帳號（只能做一次）。設定碼在電腦上的 web/.setup-code.txt。</p>
    <form id="f"><input name="code" placeholder="設定碼" required><input name="username" placeholder="帳號（登入用）" required>
    <input name="name" placeholder="名字（顯示用）" required><input name="password" type="password" placeholder="密碼（至少 8 碼）" minlength="8" required>
    <div class="err" id="e"></div><button class="pri">建立</button></form></div>`;
  $('#f').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/setup', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('建立完成，請登入'); showLogin(); }
    catch (x) { $('#e').textContent = x.message; }
  };
}

function renderShell() {
  const tabs = [['dev', '開發'], ['clients', '客戶配對'], ['visits', '帶看'], ...(ME.role === 'admin' ? [['users', '帳號']] : []), ['me', '我']];
  $('#root').innerHTML = `<header class="top"><h1>案件雷達</h1><nav class="tabs">${tabs.map(([k, v]) => `<a href="#${k}" data-k="${k}">${v}</a>`).join('')}</nav>
    <span class="who-am-i">${esc(ME.name)}</span></header><main id="main"></main>`;
}

window.addEventListener('hashchange', () => ME && route());
function route() {
  const h = location.hash.slice(1) || 'dev';
  const [k, arg] = h.split('/');
  document.querySelectorAll('nav.tabs a').forEach(a => a.classList.toggle('on', a.dataset.k === (k === 'client' ? 'clients' : k)));
  const views = { dev: viewDev, case: viewCase, clients: viewClients, client: viewClient, visits: viewVisits, users: viewUsers, me: viewMe };
  const main = $('#main'); main.onclick = main.onchange = null; window._redrawMatch = null; // 換頁時清掉上一頁的事件
  (views[k] || viewDev)(arg).catch(e => { $('#main').innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
}

// ================= 共用：案件卡 =================
function srcLinks(c) {
  const p = c.posters || { total: c.sources.length, agents: 0, owner: false };
  const who = p.owner && p.agents === 0 ? '<span class="who own">只有屋主自己在賣</span>'
    : `<span class="who${p.agents >= 5 ? ' many' : ''}">${p.owner ? '屋主＋' : ''}${p.agents} 位仲介在刊</span>`;
  const link = s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.s)} ${s.price ?? ''}${s.agent ? '・' + esc(s.agent.replace(/^仲介/, '')) : ''}${s.gone != null ? `（已下架${s.gone}天）` : ''}</a>`;
  const gone = c.ownerGone != null ? `<span class="who many">屋主刊登已下架 ${c.ownerGone} 天，可能只是廣告到期</span>` : '';
  const ss = c.sources.slice().sort((a, b) => (a.price || 1e9) - (b.price || 1e9));
  const more = ss.length > 4 ? `<details class="more"><summary>其他 ${ss.length - 4} 筆</summary>${ss.slice(4).map(link).join(' ')}</details>` : '';
  return gone + who + ss.slice(0, 4).map(link).join('') + more;
}

function mkLine(c) {
  return peerLine(c) + bargainLine(c) + mkLine0(c);
}
// 嚴格版：1.5 km 內同等級社區（單價差 10% 內）同房數、坪數相近的近 2 年成交
const peerLine = c => c.peer ? `<div class="mk">同等級社區（${c.peer.comms} 個社區 ${c.peer.n} 筆，1.5 km 內、近 2 年、同房數）成交中位 ${c.peer.med} 萬/坪 → <b class="${c.peer.diff < 0 ? 'lo' : 'hi'}">${sign(c.peer.diff)}</b>${c.peer.diff < 0 ? ' <b class="lo">同等級比較仍低</b>' : ''}</div>` : '';
// 成交回填：雷達追蹤到下架、之後在實登找到成交的「最後開價 vs 成交價」
const bargainLine = c => c.bargain ? `<div class="mk">本社區議價空間：開價→成交 中位 <b>${c.bargain.med}%</b>（${c.bargain.n} 筆實際成交）</div>` : '';
function mkLine0(c) {
  if (c.comm) return `<div class="mk">開價 ${c.unitPrice} 萬/坪 vs <a href="${esc(c.comm.url)}" target="_blank" rel="noopener">同社區</a>近3年成交中位 ${c.comm.med}（${c.comm.n} 筆，最低 ${c.comm.min}）→ <b class="${c.comm.diff < 0 ? 'lo' : 'hi'}">${sign(c.comm.diff)}</b>${c.comm.belowMin ? ' <b class="lo">低於最低成交</b>' : ''}</div>`;
  if (c.market) return `<div class="mk">實登${c.market.level === 'similar' ? '相近物件' : '同區'}中位 ${c.market.median} 萬/坪（${c.market.n} 筆），本案 ${c.unitPrice ?? '—'} → <b class="${c.market.diff < 0 ? 'lo' : 'hi'}">${sign(c.market.diff)}</b> <span class="meta">（實登已扣車位，僅供參考）</span></div>`;
  return '';
}

const metaLine = c => `${esc(c.district)}｜${esc(c.community || c.address)}｜${c.area ?? '—'} 坪｜${esc(c.floor || '—')}｜${c.age != null && c.age !== '' ? esc(c.age) + (String(c.age).includes('年') ? '' : ' 年') : '屋齡—'}｜${esc(c.layout || c.type || '')}`;

// ================= 開發系統 =================
const DEV = { tag: '全部', scope: '', dist: '', sort: 'score', st: '', q: '', pmin: '', pmax: '', ownerOnly: false };
async function viewDev() {
  $('#main').innerHTML = '<div class="empty">載入案件…</div>';
  const [data, devRows, ovRows] = await Promise.all([blob('cards'), api('/api/dev'), api('/api/same-override')]);
  const dev = Object.fromEntries(devRows.map(r => [r.item_id, r]));
  const ov = Object.fromEntries(ovRows.map(r => [r.item_id, r]));
  const TAGS = ['全部', '新上架', '同等級仍低', '低於實登', '賠售', '標低於行情', '急售', '超值', '自售', '降價'];
  const cnt = {}; data.cards.forEach(c => c.district && (cnt[c.district] = (cnt[c.district] || 0) + 1));
  const dists = [...(data.districts || []).filter(d => cnt[d]), ...Object.keys(cnt).filter(d => !(data.districts || []).includes(d)).sort((a, b) => cnt[b] - cnt[a])];

  $('#main').innerHTML = `
    <div class="chips" id="tags">${TAGS.map(t => `<span class="chip${t === DEV.tag ? ' on' : ''}" data-t="${t}">${t}</span>`).join('')}</div>
    <div class="bar">
      <select id="scope"><option value="">全台中</option><option value="main">主力區</option><option value="wide">主力區以外</option></select>
      <select id="dist"><option value="">全部區域</option>${dists.map(d => `<option value="${esc(d)}">${esc(d)}（${cnt[d]}）</option>`).join('')}</select>
      <select id="sort"><option value="score">依分數</option><option value="new">依上架</option><option value="drop">依降幅</option><option value="mk">依低於實登</option></select>
      <select id="st"><option value="">全部進度</option><option value="none">還沒人跟</option>${DEV_ST.map(s => `<option>${s}</option>`).join('')}</select>
      <input id="pmin" type="number" placeholder="總價下限" style="width:90px"><input id="pmax" type="number" placeholder="總價上限" style="width:90px">
      <label><input type="checkbox" id="own"> 只看屋主自售</label>
      <input id="q" type="search" placeholder="社區／路名／標題" style="flex:1;min-width:120px">
    </div>
    <div class="stat" id="stat"></div><div id="due"></div><div id="list"></div>`;
  drawDue();
  // 今天（含過期）要聯絡的：簽委託／放棄的不列
  function drawDue() {
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const due = Object.values(dev).filter(d => d.next_contact && d.next_contact <= today && !['簽委託', '放棄'].includes(d.status))
      .sort((a, b) => a.next_contact.localeCompare(b.next_contact));
    $('#due').innerHTML = due.length ? `<div class="panel"><h2>今天要聯絡（${due.length}）</h2>${due.map(d => {
      const c = data.cards.find(x => x.id === d.item_id); let s = {}; try { s = JSON.parse(d.snapshot || '{}'); } catch {}
      return `<div class="meta"><b>${esc(c?.title || s.community || s.title || s.address || d.item_id)}</b>｜${c?.price ?? s.price ?? '—'} 萬｜${esc(d.status)}｜${d.next_contact < today ? `<b class="hi">逾期 ${esc(d.next_contact)}</b>` : '今天'}｜${esc(d.by_name)}${d.note ? '｜' + esc(d.note) : ''}${c ? '' : '（已不在清單，可能下架）'}</div>`;
    }).join('')}</div>` : '';
  }
  for (const k of ['scope', 'dist', 'sort', 'st', 'q', 'pmin', 'pmax']) { $('#' + k).value = DEV[k]; $('#' + k).oninput = () => { DEV[k] = $('#' + k).value; draw(); }; }
  $('#own').checked = DEV.ownerOnly; $('#own').onchange = () => { DEV.ownerOnly = $('#own').checked; draw(); };
  $('#tags').onclick = e => { const t = e.target.dataset.t; if (!t) return; DEV.tag = t; [...$('#tags').children].forEach(x => x.classList.toggle('on', x.dataset.t === t)); draw(); };

  function draw() {
    let cs = data.cards.filter(c =>
      (!DEV.dist || c.district === DEV.dist) && (!DEV.scope || (DEV.scope === 'wide') === !!c.wide) &&
      (DEV.tag === '全部' || (DEV.tag === '新上架' ? c.isNew : c.tags.includes(DEV.tag))) &&
      (!DEV.q || [c.title, c.community, c.address].join(' ').includes(DEV.q)) &&
      (!DEV.pmin || c.price >= +DEV.pmin) && (!DEV.pmax || c.price <= +DEV.pmax) &&
      (!DEV.ownerOnly || (c.posters && c.posters.owner)) &&
      (!DEV.st || (DEV.st === 'none' ? !dev[c.id] : dev[c.id]?.status === DEV.st)));
    const key = { score: c => -c.score, new: c => -Date.parse(c.firstSeen), drop: c => -c.drop, mk: c => c.peer ? c.peer.diff - 100 : c.comm ? c.comm.diff : c.market ? c.market.diff + 100 : 999 }[DEV.sort];
    cs.sort((a, b) => key(a) - key(b));
    $('#stat').textContent = `顯示 ${cs.length} 筆｜可開發 ${data.totals.hot}｜同體系已有、排除 ${data.totals.blocked}｜追蹤 ${data.totals.groups} 案｜資料更新 ${ago(data.generatedAt)}`;
    $('#list').innerHTML = (cs.length ? cs.slice(0, 200).map(c => devCard(c, dev[c.id])).join('') : '<div class="empty">沒有符合的案件</div>')
      + (cs.length > 200 ? `<div class="empty">只顯示前 200 筆，請用篩選縮小範圍</div>` : '') + blockedList(data, ov);
  }
  $('#list').onchange = async e => {
    const row = e.target.closest('.devrow'); if (!row || !(e.target.tagName === 'SELECT' || e.target.type === 'date')) return;
    await saveDev(row, data, dev); drawDue();
  };
  // 同體系「比對錯了」／復原
  $('#list').onclick = async e => {
    const btn = e.target.closest('[data-ov]'); if (!btn) return;
    const id = btn.dataset.ov; const b = (data.blocked || []).find(x => x.id === id);
    try {
      if (ov[id]) { await api(`/api/same-override/${id}`, { method: 'DELETE' }); delete ov[id]; toast('已復原：維持同體系排除'); }
      else {
        const note = prompt('哪裡不一樣？（例：樓層不同、不同戶）', ''); if (note == null) return;
        await api(`/api/same-override/${id}`, { method: 'PUT', body: { note, snapshot: { title: b?.title, address: b?.address, price: b?.price } } });
        ov[id] = { note, by_name: ME.name }; toast('已標比對錯，雷達下次更新後改回可開發');
      }
      draw();
    } catch (x) { toast(x.message); }
  };
  $('#list').onkeydown = async e => { if (e.key === 'Enter' && e.target.closest('.devrow')) await saveDev(e.target.closest('.devrow'), data, dev); };
  draw();
}

// 單一案件（#case/<id>）：LINE 推播／查詢時各平台刊登都打不開，改連到這裡看案件資料（用戶 10/24：優質案件不能因此漏掉）
async function viewCase(id) {
  $('#main').innerHTML = '<div class="empty">載入案件…</div>';
  const [data, pool, devRows] = await Promise.all([blob('cards'), blob('pool'), api('/api/dev')]);
  const dev = Object.fromEntries(devRows.map(r => [r.item_id, r]));
  const note = '<div class="empty">⚠️ 這件的平台刊登可能已下架（或連結失效），以下是雷達最後抓到的資料；可以到 591 搜尋社區名或地址確認是否還在賣</div>';
  const c = data.cards.find(x => x.id === id) || (data.blocked || []).find(x => x.id === id);
  if (c && c.sources) {
    $('#main').innerHTML = note + `<div id="list">${devCard(c, dev[c.id])}</div>`;
    $('#list').onchange = async e => { const row = e.target.closest('.devrow'); if (row && (e.target.tagName === 'SELECT' || e.target.type === 'date')) await saveDev(row, data, dev); };
    return;
  }
  const it = pool.items.find(x => x.id === id);
  if (!it) { $('#main').innerHTML = '<div class="empty">找不到這件（可能已經從雷達移除）</div>'; return; }
  $('#main').innerHTML = note + `<div class="card"><img loading="lazy" src="${esc(it.ph)}" alt="" onerror="this.style.visibility='hidden'"><div>
    <div class="ttl">${esc(it.c || it.t || it.a)}</div><div class="meta">${esc(it.t || '')}</div>
    <div class="price">${it.p ?? '—'} 萬 <span class="meta">${it.up ? it.up + ' 萬/坪' : ''}</span></div>
    <div class="meta">${esc(it.d)}｜${esc(it.a)}｜${it.ar ?? '—'} 坪｜${esc(it.fl || '—')}｜${it.ag != null && it.ag !== '' ? esc(it.ag) + ' 年' : '屋齡—'}｜${esc(it.ly || it.ty || '')}</div>
    <div class="why">${(it.us || [it.u]).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">刊登連結</a>`).join('｜')}｜${esc((it.s || []).join('、'))}</div>
  </div></div>`;
}

async function saveDev(row, data, dev) {
  const id = row.dataset.id; const c = data.cards.find(x => x.id === id);
  const status = row.querySelector('select').value || '未聯絡'; const note = row.querySelector('[data-note]').value;
  const next_contact = row.querySelector('[data-next]').value;
  try {
    const snapshot = { title: c.title, address: c.address, price: c.price, community: c.community };
    await api(`/api/dev/${id}`, { method: 'PUT', body: { status, note, next_contact, snapshot } });
    dev[id] = { ...(dev[id] || {}), item_id: id, status, note, next_contact, snapshot: JSON.stringify(snapshot), by_name: ME.name, updated_at: new Date().toISOString() };
    row.querySelector('.by').textContent = `${ME.name}・剛剛`;
    toast('已更新開發進度');
  } catch (e) { toast(e.message); }
}

function devCard(c, d) {
  const tags = (c.isNew ? ['新'] : []).concat(c.tags);
  const hi = Math.max(...c.sources.flatMap(s => (s.hist || []).map(h => h[1])), c.price || 0);
  return `<div class="card"><img loading="lazy" src="${esc(c.photo)}" alt="" onerror="this.style.visibility='hidden'"><div>
    <div class="top-row"><div class="ttl">${esc(c.title || c.community || c.address)}</div><div class="score">${c.score}</div></div>
    <div class="tags">${tags.map(t => `<span class="tag t-${t}">${t}</span>`).join('')}</div>
    <div class="price">${c.price ?? '—'} 萬${hi > c.price ? `<s>${hi} 萬</s>` : ''} <span class="meta">${c.drop ? `降 ${c.drop}%` : ''}</span></div>
    <div class="meta">${metaLine(c)}</div>${mkLine(c)}
    <div class="srcs">${srcLinks(c)}</div>
    <div class="why">首次看到 ${ago(c.firstSeen)}｜${esc(c.why.join('、'))}</div>
    <div class="devrow" data-id="${esc(c.id)}">開發：<select class="st-${esc(d?.status || '')}">${['', ...DEV_ST].map(s => `<option ${d?.status === s ? 'selected' : ''} value="${s}">${s || '—'}</option>`).join('')}</select>
      <input data-note placeholder="備註（Enter 存）" value="${esc(d?.note || '')}">
      <label class="meta">下次聯絡 <input data-next type="date" value="${esc(d?.next_contact || '')}"></label><span class="meta by">${d ? `${esc(d.by_name)}・${ago(d.updated_at)}` : ''}</span></div>
  </div></div>`;
}

function blockedList(data, ov = {}) {
  const bs = data.blocked || [];
  if (!bs.length) return '';
  const open = document.querySelector('.blkbox')?.open ? ' open' : '';
  return `<details class="blkbox"${open}><summary>同體系已有・不可開發（${bs.length}）— 點開抽查比對對不對</summary>${bs.slice(0, 300).map(b => `<div class="blkrow"><b>${esc(b.title || b.community || b.address)}</b>
    <span class="meta">${esc(b.district)}｜${b.price ?? '—'} 萬｜${b.area ?? '—'} 坪｜${esc(b.floor || '—')}｜${b.storeCount} 店｜可信度 ${b.level}</span>
    <a href="${esc(b.url)}" target="_blank" rel="noopener">刊登</a> <a href="${esc(b.ycUrl)}" target="_blank" rel="noopener">永慶</a>
    ${ov[b.id] ? `<span class="pill">已標比對錯（${esc(ov[b.id].by_name || '')}${ov[b.id].note ? '：' + esc(ov[b.id].note) : ''}），下次更新改回可開發</span> <button class="sm" data-ov="${esc(b.id)}">復原</button>`
      : `<button class="sm" data-ov="${esc(b.id)}">比對錯了</button>`}</div>`).join('')}</details>`;
}

// ================= 客戶列表 =================
async function viewClients() {
  const list = await api('/api/clients');
  $('#main').innerHTML = `<div class="row-btns" style="margin:0 0 12px"><button class="pri" id="add">＋ 新增客戶</button></div>
    ${list.length ? `<div class="panel"><table><tr><th>客戶</th><th>需求摘要</th>${ME.role === 'admin' ? '<th>負責</th>' : ''}<th>更新</th></tr>
    ${list.map(c => { const p = JSON.parse(c.prefs || '{}'); return `<tr><td><a href="#client/${c.id}"><b>${esc(c.name)}</b></a>${c.new_count ? ` <span class="pill newm">${c.new_count} 件新配對</span>` : ''}</td>
      <td class="meta">${esc([(p.districts || []).join('、'), p.priceMax ? `${p.priceMin || 0}–${p.priceMax} 萬` : '', (p.types || []).join('/'), p.roomsMin ? `${p.roomsMin}房以上` : ''].filter(Boolean).join('｜'))}</td>
      ${ME.role === 'admin' ? `<td class="meta">${esc(c.owner_name)}</td>` : ''}<td class="meta">${ago(c.updated_at)}</td></tr>`; }).join('')}</table></div>`
    : '<div class="empty">還沒有客戶，按「新增客戶」把客需填進來</div>'}`;
  $('#add').onclick = async () => {
    const name = prompt('客戶名稱（例：王小姐）'); if (!name) return;
    const r = await api('/api/clients', { method: 'POST', body: { name, prefs: { districts: [], types: ['大樓'] } } });
    location.hash = `client/${r.id}`;
  };
}

// ================= 單一客戶：客需、配對、分享、反應 =================
async function viewClient(id) {
  $('#main').innerHTML = '<div class="empty">載入中…</div>';
  const [list, items, shares, pool, alerts] = await Promise.all([api('/api/clients'), api(`/api/clients/${id}/items`), api(`/api/clients/${id}/shares`), blob('pool'), api(`/api/clients/${id}/alerts`)]);
  const c = list.find(x => String(x.id) === String(id)); if (!c) throw new Error('找不到客戶');
  const prefs = JSON.parse(c.prefs || '{}');
  // 新配對（雲端排程算的）：這次打開就標已看，畫面上仍標「新」直到離開
  const S = { sel: new Set(), showSeen: false, limit: 30, fresh: new Set(alerts.map(a => a.item_id)) };
  if (alerts.length) api(`/api/clients/${id}/alerts/seen`, { method: 'POST' }).catch(() => {});

  $('#main').innerHTML = `
    <div class="bar"><a href="#clients">← 客戶列表</a><b style="font-size:17px;margin-left:6px">${esc(c.name)}</b><span class="meta">${esc(c.contact || '')}</span></div>
    <details class="panel" id="prefsBox" ${Object.keys(prefs).length <= 2 ? 'open' : ''}><summary><b>客需（買房需求諮詢單）</b> <span class="meta">點開編輯</span></summary>${prefsForm(c, prefs)}</details>
    <div class="panel"><h2>系統學到的</h2><div class="learn" id="learn"></div></div>
    <div class="panel"><h2>客人的反應與進度（${items.length}）</h2><div id="hist"></div></div>
    <div class="panel"><h2>配對結果</h2><div class="bar"><label><input type="checkbox" id="seen"> 包含已推送過的</label>
      <span class="meta" id="mstat"></span></div><div class="meta" id="mout"></div>
      <div class="row-btns"><button class="pri" id="share" disabled>產生分享連結（已選 0）</button></div>
      <div id="shareOut"></div><div id="mlist" style="margin-top:10px"></div></div>
    <div class="panel"><h2>分享過的連結（${shares.length}）</h2>${shares.map(s => `<div class="meta">${esc(s.title || '（無標題）')}・${JSON.parse(s.item_ids).length} 件・${ago(s.created_at)}・到期 ${esc(s.expires_at.slice(0, 10))}
      <a href="/s/${s.token}" target="_blank">開啟</a> <button class="sm" data-copy="/s/${s.token}">複製連結</button></div>`).join('') || '<div class="meta">還沒有</div>'}</div>`;

  bindPrefs(c, prefs);
  $('#learn').innerHTML = Match.learn(items, prefs).map(t => `<div>• ${t}</div>`).join('') || '<span class="meta">還沒有客人的反應。分享連結給客人按「喜歡／不喜歡」後，這裡會整理出偏好。</span>';
  drawHist();
  $('#seen').onchange = () => { S.showSeen = $('#seen').checked; drawMatch(); };
  $('#main').onclick = e => {
    const cp = e.target.dataset.copy;
    if (cp) navigator.clipboard.writeText(location.origin + cp).then(() => toast('已複製連結'), () => prompt('複製這個連結', location.origin + cp));
  };

  function drawHist() {
    $('#hist').innerHTML = items.length ? `<table>${items.map(h => { const s = JSON.parse(h.snapshot || '{}'); return `<tr data-item="${esc(h.item_id)}">
      <td><b>${esc(s.c || s.t || s.a || h.item_id)}</b><div class="meta">${esc(s.d || '')}｜${s.p ?? '—'} 萬｜${s.ar ?? '—'} 坪｜${esc(s.fl || '')}</div>
        ${h.reasons ? `<div class="meta">原因：${esc(h.reasons)}</div>` : ''}${h.note ? `<div class="meta">客人留言：${esc(h.note)}</div>` : ''}</td>
      <td><span class="pill s-${h.status}">${CI_ST[h.status]}</span><div class="meta">${ago(h.updated_at)}</div></td>
      <td><select data-st>${Object.entries(CI_ST).map(([k, v]) => `<option value="${k}" ${k === h.status ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>`; }).join('')}</table>`
      : '<div class="meta">還沒推送過案件</div>';
    $('#hist').onchange = async e => {
      if (!e.target.matches('[data-st]')) return;
      const tr = e.target.closest('tr'); const h = items.find(x => x.item_id === tr.dataset.item);
      await api(`/api/clients/${id}/items/${h.item_id}`, { method: 'PUT', body: { status: e.target.value, note: h.note, visit_at: h.visit_at } });
      h.status = e.target.value; toast('已更新'); drawHist();
    };
  }

  function drawMatch() {
    const cur = readPrefs();
    const r = Match.run(pool.items, cur, items, { includeSeen: S.showSeen });
    // 新配對排最前
    if (S.fresh.size) r.items.sort((a, b) => S.fresh.has(b.id) - S.fresh.has(a.id) || b.ms - a.ms);
    const nf = r.items.filter(x => S.fresh.has(x.id)).length;
    $('#mstat').textContent = `案件池 ${pool.items.length} 筆 → 符合 ${r.items.length} 筆${nf ? `，其中 ${nf} 件是新配對` : ''}（資料更新 ${ago(pool.generatedAt)}）`;
    $('#mout').textContent = Object.keys(r.out).length ? '被篩掉：' + Object.entries(r.out).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('、') : '';
    $('#mlist').innerHTML = r.items.slice(0, S.limit).map(it => matchCard(it, S.sel.has(it.id), S.fresh.has(it.id))).join('') +
      (r.items.length > S.limit ? `<div class="row-btns"><button id="moreM">再多看 30 筆</button></div>` : '');
    if ($('#moreM')) $('#moreM').onclick = () => { S.limit += 30; drawMatch(); };
    $('#mlist').onclick = e => {
      const bro = e.target.closest('[data-brochure]');
      if (bro) return brochure(bro.dataset.brochure);
      const card = e.target.closest('.card'); if (!card || e.target.closest('a')) return;
      const iid = card.dataset.id; S.sel.has(iid) ? S.sel.delete(iid) : S.sel.add(iid);
      card.classList.toggle('sel'); card.querySelector('input[type=checkbox]').checked = S.sel.has(iid);
      $('#share').disabled = !S.sel.size; $('#share').textContent = `產生分享連結（已選 ${S.sel.size}）`;
    };
    S.last = r;
  }

  $('#share').onclick = async () => {
    const chosen = pool.items.filter(x => S.sel.has(x.id));
    const title = prompt('連結標題（客人會看到）', `${c.name} 精選物件`); if (title == null) return;
    const res = await api(`/api/clients/${id}/share`, { method: 'POST', body: { title, days: 14, items: chosen.map(Match.snapshot) } });
    $('#shareOut').innerHTML = `<div class="panel" style="margin-top:10px">分享連結（14 天有效）：<br><b>${esc(res.url)}</b>
      <div class="row-btns"><button class="pri" data-copy="/s/${res.token}">複製連結</button><a href="${esc(res.url)}" target="_blank">預覽</a></div></div>`;
    S.sel.clear();
    items.unshift(...chosen.filter(x => !items.some(h => h.item_id === x.id)).map(x => ({ item_id: x.id, status: 'sent', snapshot: JSON.stringify(Match.snapshot(x)), updated_at: new Date().toISOString() })));
    drawHist(); drawMatch(); toast('已建立分享連結');
  };

  drawMatch();
  window._redrawMatch = drawMatch;
}

// 案件說明書目前是電腦上的程式（AI 挑照片、自繪格局要本機環境），先給可直接貼上的指令
function brochure(id591) {
  if (!id591) return alert('這個案子沒有 591 刊登，說明書目前只支援 591 物件。');
  const cmd = `cd /home/YuSheng/仲介開發/案件說明書 && node 程式/make.js ${id591}`;
  const done = () => toast('已複製指令，到電腦的 WSL 貼上執行，PDF 在 案件說明書/輸出/');
  navigator.clipboard.writeText(cmd).then(done, () => prompt('在電腦的 WSL 執行這行（PDF 會在 案件說明書/輸出/）', cmd));
}

function matchCard(it, sel, fresh) {
  return `<div class="card${sel ? ' sel' : ''}" data-id="${esc(it.id)}" style="cursor:pointer"><img loading="lazy" src="${esc(it.ph)}" alt="" onerror="this.style.visibility='hidden'"><div>
    <div class="top-row"><div class="ttl"><input type="checkbox" ${sel ? 'checked' : ''} style="pointer-events:none"> ${esc(it.c || it.t || it.a)}</div><div class="score">${it.ms}</div></div>
    <div class="tags">${fresh ? '<span class="tag t-新">新配對</span>' : ''}${(it.tg || []).map(t => `<span class="tag t-${t}">${t}</span>`).join('')}${it.same ? '<span class="tag t-同體系">同體系物件</span>' : ''}</div>
    <div class="price">${it.p ?? '—'} 萬 <span class="meta">${it.up ? it.up + ' 萬/坪' : ''}${it.cm != null ? `・比同社區實登 ${sign(it.cm)}` : ''}${it.pd != null ? `・比同等級社區 ${sign(it.pd)}` : ''}</span></div>
    <div class="meta">${esc(it.d)}｜${esc(it.a)}｜${it.ar ?? '—'} 坪｜${esc(it.fl || '—')}｜${it.ag != null && it.ag !== '' ? esc(it.ag) + ' 年' : '屋齡—'}｜${esc(it.ly || it.ty || '')}</div>
    <div class="why">${esc(it.why.join('、'))}｜<a href="${esc(it.u)}" target="_blank" rel="noopener">看刊登</a>｜${esc((it.s || []).join('、'))}
      <button type="button" class="sm" data-brochure="${esc(it.a5 || '')}">產生說明書</button></div>
  </div></div>`;
}

// ----- 客需表單（ALL HOUSE 買房需求諮詢單＋客戶配對單）-----
const AMENITIES = ['SPA', '花園', '室內泳池', '戶外泳池', '健身房', '籃球場', '網球場', 'KTV', '視聽中心', '宴會廳', '遊戲室', '媽媽教室', '圖書室', '交誼廳', '會議室', '桌球室'];
const FUNCTIONS = ['24H 便利商店', '傳統菜市場', '生鮮超市', '藥妝店', '百貨公司', '銀行/郵局/農會', '車站/高鐵/捷運', '醫院', '各科診所', '寵物醫院', '公園', '學校', '快速道路', '高速公路'];
const checks = (name, opts, val) => `<div class="checks">${opts.map(o => `<label><input type="checkbox" name="${name}" value="${esc(o)}" ${(val || []).includes(o) ? 'checked' : ''}>${esc(o)}</label>`).join('')}</div>`;
const inp = (name, label, val, type = 'text', ph = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(val ?? '')}" placeholder="${esc(ph)}"></label>`;

function prefsForm(c, p) {
  return `<form id="pf">
    <h3>基本</h3><div class="grid">${inp('_name', '客戶名稱', c.name)}${inp('_contact', '聯絡方式', c.contact)}
      ${inp('anchorCommunity', '目前最喜歡的物件（社區名）', p.anchorCommunity, 'text', '開頭先問的那一個')}${inp('anchorNote', '喜歡它的原因', p.anchorNote)}</div>
    <h3>購屋背景</h3><div class="grid">
      <label>購屋動機<select name="motive">${['', '首購', '再購', '換屋', '投資'].map(o => `<option ${p.motive === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
      <label>看房多久<select name="lookingFor">${['', '剛找', '1-3 個月', '半年', '一年以上'].map(o => `<option ${p.lookingFor === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
      ${inp('buyBy', '希望多久買到', p.buyBy)}${inp('keyPerson', '關鍵人物（誰拍板）', p.keyPerson)}
      ${inp('members', '居住成員', p.members, 'text', '父母、伴侶、小孩年齡…')}${inp('pets', '寵物', p.pets)}${inp('school', '學區需求', p.school)}${inp('workPlace', '工作地點／通勤', p.workPlace)}</div>
    <h3>範圍與預算</h3>${checks('districts', TAICHUNG, p.districts)}
    <div class="grid" style="margin-top:6px">${inp('districtsExclude', '排除的區（逗號）', (p.districtsExclude || []).join('、'))}
      ${inp('nearKeywords', '希望靠近的路段／地標（逗號）', (p.nearKeywords || []).join('、'), 'text', '例：文心路、大元國小')}
      ${inp('priceMin', '總價下限（萬）', p.priceMin, 'number')}${inp('priceMax', '總價上限（萬）', p.priceMax, 'number')}${inp('downPayment', '頭期款（萬）', p.downPayment, 'number')}</div>
    <h3>通勤地標</h3><p class="meta">公司、學校、娘家…配對會顯示離最近地標的直線距離並納入排序；填「最遠」就把超過的篩掉。案件用社區座標，沒社區的案子距離不明。</p>
    <div id="lms"></div><input type="hidden" name="landmarks" value="${esc(JSON.stringify(p.landmarks || []))}">
    <div class="grid"><label>地址或地標<input id="lmq" placeholder="例：南屯區大業路105號、台中榮總"></label><label>叫它什麼<input id="lmn" placeholder="例：公司"></label>
      <label>最遠（公里，可空）<input id="lmk" type="number" step="0.5" min="0"></label></div>
    <div class="row-btns"><button type="button" id="lmadd">定位並加入</button></div><div id="lmc" class="meta"></div>
    <h3>物件條件</h3>${checks('types', Match.TYPES, p.types)}${checks('kinds', ['新成屋', '中古屋'], p.kinds)}
    <div class="grid" style="margin-top:6px">${inp('areaMin', '權狀坪數下限', p.areaMin, 'number')}${inp('areaMax', '權狀坪數上限', p.areaMax, 'number')}
      ${inp('roomsMin', '至少幾房', p.roomsMin, 'number')}${inp('bathsMin', '至少幾衛', p.bathsMin, 'number')}${inp('ageMax', '屋齡上限（年）', p.ageMax, 'number')}
      ${inp('floorMin', '喜好樓層從', p.floorMin, 'number')}${inp('floorMax', '喜好樓層到', p.floorMax, 'number')}${inp('floorAvoid', '不要的樓層（逗號）', (p.floorAvoid || []).join('、'), 'text', '例：4、13')}
      <label>車位<select name="parking">${[['', '都可以'], ['need', '一定要'], ['no', '不需要']].map(([v, t]) => `<option value="${v}" ${p.parking === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${inp('orientation', '座向', p.orientation)}${inp('mgmtMax', '管理費上限（元/月）', p.mgmtMax, 'number')}</div>
    <h3>排除</h3><div class="grid">${inp('excludeKeywords', '排除建商／建案（逗號，可寫「寶佳集團」）', (p.excludeKeywords || []).join('、'))}</div>
    <div class="checks" style="margin-top:6px"><label><input type="checkbox" name="excludeSameSystem" ${p.excludeSameSystem ? 'checked' : ''}>不要同體系店家的物件</label></div>
    <h3>公設要求</h3>${checks('amenities', AMENITIES, p.amenities)}
    <h3>機能要求</h3>${checks('functions', FUNCTIONS, p.functions)}
    <h3>最終補充</h3><div class="grid">${inp('transit', '交通要求', p.transit)}${inp('fengshui', '風水禁忌', p.fengshui)}</div>
    <label class="meta">明確痛點<textarea name="pain">${esc(p.pain || '')}</textarea></label>
    <label class="meta">特需要的點<textarea name="must">${esc(p.must || '')}</textarea></label>
    <label class="meta">特困擾的點<textarea name="trouble">${esc(p.trouble || '')}</textarea></label>
    <label class="meta">補充說明<textarea name="note">${esc(p.note || '')}</textarea></label>
    <div class="row-btns"><button class="pri" type="submit">儲存客需</button><button type="button" id="preview">只重新配對（不存）</button><button type="button" id="del" style="margin-left:auto">刪除客戶</button></div>
  </form>`;
}

const LIST_FIELDS = ['districtsExclude', 'nearKeywords', 'excludeKeywords', 'floorAvoid'];
const NUM_FIELDS = ['priceMin', 'priceMax', 'downPayment', 'areaMin', 'areaMax', 'roomsMin', 'bathsMin', 'ageMax', 'floorMin', 'floorMax', 'mgmtMax'];
function readPrefs() {
  const f = $('#pf'); const fd = new FormData(f); const p = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith('_')) continue;
    if (['districts', 'types', 'kinds', 'amenities', 'functions'].includes(k)) (p[k] = p[k] || []).push(v);
    else if (LIST_FIELDS.includes(k)) p[k] = String(v).split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean);
    else if (NUM_FIELDS.includes(k)) { if (v !== '') p[k] = +v; }
    else if (k === 'excludeSameSystem') p[k] = true;
    else if (k === 'landmarks') { try { const v2 = JSON.parse(v); if (v2.length) p[k] = v2; } catch {} }
    else if (v !== '') p[k] = v;
  }
  return p;
}
function bindPrefs(c, prefs) {
  $('#pf').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData($('#pf'));
    await api(`/api/clients/${c.id}`, { method: 'PUT', body: { name: fd.get('_name'), contact: fd.get('_contact'), note: c.note, prefs: readPrefs() } });
    toast('客需已儲存'); window._redrawMatch && window._redrawMatch();
  };
  $('#preview').onclick = () => window._redrawMatch && window._redrawMatch();
  // 通勤地標：輸入 → 定位（內政部門牌／OSM）→ 從候選挑一個確認
  const lmInput = $('#pf').querySelector('[name=landmarks]');
  const getLm = () => { try { return JSON.parse(lmInput.value); } catch { return []; } };
  const setLm = v => { lmInput.value = JSON.stringify(v); drawLm(); window._redrawMatch && window._redrawMatch(); };
  function drawLm() {
    $('#lms').innerHTML = getLm().map((l, i) => `<div class="meta">📍 <b>${esc(l.name)}</b>：${esc(l.label)}${l.maxKm ? `（最遠 ${l.maxKm} km）` : ''} <button type="button" class="sm" data-lmdel="${i}">刪</button></div>`).join('');
  }
  drawLm();
  $('#lms').onclick = e => { const i = e.target.dataset.lmdel; if (i == null) return; const v = getLm(); v.splice(+i, 1); setLm(v); };
  $('#lmadd').onclick = async () => {
    const q = $('#lmq').value.trim(); if (!q) return toast('先輸入地址或地標');
    $('#lmc').textContent = '定位中…';
    try {
      const cs = await api('/api/geocode', { method: 'POST', body: { q } });
      if (!cs.length) { $('#lmc').textContent = '找不到，換個寫法（門牌要含路名與號，例：南屯區大業路105號）'; return; }
      $('#lmc').innerHTML = '定位到下面哪一個？' + cs.map((c, i) => `<div><button type="button" class="sm" data-lmpick="${i}">選這個</button> ${esc(c.label)} <span class="meta">（${esc(c.src)}）</span></div>`).join('');
      $('#lmc').onclick = e => {
        const i = e.target.dataset.lmpick; if (i == null) return;
        const c = cs[+i];
        setLm([...getLm(), { name: $('#lmn').value.trim() || q, label: c.label, lat: c.lat, lng: c.lng, maxKm: +$('#lmk').value || null }]);
        $('#lmc').textContent = '已加入（記得按「儲存客需」）'; $('#lmq').value = $('#lmn').value = $('#lmk').value = '';
      };
    } catch (x) { $('#lmc').textContent = x.message; }
  };
  $('#del').onclick = async () => {
    if (!confirm(`確定刪除客戶「${c.name}」？`)) return;
    await api(`/api/clients/${c.id}`, { method: 'DELETE' }); location.hash = 'clients';
  };
}

// ================= 帶看待辦 =================
async function viewVisits() {
  const rows = await api('/api/visits');
  const groups = { visit_req: '客人想去看（請安排）', liked: '客人喜歡（可以約）', booked: '已約帶看', offer: '出價斡旋中', visited: '已帶看' };
  $('#main').innerHTML = rows.length ? Object.entries(groups).map(([st, label]) => {
    const rs = rows.filter(r => r.status === st); if (!rs.length) return '';
    return `<div class="panel"><h2>${label}（${rs.length}）</h2><table>${rs.map(r => { const s = JSON.parse(r.snapshot || '{}'); return `<tr data-c="${r.client_id}" data-i="${esc(r.item_id)}">
      <td><a href="#client/${r.client_id}"><b>${esc(r.client_name)}</b></a><div class="meta">${ago(r.updated_at)}</div></td>
      <td><b>${esc(s.c || s.t || s.a)}</b><div class="meta">${esc(s.d || '')}｜${s.p ?? '—'} 萬｜${s.ar ?? '—'} 坪｜${esc(s.fl || '')}</div>${r.note ? `<div class="meta">留言：${esc(r.note)}</div>` : ''}</td>
      <td><select data-st>${Object.entries(CI_ST).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input type="datetime-local" data-at value="${esc(r.visit_at || '')}" style="margin-top:4px"></td></tr>`; }).join('')}</table></div>`;
  }).join('') : '<div class="empty">還沒有待安排的帶看。客人在分享連結按「喜歡」或「想去看」，就會出現在這裡。</div>';
  $('#main').onchange = async e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const r = rows.find(x => String(x.client_id) === tr.dataset.c && x.item_id === tr.dataset.i);
    const status = tr.querySelector('[data-st]').value, visit_at = tr.querySelector('[data-at]').value;
    await api(`/api/clients/${r.client_id}/items/${r.item_id}`, { method: 'PUT', body: { status: visit_at && status === r.status && ['visit_req', 'liked'].includes(status) ? 'booked' : status, note: r.note, visit_at } });
    toast('已更新'); viewVisits();
  };
}

// ================= 帳號（管理者）=================
async function viewUsers() {
  const users = await api('/api/users');
  $('#main').innerHTML = `<div class="panel"><h2>帳號</h2><table><tr><th>帳號</th><th>名字</th><th>權限</th><th>狀態</th><th></th></tr>
    ${users.map(u => `<tr data-id="${u.id}"><td>${esc(u.username)}</td><td>${esc(u.name)}</td><td>${u.role === 'admin' ? '管理者' : '成員'}</td>
      <td>${u.active ? '使用中' : '<span class="meta">停用</span>'}</td>
      <td>${u.id === ME.id ? '<span class="meta">（自己）</span>' : `<button class="sm" data-act="pw">重設密碼</button> <button class="sm" data-act="toggle">${u.active ? '停用' : '啟用'}</button>`}</td></tr>`).join('')}</table></div>
    <div class="panel"><h2>新增帳號</h2><form id="nu" class="grid">${inp('username', '帳號（登入用）', '')}${inp('name', '名字', '')}${inp('password', '密碼（至少 8 碼）', '', 'password')}
      <label>權限<select name="role"><option value="member">成員（只看自己的客戶）</option><option value="admin">管理者（看全部）</option></select></label>
      <div class="row-btns"><button class="pri">建立</button></div></form>
      <p class="meta">建立後把帳號密碼私下告訴對方，請他登入後到「我」改密碼。</p></div>`;
  $('#nu').onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/users', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('已建立'); viewUsers(); } catch (x) { toast(x.message); }
  };
  $('#main').onclick = async e => {
    const act = e.target.dataset.act; if (!act) return;
    const id = e.target.closest('tr').dataset.id; const u = users.find(x => String(x.id) === id);
    try {
      if (act === 'pw') { const pw = prompt(`幫 ${u.name} 設新密碼（至少 8 碼）`); if (!pw) return; await api(`/api/users/${id}`, { method: 'PUT', body: { password: pw } }); toast('已重設，對方要重新登入'); }
      if (act === 'toggle') { await api(`/api/users/${id}`, { method: 'PUT', body: { active: u.active ? 0 : 1 } }); viewUsers(); }
    } catch (x) { toast(x.message); }
  };
}

// ================= 我 =================
async function viewMe() {
  $('#main').innerHTML = `<div class="panel"><h2>${esc(ME.name)}（${esc(ME.username)}）</h2><p class="meta">${ME.role === 'admin' ? '管理者' : '成員'}</p>
    <form id="pw" class="grid">${inp('old', '舊密碼', '', 'password')}${inp('new', '新密碼（至少 8 碼）', '', 'password')}<div class="row-btns"><button class="pri">改密碼</button></div></form></div>
    <div class="row-btns"><button id="out">登出</button></div>`;
  $('#pw').onsubmit = async e => { e.preventDefault(); try { await api('/api/me/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('密碼已更新'); e.target.reset(); } catch (x) { toast(x.message); } };
  $('#out').onclick = async () => { await api('/api/logout', { method: 'POST' }); ME = null; boot(); };
}

boot();

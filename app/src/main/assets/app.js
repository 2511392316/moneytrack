'use strict';

/* ---------- 基础工具 ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const pad2 = n => String(n).padStart(2, '0');
const dayStr = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthStr = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const yuan = c => (c / 100).toFixed(2);
const toCent = v => Math.round((Number(v) || 0) * 100);
const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 1700);
}

/* 算式求值:支持 + - × ÷,按分取整 */
const PREC = { '+': 1, '-': 1, '×': 2, '÷': 2 };
function calc(expr) {
  const toks = String(expr).match(/(?:\d+\.?\d*|\.\d+)|[+\-×÷]/g) || [];
  const vals = [], ops = [];
  const pop = () => {
    const b = vals.pop() ?? 0, a = vals.pop() ?? 0, o = ops.pop();
    vals.push(o === '+' ? a + b : o === '-' ? a - b : o === '×' ? a * b : (b ? a / b : 0));
  };
  for (const t of toks) {
    if (PREC[t]) {
      while (ops.length && PREC[ops[ops.length - 1]] >= PREC[t]) pop();
      ops.push(t);
    } else vals.push(parseFloat(t));
  }
  while (ops.length) pop();
  return vals.length ? vals[0] : 0;
}
const exprCent = e => toCent(calc(e));

/* ---------- 存储层:优先 IndexedDB,不可用时回退 localStorage ---------- */
const DB_NAME = 'moneytrack';
const STORES = ['accounts', 'categories', 'transactions', 'transfers', 'balance_adjustments'];
let idb = null, lsMode = false;

function openDB() {
  return new Promise(resolve => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch { lsMode = true; return resolve(null); }
    req.onupgradeneeded = () => STORES.forEach(s => {
      if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id', autoIncrement: true });
    });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { lsMode = true; resolve(null); };
  });
}
const lsRead = s => { try { return JSON.parse(localStorage.getItem('mt.' + s) || '[]'); } catch { return []; } };
const lsWrite = (s, a) => localStorage.setItem('mt.' + s, JSON.stringify(a));

function all(name) {
  if (lsMode) return Promise.resolve(lsRead(name));
  return new Promise(res => {
    const r = idb.transaction(name).objectStore(name).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => res([]);
  });
}
function put(name, obj) {
  if (lsMode) {
    const arr = lsRead(name);
    if (obj.id == null) { obj.id = arr.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1; arr.push(obj); }
    else { const i = arr.findIndex(x => x.id === obj.id); if (i < 0) arr.push(obj); else arr[i] = obj; }
    lsWrite(name, arr);
    return Promise.resolve(obj);
  }
  return new Promise(res => {
    const r = idb.transaction(name, 'readwrite').objectStore(name).put(obj);
    r.onsuccess = () => res({ ...obj, id: r.result });
    r.onerror = () => res(obj);
  });
}
function del(name, id) {
  if (lsMode) { lsWrite(name, lsRead(name).filter(x => x.id !== id)); return Promise.resolve(); }
  return new Promise(res => {
    const r = idb.transaction(name, 'readwrite').objectStore(name).delete(id);
    r.onsuccess = r.onerror = () => res();
  });
}
async function wipe() {
  for (const n of STORES) {
    if (lsMode) { lsWrite(n, []); continue; }
    await new Promise(res => {
      const r = idb.transaction(n, 'readwrite').objectStore(n).clear();
      r.onsuccess = r.onerror = () => res();
    });
  }
}

/* ---------- 数据 ---------- */
const S = { accounts: [], categories: [], transactions: [], transfers: [], adjustments: [] };

async function load() {
  const [accounts, categories, transactions, transfers, adjustments] = await Promise.all(STORES.map(all));
  Object.assign(S, { accounts, categories, transactions, transfers, adjustments });
}

const SEED = {
  out: {
    '餐饮': ['早餐', '午餐', '晚餐', '外卖', '零食饮料'],
    '交通': ['公交地铁', '打车', '加油', '停车'],
    '购物': ['日用品', '服饰', '数码'],
    '居住': ['房租', '水电燃气', '物业'],
    '娱乐': ['电影', '游戏', '旅行', '聚会'],
    '医疗': ['药品', '门诊'],
    '学习': ['书籍', '课程'],
    '其他': ['其他']
    // 想加分类就按这个格式加，例如：'宠物': ['粮食', '医疗']
  },
  in: {
    '工资': ['月薪', '加班费'],
    '奖金': ['年终奖', '绩效'],
    '兼职': ['接单', '稿费'],
    '理财': ['利息', '分红'],
    '红包': ['礼金', '返现'],
    '其他': ['其他']
  }
};

async function seedIfEmpty() {
  if (!S.accounts.length) {
    await put('accounts', { name: '现金', kind: '现金', initBalance: 0 });
    // 补充微信、支付宝、蚂蚁基金
    await put('accounts', { name: '微信', kind: '微信', initBalance: 0 });
    await put('accounts', { name: '支付宝', kind: '支付宝', initBalance: 0 });
    await put('accounts', { name: '蚂蚁基金', kind: '蚂蚁基金', initBalance: 0 });
}
  if (!S.categories.length) {
    let o = 0;
    for (const type of ['out', 'in']) {
      for (const [p, kids] of Object.entries(SEED[type])) {
        const parent = await put('categories', { type, parentId: null, name: p, useCount: 0, order: o++ });
        for (const k of kids) await put('categories', { type, parentId: parent.id, name: k, useCount: 0, order: o++ });
      }
    }
  }
  await load();
}

/* ---------- 派生值 ---------- */
const accById = id => S.accounts.find(a => a.id === id);
const catById = id => S.categories.find(c => c.id === id);
const catName = id => catById(id)?.name || '未分类';
const catRoot = id => { const c = catById(id); return c ? (c.parentId ? catById(c.parentId) : c) : null; };
const catPath = id => { const c = catById(id); if (!c) return '未分类'; return c.parentId ? `${catName(c.parentId)} · ${c.name}` : c.name; };
const byUse = (a, b) => (b.useCount || 0) - (a.useCount || 0) || (a.order || 0) - (b.order || 0);
const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
const rootCats = type => S.categories.filter(c => !c.parentId && c.type === type).sort(byUse);
const kidCats = pid => S.categories.filter(c => c.parentId === pid).sort(byUse);
const nextOrder = () => Math.max(0, ...S.categories.map(c => c.order || 0)) + 1;

function balMap() {
  const m = {};
  for (const a of S.accounts) m[a.id] = a.initBalance || 0;
  for (const t of S.transactions) if (m[t.accountId] !== undefined) m[t.accountId] += t.type === 'in' ? t.amountCent : -t.amountCent;
  for (const t of S.transfers) {
    if (m[t.fromAccountId] !== undefined) m[t.fromAccountId] -= t.amountCent;
    if (m[t.toAccountId] !== undefined) m[t.toAccountId] += t.amountCent;
  }
  for (const a of S.adjustments) if (m[a.accountId] !== undefined) m[a.accountId] += a.diffCent;
  return m;
}

function dayLabel(d) {
  const dt = new Date(d + 'T00:00:00');
  const w = '日一二三四五六'[dt.getDay()];
  const pre = d === dayStr() ? '今天 · ' : d === dayStr(new Date(Date.now() - 864e5)) ? '昨天 · ' : '';
  return `${pre}${dt.getMonth() + 1}月${dt.getDate()}日 周${w}`;
}

/* ---------- 弹出层 ---------- */
function sheet(title, build) {
  const back = document.createElement('div');
  back.className = 'sheet-back';
  const el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = `<div class="sheet-hd"><button class="icon" data-act="close">✕</button><div class="sheet-t">${esc(title)}</div><span class="gap"></span></div><div class="sheet-bd"></div>`;
  const bd = $('.sheet-bd', el);
  document.body.append(back, el);
  const close = () => {
    back.classList.remove('on');
    el.classList.remove('on');
    setTimeout(() => { back.remove(); el.remove(); }, 220);
  };
  back.addEventListener('click', close);
  $('[data-act="close"]', el).addEventListener('click', close);
  requestAnimationFrame(() => { back.classList.add('on'); el.classList.add('on'); });
  build(bd, close);
}

/* ---------- 记账表单(记账页与编辑弹层共用) ---------- */
const KEYS = ['7', '8', '9', '⌫', '4', '5', '6', '÷', '1', '2', '3', '×', '.', '0', '+', '-', 'C', '=', '保存'];
const keypadHTML = () => KEYS.map(k => {
  if (k === '保存') return '<button class="save" data-act="save">保存</button>';
  const cls = '+-×÷'.includes(k) ? 'op' : (k === 'C' || k === '⌫' || k === '=' ? 'fn' : '');
  return `<button class="${cls}" data-act="key" data-k="${k}">${k}</button>`;
}).join('');

function editorEl(st, opts = {}) {
  const el = document.createElement('div');
  el.className = 'editor';
  el.innerHTML = `
    <div class="seg" data-role="type">
      <button data-act="type" data-v="out">支出</button>
      <button data-act="type" data-v="in">收入</button>
    </div>
    <div class="chips" data-role="cat1"></div>
    <div class="chips" data-role="cat2"></div>
    <div class="amtrow"><span class="expr" data-role="expr"></span><span class="amtv" data-role="amt">0.00</span></div>
    <div class="chips" data-role="acc"></div>
    <div class="inprow">
      <input class="inp" data-role="date" type="date">
      <input class="inp" data-role="note" placeholder="备注(可选)" maxlength="40">
    </div>
    <div class="keypad">${keypadHTML()}</div>
    <div class="btns" data-role="btns"></div>`;

  const q = r => $('[data-role="' + r + '"]', el);
  const chip = (on, act, id, name) => `<button class="chip${on ? ' on' : ''}" data-act="${act}" data-v="${id}">${esc(name)}</button>`;

  function drawAmount() {
    q('amt').textContent = yuan(exprCent(st.expr));
    q('expr').textContent = /[+\-×÷]/.test(st.expr) ? st.expr + ' =' : '';
  }
  function draw() {
    $$('[data-role="type"] button', el).forEach(b => b.classList.toggle('on', b.dataset.v === st.type));

    const roots = rootCats(st.type);
    if (!roots.some(c => c.id === st.cat1)) st.cat1 = roots[0]?.id ?? null;
    q('cat1').innerHTML = roots.map(c => chip(c.id === st.cat1, 'cat1', c.id, c.name)).join('')
      || '<span class="hint">还没有分类,去「账户 · 分类管理」添加</span>';

    const kids = st.cat1 ? kidCats(st.cat1) : [];
    if (st.cat2 && !kids.some(c => c.id === st.cat2)) st.cat2 = null;
    q('cat2').innerHTML = kids.map(c => chip(c.id === st.cat2, 'cat2', c.id, c.name)).join('');
    q('cat2').style.display = kids.length ? '' : 'none';

    if (!S.accounts.some(a => a.id === st.accId)) st.accId = S.accounts[0]?.id ?? null;
    q('acc').innerHTML = S.accounts.map(a => chip(a.id === st.accId, 'acc', a.id, a.name)).join('')
      || '<span class="hint">还没有账户,去「账户」页新增</span>';

    drawAmount();
    if (st.date) q('date').value = st.date;
    if (q('note').value !== st.note) q('note').value = st.note;

    const btns = q('btns');
    btns.innerHTML = st.id
      ? '<button class="btn" data-act="save">保存修改</button><button class="btn ghost" data-act="del">删除</button>'
      : '';
    btns.style.display = st.id ? '' : 'none';
  }

  let afterEq = false;
  function press(k) {
    if (afterEq) {
      afterEq = false;
      if (/^[\d.]$/.test(k)) st.expr = '';
    }
    if (k === '⌫') st.expr = st.expr.slice(0, -1);
    else if (k === 'C') st.expr = '';
    else if (k === '=') { st.expr = st.expr ? yuan(exprCent(st.expr)) : ''; afterEq = true; }
    else if (k === '.') { const tail = st.expr.match(/[\d.]*$/)[0]; if (!tail.includes('.')) st.expr += tail === '' ? '0.' : '.'; }
    else if ('+-×÷'.includes(k)) { if (!st.expr) st.expr = '0'; if (PREC[st.expr.slice(-1)]) st.expr = st.expr.slice(0, -1); st.expr += k; }
    else st.expr += k;
    if (/^0\d/.test(st.expr)) st.expr = st.expr.slice(1);
    drawAmount();
  }

  async function save() {
    const cent = exprCent(st.expr);
    if (!(cent > 0)) return toast('请输入金额');
    if (!st.accId) return toast('请先新增账户');
    const categoryId = st.cat2 || st.cat1;
    if (!categoryId) return toast('请选择分类');
    const tx = {
      type: st.type, amountCent: cent, categoryId, accountId: st.accId,
      date: st.date || dayStr(), note: (st.note || '').trim(), createdAt: Date.now()
    };
    if (st.id) tx.id = st.id;
    await put('transactions', tx);
    const c = catById(categoryId);
    if (c) { c.useCount = (c.useCount || 0) + 1; await put('categories', c); }
    await load();
    if (opts.onSaved) opts.onSaved(cent, tx);
    else { st.expr = ''; st.note = ''; draw(); toast('已保存 ' + yuan(cent)); }
  }

  el.addEventListener('click', ev => {
    const b = ev.target.closest('[data-act]');
    if (!b || !el.contains(b)) return;
    const act = b.dataset.act;
    if (act === 'type') { st.type = b.dataset.v; st.cat1 = null; st.cat2 = null; draw(); }
    else if (act === 'cat1') { st.cat1 = +b.dataset.v; st.cat2 = null; draw(); }
    else if (act === 'cat2') { st.cat2 = st.cat2 === +b.dataset.v ? null : +b.dataset.v; draw(); }
    else if (act === 'acc') { st.accId = +b.dataset.v; draw(); }
    else if (act === 'key') press(b.dataset.k);
    else if (act === 'save') save();
    else if (act === 'del') opts.onDelete?.(st);
  });
  el.addEventListener('input', ev => {
    const r = ev.target.dataset.role;
    if (r === 'note') st.note = ev.target.value;
    else if (r === 'date' && ev.target.value) st.date = ev.target.value;
  });

  draw();
  return { el, st, draw };
}

/* ---------- 记账页 ---------- */
const entrySt = { type: 'out', cat1: null, cat2: null, accId: null, date: dayStr(), note: '', expr: '' };
let entryEd = null;

function renderEntry(root) {
  entrySt.date = dayStr();
  if (!entryEd) {
    entryEd = editorEl(entrySt, {
      onSaved: cent => {
        entryEd.st.expr = '';
        entryEd.st.note = '';
        entryEd.draw();
        toast('已保存 ' + yuan(cent));
      }
    });
  }
  root.append(entryEd.el);
  entryEd.draw();
}

/* ---------- 明细页 ---------- */
const L = { month: monthStr(), all: false, type: 'all', accId: 'all', catId: 'all' };

function shiftMonth(k) {
  const [y, m] = L.month.split('-').map(Number);
  L.month = monthStr(new Date(y, m - 1 + k, 1));
  render();
}

function filteredTx() {
  return S.transactions.filter(t => {
    if (!L.all && !t.date.startsWith(L.month)) return false;
    if (L.type !== 'all' && t.type !== L.type) return false;
    if (L.accId !== 'all' && t.accountId !== L.accId) return false;
    if (L.catId !== 'all' && catRoot(t.categoryId)?.id !== L.catId) return false;
    return true;
  }).sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1) || (b.createdAt || 0) - (a.createdAt || 0));
}

function renderList(root) {
  const rows = filteredTx();
  const inc = rows.reduce((s, t) => s + (t.type === 'in' ? t.amountCent : 0), 0);
  const out = rows.reduce((s, t) => s + (t.type === 'out' ? t.amountCent : 0), 0);

  const accOpts = ['<option value="all">全部账户</option>']
    .concat(S.accounts.map(a => `<option value="${a.id}"${L.accId === a.id ? ' selected' : ''}>${esc(a.name)}</option>`)).join('');
  const catOpts = ['<option value="all">全部分类</option>']
    .concat(S.categories.filter(c => !c.parentId).sort(byOrder)
      .map(c => `<option value="${c.id}"${L.catId === c.id ? ' selected' : ''}>${c.type === 'in' ? '收·' : '支·'}${esc(c.name)}</option>`)).join('');

  const groups = {};
  for (const t of rows) (groups[t.date] ||= []).push(t);
  const listHTML = Object.keys(groups).sort().reverse().map(d => {
    const g = groups[d];
    const gi = g.reduce((s, t) => s + (t.type === 'in' ? t.amountCent : 0), 0);
    const go = g.reduce((s, t) => s + (t.type === 'out' ? t.amountCent : 0), 0);
    return `<div class="day">${dayLabel(d)} · 收 ${yuan(gi)} 支 ${yuan(go)}</div>` + g.map(t => `
      <div class="tx" data-act="tx" data-v="${t.id}">
        <div class="tx-main">
          <div class="tx-t">${esc(catPath(t.categoryId))}</div>
          <div class="tx-s">${esc(accById(t.accountId)?.name || '已删除账户')}${t.note ? ' · ' + esc(t.note) : ''}</div>
        </div>
        <div class="tx-amt ${t.type}">${t.type === 'in' ? '+' : '-'}${yuan(t.amountCent)}</div>
      </div>`).join('');
  }).join('');

  root.innerHTML = `
    <div class="bar">
      <button class="icon" data-act="mprev">‹</button>
      <div class="bar-t">${L.all ? '全部时间' : L.month.replace('-', '年') + '月'}</div>
      <button class="icon" data-act="mnext">›</button>
      <button class="mini${L.all ? ' on' : ''}" data-act="mAll">全部</button>
    </div>
    <div class="filters">
      <div class="seg small">
        <button data-act="ftype" data-v="all" class="${L.type === 'all' ? 'on' : ''}">全部</button>
        <button data-act="ftype" data-v="out" class="${L.type === 'out' ? 'on' : ''}">支出</button>
        <button data-act="ftype" data-v="in" class="${L.type === 'in' ? 'on' : ''}">收入</button>
      </div>
      <select data-act="facc">${accOpts}</select>
      <select data-act="fcat">${catOpts}</select>
    </div>
    <div class="sum">共 ${rows.length} 笔 · 收入 ${yuan(inc)} · 支出 ${yuan(out)} · 净 ${yuan(inc - out)}</div>
    ${listHTML || '<div class="hint">这段时间还没有记录</div>'}`;
}

function txEdit(id) {
  const t = S.transactions.find(x => x.id === id);
  if (!t) return;
  const root = catRoot(t.categoryId);
  const st = {
    id: t.id, type: t.type,
    cat1: root?.id ?? null,
    cat2: catById(t.categoryId)?.parentId ? t.categoryId : null,
    accId: t.accountId, date: t.date, note: t.note || '', expr: yuan(t.amountCent)
  };
  sheet('编辑记录', (bd, close) => {
    const ed = editorEl(st, {
      onSaved: () => { close(); render(); toast('已修改'); },
      onDelete: async () => {
        if (!confirm('删除这笔记录?')) return;
        await del('transactions', st.id);
        await load(); close(); render(); toast('已删除');
      }
    });
    ed.el.classList.add('in-sheet');
    bd.append(ed.el);
  });
}

/* ---------- 统计页 ---------- */
const PIE_COLORS = ['#2f6fed', '#f2994a', '#27ae60', '#9b51e0', '#eb5757', '#56ccf2', '#f2c94c', '#6fcf97', '#bb6bd9', '#9aa2af'];
const ST = { month: monthStr(), drill: null };

function shiftStatMonth(k) {
  const [y, m] = ST.month.split('-').map(Number);
  ST.month = monthStr(new Date(y, m - 1 + k, 1));
  ST.drill = null;
  render();
}

function statsData() {
  const rows = S.transactions.filter(t => t.date.startsWith(ST.month));
  const inc = rows.reduce((s, t) => s + (t.type === 'in' ? t.amountCent : 0), 0);
  const out = rows.reduce((s, t) => s + (t.type === 'out' ? t.amountCent : 0), 0);
  const bucket = {};
  const src = rows.filter(t => t.type === 'out' && (ST.drill == null || catRoot(t.categoryId)?.id === ST.drill));
  for (const t of src) {
    const key = ST.drill == null ? (catRoot(t.categoryId)?.id ?? 0) : t.categoryId;
    bucket[key] = (bucket[key] || 0) + t.amountCent;
  }
  const items = Object.entries(bucket).map(([k, v]) => ({ id: +k, name: catName(+k), value: v })).sort((a, b) => b.value - a.value);
  return { inc, out, items };
}

function drawPie(cv, items, onPick) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 320, h = 200;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 8, r = R * 0.58;
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) {
    ctx.fillStyle = '#c9ced6';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('本月暂无支出', cx, cy);
    cv.onclick = null;
    return;
  }
  let a0 = -Math.PI / 2;
  items.forEach((it, i) => {
    const a1 = a0 + (it.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a0, a1);
    ctx.closePath();
    ctx.fillStyle = PIE_COLORS[i % PIE_COLORS.length];
    ctx.fill();
    a0 = a1;
  });
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  cv.onclick = ev => {
    const rect = cv.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (w / rect.width) - cx;
    const y = (ev.clientY - rect.top) * (h / rect.height) - cy;
    const dist = Math.hypot(x, y);
    if (dist > R || dist < r) return;
    let ang = Math.atan2(y, x) + Math.PI / 2;
    if (ang < 0) ang += Math.PI * 2;
    let from = 0;
    for (const it of items) {
      const to = from + (it.value / total) * Math.PI * 2;
      if (ang >= from && ang < to) return onPick(it);
      from = to;
    }
  };
}

function pickSlice(id) {
  if (ST.drill == null) { ST.drill = id; render(); }
  else toast('小类明细可在「明细」页按大类筛选查看');
}

function renderStats(root) {
  const { inc, out, items } = statsData();
  const total = items.reduce((s, i) => s + i.value, 0);
  const bal = balMap();
  const dr = ST.drill != null ? catById(ST.drill) : null;

  const legend = items.length ? items.map((it, i) => `
    <div class="lg" data-act="pick" data-v="${it.id}">
      <i style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></i>
      <span class="lg-n">${esc(it.name)}</span>
      <span class="lg-v">${yuan(it.value)}</span>
      <span class="lg-p">${total ? Math.round(it.value / total * 100) : 0}%</span>
    </div>`).join('') : '<div class="hint">本月还没有支出记录</div>';

  root.innerHTML = `
    <div class="bar">
      <button class="icon" data-act="sprev">‹</button>
      <div class="bar-t">${ST.month.replace('-', '年') + '月'}</div>
      <button class="icon" data-act="snext">›</button>
    </div>
    <div class="cards3">
      <div class="card"><div class="c-l">收入</div><div class="c-v in">${yuan(inc)}</div></div>
      <div class="card"><div class="c-l">支出</div><div class="c-v out">${yuan(out)}</div></div>
      <div class="card"><div class="c-l">净现金流</div><div class="c-v">${yuan(inc - out)}</div></div>
    </div>
    <div class="sec-t">
      <span>支出构成${dr ? ' · ' + esc(dr.name) : ' · 按大类'}</span>
      ${ST.drill != null ? '<button class="mini" data-act="udrill">← 返回大类</button>' : ''}
    </div>
    <div class="pie-wrap"><canvas data-role="pie"></canvas>${legend}</div>
    <div class="sec-t"><span>账户余额</span><span>净值 ${yuan(S.accounts.reduce((s, a) => s + (bal[a.id] || 0), 0))}</span></div>
    ${S.accounts.map(a => `<div class="acc"><div><div class="acc-n">${esc(a.name)}</div><div class="acc-k">${esc(a.kind || '')}</div></div><div class="acc-v">${yuan(bal[a.id] || 0)}</div></div>`).join('') || '<div class="hint">还没有账户</div>'}`;

  drawPie($('[data-role="pie"]', root), items, it => pickSlice(it.id));
}

/* ---------- 账户页 ---------- */
function renderAccounts(root) {
  const bal = balMap();
  const accs = S.accounts;
  const net = accs.reduce((s, a) => s + (bal[a.id] || 0), 0);
  const pos = accs.reduce((s, a) => s + Math.max(0, bal[a.id] || 0), 0);
  const neg = accs.reduce((s, a) => s + Math.min(0, bal[a.id] || 0), 0);
  const trs = [...S.transfers]
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1) || (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 8)
    .map(t => `
      <div class="tx" data-act="trOpen" data-v="${t.id}">
        <div class="tx-main">
          <div class="tx-t">${esc(accById(t.fromAccountId)?.name || '?')} → ${esc(accById(t.toAccountId)?.name || '?')}</div>
          <div class="tx-s">${esc(t.date)}${t.note ? ' · ' + esc(t.note) : ''}</div>
        </div>
        <div class="tx-amt">${yuan(t.amountCent)}</div>
      </div>`).join('');

  root.innerHTML = `
    <div class="card hero">
      <div class="hero-l">净资产</div>
      <div class="hero-v">${yuan(net)}</div>
      <div class="hero-r"><span>总资产 ${yuan(pos)}</span><span>总负债 ${yuan(Math.abs(neg))}</span></div>
    </div>
    <div class="sec-t"><span>账户</span><button class="mini" data-act="accNew">+ 新增账户</button></div>
    ${accs.map(a => `
      <div class="acc" data-act="accOpen" data-v="${a.id}">
        <div><div class="acc-n">${esc(a.name)}</div><div class="acc-k">${esc(a.kind || '')}</div></div>
        <div class="acc-v">${yuan(bal[a.id] || 0)}</div>
      </div>`).join('') || '<div class="hint">还没有账户,点右上角新增</div>'}
    <div class="sec-t"><span>最近转账(不计入收支)</span><button class="mini" data-act="trNew">+ 转账</button></div>
    ${trs || '<div class="hint">还没有转账记录</div>'}
    <div class="sec-t">工具</div>
    <div class="tools">
      <button class="btn ghost" data-act="catMgr">分类管理</button>
      <button class="btn ghost" data-act="expJson">导出 JSON</button>
      <button class="btn ghost" data-act="expCsv">导出 CSV</button>
      <button class="btn ghost" data-act="imp">导入数据</button>
    </div>`;
}

const KINDS = ['储蓄卡', '信用卡', '微信', '支付宝', '现金', '其他'];

function accForm(a) {
  const st = { name: a?.name || '', kind: a?.kind || '储蓄卡' };
  sheet(a ? '编辑账户' : '新增账户', (bd, close) => {
    bd.innerHTML = `
      <div class="field"><label>账户名称</label><input class="inp" data-role="name" placeholder="如:招行储蓄卡" maxlength="16" value="${esc(st.name)}"></div>
      <div class="field"><label>账户类型(可自定义)</label><div class="chips" data-role="kinds"></div><input class="inp" data-role="kind" placeholder="如:新办的卡 / 云闪付" maxlength="10" value="${esc(st.kind)}"></div>
      <div class="field"><label>初始余额(信用卡可填负数)</label><input class="inp" data-role="init" inputmode="decimal" value="${a ? yuan(a.initBalance || 0) : '0.00'}"></div>
      <div class="btns"><button class="btn" data-act="ok">保存</button></div>`;
    const kq = $('[data-role="kind"]', bd);
    const drawKinds = () => $('[data-role="kinds"]', bd).innerHTML =
      KINDS.map(k => `<button class="chip${k === kq.value.trim() ? ' on' : ''}" data-act="kind" data-v="${k}">${k}</button>`).join('');
    drawKinds();
    bd.addEventListener('input', ev => { if (ev.target === kq) drawKinds(); });
    bd.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'kind') { kq.value = b.dataset.v; drawKinds(); return; }
      if (b.dataset.act !== 'ok') return;
      const name = $('[data-role="name"]', bd).value.trim();
      if (!name) return toast('请输入账户名称');
      const obj = {
        name, kind: kq.value.trim() || '其他',
        initBalance: toCent($('[data-role="init"]', bd).value || 0)
      };
      if (a) obj.id = a.id;
      await put('accounts', obj);
      await load(); close(); render(); toast('已保存');
    });
  });
}

function accSheet(id) {
  const a = accById(id);
  if (!a) return;
  const bal = balMap()[id] || 0;
  sheet(a.name, (bd, close) => {
    bd.innerHTML = `
      <div class="card hero">
        <div class="hero-l">当前余额</div>
        <div class="hero-v">${yuan(bal)}</div>
        <div class="hero-r"><span>初始 ${yuan(a.initBalance || 0)}</span><span>类型 ${esc(a.kind || '')}</span></div>
      </div>
      <div class="tools">
        <button class="btn ghost" data-act="to">转账</button>
        <button class="btn ghost" data-act="re">余额校准</button>
        <button class="btn ghost" data-act="ed">编辑账户</button>
        <button class="btn ghost" data-act="rm">删除账户</button>
      </div>`;
    bd.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'to') { close(); transferForm(id); }
      else if (act === 're') { close(); adjustForm(id); }
      else if (act === 'ed') { close(); accForm(a); }
      else if (act === 'rm') {
        const used = S.transactions.some(t => t.accountId === id)
          || S.transfers.some(t => t.fromAccountId === id || t.toAccountId === id)
          || S.adjustments.some(x => x.accountId === id);
        if (used) return toast('该账户已有流水,不能被删除');
        if (!confirm('删除账户「' + a.name + '」?')) return;
        await del('accounts', id);
        await load(); close(); render(); toast('已删除');
      }
    });
  });
}

function transferForm(fromId) {
  if (S.accounts.length < 2) return toast('至少需要两个账户');
  const from = fromId ?? S.accounts[0].id;
  const to = S.accounts.find(a => a.id !== from).id;
  sheet('转账', (bd, close) => {
    const opts = sel => S.accounts.map(a => `<option value="${a.id}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
    bd.innerHTML = `
      <div class="field"><label>转出账户</label><select class="inp" data-role="from">${opts(from)}</select></div>
      <div class="field"><label>转入账户</label><select class="inp" data-role="to">${opts(to)}</select></div>
      <div class="field"><label>金额</label><input class="inp" data-role="amount" inputmode="decimal" placeholder="0.00"></div>
      <div class="field"><label>日期</label><input class="inp" type="date" data-role="date" value="${dayStr()}"></div>
      <div class="field"><label>备注</label><input class="inp" data-role="note" placeholder="可选" maxlength="40"></div>
      <div class="btns"><button class="btn" data-act="ok">保存</button></div>
      <div class="hint">转账只改变账户余额,不计入收入或支出统计。</div>`;
    bd.addEventListener('click', async ev => {
      if (!ev.target.closest('[data-act="ok"]')) return;
      const f = +$('[data-role="from"]', bd).value;
      const t = +$('[data-role="to"]', bd).value;
      const amt = toCent($('[data-role="amount"]', bd).value);
      if (f === t) return toast('转出与转入不能是同一账户');
      if (!(amt > 0)) return toast('请输入金额');
      await put('transfers', {
        fromAccountId: f, toAccountId: t, amountCent: amt,
        date: $('[data-role="date"]', bd).value || dayStr(),
        note: $('[data-role="note"]', bd).value.trim(), createdAt: Date.now()
      });
      await load(); close(); render(); toast('转账已记录');
    });
  });
}

function transferOpen(id) {
  const t = S.transfers.find(x => x.id === id);
  if (!t) return;
  sheet('转账详情', (bd, close) => {
    bd.innerHTML = `
      <div class="card hero">
        <div class="hero-l">${esc(accById(t.fromAccountId)?.name || '?')} → ${esc(accById(t.toAccountId)?.name || '?')}</div>
        <div class="hero-v">${yuan(t.amountCent)}</div>
        <div class="hero-r"><span>${esc(t.date)}</span>${t.note ? '<span>' + esc(t.note) + '</span>' : ''}</div>
      </div>
      <div class="btns"><button class="btn ghost" data-act="rm">删除这笔转账</button></div>`;
    bd.addEventListener('click', async ev => {
      if (!ev.target.closest('[data-act="rm"]')) return;
      if (!confirm('删除这笔转账?')) return;
      await del('transfers', id);
      await load(); close(); render(); toast('已删除');
    });
  });
}

function adjustForm(id) {
  const a = accById(id);
  const cur = balMap()[id] || 0;
  sheet('余额校准', (bd, close) => {
    const hist = S.adjustments.filter(x => x.accountId === id)
      .sort((x, y) => (x.date === y.date ? 0 : x.date < y.date ? 1 : -1)).slice(0, 10)
      .map(x => `
        <div class="tx">
          <div class="tx-main"><div class="tx-t">${esc(x.date)}</div>
          <div class="tx-s">实际 ${yuan(x.realBalanceCent)}${x.note ? ' · ' + esc(x.note) : ''}</div></div>
          <div class="tx-amt">${x.diffCent >= 0 ? '+' : ''}${yuan(x.diffCent)}</div>
        </div>`).join('');
    bd.innerHTML = `
      <div class="card hero">
        <div class="hero-l">当前记账余额</div>
        <div class="hero-v">${yuan(cur)}</div>
        <div class="hero-r"><span>${esc(a.name)}</span></div>
      </div>
      <div class="field"><label>实际余额</label><input class="inp" data-role="real" inputmode="decimal" placeholder="0.00"></div>
      <div class="field"><label>备注</label><input class="inp" data-role="note" placeholder="如:对账 / 漏记补差" maxlength="40"></div>
      <div class="btns"><button class="btn" data-act="ok">确认校准</button></div>
      <div class="sec-t">历史校准</div>
      ${hist || '<div class="hint">还没有校准记录</div>'}`;
    bd.addEventListener('click', async ev => {
      if (!ev.target.closest('[data-act="ok"]')) return;
      const raw = $('[data-role="real"]', bd).value.trim();
      if (!raw) return toast('请输入实际余额');
      const real = toCent(raw);
      await put('balance_adjustments', {
        accountId: id, realBalanceCent: real, diffCent: real - cur,
        date: dayStr(), note: $('[data-role="note"]', bd).value.trim(), createdAt: Date.now()
      });
      await load(); close(); render(); toast('已校准,差额 ' + yuan(real - cur));
    });
  });
}

/* ---------- 分类管理 ---------- */
function catMgr(initType = 'out') {
  let type = initType;
  sheet('分类管理', bd => {
    const draw = () => {
      const roots = S.categories.filter(c => !c.parentId && c.type === type).sort(byOrder);
      bd.innerHTML = `
        <div class="seg">
          <button data-act="type" data-v="out" class="${type === 'out' ? 'on' : ''}">支出</button>
          <button data-act="type" data-v="in" class="${type === 'in' ? 'on' : ''}">收入</button>
        </div>
        <button class="btn ghost" data-act="addRoot" style="width:100%;margin-bottom:10px">+ 新增大类</button>
        ${roots.map(r => `
          <div class="cat-blk">
            <div class="cat-r">
              <span class="cat-n">${esc(r.name)}</span>
              <span class="cat-a">
                <button class="mini" data-act="addKid" data-v="${r.id}">+小类</button>
                <button class="mini" data-act="ren" data-v="${r.id}">改名</button>
                <button class="mini" data-act="rm" data-v="${r.id}">删</button>
              </span>
            </div>
            ${kidCats(r.id).sort(byOrder).map(k => `
              <div class="cat-r kid">
                <span class="cat-n">${esc(k.name)}</span>
                <span class="cat-a">
                  <button class="mini" data-act="ren" data-v="${k.id}">改名</button>
                  <button class="mini" data-act="rm" data-v="${k.id}">删</button>
                </span>
              </div>`).join('')}
          </div>`).join('') || '<div class="hint">还没有分类</div>'}
        <div class="hint">删除前需保证该分类下没有小类、也没有流水记录。</div>`;
    };

    const refresh = async () => { await load(); draw(); render(); };
    const used = id => S.transactions.some(t => t.categoryId === id);

    bd.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      const id = +b.dataset.v;
      if (act === 'type') { type = b.dataset.v; draw(); }
      else if (act === 'addRoot' || act === 'addKid') {
        const name = prompt(act === 'addRoot' ? '新大类名称' : '新小类名称');
        if (!name?.trim()) return;
        await put('categories', {
          type, parentId: act === 'addRoot' ? null : id,
          name: name.trim(), useCount: 0, order: nextOrder()
        });
        await refresh();
      } else if (act === 'ren') {
        const c = catById(id);
        const name = prompt('修改名称', c.name);
        if (!name?.trim()) return;
        c.name = name.trim();
        await put('categories', c);
        await refresh();
      } else if (act === 'rm') {
        const c = catById(id);
        if (S.categories.some(x => x.parentId === id)) return toast('请先删除该大类下的小类');
        if (used(id)) return toast('该分类已有流水记录,不能删除');
        if (!confirm('删除分类「' + c.name + '」?')) return;
        await del('categories', id);
        await refresh();
      }
    });
    draw();
  });
}

/* ---------- 导出 / 导入 ---------- */
function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportJson() {
  const data = {
    app: 'moneytrack', version: 1, exportedAt: new Date().toISOString(),
    accounts: S.accounts, categories: S.categories, transactions: S.transactions,
    transfers: S.transfers, adjustments: S.adjustments
  };
  const text = JSON.stringify(data, null, 2);
  if (typeof Android !== 'undefined' && Android.saveJson) {
    Android.saveJson(text);
  } else {
    download('记账备份-' + dayStr() + '.json', text, 'application/json');
  }
}

function exportCsv() {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const head = ['日期', '类型', '大类', '小类', '金额', '账户', '备注'];
  const rows = [...S.transactions].sort((a, b) => (a.date < b.date ? -1 : 1)).map(t => {
    const c = catById(t.categoryId);
    return [
      t.date, t.type === 'in' ? '收入' : '支出',
      c?.parentId ? catName(c.parentId) : (c?.name || '未分类'),
      c?.parentId ? c.name : '',
      yuan(t.amountCent), accById(t.accountId)?.name || '', t.note || ''
    ];
  });
  const csv = '\ufeff' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n');
  download('记账明细-' + dayStr() + '.csv', csv, 'text/csv;charset=utf-8');
  toast('已导出 CSV');
}

async function importFile(ev) {
  const f = ev.target.files?.[0];
  ev.target.value = '';
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch { return toast('文件解析失败'); }
  if (!data || !Array.isArray(data.transactions)) return toast('不是有效的备份文件');

  sheet('导入数据', (bd, close) => {
    bd.innerHTML = `
      <div class="hint">文件包含:账户 <b>${(data.accounts || []).length}</b> 个 · 分类 <b>${(data.categories || []).length}</b> 个 · 流水 <b>${data.transactions.length}</b> 笔 · 转账 <b>${(data.transfers || []).length}</b> 笔。</div>
      <div class="hint">导入会用文件内容<b>覆盖</b>当前全部数据,覆盖前会自动导出一份当前备份。</div>
      <div class="btns"><button class="btn" data-act="ok">覆盖导入</button><button class="btn ghost" data-act="no">取消</button></div>`;
    bd.addEventListener('click', async ev => {
      const b = ev.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'no') return close();
      exportJson();
      await wipe();
      for (const n of STORES) {
        const rows = n === 'balance_adjustments' ? (data.adjustments || []) : (data[n] || []);
        for (const r of rows) await put(n, r);
      }
      await load();
      await seedIfEmpty();
      close();
      render();
      toast('导入完成');
    });
  });
}

/* ---------- 路由与事件 ---------- */
let view = 'entry';

function render() {
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === view));
  const root = $('#view');
  root.innerHTML = '';
  if (view === 'entry') renderEntry(root);
  else if (view === 'list') renderList(root);
  else if (view === 'stats') renderStats(root);
  else renderAccounts(root);
}

const ACTIONS = {
  mprev: () => shiftMonth(-1),
  mnext: () => shiftMonth(1),
  mAll: () => { L.all = !L.all; render(); },
  ftype: d => { L.type = d.v; render(); },
  tx: d => txEdit(+d.v),
  sprev: () => shiftStatMonth(-1),
  snext: () => shiftStatMonth(1),
  pick: d => pickSlice(+d.v),
  udrill: () => { ST.drill = null; render(); },
  accNew: () => accForm(null),
  accOpen: d => accSheet(+d.v),
  trNew: () => transferForm(),
  trOpen: d => transferOpen(+d.v),
  catMgr: () => catMgr(),
  expJson: () => exportJson(),
  expCsv: () => exportCsv(),
  imp: () => $('#file').click()
};

function bindGlobal() {
  $('#tabs').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-tab]');
    if (!b) return;
    view = b.dataset.tab;
    render();
  });
  $('#view').addEventListener('click', ev => {
    if (ev.target.closest('.editor')) return;
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    ACTIONS[b.dataset.act]?.(b.dataset);
  });
  $('#view').addEventListener('change', ev => {
    const act = ev.target.dataset.act;
    if (act === 'facc') { L.accId = ev.target.value === 'all' ? 'all' : +ev.target.value; render(); }
    else if (act === 'fcat') { L.catId = ev.target.value === 'all' ? 'all' : +ev.target.value; render(); }
  });
  $('#file').addEventListener('change', importFile);
}

async function boot() {
  idb = await openDB();
  if (!idb) lsMode = true;
  await load();
  await seedIfEmpty();
  bindGlobal();
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();

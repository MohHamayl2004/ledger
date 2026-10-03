'use strict';
/* ================================================================
   إدارة الطلبيات — منطق الواجهة
   ================================================================ */

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const ico = (n) => window.Icons.svg(n);
const C = window.Calc;

let DB = null;
let saveTimer = null;

/* ------------------------- أدوات مساعدة ------------------------- */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const money = (n) => {
  const v = C.round2(C.num(n));
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const shekel = (n) => `<span class="num">${money(n)} ₪</span>`;

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const thisMonth = () => todayStr().slice(0, 7);

const MONTH_NAMES = ['كانون الثاني','شباط','آذار','نيسان','أيار','حزيران','تموز','آب','أيلول','تشرين الأول','تشرين الثاني','كانون الأول'];
const monthLabel = (m) => {
  if (!m) return '';
  const [y, mo] = m.split('-');
  return `${MONTH_NAMES[+mo - 1]} ${y}`;
};
const dateLabel = (d) => {
  if (!d) return '—';
  const [y, m, day] = String(d).split('-');
  return `${day}/${m}/${y}`;
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DELIVERY_TYPES = {
  delivery: { label: 'توصيل', cls: 'blue', icon: 'truck' },
  pickup: { label: 'نقطة استلام', cls: 'purple', icon: 'box' }
};
const dtypeBadge = (t) => {
  const d = DELIVERY_TYPES[t] || DELIVERY_TYPES.delivery;
  return `<span class="badge ${d.cls}">${ico(d.icon)}${d.label}</span>`;
};
const isPickup = (o) => o && o.deliveryType === 'pickup';

const STATUS = {
  pending: { label: 'قيد الانتظار', cls: 'amber', icon: 'clock' },
  delivered: { label: 'مستلمة', cls: 'green', icon: 'check' },
  returned: { label: 'راجعة', cls: 'rose', icon: 'arrowDown' }
};
const statusBadge = (s) => {
  const t = STATUS[s] || STATUS.pending;
  return `<span class="badge ${t.cls}">${ico(t.icon)}${t.label}</span>`;
};

function toast(msg, type = 'ok', ms = 3200) {
  const icons = { ok: 'check', err: 'warn', warn: 'warn', info: 'info' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `${ico(icons[type] || 'info')}<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 200);
  }, ms);
}

/* النوافذ */
let lastFocused = null;
function openModal(id) {
  lastFocused = document.activeElement;
  const m = $(id);
  m.classList.add('open');
  const f = m.querySelector('input:not([type=hidden]), select, textarea, button');
  setTimeout(() => f && f.focus(), 60);
}
function closeModal(id) {
  $(id).classList.remove('open');
  if (lastFocused && document.body.contains(lastFocused)) lastFocused.focus();
}
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-close]');
  if (c) { const ov = c.closest('.overlay'); if (ov) ov.classList.remove('open'); }
  const ov = e.target.classList && e.target.classList.contains('overlay') ? e.target : null;
  if (ov) ov.classList.remove('open');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const open = $$('.overlay.open').pop();
    if (open) open.classList.remove('open');
  }
});

let confirmCb = null;
function confirmBox(title, text, okLabel, cb) {
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  $('#confirmOk').textContent = okLabel || 'تأكيد';
  confirmCb = cb;
  openModal('#confirmModal');
}

/* حفظ */
function save(immediate) {
  clearTimeout(saveTimer);
  const doSave = async () => {
    const r = await window.api.data.save(DB);
    if (!r.ok) toast('فشل الحفظ: ' + r.error, 'err', 6000);
  };
  if (immediate) return doSave();
  saveTimer = setTimeout(doSave, 350);
}

/* التحقق من الحقول */
function markField(input, invalid) {
  const f = input.closest('.field');
  if (f) f.classList.toggle('invalid', !!invalid);
  return !invalid;
}

/* ================================================================
   التنقّل
   ================================================================ */

const VIEW_META = {
  dashboard: ['لوحة التحكم', 'نظرة سريعة على شغلك'],
  orders: ['الطلبيات', 'كل طلبياتك مع الفلاتر'],
  customers: ['الزبائن', 'بيانات الزبائن المحفوظة'],
  ledgers: ['الأرصدة', 'حسابك مع كل شخص'],
  expenses: ['الرسوم والمصاريف', 'كل شي بتدفعه وبينخصم من ربحك'],
  reports: ['التقارير والأرباح', 'الربح حسب الشهر'],
  united: ['ربط يونايتد', 'إرسال الطلبيات تلقائياً لشركة التوصيل'],
  settings: ['الإعدادات', 'الحسابات والبيانات']
};

let currentView = 'dashboard';
function go(view) {
  currentView = view;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  const m = VIEW_META[view] || ['', ''];
  $('#pageTitle').textContent = m[0];
  $('#pageSub').textContent = m[1];
  renderView(view);
}

function renderView(v) {
  if (v === 'dashboard') renderDashboard();
  else if (v === 'orders') renderOrders();
  else if (v === 'customers') renderCustomers();
  else if (v === 'ledgers') renderLedgers();
  else if (v === 'expenses') renderExpenses();
  else if (v === 'reports') renderReports();
  else if (v === 'united') renderUnited();
  else if (v === 'settings') renderSettings();
  window.Icons.paint();
}

function refreshAll() {
  renderView(currentView);
  updateBadges();
  window.Icons.paint();
}

function updateBadges() {
  const pending = DB.orders.filter((o) => o.status === 'pending').length;
  const bp = $('#badgePending');
  bp.textContent = pending;
  bp.classList.toggle('hidden', pending === 0);

  const th = C.num(DB.settings.lowBalanceThreshold);
  const low = DB.ledgers.filter((l) => C.ledgerBalance(l) < th).length;
  const bl = $('#badgeLow');
  bl.textContent = low;
  bl.classList.toggle('hidden', low === 0);

}

/* ================================================================
   لوحة التحكم
   ================================================================ */

function statCard(icoName, color, label, value, foot, valueCls) {
  return `<div class="stat">
    <div class="stat-top"><div class="stat-ico ${color}">${ico(icoName)}</div><div class="stat-label">${esc(label)}</div></div>
    <div class="stat-value ${valueCls || ''}">${value}</div>
    ${foot ? `<div class="stat-foot">${foot}</div>` : ''}
  </div>`;
}

function renderDashboard() {
  const s = DB.settings;
  const m = thisMonth();
  const monthOrders = DB.orders.filter((o) => C.monthKey(o.date) === m);
  const sum = C.summarize(monthOrders, s);
  const allSum = C.summarize(DB.orders, s);
  const pending = DB.orders.filter((o) => o.status === 'pending');
  const expMonth = C.summarizeExpenses(C.expensesInRange(DB.expenses, m, m));
  const expAll = C.summarizeExpenses(DB.expenses);
  const netMonth = C.netAfterExpenses(sum, expMonth);
  const netAll = C.netAfterExpenses(allSum, expAll);

  $('#dashStats').innerHTML = [
    statCard('coins', 'green', `ربح ${monthLabel(m)}`, shekel(netMonth), `بعد خصم رسوم ${money(expMonth.total)} ₪`, netMonth < 0 ? 'neg' : 'pos'),
    statCard('box', 'blue', 'طلبيات هذا الشهر', `<span class="num">${sum.count}</span>`, `${sum.delivered} مستلمة · ${sum.returned} راجعة`),
    statCard('clock', 'amber', 'قيد الانتظار', `<span class="num">${pending.length}</span>`, `ربح متوقع ${money(sum.expectedPending)} ₪`),
    statCard('chart', 'purple', 'الربح الكلي', shekel(netAll), `${allSum.count} طلبية · رسوم ${money(expAll.total)} ₪`, netAll < 0 ? 'neg' : 'pos')
  ].join('');

  // التنبيهات
  const alerts = [];
  const th = C.num(s.lowBalanceThreshold);
  const low = DB.ledgers.filter((l) => C.ledgerBalance(l) < th);
  if (low.length) {
    alerts.push(`<div class="alert warn">${ico('warn')}<div><b>رصيد منخفض عند ${low.length} ${low.length === 1 ? 'شخص' : 'أشخاص'}</b> —
      ${low.slice(0, 5).map((l) => `${esc(l.name)} <span class="num">(${money(C.ledgerBalance(l))} ₪)</span>`).join(' · ')}${low.length > 5 ? ' …' : ''}
      </div><button class="btn btn-sm" data-goto="ledgers">فتح الأرصدة</button></div>`);
  }
  const late = pending.filter((o) => o.date < todayStr());
  if (late.length) {
    alerts.push(`<div class="alert danger">${ico('warn')}<div><b>${late.length} طلبية متأخرة</b> — تاريخها عدّى ولسا قيد الانتظار.</div>
      <button class="btn btn-sm" data-goto="orders">مراجعتها</button></div>`);
  }
  $('#dashAlerts').innerHTML = alerts.join('');

  // آخر الطلبيات
  const recent = [...DB.orders].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 7);
  $('#dashRecent').innerHTML = recent.length ? `<table><thead><tr>
      <th>الزبون</th><th>التاريخ</th><th>السعر</th><th>الربح</th><th>الحالة</th></tr></thead><tbody>
      ${recent.map((o) => {
        const p = o.status === 'pending' ? C.expectedProfit(o, s) : C.orderProfit(o, s);
        return `<tr data-order="${o.id}" style="cursor:pointer">
        <td class="nowrap"><div class="cell-strong">${esc(o.customerName)}</div><div class="cell-sub num">${esc(o.phone)}</div></td>
        <td class="num">${dateLabel(o.date)}</td>
        <td>${shekel(o.price)}</td>
        <td class="cell-strong ${p < 0 ? 'neg' : p > 0 ? 'pos' : 'text-faint'}">${shekel(p)}${o.status === 'pending' ? '<div class="cell-sub">متوقع</div>' : ''}</td>
        <td>${statusBadge(o.status)}</td></tr>`; }).join('')}
    </tbody></table>` : emptyBox('box', 'ما في طلبيات بعد', 'اضغط «طلبية جديدة» لتبدأ');

  // طلبيات اليوم
  const today = DB.orders
    .filter((o) => o.expectedDate === todayStr() || (!o.expectedDate && o.date === todayStr()))
    .sort((a, b) => (a.customerName || '').localeCompare(b.customerName || '', 'ar'));
  $('#todayCount').textContent = today.length;
  $('#dashToday').innerHTML = today.length ? `<table><thead><tr>
      <th>النوع</th><th>الزبون</th><th>العنوان</th><th>الحالة</th></tr></thead><tbody>
      ${today.map((o) => `<tr data-order="${o.id}" style="cursor:pointer">
        <td>${dtypeBadge(o.deliveryType)}</td>
        <td class="nowrap"><div class="cell-strong">${esc(o.customerName)}</div><div class="cell-sub num">${esc(o.phone)}</div></td>
        <td class="fs-13 truncate" title="${esc(o.address1)} ${esc(o.address2)}"><div>${esc(o.address1)}</div>${o.address2 ? `<div class="cell-sub">${esc(o.address2)}</div>` : ''}</td>
        <td>${statusBadge(o.status)}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('clock', 'ما في طلبيات اليوم', 'ولا طلبية مجدولة لليوم');
}

function emptyBox(icon, title, sub) {
  return `<div class="empty">${ico(icon)}<h4>${esc(title)}</h4><p>${esc(sub || '')}</p></div>`;
}

/* ================================================================
   الطلبيات
   ================================================================ */

let orderFilter = { status: 'all', month: '', q: '', platform: '' };

function filteredOrders() {
  const q = orderFilter.q.trim().toLowerCase();
  const qPhone = C.normalizePhone(q);
  return DB.orders
    .filter((o) => orderFilter.status === 'all' || o.status === orderFilter.status)
    .filter((o) => !orderFilter.month || C.monthKey(o.date) === orderFilter.month)
    .filter((o) => !orderFilter.platform || platKey(o) === orderFilter.platform)
    .filter((o) => {
      if (!q) return true;
      const inName = String(o.customerName || '').toLowerCase().includes(q);
      const inAddr = (String(o.address1 || '') + ' ' + String(o.address2 || '')).toLowerCase().includes(q);
      const inPhone = qPhone && C.normalizePhone(o.phone).includes(qPhone);
      return inName || inAddr || inPhone;
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function fillOrdersPlatform() {
  const sel = $('#ordersPlatform');
  sel.innerHTML = `<option value="">كل البرامج</option>` +
    allPlatformKeys().map((k) => `<option value="${esc(k)}">${esc(platName(k))}</option>`).join('');
  if (orderFilter.platform && !allPlatformKeys().includes(orderFilter.platform)) orderFilter.platform = '';
  sel.value = orderFilter.platform;
}

function renderOrders() {
  fillOrdersPlatform();
  const s = DB.settings;
  const list = filteredOrders();
  const sum = C.summarize(list, s);

  $('#ordersStats').innerHTML = [
    statCard('box', 'blue', 'عدد الطلبيات', `<span class="num">${sum.count}</span>`, `${sum.pieces} قطعة`),
    statCard('coins', 'green', 'الربح الصافي', shekel(sum.netProfit), `من ${sum.delivered} طلبية مستلمة`, sum.netProfit < 0 ? 'neg' : 'pos'),
    statCard('arrowDown', 'rose', 'خسائر الراجعة', shekel(sum.losses), `${sum.returned} طلبية راجعة`, sum.losses > 0 ? 'neg' : ''),
    statCard('clock', 'amber', 'متوقع من الانتظار', shekel(sum.expectedPending), `${sum.pending} قيد الانتظار`),
    statCard('box', 'purple', 'نقاط الاستلام', `<span class="num">${sum.pickup}</span>`, `تكلفة ${money(sum.pickupCost)} ₪`, sum.pickupCost > 0 ? 'neg' : '')
  ].join('');
  updateBulkBar();

  $('#ordersTable').innerHTML = list.length ? `<table class="wide"><thead><tr>
      <th style="width:34px"><input type="checkbox" id="selAll" title="تحديد الكل" style="width:16px;height:16px"></th>
      <th>التاريخ / المتوقع</th><th>الزبون</th><th>العنوان</th><th>البرنامج</th><th>القطع</th>
      <th>السعر / التوصيل</th><th>الربح / النسبة</th><th>الحالة</th><th></th>
    </tr></thead><tbody>
    ${list.map((o) => {
      const p = C.orderProfit(o, s);
      const expected = o.status === 'pending';
      const pickup = isPickup(o);
      return `<tr>
        <td><input type="checkbox" class="rowSel" data-sel="${o.id}" ${selectedOrders.has(o.id) ? 'checked' : ''} style="width:16px;height:16px"></td>
        <td><div class="cell-strong num">${dateLabel(o.date)}</div>
          <div class="cell-sub num">${o.expectedDate ? '→ ' + dateLabel(o.expectedDate) : '—'}</div></td>
        <td class="nowrap"><div class="cell-strong">${esc(o.customerName)}</div><div class="cell-sub num">${esc(o.phone)}</div></td>
        <td class="truncate" title="${esc(o.address1)} ${esc(o.address2)}">
          <div>${esc(o.address1)}</div>${o.address2 ? `<div class="cell-sub">${esc(o.address2)}</div>` : ''}</td>
        <td class="nowrap"><div class="fs-13">${esc(o.platform) || '—'}</div>
          <div class="cell-sub">${pickup ? 'نقطة استلام' : 'توصيل'}</div></td>
        <td class="num">${C.num(o.pieces)}</td>
        <td><div class="cell-strong">${shekel(o.price)}</div>
          <div class="cell-sub">${pickup ? 'استلام ' : 'توصيل '}${shekel(o.deliveryPrice)}</div></td>
        <td><div class="cell-strong ${p < 0 ? 'neg' : p > 0 ? 'pos' : 'text-faint'}">${shekel(expected ? C.expectedProfit(o, s) : p)}</div>
          <div class="cell-sub num">${C.num(o.profitPercent)}%${expected ? ' · متوقع' : ''}</div></td>
        <td>${statusBadge(o.status)}
          ${o.unitedId ? `<div class="cell-sub" title="رقم الطلبية عند يونايتد">${ico('send')} <span class="num">${esc(o.unitedRef || o.unitedId)}</span></div>` : ''}
          ${o.statusSource === 'united' ? '<div class="cell-sub text-faint">من يونايتد</div>' : ''}</td>
        <td class="actions">
          ${pickup
            ? `<button class="btn btn-sm btn-icon btn-ghost" disabled title="نقطة استلام — ما بترفع ليونايتد" aria-label="نقطة استلام" style="opacity:.3">${ico('send')}</button>`
            : `<button class="btn btn-sm btn-icon btn-ghost" data-act="send" data-id="${o.id}" title="${o.unitedId ? 'مرسلة ليونايتد' : 'رفع ليونايتد'}" aria-label="رفع ليونايتد" style="color:${o.unitedId ? 'var(--text-faint)' : 'var(--info)'}">${ico('send')}</button>`}
          <button class="btn btn-sm btn-icon btn-ghost" data-act="view" data-id="${o.id}" title="عرض" aria-label="عرض">${ico('eye')}</button>
          <button class="btn btn-sm btn-icon btn-ghost" data-act="edit" data-id="${o.id}" title="تعديل" aria-label="تعديل">${ico('edit')}</button>
          ${o.status !== 'delivered' ? `<button class="btn btn-sm btn-icon btn-ghost" data-act="deliver" data-id="${o.id}" title="تحديد كمستلمة" aria-label="تحديد كمستلمة" style="color:var(--primary)">${ico('check')}</button>` : ''}
          ${o.status !== 'returned' ? `<button class="btn btn-sm btn-icon btn-ghost" data-act="return" data-id="${o.id}" title="تحديد كراجعة" aria-label="تحديد كراجعة" style="color:var(--warn)">${ico('arrowDown')}</button>` : ''}
          <button class="btn btn-sm btn-icon btn-ghost" data-act="del" data-id="${o.id}" title="حذف" aria-label="حذف" style="color:var(--danger)">${ico('trash')}</button>
        </td></tr>`;
    }).join('')}</tbody></table>`
    : emptyBox('box', 'ما في نتائج', 'جرّب تغيّر الفلاتر أو أضف طلبية جديدة');
}

/* ------- تحديد الطلبيات ورفعها دفعة ------- */

const selectedOrders = new Set();

function selectableIds() {
  return filteredOrders().filter((o) => !isPickup(o) && !o.unitedId).map((o) => o.id);
}

function updateBulkBar() {
  const n = selectedOrders.size;
  const btn = $('#bulkSend');
  if (!btn) return;
  $('#bulkCount').textContent = n;
  btn.disabled = n === 0;
  const all = $('#selAll');
  if (all) {
    const ids = filteredOrders().map((o) => o.id);
    all.checked = ids.length > 0 && ids.every((id) => selectedOrders.has(id));
  }
}

async function bulkSendToUnited() {
  const ids = [...selectedOrders];
  const orders = ids.map((id) => DB.orders.find((o) => o.id === id)).filter(Boolean);
  const pickups = orders.filter(isPickup);
  const already = orders.filter((o) => o.unitedId && !isPickup(o));
  const todo = orders.filter((o) => !isPickup(o) && !o.unitedId);

  if (!todo.length) {
    toast(pickups.length ? 'المحدّد كله نقاط استلام — ما بترفع ليونايتد' : 'المحدّد كله مرفوع أصلاً', 'warn', 6000);
    return;
  }

  const notes = [];
  if (pickups.length) notes.push(`${pickups.length} نقطة استلام (ما بترفع)`);
  if (already.length) notes.push(`${already.length} مرفوعة أصلاً`);

  confirmBox('رفع دفعة ليونايتد',
    `رح يترفع ${todo.length} طلبية ليونايتد${notes.length ? ' — وينتجاهل ' + notes.join(' و') : ''}. متابعة؟`,
    'ارفع', async () => {
      $('#runLog').innerHTML = '';
      $('#runStatus').innerHTML = `<div class="alert info">${ico('refresh')}<div>جاري رفع ${todo.length} طلبية…</div></div>`;
      window.Icons.paint($('#runStatus'));
      openModal('#runModal');

      let done = 0;
      let failed = 0;
      for (const o of todo) {
        logLine('#runLog', `↑ ${o.customerName} (${dateLabel(o.date)})…`, 'info');
        const r = await sendViaWeb(Object.assign({ name: o.customerName }, o), true, o.id);
        if (r && r.ok) { done++; logLine('#runLog', `  ✓ تم — ${r.data.ref || r.data.id}`, 'ok'); }
        else { failed++; logLine('#runLog', `  ✗ ${(r && r.error) || 'فشل'}`, 'error'); }
      }

      $('#runStatus').innerHTML = failed
        ? `<div class="alert warn">${ico('warn')}<div><b>خلص الرفع</b><br>نجح ${done} · فشل ${failed}</div></div>`
        : `<div class="alert ok">${ico('check')}<div><b>تم رفع ${done} طلبية بنجاح</b></div></div>`;
      window.Icons.paint($('#runStatus'));
      selectedOrders.clear();
      refreshAll();
      toast(failed ? `نجح ${done} وفشل ${failed}` : `تم رفع ${done} طلبية`, failed ? 'warn' : 'ok', 6000);
    });
}

/* ------- نافذة الطلبية ------- */
let editingOrderId = null;

function openOrderModal(id) {
  editingOrderId = id || null;
  const o = id ? DB.orders.find((x) => x.id === id) : null;
  $('#orderModalTitle').textContent = o ? 'تعديل طلبية' : 'إضافة طلبية';
  $$('#orderForm .field').forEach((f) => f.classList.remove('invalid'));

  $('#oPhone').value = o ? o.phone || '' : '';
  $('#oName').value = o ? o.customerName || '' : '';
  $('#oAddr1').value = o ? o.address1 || '' : '';
  pickedAreaId = o ? (o.address1Id || null) : null;
  $('#oAddr2').value = o ? o.address2 || '' : '';
  $('#oPieces').value = o ? o.pieces : 1;
  $('#oPrice').value = o ? o.price : '';
  $('#oDelivery').value = o ? o.deliveryPrice : '';
  $('#oPct').value = o ? o.profitPercent : C.num(DB.settings.defaultProfitPercent);
  $('#oDate').value = o ? o.date : todayStr();
  $('#oExpDate').value = o ? o.expectedDate || '' : '';
  $('#oStatus').value = o ? o.status : 'pending';
  $('#oNotes').value = o ? o.notes || '' : '';

  // البرامج
  renderPlatformOptions();
  $('#oPlatform').value = o ? (o.platform || '') : '';

  // نوع التسليم
  setDeliveryType(o ? (o.deliveryType || 'delivery') : 'delivery', !o);

  updateProfitPreview();
  updateAreaHint();
  openModal('#orderModal');
}

function platforms() { return DB.settings.platforms || []; }

function renderPlatformOptions() {
  $('#oPlatform').innerHTML = '<option value="">— بدون —</option>' +
    platforms().map((p) => `<option value="${esc(p.name)}">${esc(p.name)} — ${C.num(p.percent)}%</option>`).join('');
}

let currentDeliveryType = 'delivery';

function setDeliveryType(type, applyDefaults) {
  currentDeliveryType = type === 'pickup' ? 'pickup' : 'delivery';
  $$('#oDeliveryType .chip').forEach((c) => c.classList.toggle('active', c.dataset.dtype === currentDeliveryType));
  const pickup = currentDeliveryType === 'pickup';
  const fee = C.num(DB.settings.pickupFee === undefined ? 5 : DB.settings.pickupFee);
  const dInput = $('#oDelivery');
  dInput.disabled = pickup;
  if (pickup) dInput.value = fee;
  else if (applyDefaults) dInput.value = '';
  $('#dtypeHint').innerHTML = pickup
    ? `تكلفة نقطة الاستلام <b>${money(fee)} ₪</b> بتنخصم من ربحك، والطلبية <b>ما بترفع ليونايتد</b>.`
    : 'الطلبية بتقدر ترفعها ليونايتد من زر ✈ بجدول الطلبيات.';
  updateProfitPreview();
}

function updateProfitPreview() {
  const o = {
    price: $('#oPrice').value,
    deliveryPrice: $('#oDelivery').value,
    profitPercent: $('#oPct').value,
    status: $('#oStatus').value,
    deliveryType: currentDeliveryType
  };
  const p = C.orderProfit(o, DB.settings);
  const shown = o.status === 'pending' ? C.expectedProfit(o, DB.settings) : p;
  const el = $('#oProfitPreview');
  el.innerHTML = `<span class="num">${money(shown)} ₪</span>` +
    (o.status === 'pending' ? ' <span class="text-faint fs-12">(متوقع)</span>' : '');
  el.className = 'cell-strong ' + (shown < 0 ? 'neg' : 'pos');
}

function saveOrder() {
  const phone = $('#oPhone').value.trim();
  const name = $('#oName').value.trim();
  const addr1 = $('#oAddr1').value.trim();
  const pieces = parseInt($('#oPieces').value, 10);
  const price = parseFloat($('#oPrice').value);
  const date = $('#oDate').value;

  let valid = true;
  valid = markField($('#oPhone'), !phone) && valid;
  valid = markField($('#oName'), !name) && valid;
  valid = markField($('#oAddr1'), !addr1) && valid;
  valid = markField($('#oPieces'), !(pieces > 0)) && valid;
  valid = markField($('#oPrice'), !(Number.isFinite(price) && price >= 0)) && valid;
  valid = markField($('#oDate'), !date) && valid;
  if (!valid) { toast('في حقول ناقصة، راجعها من فضلك', 'err'); return; }

  const cust = upsertCustomer({ name, phone, address1: addr1, address2: $('#oAddr2').value.trim(), areaId: pickedAreaId || null });

  const pickup = currentDeliveryType === 'pickup';
  const payload = {
    customerId: cust.id,
    customerName: name,
    phone,
    address1: addr1,
    address1Id: pickedAreaId || null,
    address2: $('#oAddr2').value.trim(),
    platform: $('#oPlatform').value,
    deliveryType: currentDeliveryType,
    pieces,
    price,
    deliveryPrice: pickup ? C.num(DB.settings.pickupFee === undefined ? 5 : DB.settings.pickupFee) : C.num($('#oDelivery').value),
    profitPercent: C.num($('#oPct').value),
    date,
    expectedDate: $('#oExpDate').value,
    status: $('#oStatus').value,
    notes: $('#oNotes').value.trim()
  };

  if (editingOrderId) {
    const o = DB.orders.find((x) => x.id === editingOrderId);
    Object.assign(o, payload, { updatedAt: new Date().toISOString() });
    toast('تم تعديل الطلبية');
  } else {
    DB.orders.push(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, payload));
    toast('تمت إضافة الطلبية');
  }
  save(true);
  closeModal('#orderModal');
  refreshAll();

  editingOrderId = null;
}

function setStatus(id, status) {
  const o = DB.orders.find((x) => x.id === id);
  if (!o) return;
  o.status = status;
  o.updatedAt = new Date().toISOString();
  save(true);
  refreshAll();
  toast(status === 'delivered' ? 'تم تحديد الطلبية كمستلمة' : status === 'returned' ? 'تم تحديد الطلبية كراجعة' : 'تم التحديث');
}

function deleteOrder(id) {
  const o = DB.orders.find((x) => x.id === id);
  if (!o) return;
  confirmBox('حذف طلبية', `متأكد إنك بدك تحذف طلبية «${o.customerName}» بتاريخ ${dateLabel(o.date)}؟ ما في تراجع.`, 'حذف', () => {
    DB.orders = DB.orders.filter((x) => x.id !== id);
    save(true);
    refreshAll();
    toast('تم حذف الطلبية');
  });
}

function viewOrder(id) {
  const o = DB.orders.find((x) => x.id === id);
  if (!o) return;
  const s = DB.settings;
  const p = C.orderProfit(o, s);
  $('#viewBody').innerHTML = `
    <div class="flex mb-5" style="justify-content:space-between">
      <div><div class="stat-label">الزبون</div><h3 style="font-size:19px">${esc(o.customerName)}</h3>
        <div class="cell-sub num">${esc(o.phone)}</div></div>
      ${statusBadge(o.status)}
    </div>
    <dl class="kv">
      <dt>العنوان الأول</dt><dd>${esc(o.address1) || '—'}</dd>
      <dt>العنوان التفصيلي</dt><dd>${esc(o.address2) || '—'}</dd>
      <dt>عدد القطع</dt><dd class="num">${C.num(o.pieces)}</dd>
      <dt>سعر الطلبية</dt><dd>${shekel(o.price)}</dd>
      <dt>${isPickup(o) ? 'تكلفة نقطة الاستلام' : 'سعر التوصيل'}</dt><dd>${shekel(o.deliveryPrice)}</dd>
      <dt>نسبة الربح</dt><dd class="num">${C.num(o.profitPercent)}%</dd>
      <dt>تاريخ الطلبية</dt><dd class="num">${dateLabel(o.date)}</dd>
      <dt>التاريخ المتوقع</dt><dd class="num">${o.expectedDate ? dateLabel(o.expectedDate) : '—'}</dd>
      <dt>البرنامج</dt><dd>${esc(o.platform) || '—'}</dd>
      <dt>نوع التسليم</dt><dd>${dtypeBadge(o.deliveryType)}${isPickup(o) ? ` <span class="fs-12 neg">(تكلفة ${money(C.pickupCost(o, s))} ₪)</span>` : ''}</dd>
      <dt>الربح ${o.status === 'pending' ? 'المتوقع' : 'المحقّق'}</dt>
      <dd class="cell-strong ${(o.status === 'pending' ? C.expectedProfit(o, s) : p) < 0 ? 'neg' : 'pos'}">
        ${shekel(o.status === 'pending' ? C.expectedProfit(o, s) : p)}</dd>
      ${o.notes ? `<dt>ملاحظات</dt><dd style="font-weight:500">${esc(o.notes)}</dd>` : ''}
      ${o.unitedId ? `<dt>رقمها عند يونايتد</dt><dd><span class="num">${esc(o.unitedRef || o.unitedId)}</span>
        ${o.unitedUrl ? ` · <a href="#" data-uopen="${esc(o.unitedUrl)}">فتحها على الموقع</a>` : ''}</dd>` : ''}
      ${o.statusSource === 'united' ? `<dt>مصدر الحالة</dt><dd class="text-faint fs-13">محدّثة تلقائياً من يونايتد</dd>` : ''}
    </dl>`;
  $('#viewFoot').innerHTML = `
    <button class="btn" data-close>إغلاق</button>
    <div class="spacer"></div>
    ${o.status !== 'delivered' ? `<button class="btn" data-act="deliver" data-id="${o.id}" style="color:var(--primary)">${ico('check')}مستلمة</button>` : ''}
    ${o.status !== 'returned' ? `<button class="btn" data-act="return" data-id="${o.id}" style="color:var(--warn)">${ico('arrowDown')}راجعة</button>` : ''}
    <button class="btn btn-primary" data-act="edit" data-id="${o.id}">${ico('edit')}تعديل</button>`;
  openModal('#viewModal');
}

/* ------- اقتراحات الزبائن ------- */

function findCustomerByPhone(phone) {
  const n = C.normalizePhone(phone);
  if (!n || n.length < 4) return null;
  return DB.customers.find((c) => C.normalizePhone(c.phone) === n) || null;
}

function upsertCustomer(info) {
  const existing = findCustomerByPhone(info.phone);
  if (existing) {
    existing.name = info.name || existing.name;
    if (info.address1) existing.address1 = info.address1;
    if (info.address2) existing.address2 = info.address2;
    if (info.areaId) existing.areaId = info.areaId;
    existing.updatedAt = new Date().toISOString();
    return existing;
  }
  const c = Object.assign({ id: uid(), notes: '', createdAt: new Date().toISOString() }, info);
  DB.customers.push(c);
  return c;
}

function fillFromCustomer(c, keepPhone) {
  $('#oName').value = c.name || '';
  if (!keepPhone) $('#oPhone').value = c.phone || '';
  $('#oAddr1').value = c.address1 || '';
  $('#oAddr2').value = c.address2 || '';
  pickedAreaId = c.areaId || null;
  updateAreaHint();
  $$('#orderForm .field').forEach((f) => f.classList.remove('invalid'));
  toast(`تم تعبئة بيانات «${c.name}»`, 'info', 2200);
}

function wireSuggest(inputSel, boxSel, matcher) {
  const input = $(inputSel);
  const box = $(boxSel);
  let items = [];
  let sel = -1;

  const close = () => { box.classList.remove('open'); sel = -1; };

  const render = () => {
    if (!items.length) return close();
    box.innerHTML = items.map((c, i) =>
      `<div class="suggest-item ${i === sel ? 'sel' : ''}" data-cid="${c.id}">
        <b>${esc(c.name)}</b><span class="num">${esc(c.phone)}</span></div>`).join('');
    box.classList.add('open');
  };

  input.addEventListener('input', () => {
    const v = input.value.trim();
    items = v.length >= 2 ? matcher(v).slice(0, 8) : [];
    sel = -1;
    render();
    // تعبئة تلقائية فورية عند تطابق الرقم بالكامل
    if (inputSel === '#oPhone') {
      const exact = findCustomerByPhone(v);
      if (exact && C.normalizePhone(v).length >= 7 && !$('#oName').value.trim()) {
        fillFromCustomer(exact, true);
        close();
      }
    }
  });

  input.addEventListener('keydown', (e) => {
    if (!box.classList.contains('open')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); fillFromCustomer(items[sel]); close(); }
    else if (e.key === 'Escape') close();
  });

  box.addEventListener('mousedown', (e) => {
    const it = e.target.closest('[data-cid]');
    if (!it) return;
    e.preventDefault();
    const c = DB.customers.find((x) => x.id === it.dataset.cid);
    if (c) fillFromCustomer(c);
    close();
  });

  input.addEventListener('blur', () => setTimeout(close, 140));
}

/* ================================================================
   الزبائن
   ================================================================ */

let custQuery = '';
let editingCustId = null;

function customerStats(c) {
  const orders = DB.orders.filter((o) => o.customerId === c.id || C.normalizePhone(o.phone) === C.normalizePhone(c.phone));
  return Object.assign({ orders }, C.summarize(orders, DB.settings));
}

function renderCustomers() {
  const q = custQuery.trim().toLowerCase();
  const qp = C.normalizePhone(q);
  const list = DB.customers
    .filter((c) => !q || String(c.name).toLowerCase().includes(q) || (qp && C.normalizePhone(c.phone).includes(qp)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));

  $('#custTable').innerHTML = list.length ? `<table><thead><tr>
      <th>الاسم</th><th>الرقم</th><th>العنوان الأول</th><th>العنوان التفصيلي</th>
      <th>الطلبيات</th><th>صافي الربح</th><th></th></tr></thead><tbody>
    ${list.map((c) => {
      const st = customerStats(c);
      return `<tr>
        <td class="cell-strong">${esc(c.name)}</td>
        <td class="num">${esc(c.phone)}</td>
        <td class="fs-13">${esc(c.address1) || '—'}</td>
        <td class="fs-13 text-faint">${esc(c.address2) || '—'}</td>
        <td class="num">${st.count}</td>
        <td class="cell-strong ${st.netProfit < 0 ? 'neg' : 'pos'}">${shekel(st.netProfit)}</td>
        <td class="actions">
          <button class="btn btn-sm btn-icon btn-ghost" data-cact="united" data-id="${c.id}" title="إرسال ليونايتد" aria-label="إرسال ليونايتد" style="color:var(--info)">${ico('send')}</button>
          <button class="btn btn-sm btn-icon btn-ghost" data-cact="order" data-id="${c.id}" title="طلبية جديدة" aria-label="طلبية جديدة" style="color:var(--primary)">${ico('plus')}</button>
          <button class="btn btn-sm btn-icon btn-ghost" data-cact="edit" data-id="${c.id}" title="تعديل" aria-label="تعديل">${ico('edit')}</button>
          <button class="btn btn-sm btn-icon btn-ghost" data-cact="del" data-id="${c.id}" title="حذف" aria-label="حذف" style="color:var(--danger)">${ico('trash')}</button>
        </td></tr>`;
    }).join('')}</tbody></table>`
    : emptyBox('users', 'ما في زبائن', 'الزبائن بينحفظوا تلقائياً لما تضيف طلبية');
}

function openCustModal(id) {
  editingCustId = id || null;
  const c = id ? DB.customers.find((x) => x.id === id) : null;
  $('#custModalTitle').textContent = c ? 'تعديل زبون' : 'إضافة زبون';
  $$('#custForm .field').forEach((f) => f.classList.remove('invalid'));
  $('#cPhone').value = c ? c.phone || '' : '';
  $('#cName').value = c ? c.name || '' : '';
  $('#cAddr1').value = c ? c.address1 || '' : '';
  $('#cAddr2').value = c ? c.address2 || '' : '';
  $('#cNotes').value = c ? c.notes || '' : '';
  openModal('#custModal');
}

function saveCustomer() {
  const phone = $('#cPhone').value.trim();
  const name = $('#cName').value.trim();
  let valid = true;
  valid = markField($('#cPhone'), !phone) && valid;
  valid = markField($('#cName'), !name) && valid;
  if (!valid) return;

  const dup = findCustomerByPhone(phone);
  if (dup && dup.id !== editingCustId) { toast('في زبون محفوظ بنفس الرقم', 'err'); return; }

  const data = { name, phone, address1: $('#cAddr1').value.trim(), address2: $('#cAddr2').value.trim(), notes: $('#cNotes').value.trim() };
  if (editingCustId) {
    Object.assign(DB.customers.find((x) => x.id === editingCustId), data, { updatedAt: new Date().toISOString() });
    toast('تم تعديل الزبون');
  } else {
    DB.customers.push(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, data));
    toast('تمت إضافة الزبون');
  }
  save(true);
  closeModal('#custModal');
  refreshAll();
  editingCustId = null;
}

/* ================================================================
   الأرصدة
   ================================================================ */

let ledgerQuery = '';
let entryLedgerId = null;
let entryDir = 1;

function renderLedgers() {
  const th = C.num(DB.settings.lowBalanceThreshold);
  $('#thresholdInput').value = th;

  const q = ledgerQuery.trim().toLowerCase();
  const list = DB.ledgers
    .filter((l) => !q || String(l.name).toLowerCase().includes(q) || C.normalizePhone(l.phone).includes(C.normalizePhone(q)))
    .map((l) => ({ l, bal: C.ledgerBalance(l) }))
    .sort((a, b) => a.bal - b.bal);

  const total = C.round2(DB.ledgers.reduce((a, l) => a + C.ledgerBalance(l), 0));
  const low = DB.ledgers.filter((l) => C.ledgerBalance(l) < th);
  const negative = DB.ledgers.filter((l) => C.ledgerBalance(l) < 0);

  $('#ledgerStats').innerHTML = [
    statCard('wallet', 'green', 'مجموع الأرصدة', shekel(total), `${DB.ledgers.length} شخص`, total < 0 ? 'neg' : 'pos'),
    statCard('warn', 'amber', 'تحت حد التنبيه', `<span class="num">${low.length}</span>`, `أقل من ${money(th)} ₪`),
    statCard('arrowDown', 'rose', 'أرصدة سالبة', `<span class="num">${negative.length}</span>`, 'عليهم لك')
  ].join('');

  $('#ledgerAlerts').innerHTML = low.length
    ? `<div class="alert warn">${ico('warn')}<div><b>تنبيه: رصيد منخفض</b><br>
        ${low.map((l) => `${esc(l.name)} — <span class="num">${money(C.ledgerBalance(l))} ₪</span>`).join('<br>')}</div></div>`
    : '';

  $('#ledgerTable').innerHTML = list.length ? `<table><thead><tr>
      <th>الاسم</th><th>الرقم</th><th>الرصيد</th><th>الحركات</th><th>آخر حركة</th><th></th></tr></thead><tbody>
    ${list.map(({ l, bal }) => {
      const entries = l.entries || [];
      const last = entries.length ? entries[entries.length - 1] : null;
      const isLow = bal < th;
      return `<tr>
        <td><div class="cell-strong">${esc(l.name)}</div>${l.note ? `<div class="cell-sub">${esc(l.note)}</div>` : ''}</td>
        <td class="num">${esc(l.phone) || '—'}</td>
        <td><span class="badge ${bal < 0 ? 'rose' : isLow ? 'amber' : 'green'}">${isLow ? ico('warn') : ''}<span class="num">${money(bal)} ₪</span></span></td>
        <td class="num">${entries.length}</td>
        <td class="fs-13 text-faint">${last ? `${dateLabel(last.date)} · <span class="num ${C.num(last.amount) < 0 ? 'neg' : 'pos'}">${C.num(last.amount) > 0 ? '+' : ''}${money(last.amount)}</span>` : '—'}</td>
        <td class="actions">
          <button class="btn btn-sm" data-lact="entry" data-id="${l.id}">${ico('coins')}حركة</button>
          <button class="btn btn-sm btn-icon btn-ghost" data-lact="edit" data-id="${l.id}" title="تعديل" aria-label="تعديل">${ico('edit')}</button>
          <button class="btn btn-sm btn-icon btn-ghost" data-lact="del" data-id="${l.id}" title="حذف" aria-label="حذف" style="color:var(--danger)">${ico('trash')}</button>
        </td></tr>`;
    }).join('')}</tbody></table>`
    : emptyBox('wallet', 'ما في أشخاص', 'أضف شخص لتتابع رصيدك عنده');
}

let editingLedgerId = null;
function openLedgerModal(id) {
  editingLedgerId = id || null;
  const l = id ? DB.ledgers.find((x) => x.id === id) : null;
  $('#ledgerModalTitle').textContent = l ? 'تعديل شخص' : 'إضافة شخص';
  $$('#ledgerForm .field').forEach((f) => f.classList.remove('invalid'));
  $('#lName').value = l ? l.name : '';
  $('#lPhone').value = l ? l.phone || '' : '';
  $('#lNote').value = l ? l.note || '' : '';
  $('#lOpen').value = 0;
  $('#lOpen').closest('.field').classList.toggle('hidden', !!l);
  openModal('#ledgerModal');
}

function saveLedger() {
  const name = $('#lName').value.trim();
  if (!markField($('#lName'), !name)) return;
  if (editingLedgerId) {
    Object.assign(DB.ledgers.find((x) => x.id === editingLedgerId), {
      name, phone: $('#lPhone').value.trim(), note: $('#lNote').value.trim()
    });
    toast('تم التعديل');
  } else {
    const open = C.num($('#lOpen').value);
    DB.ledgers.push({
      id: uid(), name, phone: $('#lPhone').value.trim(), note: $('#lNote').value.trim(),
      entries: open !== 0 ? [{ id: uid(), amount: open, note: 'رصيد ابتدائي', date: todayStr() }] : [],
      createdAt: new Date().toISOString()
    });
    toast('تمت الإضافة');
  }
  save(true);
  closeModal('#ledgerModal');
  refreshAll();
  editingLedgerId = null;
}

function openEntryModal(id) {
  entryLedgerId = id;
  entryDir = 1;
  const l = DB.ledgers.find((x) => x.id === id);
  if (!l) return;
  $('#entryTitle').textContent = `حركة رصيد — ${l.name}`;
  const bal = C.ledgerBalance(l);
  const cur = $('#entryCurrent');
  cur.textContent = `${money(bal)} ₪`;
  cur.className = 'stat-value num ' + (bal < C.num(DB.settings.lowBalanceThreshold) ? 'neg' : 'pos');
  $$('#entryDir .chip').forEach((c) => c.classList.toggle('active', c.dataset.dir === '1'));
  $('#eAmount').value = '';
  $('#eNote').value = '';
  $('#eDate').value = todayStr();
  $('#eAmount').closest('.field').classList.remove('invalid');
  renderEntryHistory(l);
  openModal('#entryModal');
}

function renderEntryHistory(l) {
  const entries = [...(l.entries || [])].reverse();
  $('#entryHistory').innerHTML = entries.length ? `<table><thead><tr>
      <th>التاريخ</th><th>المبلغ</th><th>ملاحظة</th><th></th></tr></thead><tbody>
    ${entries.map((e) => `<tr>
      <td class="num fs-13">${dateLabel(e.date)}</td>
      <td class="cell-strong ${C.num(e.amount) < 0 ? 'neg' : 'pos'}"><span class="num">${C.num(e.amount) > 0 ? '+' : ''}${money(e.amount)} ₪</span></td>
      <td class="fs-13">${esc(e.note) || '—'}</td>
      <td class="actions"><button class="btn btn-sm btn-icon btn-ghost" data-eact="del" data-id="${e.id}" title="حذف" aria-label="حذف" style="color:var(--danger)">${ico('trash')}</button></td>
    </tr>`).join('')}</tbody></table>` : `<p class="text-faint fs-13">ما في حركات بعد.</p>`;
  window.Icons.paint($('#entryHistory'));
}

function saveEntry() {
  const l = DB.ledgers.find((x) => x.id === entryLedgerId);
  if (!l) return;
  const amt = parseFloat($('#eAmount').value);
  if (!markField($('#eAmount'), !(Number.isFinite(amt) && amt > 0))) return;
  l.entries = l.entries || [];
  l.entries.push({ id: uid(), amount: entryDir * Math.abs(amt), note: $('#eNote').value.trim(), date: $('#eDate').value || todayStr() });
  save(true);
  const bal = C.ledgerBalance(l);
  const cur = $('#entryCurrent');
  cur.textContent = `${money(bal)} ₪`;
  cur.className = 'stat-value num ' + (bal < C.num(DB.settings.lowBalanceThreshold) ? 'neg' : 'pos');
  $('#eAmount').value = '';
  $('#eNote').value = '';
  renderEntryHistory(l);
  refreshAll();
  toast(entryDir > 0 ? 'تمت إضافة الرصيد' : 'تم خصم الرصيد');
  if (bal < C.num(DB.settings.lowBalanceThreshold)) {
    toast(`تنبيه: رصيد ${l.name} صار ${money(bal)} ₪`, 'warn', 6000);
  }
}

/* ================================================================
   الرسوم والمصاريف (مستقلة عن الطلبيات)
   ================================================================ */

let expFilter = { type: 'all', month: '' };
let editingExpId = null;

function expenseTypes() { return DB.settings.expenseTypes || []; }

function filteredExpenses() {
  return (DB.expenses || [])
    .filter((e) => expFilter.type === 'all' || e.type === expFilter.type)
    .filter((e) => !expFilter.month || C.monthKey(e.date) === expFilter.month)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function renderExpenses() {
  // شرائح الأنواع
  $('#expTypeChips').innerHTML =
    `<button class="chip ${expFilter.type === 'all' ? 'active' : ''}" data-etype="all">الكل</button>` +
    expenseTypes().map((t) => `<button class="chip ${expFilter.type === t ? 'active' : ''}" data-etype="${esc(t)}">${esc(t)}</button>`).join('');

  const list = filteredExpenses();
  const sum = C.summarizeExpenses(list);
  const m = expFilter.month || thisMonth();
  const monthSum = C.summarizeExpenses(C.expensesInRange(DB.expenses, m, m));
  const allSum = C.summarizeExpenses(DB.expenses);

  $('#expStats').innerHTML = [
    statCard('coins', 'rose', 'المعروض حالياً', shekel(sum.total), `${sum.count} حركة`, sum.total > 0 ? 'neg' : ''),
    statCard('clock', 'amber', `رسوم ${monthLabel(m)}`, shekel(monthSum.total), `${monthSum.count} حركة`, monthSum.total > 0 ? 'neg' : ''),
    statCard('chart', 'purple', 'المجموع الكلي', shekel(allSum.total), `${allSum.count} حركة`, allSum.total > 0 ? 'neg' : '')
  ].join('');

  $('#expTable').innerHTML = list.length ? `<table><thead><tr>
      <th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th><th></th></tr></thead><tbody>
    ${list.map((e) => `<tr>
      <td class="num">${dateLabel(e.date)}</td>
      <td><span class="badge gray">${esc(e.type)}</span></td>
      <td class="cell-strong neg">${shekel(e.amount)}</td>
      <td class="fs-13">${esc(e.note) || '—'}</td>
      <td class="actions">
        <button class="btn btn-sm btn-icon btn-ghost" data-xact="edit" data-id="${e.id}" title="تعديل" aria-label="تعديل">${ico('edit')}</button>
        <button class="btn btn-sm btn-icon btn-ghost" data-xact="del" data-id="${e.id}" title="حذف" aria-label="حذف" style="color:var(--danger)">${ico('trash')}</button>
      </td></tr>`).join('')}
    <tr style="background:var(--surface-2)">
      <td class="cell-strong" colspan="2">المجموع</td>
      <td class="cell-strong neg">${shekel(sum.total)}</td><td colspan="2"></td></tr>
    </tbody></table>` : emptyBox('coins', 'ما في رسوم مسجّلة', 'اضغط «إضافة رسوم» لتسجّل أول حركة');

  const byType = sum.byType;
  $('#expByType').innerHTML = byType.length ? `<table><thead><tr>
      <th>النوع</th><th>عدد</th><th>المجموع</th><th>النسبة</th></tr></thead><tbody>
    ${byType.map((t) => `<tr>
      <td class="cell-strong">${esc(t.type)}</td>
      <td class="num">${t.count}</td>
      <td class="cell-strong neg">${shekel(t.total)}</td>
      <td class="num">${sum.total ? Math.round((t.total / sum.total) * 100) : 0}%</td>
    </tr>`).join('')}</tbody></table>` : emptyBox('chart', 'لا توجد بيانات', '');
}

function renderExpTypeOptions() {
  $('#xType').innerHTML = expenseTypes().map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
}

function openExpModal(id) {
  editingExpId = id || null;
  const e = id ? (DB.expenses || []).find((x) => x.id === id) : null;
  $('#expModalTitle').textContent = e ? 'تعديل رسوم' : 'إضافة رسوم';
  $$('#expForm .field').forEach((f) => f.classList.remove('invalid'));
  renderExpTypeOptions();
  $('#xType').value = e ? e.type : (expenseTypes()[0] || '');
  $('#xAmount').value = e ? Math.abs(C.num(e.amount)) : '';
  $('#xDate').value = e ? e.date : todayStr();
  $('#xNote').value = e ? e.note || '' : '';
  openModal('#expModal');
}

function saveExpense() {
  const amount = parseFloat($('#xAmount').value);
  const date = $('#xDate').value;
  let valid = true;
  valid = markField($('#xAmount'), !(Number.isFinite(amount) && amount > 0)) && valid;
  valid = markField($('#xDate'), !date) && valid;
  if (!valid) return;

  const data = {
    type: $('#xType').value || 'غير محدد',
    amount: Math.abs(amount),
    date,
    note: $('#xNote').value.trim()
  };
  DB.expenses = DB.expenses || [];
  if (editingExpId) {
    Object.assign(DB.expenses.find((x) => x.id === editingExpId), data);
    toast('تم التعديل');
  } else {
    DB.expenses.push(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, data));
    toast('تمت إضافة الرسوم');
  }
  save(true);
  closeModal('#expModal');
  refreshAll();
  editingExpId = null;
}

/* ================================================================
   التقارير
   ================================================================ */

function renderReports() {
  if (!$('#repFrom').value) $('#repFrom').value = thisMonth();
  if (!$('#repTo').value) $('#repTo').value = thisMonth();
  runReport();
}

function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* ------- فلتر البرنامج (تيمو / شي ان / …) ------- */
const NO_PLATFORM = '__none';
let repPlatform = '';   // '' = كل البرامج
const platKey = (o) => (o.platform || '').trim() || NO_PLATFORM;
const platName = (k) => (k === NO_PLATFORM ? 'بدون برنامج' : k);

/** كل البرامج: اللي بالإعدادات + أي برنامج موجود بطلبية قديمة */
function allPlatformKeys() {
  const keys = platforms().map((p) => p.name);
  for (const o of DB.orders) { const k = platKey(o); if (!keys.includes(k)) keys.push(k); }
  return keys;
}

function platformChips(active) {
  return [`<button class="chip ${!active ? 'active' : ''}" data-plat="">كل البرامج</button>`]
    .concat(allPlatformKeys().map((k) => `<button class="chip ${active === k ? 'active' : ''}" data-plat="${esc(k)}">${esc(platName(k))}</button>`))
    .join('');
}

function renderPlatformBreakdown(all, s) {
  const rows = allPlatformKeys()
    .map((k) => Object.assign({ key: k }, C.summarize(all.filter((o) => platKey(o) === k), s)))
    .filter((r) => r.count > 0);
  const total = C.summarize(all, s);
  const share = (v) => (total.netProfit > 0 && v > 0 ? Math.round((v / total.netProfit) * 100) + '%' : '—');
  $('#repByPlatform').innerHTML = rows.length ? `<table class="wide" style="min-width:720px"><thead><tr>
      <th>البرنامج</th><th>طلبيات</th><th>مستلمة</th><th>راجعة</th><th>قيد الانتظار</th><th>مبيعات</th><th>ربح الطلبيات</th><th>متوقّع</th><th>من الربح</th>
    </tr></thead><tbody>
    ${rows.map((r) => `<tr class="${repPlatform === r.key ? 'row-active' : ''}" data-plat-row="${esc(r.key)}" style="cursor:pointer">
      <td class="cell-strong">${esc(platName(r.key))}</td>
      <td class="num">${r.count}</td><td class="num">${r.delivered}</td><td class="num">${r.returned}</td><td class="num">${r.pending}</td>
      <td>${shekel(r.sales)}</td>
      <td class="cell-strong ${r.netProfit < 0 ? 'neg' : 'pos'}">${shekel(r.netProfit)}</td>
      <td class="text-faint">${shekel(r.expectedPending)}</td>
      <td class="num">${share(r.netProfit)}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('chart', 'ما في طلبيات بالمدى المحدد', '');
}

function runReport() {
  const from = $('#repFrom').value;
  const to = $('#repTo').value;
  const s = DB.settings;
  const all = DB.orders.filter((o) => C.inRange(o, from, to));
  if (repPlatform && !allPlatformKeys().includes(repPlatform)) repPlatform = '';
  const list = repPlatform ? all.filter((o) => platKey(o) === repPlatform) : all;
  $('#repPlatforms').innerHTML = platformChips(repPlatform);
  $('#repPlatformNote').classList.toggle('hidden', !repPlatform);
  renderPlatformBreakdown(all, s);
  const sum = C.summarize(list, s);
  const months = C.byMonth(list, s);
  // الرسوم مش مربوطة ببرنامج معيّن — فلما تختار برنامج منحسب ربح طلبياته بس
  const expList = repPlatform ? [] : C.expensesInRange(DB.expenses, from, to);
  const expSum = C.summarizeExpenses(expList);
  const expByMonth = C.expensesByMonth(expList);
  const net = C.netAfterExpenses(sum, expSum);

  $('#repStats').innerHTML = [
    statCard('coins', 'green', repPlatform ? `ربح ${platName(repPlatform)}` : 'الربح النهائي', shekel(net), `${repPlatform ? 'بدون الرسوم' : 'بعد خصم الرسوم'} · ${from ? monthLabel(from) : 'البداية'} ← ${to ? monthLabel(to) : 'اليوم'}`, net < 0 ? 'neg' : 'pos'),
    statCard('check', 'blue', 'ربح الطلبيات', shekel(sum.netProfit), `${sum.delivered} مستلمة · ${sum.returned} راجعة`, sum.netProfit < 0 ? 'neg' : 'pos'),
    statCard('coins', 'rose', 'الرسوم والمصاريف', shekel(expSum.total), expSum.byType.slice(0, 3).map((t) => `${t.type} ${money(t.total)}`).join(' · ') || 'ما في رسوم', expSum.total > 0 ? 'neg' : ''),
    statCard('box', 'purple', 'قيمة المبيعات', shekel(sum.sales), `${sum.pieces} قطعة · ${sum.pickup} نقطة استلام`)
  ].join('');

  // الرسم البياني
  const monthNet = (m) => C.round2(m.netProfit - ((expByMonth[m.month] || {}).total || 0));
  const max = Math.max(1, ...months.map((m) => Math.abs(monthNet(m))));
  $('#repChart').innerHTML = months.length ? months.map((m) => {
    const v = monthNet(m);
    const h = Math.max(4, Math.round((Math.abs(v) / max) * 150));
    return `<div class="bar-col">
      <div class="bar-val ${v < 0 ? 'neg' : 'pos'}"><span class="num">${money(v)}</span></div>
      <div class="bar-track"><div class="bar ${v < 0 ? 'neg' : ''}" style="height:${h}px" title="${monthLabel(m.month)}: ${money(v)} ₪ بعد الرسوم"></div></div>
      <div class="bar-label">${monthLabel(m.month)}</div>
    </div>`;
  }).join('') : `<div class="empty" style="width:100%">${ico('chart')}<h4>ما في بيانات بالمدى المحدد</h4><p>غيّر الشهور وجرّب مرة ثانية</p></div>`;

  // الجدول
  $('#repTable').innerHTML = months.length ? `<table class="wide" style="min-width:820px"><thead><tr>
      <th>الشهر</th><th>طلبيات</th><th>مستلمة</th><th>راجعة</th><th>مبيعات</th><th>ربح الطلبيات</th><th>الرسوم</th><th>النهائي</th>
    </tr></thead><tbody>
    ${months.map((m) => {
      const ex = (expByMonth[m.month] || {}).total || 0;
      const v = C.round2(m.netProfit - ex);
      return `<tr>
      <td class="cell-strong">${monthLabel(m.month)}</td>
      <td class="num">${m.count}</td><td class="num">${m.delivered}</td><td class="num">${m.returned}</td>
      <td>${shekel(m.sales)}</td>
      <td class="${m.netProfit < 0 ? 'neg' : 'pos'}">${shekel(m.netProfit)}</td>
      <td class="${ex > 0 ? 'neg' : 'text-faint'}">${shekel(ex)}</td>
      <td class="cell-strong ${v < 0 ? 'neg' : 'pos'}">${shekel(v)}</td></tr>`;
    }).join('')}
    <tr style="background:var(--surface-2)">
      <td class="cell-strong">المجموع</td><td class="num cell-strong">${sum.count}</td>
      <td class="num cell-strong">${sum.delivered}</td><td class="num cell-strong">${sum.returned}</td>
      <td class="cell-strong">${shekel(sum.sales)}</td>
      <td class="cell-strong ${sum.netProfit < 0 ? 'neg' : 'pos'}">${shekel(sum.netProfit)}</td>
      <td class="cell-strong ${expSum.total > 0 ? 'neg' : ''}">${shekel(expSum.total)}</td>
      <td class="cell-strong ${net < 0 ? 'neg' : 'pos'}">${shekel(net)}</td></tr>
    </tbody></table>` : emptyBox('chart', 'لا توجد بيانات', '');

  // أفضل الزبائن
  const byCust = new Map();
  for (const o of list) {
    const k = o.customerId || C.normalizePhone(o.phone);
    if (!byCust.has(k)) byCust.set(k, { name: o.customerName, phone: o.phone, orders: [] });
    byCust.get(k).orders.push(o);
  }
  const top = [...byCust.values()]
    .map((c) => Object.assign({ name: c.name, phone: c.phone }, C.summarize(c.orders, s)))
    .sort((a, b) => b.netProfit - a.netProfit)
    .slice(0, 10);
  $('#repCustomers').innerHTML = top.length ? `<table><thead><tr>
      <th>الزبون</th><th>طلبيات</th><th>مبيعات</th><th>الصافي</th></tr></thead><tbody>
    ${top.map((c) => `<tr>
      <td><div class="cell-strong">${esc(c.name)}</div><div class="cell-sub num">${esc(c.phone)}</div></td>
      <td class="num">${c.count}</td><td>${shekel(c.sales)}</td>
      <td class="cell-strong ${c.netProfit < 0 ? 'neg' : 'pos'}">${shekel(c.netProfit)}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('users', 'لا توجد بيانات', '');

  window.Icons.paint($('#view-reports'));
  return { from, to, months, sum, expSum, expByMonth, net };
}

/* ================================================================
   التصدير CSV
   ================================================================ */

function toCsv(rows) {
  return rows.map((r) => r.map((c) => {
    const s = String(c == null ? '' : c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}

async function saveCsv(name, rows) {
  const r = await window.api.data.saveText({
    defaultName: name, content: toCsv(rows), filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (r.ok && r.data) toast('تم حفظ الملف');
  else if (!r.ok) toast('فشل الحفظ: ' + r.error, 'err');
}

/* ================================================================
   ربط يونايتد
   ================================================================ */

function logLine(target, msg, level) {
  const el = $(target);
  const d = document.createElement('div');
  d.className = 'log-line ' + (level || 'info');
  d.textContent = msg;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}

function renderUnited() {
  renderUnitedWeb();
}

async function sendCustomerToUnited(cust, linkOrderId) {
  return sendViaWeb(cust, false, linkOrderId);
}

/** إرسال طلبية محفوظة (وربطها برقمها عند يونايتد) */
async function sendOrderToUnited(orderId) {
  const o = DB.orders.find((x) => x.id === orderId);
  if (!o) return;
  if (o.unitedId) {
    confirmBox('إرسال مرة ثانية', `هاي الطلبية مرسلة أصلاً ليونايتد برقم ${o.unitedRef || o.unitedId}. الإرسال مرة ثانية بينشئ طلبية جديدة عندهم. متابعة؟`, 'أرسل', () => {
      sendCustomerToUnited(Object.assign({ name: o.customerName }, o), o.id);
    });
    return;
  }
  return sendCustomerToUnited(Object.assign({ name: o.customerName }, o), o.id);
}


/* ================================================================
   يونايتد — عبر الموقع (Odoo)
   ================================================================ */

const U_SOURCES = [
  { key: 'name', label: 'اسم الزبون' },
  { key: 'phone', label: 'رقم الزبون' },
  { key: 'address1', label: 'العنوان الأول' },
  { key: 'address2', label: 'العنوان التفصيلي' },
  { key: 'pieces', label: 'عدد القطع' },
  { key: 'price', label: 'سعر الطلبية' },
  { key: 'deliveryPrice', label: 'سعر التوصيل' },
  { key: 'total', label: 'السعر شامل التوصيل' },
  { key: 'notes', label: 'ملاحظات' }
];

const uCfg = () => DB.settings.united;
const uFields = () => uCfg().fieldsCache || [];

function renderUnitedWeb() {

  $('#uBase').value = uCfg().baseUrl || '';
  $('#uModel').value = uCfg().model || '';
  renderMapTable();
  renderAreas();
  renderStatusTable();
  renderFixed();
  uCheckStatus();
}

async function uCheckStatus() {
  const box = $('#uStatus');
  box.innerHTML = `<div class="alert info">${ico('refresh')}<div>جاري الفحص…</div></div>`;
  window.Icons.paint(box);
  const r = await window.api.united.status();
  if (r.ok && r.data.loggedIn) {
    const i = r.data.info;
    box.innerHTML = `<div class="alert ok">${ico('check')}<div><b>مسجّل دخول</b> — ${esc(i.name || i.username)}
      ${i.company ? ' · ' + esc(i.company) : ''}<br><span class="fs-12">الجلسة محفوظة، ما بتحتاج تسجّل دخول كل مرة.</span></div></div>`;
    $('#uLogin').classList.add('hidden');
    $('#uLogout').classList.remove('hidden');
  } else {
    const why = (r.ok && r.data.reason) ? r.data.reason : '';
    box.innerHTML = `<div class="alert warn">${ico('warn')}<div><b>غير مسجّل دخول</b><br>
      اضغط «تسجيل الدخول» واكتب اسم المستخدم وكلمة السر تبع يونايتد. كلمة السر ما بتنحفظ — بس الجلسة على هذا الجهاز.
      ${why ? `<br><span class="fs-12">التفصيل: ${esc(why)}</span>` : ''}</div></div>`;
    $('#uLogin').classList.remove('hidden');
    $('#uLogout').classList.add('hidden');
  }
  window.Icons.paint(box);
}

function fieldOptions(selectedName, sourceKey) {
  const fields = uFields();
  const mapping = uCfg().mapping || {};
  const opts = ['<option value="">— بدون ربط —</option>'];
  for (const f of fields) {
    const takenBy = mapping[f.name];
    const busy = takenBy && takenBy !== sourceKey;
    opts.push(`<option value="${esc(f.name)}" ${f.name === selectedName ? 'selected' : ''} ${busy ? 'disabled' : ''}>
      ${esc(f.label)}${f.required ? ' *' : ''}${busy ? ' (مربوط)' : ''} — ${esc(f.name)}</option>`);
  }
  return opts.join('');
}

function renderMapTable() {
  const fields = uFields();
  $('#uFieldCount').textContent = fields.length ? `${fields.length} حقل` : 'لم تُكتشف بعد';
  const mapping = uCfg().mapping || {};

  if (!fields.length) {
    $('#uMapTable').innerHTML = emptyBox('list', 'ما اكتشفنا الحقول بعد', 'سجّل دخول واضغط «اكتشاف الحقول»');
    $('#uRequiredWarn').innerHTML = '';
    window.Icons.paint($('#uMapTable'));
    return;
  }

  const rev = {};
  for (const [target, src] of Object.entries(mapping)) rev[src] = target;

  const byName = new Map(fields.map((f) => [f.name, f]));
  $('#uMapTable').innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th style="width:180px">حقلي</th><th>الحقل المقابل عند يونايتد</th></tr></thead><tbody>
    ${U_SOURCES.map((s) => {
      const t = rev[s.key];
      const f = t ? byName.get(t) : null;
      return `<tr>
        <td class="cell-strong">${esc(s.label)}</td>
        <td><button class="btn btn-block" data-pick="${s.key}" style="justify-content:space-between">
          <span>${f ? `${esc(f.label)}${f.required ? ' *' : ''} — <code class="fs-12">${esc(f.name)}</code>` : '<span class="text-faint">— اضغط للاختيار —</span>'}</span>
          ${ico('search')}</button></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;

  const fixedNames = new Set((uCfg().fixed || []).map((f) => f.field));
  const missing = fields.filter((f) => f.required && !f.hasDefault && !mapping[f.name] && !fixedNames.has(f.name));
  $('#uRequiredWarn').innerHTML = missing.length
    ? `<div class="alert warn">${ico('warn')}<div><b>حقول إلزامية عند يونايتد بدون قيمة (${missing.length})</b><br>
        ${missing.map((f) => `${esc(f.label)} <code class="fs-12">${esc(f.name)}</code>`).join(' · ')}<br>
        <span class="fs-12">إمّا تربطها بحقل من عندك أو تحطلها «قيمة ثابتة». جرّب «إرسال طلبية تجريبية» — إذا نجح، يعني يونايتد بيعبّيها لحاله وما في مشكلة.</span></div></div>`
    : `<div class="alert ok">${ico('check')}<div>كل الحقول الإلزامية إلها قيمة ✔</div></div>`;
  window.Icons.paint($('#view-united'));
}

function renderAreas() {
  const u = uCfg();
  const fields = uFields();
  const rels = fields.filter((f) => f.type === 'many2one' && f.relation);
  $('#uAreaField').innerHTML = '<option value="">— اختر —</option>' + rels.map((f) =>
    `<option value="${esc(f.name)}" ${f.name === u.areaField ? 'selected' : ''}>${esc(f.label)}${f.required ? ' *' : ''} — ${esc(f.name)}</option>`).join('');

  const n = (u.areas || []).length;
  $('#uAreaCount').textContent = n ? `${n} منطقة` : 'لم تُحمّل';
  $('#uAreaPreview').innerHTML = n
    ? `<div class="alert ok">${ico('check')}<div><b>القائمة جاهزة (${n} منطقة)</b><br>
        <span class="fs-12">${(u.areas || []).slice(0, 12).map((a) => esc(a.name)).join(' · ')}${n > 12 ? ' …' : ''}</span></div></div>`
    : `<div class="alert warn">${ico('warn')}<div>ما حمّلت القائمة بعد — اضغط «تحميل القائمة».</div></div>`;
  window.Icons.paint($('#uAreaPreview'));
}

function renderFixed() {
  const list = uCfg().fixed || [];
  const byName = new Map(uFields().map((f) => [f.name, f]));
  $('#uFixedList').innerHTML = list.length ? `<div class="steps">
    ${list.map((f, i) => {
      const meta = byName.get(f.field);
      return `<div class="step">
        <span class="idx">${i + 1}</span>
        <span class="txt"><b>${esc((meta && meta.label) || f.label || f.field)}</b> = ${esc(f.display || f.value)}</span>
        <span class="ops"><button class="btn btn-sm btn-icon btn-ghost" data-fxdel="${i}" title="حذف" aria-label="حذف" style="color:var(--danger)">${ico('trash')}</button></span>
      </div>`;
    }).join('')}</div>`
    : `<p class="text-faint fs-13">ما في قيم ثابتة.</p>`;
  window.Icons.paint($('#uFixedList'));
}

/* --- نافذة القيمة الثابتة --- */
let fxPicked = null;

function openFixedModal() {
  const fields = uFields();
  if (!fields.length) { toast('اكتشف الحقول أولاً', 'err'); return; }
  fxPicked = null;
  $('#fxField').innerHTML = fields.map((f) =>
    `<option value="${esc(f.name)}" data-type="${esc(f.type)}" data-rel="${esc(f.relation || '')}">
      ${esc(f.label)}${f.required ? ' *' : ''} — ${esc(f.name)}</option>`).join('');
  $('#fxValue').value = '';
  $('#fxSearch').value = '';
  $('#fxResults').innerHTML = '';
  fxSyncType();
  openModal('#fixedModal');
}

function fxSyncType() {
  const opt = $('#fxField').selectedOptions[0];
  const isRel = opt && opt.dataset.type === 'many2one';
  $('#fxSearchWrap').classList.toggle('hidden', !isRel);
  $('#fxValueWrap').classList.toggle('hidden', !!isRel);
  fxPicked = null;
}

async function fxSearch() {
  const opt = $('#fxField').selectedOptions[0];
  const q = $('#fxSearch').value.trim();
  if (!opt || q.length < 2) { $('#fxResults').innerHTML = ''; return; }
  const r = await window.api.united.nameSearch({ model: opt.dataset.rel, query: q });
  if (!r.ok) { $('#fxResults').innerHTML = `<div class="alert danger">${ico('warn')}<div>${esc(r.error)}</div></div>`; window.Icons.paint($('#fxResults')); return; }
  $('#fxResults').innerHTML = r.data.length
    ? r.data.map((x) => `<div class="node-item" data-fxid="${x.id}" data-fxname="${esc(x.name)}"><b>${esc(x.name)}</b></div>`).join('')
    : `<p class="text-faint fs-13">ما في نتائج.</p>`;
}

/* --- مزامنة الحالات --- */

const OUR_STATUSES = [
  { key: '', label: 'بدون تغيير (لسا بالطريق)' },
  { key: 'delivered', label: 'مستلمة ✓' },
  { key: 'returned', label: 'راجعة ↓' },
  { key: 'pending', label: 'قيد الانتظار' }
];

function statusSelection() {
  const u = uCfg();
  const f = uFields().find((x) => x.name === (u.statusField || 'state'));
  return (f && f.selection) || [];
}

function renderStatusTable() {
  const u = uCfg();
  $('#uAutoSync').checked = u.autoSync !== false;
  $('#uSyncMinutes').value = C.num(u.syncMinutes) || 20;

  const linked = DB.orders.filter((o) => o.unitedId).length;
  $('#uSyncInfo').textContent = u.lastSync
    ? `${linked} طلبية مرتبطة · آخر مزامنة ${timeAgo(u.lastSync)}`
    : `${linked} طلبية مرتبطة`;

  const sel = statusSelection();
  if (!sel.length) {
    $('#uStatusTable').innerHTML = `<div class="alert warn">${ico('warn')}<div>ما اكتشفت حالات يونايتد بعد — اضغط «اكتشاف الحقول».</div></div>`;
    window.Icons.paint($('#uStatusTable'));
    return;
  }
  const map = u.statusMap || {};
  $('#uStatusTable').innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th>الحالة عند يونايتد</th><th style="width:230px">تعني عندي</th></tr></thead><tbody>
    ${sel.map(([value, label]) => `<tr>
      <td><div class="cell-strong">${esc(label)}</div><div class="cell-sub"><code>${esc(value)}</code></div></td>
      <td><select data-st="${esc(value)}">
        ${OUR_STATUSES.map((o) => `<option value="${o.key}" ${map[value] === o.key || (!map[value] && !o.key) ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select></td></tr>`).join('')}</tbody></table></div>`;
}

function timeAgo(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diff < 1) return 'الآن';
  if (diff < 60) return `قبل ${diff} دقيقة`;
  if (diff < 1440) return `قبل ${Math.floor(diff / 60)} ساعة`;
  return dateLabel(iso.slice(0, 10));
}

let syncing = false;

async function runSync(silent) {
  if (syncing) return null;
  const linked = DB.orders.filter((o) => o.unitedId).length;
  if (!linked) {
    if (!silent) toast('ما في طلبيات مرتبطة بيونايتد بعد', 'warn');
    return null;
  }
  syncing = true;
  const btn = $('#uSyncNow');
  if (btn) btn.disabled = true;
  try {
    const r = await window.api.united.sync({});
    if (!r.ok) {
      if (!silent) toast('فشلت المزامنة: ' + r.error, 'err', 7000);
      uLog('✗ ' + r.error, 'error');
      return null;
    }
    // حدّث النسخة المحلية من القرص (الرئيسية عدّلت الطلبيات)
    const fresh = await window.api.data.get();
    if (fresh.ok) DB = fresh.data;

    const ch = r.data.changed || [];
    if (ch.length) {
      uLog(`✓ فحصت ${r.data.checked} طلبية — تغيّرت ${ch.length}`, 'ok');
      ch.forEach((c) => uLog(`  • ${c.customerName} (${dateLabel(c.date)}) → ${(STATUS[c.to] || {}).label || c.to}`, 'ok'));
      toast(`تحدّثت ${ch.length} طلبية من يونايتد`, 'ok', 6000);
      showSyncSummary(ch);
    } else if (!silent) {
      uLog(`✓ فحصت ${r.data.checked} طلبية — ما في تغييرات`, 'info');
      toast('ما في تغييرات جديدة', 'info');
    }
    refreshAll();
    renderStatusTable();
    return r.data;
  } finally {
    syncing = false;
    if (btn) btn.disabled = false;
  }
}

function showSyncSummary(changed) {
  if (!changed.length) return;
  const delivered = changed.filter((c) => c.to === 'delivered');
  const returned = changed.filter((c) => c.to === 'returned');
  const html = `<div class="alert ok">${ico('check')}<div><b>تحدّثت ${changed.length} طلبية من يونايتد</b><br>
      ${delivered.length ? `<span class="pos">${delivered.length} مستلمة</span>` : ''}
      ${delivered.length && returned.length ? ' · ' : ''}
      ${returned.length ? `<span class="neg">${returned.length} راجعة</span>` : ''}</div></div>`;
  const box = $('#dashAlerts');
  if (box && currentView === 'dashboard') box.insertAdjacentHTML('afterbegin', html);
}

let syncTimer = null;
function scheduleAutoSync() {
  if (syncTimer) clearInterval(syncTimer);
  const u = uCfg();
  if (u.autoSync === false) return;
  const mins = Math.max(5, C.num(u.syncMinutes) || 20);
  syncTimer = setInterval(() => runSync(true), mins * 60000);
}

/* --- نافذة اختيار الحقل بالبحث --- */
let pickFor = null;

function openPickModal(sourceKey) {
  pickFor = sourceKey;
  const src = U_SOURCES.find((x) => x.key === sourceKey);
  $('#pickTitle').textContent = `اختر الحقل المقابل لـ «${src ? src.label : sourceKey}»`;
  $('#pickSearch').value = '';
  renderPickList('');
  openModal('#pickModal');
}

function renderPickList(q) {
  const fields = uFields();
  const mapping = uCfg().mapping || {};
  const norm = (x) => String(x || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/[_-]+/g, ' ');
  const f = norm(q).trim();
  const items = fields.filter((x) => !f || norm(x.label + ' ' + x.name).includes(f));
  $('#pickList').innerHTML = items.length ? items.slice(0, 300).map((x) => {
    const takenBy = mapping[x.name];
    const busy = takenBy && takenBy !== pickFor;
    const owner = busy ? (U_SOURCES.find((u) => u.key === takenBy) || {}).label : '';
    return `<div class="node-item" data-pf="${esc(x.name)}">
      <b>${esc(x.label)}${x.required ? ' <span style="color:var(--danger)">*</span>' : ''}</b>
      <code>${esc(x.name)}</code>
      <span class="fs-12 text-faint"> · ${esc(x.type)}${x.relation ? ' → ' + esc(x.relation) : ''}${busy ? ` · مربوط بـ «${esc(owner)}»` : ''}</span>
    </div>`;
  }).join('') : `<p class="text-faint fs-13">ما في نتائج.</p>`;
}

function setMapping(sourceKey, fieldName) {
  const mapping = uCfg().mapping || {};
  for (const [t, v] of Object.entries(mapping)) if (v === sourceKey) delete mapping[t];
  if (fieldName) {
    // لو الحقل مربوط بمصدر تاني، فك الربط القديم
    delete mapping[fieldName];
    mapping[fieldName] = sourceKey;
  }
  uCfg().mapping = mapping;
  save(true);
  renderMapTable();
}

/* --- اقتراح المناطق داخل نموذج الطلبية --- */
let pickedAreaId = null;

function areaList() { return (uCfg().areas) || []; }

function normAr(x) {
  return String(x || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
}

function wireAreaSuggest() {
  const input = $('#oAddr1');
  const box = $('#areaSuggest');
  let items = [];
  let sel = -1;

  const close = () => { box.classList.remove('open'); sel = -1; };
  const render = () => {
    if (!items.length) return close();
    box.innerHTML = items.map((a, i) =>
      `<div class="suggest-item ${i === sel ? 'sel' : ''}" data-aid="${a.id}"><b>${esc(a.name)}</b></div>`).join('');
    box.classList.add('open');
  };
  const choose = (a) => {
    input.value = a.name;
    pickedAreaId = a.id;
    updateAreaHint();
    close();
  };

  input.addEventListener('input', () => {
    pickedAreaId = null;
    updateAreaHint();
    const areas = areaList();
    if (!areas.length) return close();
    const q = normAr(input.value);
    items = q.length >= 1 ? areas.filter((a) => normAr(a.name).includes(q)).slice(0, 10) : [];
    sel = -1;
    render();
  });
  input.addEventListener('focus', () => {
    const areas = areaList();
    if (areas.length && !input.value.trim()) { items = areas.slice(0, 10); render(); }
  });
  input.addEventListener('keydown', (e) => {
    if (!box.classList.contains('open')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); choose(items[sel]); }
    else if (e.key === 'Escape') close();
  });
  box.addEventListener('mousedown', (e) => {
    const it = e.target.closest('[data-aid]');
    if (!it) return;
    e.preventDefault();
    const a = areaList().find((x) => String(x.id) === it.dataset.aid);
    if (a) choose(a);
  });
  input.addEventListener('blur', () => setTimeout(close, 140));
}

function updateAreaHint() {
  const hint = $('#areaHint');
  const areas = areaList();
  if (!areas.length) { hint.textContent = ''; hint.className = 'hint'; return; }
  const v = $('#oAddr1').value.trim();
  if (!v) { hint.textContent = `اختر من ${areas.length} منطقة مسجّلة عند يونايتد`; hint.className = 'hint'; return; }
  if (pickedAreaId) { hint.textContent = '✓ منطقة معتمدة عند يونايتد'; hint.className = 'hint pos'; return; }
  const exact = areas.find((a) => normAr(a.name) === normAr(v));
  if (exact) { pickedAreaId = exact.id; hint.textContent = '✓ منطقة معتمدة عند يونايتد'; hint.className = 'hint pos'; return; }
  hint.textContent = 'غير مطابقة لقائمة يونايتد — اختر من الاقتراحات لضمان قبول الطلبية';
  hint.className = 'hint neg';
}

/* --- الإرسال --- */
function uLog(msg, level) { logLine('#uLog', msg, level); }

async function sendViaWeb(src, silent, linkOrderId) {
  const vars = {
    name: src.name || '', phone: src.phone || '',
    address1: src.address1 || '', address1Id: src.address1Id || src.areaId || null,
    address2: src.address2 || '',
    pieces: src.pieces || '', price: src.price || '', deliveryPrice: src.deliveryPrice || '',
    notes: src.notes || ''
  };
  if (!silent) {
    $('#runLog').innerHTML = '';
    $('#runStatus').innerHTML = `<div class="alert info">${ico('refresh')}<div>جاري إرسال «${esc(vars.name || '')}» إلى يونايتد…</div></div>`;
    window.Icons.paint($('#runStatus'));
    openModal('#runModal');
  }
  const r = await window.api.united.send({ vars });
  if (r.ok && linkOrderId) {
    const o = DB.orders.find((x) => x.id === linkOrderId);
    if (o) {
      o.unitedId = r.data.id;
      o.unitedRef = r.data.ref || '';
      o.unitedUrl = r.data.url || '';
      o.sentAt = new Date().toISOString();
      await save(true);
      refreshAll();
    }
  }
  const okMsg = r.ok
    ? `<div class="alert ok">${ico('check')}<div><b>تم إنشاء الطلبية عند يونايتد</b><br>
        رقمها: <span class="num">${esc(r.data.ref || r.data.id)}</span>
        <br><button class="btn btn-sm mt-4" data-uopen="${esc(r.data.url)}">فتحها على الموقع</button></div></div>`
    : `<div class="alert danger">${ico('warn')}<div><b>فشل الإرسال</b><br>${esc(r.error)}</div></div>`;
  if (!silent) {
    $('#runStatus').innerHTML = okMsg;
    logLine('#runLog', r.ok ? `✓ تم الإنشاء (${r.data.ref || r.data.id})` : `✗ ${r.error}`, r.ok ? 'ok' : 'error');
    window.Icons.paint($('#runStatus'));
  }
  toast(r.ok ? 'تم إرسال الطلبية ليونايتد' : 'فشل الإرسال: ' + r.error, r.ok ? 'ok' : 'err', r.ok ? 4000 : 8000);
  return r;
}

/* ================================================================
   الإعدادات
   ================================================================ */

function renderPlatformsSettings() {
  const list = platforms();
  $('#platformList').innerHTML = list.length ? `<div class="steps">
    ${list.map((p, i) => `<div class="step">
      <span class="idx">${i + 1}</span>
      <input type="text" data-pname="${i}" value="${esc(p.name)}" style="flex:1;height:34px">
      <input type="number" data-ppct="${i}" value="${C.num(p.percent)}" min="0" max="100" step="0.5" style="width:96px;height:34px">
      <span class="fs-13 text-muted">%</span>
      <span class="ops"><button class="btn btn-sm btn-icon btn-ghost" data-pdel="${i}" title="حذف" aria-label="حذف" style="color:var(--danger)">${ico('trash')}</button></span>
    </div>`).join('')}</div>` : `<p class="text-faint fs-13">ما في برامج.</p>`;
  window.Icons.paint($('#platformList'));
}

function renderExpTypesSettings() {
  const list = expenseTypes();
  $('#expTypeList').innerHTML = list.length ? `<div class="steps">
    ${list.map((t, i) => `<div class="step">
      <span class="idx">${i + 1}</span>
      <input type="text" data-tname="${i}" value="${esc(t)}" style="flex:1;height:34px">
      <span class="ops"><button class="btn btn-sm btn-icon btn-ghost" data-tdel="${i}" title="حذف" aria-label="حذف" style="color:var(--danger)">${ico('trash')}</button></span>
    </div>`).join('')}</div>` : `<p class="text-faint fs-13">ما في أنواع.</p>`;
  window.Icons.paint($('#expTypeList'));
}

async function renderSettings() {
  const s = DB.settings;
  renderPlatformsSettings();
  renderExpTypesSettings();
  $('#setPickupFee').value = C.num(s.pickupFee === undefined ? 5 : s.pickupFee);
  $('#infoExpenses').textContent = (DB.expenses || []).length;
  $('#setPct').value = C.num(s.defaultProfitPercent);
  $('#setReturn').value = s.returnPolicy || 'full_price';
  $('#setDelivery').checked = !!s.deliveryCountsInProfit;
  $('#setThreshold').value = C.num(s.lowBalanceThreshold);
  $('#infoOrders').textContent = DB.orders.length;
  $('#infoCustomers').textContent = DB.customers.length;
  $('#infoLedgers').textContent = DB.ledgers.length;
  const f = await window.api.data.folder();
  if (f.ok) $('#infoFolder').textContent = f.data;
}

/* ================================================================
   الثيم
   ================================================================ */

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const btn = $('#themeBtn');
  btn.querySelector('[data-icon]').setAttribute('data-icon', t === 'dark' ? 'sun' : 'moon');
  btn.querySelector('[data-icon]').dataset.painted = '';
  btn.querySelector('span').textContent = t === 'dark' ? 'الوضع الفاتح' : 'الوضع الغامق';
  window.Icons.paint(btn);
}

/* ================================================================
   الربط
   ================================================================ */

function bind() {
  // التنقّل
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('.nav-item');
    if (b) go(b.dataset.view);
  });
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) go(g.dataset.goto);
  });

  // الثيم
  $('#themeBtn').addEventListener('click', () => {
    DB.settings.theme = DB.settings.theme === 'dark' ? 'light' : 'dark';
    applyTheme(DB.settings.theme);
    save();
  });

  // البحث العام
  $('#globalSearch').addEventListener('input', (e) => {
    orderFilter.q = e.target.value;
    if (currentView !== 'orders') go('orders');
    else renderOrders();
    window.Icons.paint();
  });

  // إضافة سريعة
  $('#quickAdd').addEventListener('click', () => openOrderModal());
  $('#addOrderBtn').addEventListener('click', () => openOrderModal());

  // فلاتر الطلبيات
  $('#statusChips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    $$('#statusChips .chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    orderFilter.status = c.dataset.status;
    renderOrders();
    window.Icons.paint();
  });
  $('#ordersMonth').addEventListener('change', (e) => { orderFilter.month = e.target.value; renderOrders(); window.Icons.paint(); });
  $('#ordersMonthClear').addEventListener('click', () => { $('#ordersMonth').value = ''; orderFilter.month = ''; renderOrders(); window.Icons.paint(); });

  // إجراءات جدول الطلبيات
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) {
      const id = b.dataset.id;
      const act = b.dataset.act;
      if (act === 'send') sendOrderToUnited(id);
      else if (act === 'view') viewOrder(id);
      else if (act === 'edit') { closeModal('#viewModal'); openOrderModal(id); }
      else if (act === 'deliver') { setStatus(id, 'delivered'); closeModal('#viewModal'); }
      else if (act === 'return') { setStatus(id, 'returned'); closeModal('#viewModal'); }
      else if (act === 'del') deleteOrder(id);
      return;
    }
    const row = e.target.closest('tr[data-order]');
    if (row) viewOrder(row.dataset.order);
  });

  // نموذج الطلبية
  $('#orderSave').addEventListener('click', saveOrder);
  ['#oPrice', '#oDelivery', '#oPct', '#oStatus'].forEach((s) => {
    $(s).addEventListener('input', updateProfitPreview);
    $(s).addEventListener('change', updateProfitPreview);
  });
  $('#orderForm').addEventListener('submit', (e) => { e.preventDefault(); saveOrder(); });
  $('#orderForm').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !$('#phoneSuggest').classList.contains('open') && !$('#nameSuggest').classList.contains('open')) {
      e.preventDefault(); saveOrder();
    }
  });

  wireSuggest('#oPhone', '#phoneSuggest', (v) => {
    const n = C.normalizePhone(v);
    return DB.customers.filter((c) => n && C.normalizePhone(c.phone).includes(n));
  });
  wireSuggest('#oName', '#nameSuggest', (v) =>
    DB.customers.filter((c) => String(c.name).toLowerCase().includes(v.toLowerCase())));
  wireAreaSuggest();

  // نوع التسليم والبرنامج داخل نموذج الطلبية
  $('#oDeliveryType').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    setDeliveryType(c.dataset.dtype, true);
  });
  $('#oPlatform').addEventListener('change', (e) => {
    const p = platforms().find((x) => x.name === e.target.value);
    if (p) { $('#oPct').value = C.num(p.percent); updateProfitPreview(); }
  });

  // تحديد الطلبيات ورفعها دفعة
  $('#ordersTable').addEventListener('change', (e) => {
    if (e.target.id === 'selAll') {
      const ids = filteredOrders().map((o) => o.id);
      if (e.target.checked) ids.forEach((id) => selectedOrders.add(id));
      else ids.forEach((id) => selectedOrders.delete(id));
      $$('#ordersTable .rowSel').forEach((c) => { c.checked = selectedOrders.has(c.dataset.sel); });
      updateBulkBar();
      return;
    }
    const sel = e.target.closest('[data-sel]');
    if (sel) {
      if (sel.checked) selectedOrders.add(sel.dataset.sel);
      else selectedOrders.delete(sel.dataset.sel);
      updateBulkBar();
    }
  });
  $('#bulkSend').addEventListener('click', bulkSendToUnited);

  // المصاريف
  $('#addExpBtn').addEventListener('click', () => openExpModal());
  $('#expSave').addEventListener('click', saveExpense);
  $('#expForm').addEventListener('submit', (e) => { e.preventDefault(); saveExpense(); });
  $('#expTypeChips').addEventListener('click', (e) => {
    const c = e.target.closest('[data-etype]');
    if (!c) return;
    expFilter.type = c.dataset.etype;
    renderExpenses();
    window.Icons.paint();
  });
  $('#expMonth').addEventListener('change', (e) => { expFilter.month = e.target.value; renderExpenses(); window.Icons.paint(); });
  $('#expMonthClear').addEventListener('click', () => { $('#expMonth').value = ''; expFilter.month = ''; renderExpenses(); window.Icons.paint(); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xact]');
    if (!b) return;
    const x = (DB.expenses || []).find((y) => y.id === b.dataset.id);
    if (!x) return;
    if (b.dataset.xact === 'edit') openExpModal(x.id);
    else if (b.dataset.xact === 'del') {
      confirmBox('حذف رسوم', `بدك تحذف «${x.type}» بمبلغ ${money(x.amount)} ₪ بتاريخ ${dateLabel(x.date)}؟`, 'حذف', () => {
        DB.expenses = DB.expenses.filter((y) => y.id !== x.id);
        save(true); refreshAll(); toast('تم الحذف');
      });
    }
  });
  $('#exportExpCsv').addEventListener('click', () => {
    const rows = [['التاريخ', 'النوع', 'المبلغ', 'ملاحظة']];
    for (const x of filteredExpenses()) rows.push([x.date, x.type, C.num(x.amount), x.note || '']);
    saveCsv(`الرسوم-${todayStr()}.csv`, rows);
  });

  // إعدادات البرامج
  $('#addPlatform').addEventListener('click', () => {
    DB.settings.platforms = platforms().concat([{ name: 'برنامج جديد', percent: 10 }]);
    save(true); renderPlatformsSettings();
  });
  $('#platformList').addEventListener('input', (e) => {
    const n = e.target.closest('[data-pname]');
    const p = e.target.closest('[data-ppct]');
    if (n) { platforms()[+n.dataset.pname].name = n.value; save(); }
    if (p) { platforms()[+p.dataset.ppct].percent = C.num(p.value); save(); }
  });
  $('#platformList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pdel]');
    if (!b) return;
    DB.settings.platforms.splice(+b.dataset.pdel, 1);
    save(true); renderPlatformsSettings();
  });

  // إعدادات أنواع الرسوم
  $('#addExpType').addEventListener('click', () => {
    DB.settings.expenseTypes = expenseTypes().concat(['نوع جديد']);
    save(true); renderExpTypesSettings();
  });
  $('#expTypeList').addEventListener('input', (e) => {
    const n = e.target.closest('[data-tname]');
    if (n) { DB.settings.expenseTypes[+n.dataset.tname] = n.value; save(); }
  });
  $('#expTypeList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tdel]');
    if (!b) return;
    DB.settings.expenseTypes.splice(+b.dataset.tdel, 1);
    save(true); renderExpTypesSettings();
  });
  $('#setPickupFee').addEventListener('change', (e) => {
    DB.settings.pickupFee = C.num(e.target.value);
    save(); refreshAll();
  });

  // الزبائن
  $('#custSearch').addEventListener('input', (e) => { custQuery = e.target.value; renderCustomers(); window.Icons.paint(); });
  $('#addCustBtn').addEventListener('click', () => openCustModal());
  $('#custSave').addEventListener('click', saveCustomer);
  $('#custSendUnited').addEventListener('click', () => {
    const c = { name: $('#cName').value.trim(), phone: $('#cPhone').value.trim(), address1: $('#cAddr1').value.trim(), address2: $('#cAddr2').value.trim() };
    if (!c.name || !c.phone) { toast('املأ الاسم والرقم أولاً', 'err'); return; }
    sendCustomerToUnited(c);
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cact]');
    if (!b) return;
    const c = DB.customers.find((x) => x.id === b.dataset.id);
    if (!c) return;
    const act = b.dataset.cact;
    if (act === 'edit') openCustModal(c.id);
    else if (act === 'united') sendCustomerToUnited(c);
    else if (act === 'order') {
      openOrderModal();
      setTimeout(() => fillFromCustomer(c), 120);
    } else if (act === 'del') {
      confirmBox('حذف زبون', `متأكد بدك تحذف «${c.name}»؟ الطلبيات القديمة بتضل محفوظة.`, 'حذف', () => {
        DB.customers = DB.customers.filter((x) => x.id !== c.id);
        save(true); refreshAll(); toast('تم حذف الزبون');
      });
    }
  });

  // الأرصدة
  $('#ledgerSearch').addEventListener('input', (e) => { ledgerQuery = e.target.value; renderLedgers(); window.Icons.paint(); });
  $('#addLedgerBtn').addEventListener('click', () => openLedgerModal());
  $('#ledgerSave').addEventListener('click', saveLedger);
  $('#thresholdInput').addEventListener('change', (e) => {
    DB.settings.lowBalanceThreshold = C.num(e.target.value);
    save(); refreshAll();
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lact]');
    if (!b) return;
    const l = DB.ledgers.find((x) => x.id === b.dataset.id);
    if (!l) return;
    const act = b.dataset.lact;
    if (act === 'entry') openEntryModal(l.id);
    else if (act === 'edit') openLedgerModal(l.id);
    else if (act === 'del') {
      confirmBox('حذف شخص', `بدك تحذف «${l.name}» مع كل حركاته (${(l.entries || []).length})؟`, 'حذف', () => {
        DB.ledgers = DB.ledgers.filter((x) => x.id !== l.id);
        save(true); refreshAll(); toast('تم الحذف');
      });
    }
  });
  $('#entryDir').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    $$('#entryDir .chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    entryDir = parseInt(c.dataset.dir, 10);
  });
  $('#entrySave').addEventListener('click', saveEntry);
  $('#eAmount').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveEntry(); });
  $('#entryHistory').addEventListener('click', (e) => {
    const b = e.target.closest('[data-eact="del"]');
    if (!b) return;
    const l = DB.ledgers.find((x) => x.id === entryLedgerId);
    l.entries = l.entries.filter((x) => x.id !== b.dataset.id);
    save(true);
    const bal = C.ledgerBalance(l);
    $('#entryCurrent').textContent = `${money(bal)} ₪`;
    renderEntryHistory(l); refreshAll(); toast('تم حذف الحركة');
  });

  // التقارير
  $('#repRun').addEventListener('click', runReport);
  $$('#view-reports [data-range]').forEach((b) => b.addEventListener('click', () => {
    $$('#view-reports [data-range]').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    const r = b.dataset.range;
    const m = thisMonth();
    if (r === 'this') { $('#repFrom').value = m; $('#repTo').value = m; }
    else if (r === 'last') { const p = shiftMonth(m, -1); $('#repFrom').value = p; $('#repTo').value = p; }
    else if (r === '3') { $('#repFrom').value = shiftMonth(m, -2); $('#repTo').value = m; }
    else if (r === '6') { $('#repFrom').value = shiftMonth(m, -5); $('#repTo').value = m; }
    else if (r === 'year') { $('#repFrom').value = m.slice(0, 4) + '-01'; $('#repTo').value = m; }
    else { $('#repFrom').value = ''; $('#repTo').value = ''; }
    runReport();
  }));

  // التصدير
  $('#exportOrdersCsv').addEventListener('click', () => {
    const list = filteredOrders();
    const rows = [['التاريخ', 'التاريخ المتوقع', 'اسم الزبون', 'رقم الزبون', 'العنوان الأول', 'العنوان التفصيلي',
      'البرنامج', 'نوع التسليم', 'عدد القطع', 'سعر الطلبية', 'التوصيل/الاستلام', 'نسبة الربح %', 'الحالة', 'الربح',
      'رقم يونايتد', 'ملاحظات']];
    for (const o of list) {
      rows.push([o.date, o.expectedDate || '', o.customerName, o.phone, o.address1, o.address2,
        o.platform || '', (DELIVERY_TYPES[o.deliveryType] || DELIVERY_TYPES.delivery).label,
        C.num(o.pieces), C.num(o.price), C.num(o.deliveryPrice), C.num(o.profitPercent),
        (STATUS[o.status] || {}).label || o.status, C.orderProfit(o, DB.settings),
        o.unitedRef || o.unitedId || '', o.notes || '']);
    }
    saveCsv(`الطلبيات-${todayStr()}.csv`, rows);
  });

  $('#exportCustCsv').addEventListener('click', () => {
    const rows = [['الاسم', 'الرقم', 'العنوان الأول', 'العنوان التفصيلي', 'عدد الطلبيات', 'صافي الربح', 'ملاحظات']];
    for (const c of DB.customers) {
      const st = customerStats(c);
      rows.push([c.name, c.phone, c.address1 || '', c.address2 || '', st.count, st.netProfit, c.notes || '']);
    }
    saveCsv(`الزبائن-${todayStr()}.csv`, rows);
  });

  $('#exportRepCsv').addEventListener('click', () => {
    const { months, sum, expSum, expByMonth, net } = runReport();
    const rows = [['الشهر', 'عدد الطلبيات', 'مستلمة', 'راجعة', 'قيد الانتظار', 'المبيعات', 'ربح المسلّمة', 'خسائر الراجعة', 'ربح الطلبيات', 'الرسوم', 'الربح النهائي']];
    for (const m of months) {
      const ex = (expByMonth[m.month] || {}).total || 0;
      rows.push([m.month, m.count, m.delivered, m.returned, m.pending, m.sales, m.grossProfit, m.losses, m.netProfit, ex, C.round2(m.netProfit - ex)]);
    }
    rows.push(['المجموع', sum.count, sum.delivered, sum.returned, sum.pending, sum.sales, sum.grossProfit, sum.losses, sum.netProfit, expSum.total, net]);
    saveCsv(`تقرير-الأرباح-${todayStr()}.csv`, rows);
  });

  // الإعدادات
  $('#setPct').addEventListener('change', (e) => { DB.settings.defaultProfitPercent = C.num(e.target.value); save(); });
  $('#setReturn').addEventListener('change', (e) => { DB.settings.returnPolicy = e.target.value; save(); refreshAll(); });
  $('#setDelivery').addEventListener('change', (e) => { DB.settings.deliveryCountsInProfit = e.target.checked; save(); refreshAll(); });
  $('#setThreshold').addEventListener('change', (e) => { DB.settings.lowBalanceThreshold = C.num(e.target.value); save(); refreshAll(); });

  $('#btnExport').addEventListener('click', async () => {
    const r = await window.api.data.export();
    if (r.ok && r.data) toast('تم حفظ النسخة الاحتياطية');
    else if (!r.ok) toast('فشل: ' + r.error, 'err');
  });
  $('#btnImport').addEventListener('click', () => {
    confirmBox('استيراد نسخة', 'الاستيراد بيستبدل كل البيانات الحالية. البرنامج بيعمل نسخة أمان قبلها. متابعة؟', 'استيراد', async () => {
      const r = await window.api.data.import();
      if (r.ok && r.data) { DB = r.data; applyTheme(DB.settings.theme || 'dark'); refreshAll(); toast('تم الاستيراد بنجاح'); }
      else if (!r.ok) toast('فشل: ' + r.error, 'err');
    });
  });
  $('#btnWipe').addEventListener('click', () => {
    confirmBox('حذف كل البيانات', 'رح ينحذف كل شي: الطلبيات، الزبائن، الأرصدة. متأكد؟ صدّر نسخة احتياطية أولاً.', 'احذف الكل', () => {
      DB.orders = []; DB.customers = []; DB.ledgers = []; DB.expenses = [];
      save(true); refreshAll(); toast('تم حذف كل البيانات', 'warn');
    });
  });

  // التأكيد
  $('#confirmOk').addEventListener('click', () => {
    closeModal('#confirmModal');
    if (confirmCb) { const cb = confirmCb; confirmCb = null; cb(); }
  });

  /* ---------------- يونايتد: الويب ---------------- */

  $('#uRefresh').addEventListener('click', uCheckStatus);
  $('#uLogin').addEventListener('click', () => {
    $('#ulUser').value = '';
    $('#ulPass').value = '';
    $('#ulSession').value = '';
    $('#ulErr').classList.add('hidden');
    openModal('#uLoginModal');
  });
  const doULogin = async () => {
    const session = $('#ulSession').value.trim();
    const login = $('#ulUser').value.trim();
    const password = $('#ulPass').value;
    if (!session && (!login || !password)) { $('#ulErr').textContent = 'اكتب اسم المستخدم وكلمة السر'; $('#ulErr').classList.remove('hidden'); return; }
    const btn = $('#ulGo');
    btn.disabled = true;
    const r = await window.api.united.login(session ? { session } : { login, password });
    btn.disabled = false;
    if (r.ok) {
      closeModal('#uLoginModal');
      toast('تم تسجيل الدخول بنجاح');
      uCheckStatus();
    } else {
      $('#ulErr').textContent = r.error;
      $('#ulErr').classList.remove('hidden');
    }
  };
  $('#ulGo').addEventListener('click', doULogin);
  $('#uLoginForm').addEventListener('submit', (e) => { e.preventDefault(); doULogin(); });
  $('#uLogout').addEventListener('click', () => {
    confirmBox('تسجيل خروج', 'رح تحتاج تسجّل دخول من جديد عشان تبعت طلبيات. متابعة؟', 'تسجيل خروج', async () => {
      await window.api.united.logout();
      toast('تم تسجيل الخروج');
      uCheckStatus();
    });
  });
  $('#uOpenSite').addEventListener('click', () => window.api.united.open());
  $('#uDiagnose').addEventListener('click', async () => {
    $('#uLog').innerHTML = '';
    uLog('جاري التشخيص…', 'info');
    const r = await window.api.united.diagnose();
    if (!r.ok) { uLog('✗ ' + r.error, 'error'); return; }
    const d = r.data;
    $('#uLog').innerHTML = '';
    uLog(`الموقع: ${d.baseUrl}`, 'info');
    uLog(`الجدول: ${d.model}`, 'info');
    uLog(`الوسيط: ${d.proxy}`, d.proxyOk ? 'ok' : 'warn');
    if (d.proxyOk) uLog(`✓ الوسيط شغّال ووصل ليونايتد (HTTP ${d.reach})`, 'ok');
    uLog(`جلسة محفوظة على هذا الجهاز: ${d.hasSession ? 'آه' : 'لا'}`, d.hasSession ? 'ok' : 'warn');
    if (d.sessionInfo && d.sessionInfo.uid) {
      uLog(`✓ الجلسة شغّالة — المستخدم: ${d.sessionInfo.name || d.sessionInfo.username} (uid ${d.sessionInfo.uid})`, 'ok');
      if (d.sessionInfo.serverVersion) uLog(`  إصدار السيرفر: ${d.sessionInfo.serverVersion}`, 'info');
    } else {
      uLog('✗ ما في جلسة صالحة', 'error');
    }
    d.errors.forEach((e) => uLog('✗ ' + e, 'error'));
    uLog('— انسخ هذا السجل وابعته لو ضلّت المشكلة —', 'warn');
    toast('خلص التشخيص — شوف السجل تحت', 'info', 4000);
  });
  $('#uBase').addEventListener('change', (e) => { uCfg().baseUrl = e.target.value.trim().replace(/\/+$/, ''); save(); });
  $('#uModel').addEventListener('change', (e) => { uCfg().model = e.target.value.trim(); save(); });

  $('#uDiscover').addEventListener('click', async () => {
    toast('جاري قراءة حقول يونايتد…', 'info');
    const r = await window.api.united.fields();
    if (!r.ok) { toast('فشل: ' + r.error, 'err', 8000); uLog('✗ ' + r.error, 'error'); return; }
    DB.settings.united.fieldsCache = r.data.fields;
    DB.settings.united.mapping = r.data.mapping;
    if (r.data.statusField) uCfg().statusField = r.data.statusField;
    if (r.data.statusMap) uCfg().statusMap = r.data.statusMap;
    renderMapTable();
    renderAreas();
    renderStatusTable();
    renderFixed();
    uLog(`✓ تم اكتشاف ${r.data.fields.length} حقل، وربط ${Object.keys(r.data.mapping).length} منها تلقائياً`, 'ok');
    toast(`تم اكتشاف ${r.data.fields.length} حقل`);
  });

  $('#uGuess').addEventListener('click', async () => {
    const r = await window.api.united.guess();
    if (!r.ok) { toast('فشل: ' + r.error, 'err'); return; }
    uCfg().mapping = r.data;
    save(true);
    renderMapTable();
    toast('تم التخمين التلقائي');
  });

  $('#uMapTable').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (b) openPickModal(b.dataset.pick);
  });
  $('#pickSearch').addEventListener('input', (e) => renderPickList(e.target.value));
  $('#pickList').addEventListener('click', (e) => {
    const it = e.target.closest('[data-pf]');
    if (!it) return;
    setMapping(pickFor, it.dataset.pf);
    closeModal('#pickModal');
    toast('تم الربط');
  });
  $('#pickClear').addEventListener('click', () => {
    setMapping(pickFor, null);
    closeModal('#pickModal');
  });

  // المزامنة
  $('#uSyncNow').addEventListener('click', () => runSync(false));
  $('#uAutoSync').addEventListener('change', (e) => {
    uCfg().autoSync = e.target.checked;
    save();
    scheduleAutoSync();
    toast(e.target.checked ? 'تم تفعيل المزامنة التلقائية' : 'تم إيقاف المزامنة التلقائية', 'info');
  });
  $('#uSyncMinutes').addEventListener('change', (e) => {
    uCfg().syncMinutes = Math.max(5, C.num(e.target.value) || 20);
    e.target.value = uCfg().syncMinutes;
    save();
    scheduleAutoSync();
  });
  $('#uStatusTable').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-st]');
    if (!sel) return;
    uCfg().statusMap = uCfg().statusMap || {};
    uCfg().statusMap[sel.dataset.st] = sel.value;
    save(true);
  });

  // المناطق
  $('#uAreaField').addEventListener('change', (e) => {
    const f = uFields().find((x) => x.name === e.target.value);
    uCfg().areaField = e.target.value;
    uCfg().areaModel = f ? f.relation : '';
    uCfg().areas = [];
    save(true);
    renderAreas();
  });
  $('#uLoadAreas').addEventListener('click', async () => {
    const field = $('#uAreaField').value;
    if (!field) { toast('اختر حقل المنطقة أولاً', 'err'); return; }
    toast('جاري تحميل المناطق من يونايتد…', 'info', 4000);
    const r = await window.api.united.loadAreas({ field });
    if (!r.ok) { toast('فشل: ' + r.error, 'err', 8000); uLog('✗ ' + r.error, 'error'); return; }
    uCfg().areas = r.data.areas;
    uCfg().areaField = r.data.areaField;
    uCfg().areaModel = r.data.areaModel;
    renderAreas();
    uLog(`✓ تم تحميل ${r.data.areas.length} منطقة من «${r.data.label}»`, 'ok');
    toast(`تم تحميل ${r.data.areas.length} منطقة`);
  });

  $('#uAddFixed').addEventListener('click', openFixedModal);
  $('#fxField').addEventListener('change', fxSyncType);
  let fxTimer = null;
  $('#fxSearch').addEventListener('input', () => { clearTimeout(fxTimer); fxTimer = setTimeout(fxSearch, 320); });
  $('#fxResults').addEventListener('click', (e) => {
    const it = e.target.closest('[data-fxid]');
    if (!it) return;
    $$('#fxResults .node-item').forEach((x) => x.style.borderColor = '');
    it.style.borderColor = 'var(--primary)';
    fxPicked = { id: +it.dataset.fxid, name: it.dataset.fxname };
  });
  $('#fxSave').addEventListener('click', () => {
    const opt = $('#fxField').selectedOptions[0];
    if (!opt) return;
    const isRel = opt.dataset.type === 'many2one';
    if (isRel && !fxPicked) { toast('اختر قيمة من نتائج البحث', 'err'); return; }
    const val = isRel ? '' : $('#fxValue').value.trim();
    if (!isRel && !val) { toast('اكتب القيمة', 'err'); return; }
    uCfg().fixed = uCfg().fixed || [];
    uCfg().fixed = uCfg().fixed.filter((f) => f.field !== opt.value);
    uCfg().fixed.push({
      field: opt.value,
      label: opt.textContent.split('—')[0].trim(),
      value: val,
      id: isRel ? fxPicked.id : undefined,
      display: isRel ? fxPicked.name : val
    });
    save(true);
    closeModal('#fixedModal');
    renderFixed();
    renderMapTable();
    toast('تمت الإضافة');
  });
  $('#uFixedList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fxdel]');
    if (!b) return;
    uCfg().fixed.splice(+b.dataset.fxdel, 1);
    save(true);
    renderFixed();
    renderMapTable();
  });

  const SAMPLE = {
    name: 'محمد تجريبي', phone: '0591234567', address1: 'رام الله',
    address2: 'شارع الإرسال - عمارة النور، ط3', pieces: 2, price: 150,
    deliveryPrice: 20, notes: 'طلبية تجريبية من البرنامج'
  };
  $('#uPreview').addEventListener('click', async () => {
    const r = await window.api.united.preview({ vars: SAMPLE });
    $('#uLog').innerHTML = '';
    if (!r.ok) { uLog('✗ ' + r.error, 'error'); return; }
    uLog('البيانات اللي رح تنبعث ليونايتد:', 'info');
    const byName = new Map(uFields().map((f) => [f.name, f]));
    for (const [k, v] of Object.entries(r.data)) {
      uLog(`  ${(byName.get(k) || {}).label || k} (${k}) = ${JSON.stringify(v)}`, 'ok');
    }
    if (!Object.keys(r.data).length) uLog('  (فاضي — ما في ربط حقول بعد)', 'warn');
  });
  $('#uTest').addEventListener('click', () => {
    confirmBox('إرسال تجريبي', 'رح تنشأ طلبية حقيقية باسم «محمد تجريبي» في حسابك عند يونايتد. تقدر تحذفها من الموقع بعدين. متابعة؟', 'أرسل', async () => {
      $('#uLog').innerHTML = '';
      uLog('جاري الإرسال…', 'info');
      await sendViaWeb(SAMPLE, true).then((r) => uLog(r.ok ? `✓ تم — رقم الطلبية ${r.data.ref || r.data.id}` : `✗ ${r.error}`, r.ok ? 'ok' : 'error'));
    });
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-uopen]');
    if (b) window.api.united.open(b.dataset.uopen);
  });

  // اختصارات
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); openOrderModal(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#globalSearch').focus(); }
    if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(true); toast('تم الحفظ', 'ok', 1500); }
  });
}

/* ================================================================
   ربط خاص بنسخة الويب (الجوال، الحساب، المزامنة، فلتر البرنامج)
   ================================================================ */

function bindWeb() {
  // تحديث لحظي لما يتعدّل إشي من جهاز ثاني
  window.api.data.onRemote(() => {
    clearTimeout(bindWeb._t);
    bindWeb._t = setTimeout(() => { refreshAll(); }, 150);
  });

  // الحساب
  const u = window.api.user();
  $('#userName').textContent = u.name || u.email || '';
  $('#userEmail').textContent = u.email || '';
  $('#logoutBtn').addEventListener('click', () => {
    confirmBox('تسجيل الخروج', 'بدك تطلع من حسابك على هذا الجهاز؟', 'خروج', () => window.api.logout());
  });

  // قائمة الجوال
  const closeNav = () => document.body.classList.remove('nav-open');
  $('#menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#navScrim').addEventListener('click', closeNav);
  $('#nav').addEventListener('click', (e) => { if (e.target.closest('.nav-item')) closeNav(); });

  // فلتر البرنامج بالتقارير
  $('#repPlatforms').addEventListener('click', (e) => {
    const c = e.target.closest('[data-plat]');
    if (!c) return;
    repPlatform = c.dataset.plat;
    runReport();
  });
  $('#repByPlatform').addEventListener('click', (e) => {
    const r = e.target.closest('[data-plat-row]');
    if (!r) return;
    repPlatform = repPlatform === r.dataset.platRow ? '' : r.dataset.platRow;
    runReport();
  });

  // فلتر البرنامج بالطلبيات
  $('#ordersPlatform').addEventListener('change', (e) => {
    orderFilter.platform = e.target.value;
    renderOrders();
    window.Icons.paint();
  });
}

/* ================================================================
   الإقلاع
   ================================================================ */

(async function init() {
  // api.js (module) ممكن يخلص بعد هذا الملف — منستناه
  if (!window.apiReady) await new Promise((r) => window.addEventListener('api-ready', r, { once: true }));
  await window.apiReady;
  const r = await window.api.data.get();
  if (!r.ok) { document.body.innerHTML = `<p style="padding:40px">فشل تحميل البيانات: ${esc(r.error)}</p>`; return; }
  DB = r.data;
  applyTheme(DB.settings.theme || 'dark');
  bind();
  bindWeb();
  go('dashboard');
  updateBadges();
  window.Icons.paint();

  // مزامنة عند فتح البرنامج + جدولة دورية
  scheduleAutoSync();
  if (uCfg().autoSync !== false && DB.orders.some((o) => o.unitedId)) {
    setTimeout(() => runSync(true), 4000);
  }
})();

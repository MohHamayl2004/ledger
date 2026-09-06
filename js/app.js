/* ============================================================
   واجهة الموقع
   ============================================================ */
import { USERS } from './config.js';
import * as S from './store.js';

/* ─────────── أدوات مساعدة ─────────── */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf  = n => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(n) || 0);
const cur = () => S.settings().currency || '₪';
const money = n => `${nf(n)} ${cur()}`;
const initials = name => (name || '?').trim().charAt(0);
const fdate = d => new Date(d).toLocaleDateString('en-GB');
const today = () => new Date().toISOString().slice(0, 10);
const icon = id => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
const monthLabel = mk => {
  const [y, m] = mk.split('-');
  const names = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${names[Number(m) - 1]} ${y}`;
};
const ago = d => {
  if(!d) return 'لا يوجد';
  const days = Math.floor((Date.now() - new Date(d)) / 86400000);
  if(days <= 0) return 'اليوم';
  if(days === 1) return 'أمس';
  if(days < 30) return `قبل ${days} يوم`;
  const m = Math.floor(days / 30);
  return `قبل ${m} شهر`;
};

/* ─────────── الوضع الليلي ─────────── */
const THEME_KEY = 'ledger_theme';
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#080a14' : '#f4f5fb');
  try{ localStorage.setItem(THEME_KEY, t); }catch(e){}
}
applyTheme((() => { try{ return localStorage.getItem(THEME_KEY) || 'dark'; }catch(e){ return 'dark'; } })());
document.addEventListener('click', e => {
  const b = e.target.closest('[data-theme-toggle]');
  if(!b) return;
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

/* ─────────── التنبيهات ─────────── */
function toast(msg, kind = 'ok'){
  const ic = kind === 'err' ? 'alert' : kind === 'info' ? 'clock' : 'check';
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, 3200);
}

/* ─────────── النوافذ المنبثقة ─────────── */
const scrim = $('#scrim'), host = $('#sheetHost');
let onSheetClose = null;
function openSheet(html, opts = {}){
  host.innerHTML = `<div class="sheet-grab"></div>${html}`;
  host.hidden = false; scrim.hidden = false;
  document.body.style.overflow = 'hidden';
  onSheetClose = opts.onClose || null;
  const f = host.querySelector('[data-autofocus]');
  if(f) setTimeout(() => f.focus(), 120);
}
function closeSheet(){
  host.hidden = true; scrim.hidden = true; host.innerHTML = '';
  document.body.style.overflow = '';
  if(onSheetClose){ const f = onSheetClose; onSheetClose = null; f(); }
}
scrim.addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if(e.key === 'Escape' && !host.hidden) closeSheet(); });
document.addEventListener('click', e => { if(e.target.closest('[data-close]')) closeSheet(); });

function confirmSheet({ title, body, danger = true, okText = 'تأكيد' }){
  return new Promise(resolve => {
    openSheet(`
      <div class="sheet-head">
        <div><h3>${esc(title)}</h3><p>${esc(body)}</p></div>
        <button class="icon-btn" data-close aria-label="إغلاق">${icon('x')}</button>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-ghost" data-close type="button">إلغاء</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cfmOk" type="button">${esc(okText)}</button>
      </div>`, { onClose: () => resolve(false) });
    $('#cfmOk').onclick = () => { onSheetClose = null; closeSheet(); resolve(true); };
  });
}

/* ─────────── الجلسة وتسجيل الدخول ─────────── */
const SESSION_KEY = 'ledger_session';
let session = null;
try{ session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }catch(e){}

$('#peek').onclick = () => {
  const i = $('#lp');
  i.type = i.type === 'password' ? 'text' : 'password';
};

$('#loginForm').addEventListener('submit', e => {
  e.preventDefault();
  const u = $('#lu').value.trim().toLowerCase();
  const p = $('#lp').value;
  const hit = USERS.find(x => x.user.toLowerCase() === u && x.pass === p);
  const err = $('#loginErr');
  if(!hit){
    err.textContent = 'اسم المستخدم أو كلمة المرور غير صحيحة';
    err.hidden = false;
    $('#loginForm').animate(
      [{transform:'translateX(0)'},{transform:'translateX(-8px)'},{transform:'translateX(8px)'},{transform:'translateX(0)'}],
      { duration: 260 }
    );
    return;
  }
  err.hidden = true;
  session = { user: hit.user, name: hit.name };
  try{ localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }catch(e){}
  startApp();
});

$('#logoutBtn').onclick = async () => {
  if(!await confirmSheet({ title: 'تسجيل الخروج', body: 'بدك تطلع من الحساب؟', okText: 'خروج' })) return;
  try{ localStorage.removeItem(SESSION_KEY); }catch(e){}
  session = null;
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#lp').value = '';
};

/* ─────────── التشغيل ─────────── */
let view = 'dash';
let mkFilter = S.monthKey();

async function startApp(){
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#uName').textContent = session.name;
  $('#uAvatar').textContent = initials(session.name);
  await S.initStore();
  updateSyncPill();
  S.subscribe(render);
  render();
}

function updateSyncPill(){
  const online = S.getMode() === 'cloud';
  $('#syncPill').classList.toggle('online', online);
  $('#syncTxt').textContent = online ? 'مزامنة' : 'محلي';
  $('#syncPill').title = online ? 'البيانات محفوظة أونلاين ومتزامنة' : 'البيانات محفوظة على هذا الجهاز فقط';
}

$$('.nav-item').forEach(b => b.onclick = () => {
  view = b.dataset.view;
  $$('.nav-item').forEach(x => x.classList.toggle('is-active', x === b));
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

$('#fab').onclick = quickActions;

/* ============================================================
   الرسم
   ============================================================ */
function render(){
  updateSyncPill();
  const g = S.globalStats(S.monthKey());
  const badge = $('#readyBadge');
  badge.textContent = g.ready;
  badge.hidden = g.ready === 0;

  const main = $('#main');
  if(view === 'dash')          main.innerHTML = viewDash();
  else if(view === 'people')   main.innerHTML = viewPeople();
  else if(view === 'tx')       main.innerHTML = viewTx();
  else if(view === 'ready')    main.innerHTML = viewReady();
  else if(view === 'settings') main.innerHTML = viewSettings();
  wire();
}

/* ─────────── لوحة التحكم ─────────── */
function viewDash(){
  const mk = S.monthKey();
  const g = S.globalStats(mk);
  const pend = S.pendingReturns();
  const list = S.people()
    .map(p => ({ p, st: S.statsOf(p.id, mk) }))
    .sort((a, b) => b.st.balance - a.st.balance);
  const max = Math.max(1, ...list.map(x => x.st.balance));
  const readyList = list.filter(x => x.st.ready);

  return `
  <div class="page">
    <div class="page-head">
      <div>
        <h2>مرحبا ${esc(session.name)} 👋</h2>
        <p>ملخّص ${monthLabel(mk)} — ${g.peopleCount} حساب</p>
      </div>
    </div>

    <div class="stats">
      ${stat('brand','wallet','مجموع الأرصدة', money(g.balance), `عند ${g.peopleCount} شخص`)}
      ${stat('ok','check','حسابات جاهزة', g.ready, `رصيدها تحت ${nf(S.settings().readyThreshold)}`)}
      ${stat('warn','clock','قطع راجعة معلّقة', money(g.pending), `${g.pendingCount} قطعة بتنضاف قريباً`)}
      ${stat('info','box','طلبيات الشهر', g.orders, `خصومات ${nf(S.settings().counterMin)}–${nf(S.settings().counterMax)}`)}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h3>الأرصدة حسب الشخص</h3><span class="sub">${monthLabel(mk)}</span></div>
        ${list.length ? list.slice(0, 8).map(({ p, st }) => `
          <div class="rank">
            <span class="nm">${esc(p.name)}</span>
            <span class="track"><i style="width:${Math.max(2, (st.balance / max) * 100)}%;background:${p.color}"></i></span>
            <span class="vl num">${nf(st.balance)}</span>
          </div>`).join('')
        : empty('users','ما في حسابات بعد','ابدأ بإضافة أول شخص','addPerson','إضافة حساب')}
      </div>

      <div>
        <div class="card">
          <div class="card-head"><h3>حسابات جاهزة</h3><span class="chip ok">${readyList.length}</span></div>
          ${readyList.length ? readyList.map(({ p, st }) => `
            <div class="pending-row">
              <span class="pav" style="width:30px;height:30px;border-radius:10px;font-size:.8rem;background:${p.color}">${esc(initials(p.name))}</span>
              <b>${esc(p.name)}</b>
              <span class="d num">${nf(st.balance)} ${cur()}</span>
            </div>`).join('')
          : `<p class="muted" style="margin:0;font-size:.88rem">ما في حساب وصل تحت ${nf(S.settings().readyThreshold)} ${cur()} بعد.</p>`}
        </div>

        <div class="card">
          <div class="card-head"><h3>قطع راجعة قادمة</h3><span class="sub">بتنضاف تلقائياً</span></div>
          ${pend.length ? pend.slice(0, 6).map(t => `
            <div class="pending-row">
              <span class="days-chip">${t.days === 0 ? 'اليوم' : `بعد ${t.days} يوم`}</span>
              <b>${esc(t.personName)}</b>
              <span class="d num">+${nf(t.returnPrice)}</span>
            </div>`).join('')
          : `<p class="muted" style="margin:0;font-size:.88rem">ما في قطع معلّقة حالياً.</p>`}
        </div>
      </div>
    </div>
  </div>`;
}

const stat = (tone, ic, label, val, sub) => `
  <div class="stat s-${tone}">
    <div class="stat-top"><span class="badge-ico">${icon(ic)}</span><span>${esc(label)}</span></div>
    <p class="stat-val num">${typeof val === 'number' ? nf(val) : esc(val)}</p>
    <p class="stat-sub">${esc(sub)}</p>
  </div>`;

const empty = (ic, title, text, action, actionText) => `
  <div class="empty">
    ${icon(ic)}
    <h4>${esc(title)}</h4>
    <p>${esc(text)}</p>
    ${action ? `<button class="btn btn-primary" data-act="${action}">${icon('plus')}${esc(actionText)}</button>` : ''}
  </div>`;

/* ─────────── الحسابات ─────────── */
let peopleQuery = '', peopleSort = 'bal';
function viewPeople(){
  const mk = S.monthKey();
  let list = S.people().map(p => ({ p, st: S.statsOf(p.id, mk) }));
  if(peopleQuery){
    const q = peopleQuery.toLowerCase();
    list = list.filter(({ p }) => p.name.toLowerCase().includes(q) || (p.phone || '').includes(q));
  }
  if(peopleSort === 'bal')       list.sort((a, b) => b.st.balance - a.st.balance);
  else if(peopleSort === 'name') list.sort((a, b) => a.p.name.localeCompare(b.p.name, 'ar'));
  else if(peopleSort === 'ord')  list.sort((a, b) => b.st.orders - a.st.orders);

  return `
  <div class="page">
    <div class="page-head">
      <div><h2>الحسابات</h2><p>${S.people().length} شخص — ${monthLabel(mk)}</p></div>
      <button class="btn btn-primary" data-act="addPerson">${icon('plus')}حساب جديد</button>
    </div>

    <div class="toolbar">
      <div class="input-wrap">
        ${icon('search')}
        <input id="pq" type="text" placeholder="دوّر باسم أو رقم..." value="${esc(peopleQuery)}">
      </div>
      <div class="seg" id="psort">
        <button class="${peopleSort === 'bal' ? 'on' : ''}" data-sort="bal">الرصيد</button>
        <button class="${peopleSort === 'name' ? 'on' : ''}" data-sort="name">الاسم</button>
        <button class="${peopleSort === 'ord' ? 'on' : ''}" data-sort="ord">الطلبيات</button>
      </div>
    </div>

    ${list.length ? `<div class="people-grid">${list.map(({ p, st }) => pcard(p, st)).join('')}</div>`
                  : empty('users','ما في حسابات','ضيف أول شخص وابدأ ترصد له','addPerson','إضافة حساب')}
  </div>`;
}

function pcard(p, st){
  const tone = st.capUsedPct >= 95 ? 'danger' : st.capUsedPct >= 75 ? 'warn' : 'ok';
  return `
  <button class="pcard ${st.ready ? 'is-ready' : ''}" data-person="${p.id}">
    <div class="pcard-top">
      <span class="pav" style="background:${p.color}">${esc(initials(p.name))}</span>
      <div style="min-width:0">
        <div class="pname">${esc(p.name)}</div>
        <div class="pmeta">${p.phone ? esc(p.phone) : 'آخر حركة: ' + ago(st.lastDate)}</div>
      </div>
      ${st.ready ? `<span class="chip ok" style="margin-inline-start:auto">${icon('check')}جاهز</span>` : ''}
    </div>

    <div class="pbal"><b class="num">${nf(st.balance)}</b><small>${cur()}</small></div>
    <div class="plabel">الرصيد الحالي${st.pending > 0 ? ` · <span style="color:var(--warn)">+${nf(st.pending)} معلّق</span>` : ''}</div>

    <div class="bar-row"><span>سقف الشهر</span><span class="num">${nf(st.monthIn)} / ${nf(st.cap)}</span></div>
    <div class="bar ${tone}"><i style="width:${st.capUsedPct}%"></i></div>

    <div class="pcard-foot">
      <span class="chip brand">${icon('box')}${st.orders} طلبية</span>
      <span class="chip">متبقي ${nf(st.capLeft)}</span>
      ${st.pendingCount ? `<span class="chip warn">${icon('clock')}${st.pendingCount} راجعة</span>` : ''}
    </div>
  </button>`;
}

/* ─────────── الحركات ─────────── */
let txPerson = 'all', txType = 'all', txQuery = '';
function viewTx(){
  const months = S.allMonths();
  let list = S.txs().slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  if(mkFilter !== 'all') list = list.filter(t => S.monthKey(new Date(t.date)) === mkFilter);
  if(txPerson !== 'all')  list = list.filter(t => t.personId === txPerson);
  if(txType !== 'all')    list = list.filter(t => t.type === txType);
  if(txQuery){
    const q = txQuery.toLowerCase();
    list = list.filter(t => (t.note || '').toLowerCase().includes(q) || nameOf(t.personId).toLowerCase().includes(q));
  }

  const totIn  = list.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0);
  const totOut = list.filter(t => t.type === 'out').reduce((s, t) => s + t.orderPrice, 0);
  const totRet = list.filter(t => t.type === 'out').reduce((s, t) => s + t.returnPrice, 0);

  return `
  <div class="page">
    <div class="page-head">
      <div><h2>سجل الحركات</h2><p>${list.length} حركة</p></div>
      <button class="btn btn-ghost" data-act="csv">${icon('down')}تصدير CSV</button>
    </div>

    <div class="stats">
      ${stat('ok','in','إجمالي المرصود', money(totIn), 'في الفترة المحددة')}
      ${stat('danger','up','إجمالي المسحوب', money(totOut), 'سعر الطلبيات')}
      ${stat('warn','clock','قطع راجعة', money(totRet), 'المجموع الكلي')}
    </div>

    <div class="toolbar">
      <div class="input-wrap">${icon('search')}<input id="tq" type="text" placeholder="بحث..." value="${esc(txQuery)}"></div>
      <select id="fMonth">
        <option value="all" ${mkFilter === 'all' ? 'selected' : ''}>كل الشهور</option>
        ${months.map(m => `<option value="${m}" ${mkFilter === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}
      </select>
      <select id="fPerson">
        <option value="all">كل الحسابات</option>
        ${S.people().map(p => `<option value="${p.id}" ${txPerson === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      <div class="seg" id="ftype">
        <button class="${txType === 'all' ? 'on' : ''}" data-t="all">الكل</button>
        <button class="${txType === 'in' ? 'on' : ''}" data-t="in">إيداع</button>
        <button class="${txType === 'out' ? 'on' : ''}" data-t="out">طلبية</button>
      </div>
    </div>

    <div class="card" style="padding:.4rem .6rem">
      ${list.length ? `<div class="tx-list">${list.map(t => txRow(t, true)).join('')}</div>`
                    : empty('list','ما في حركات','جرّب تغيّر الفلاتر أو ضيف حركة جديدة')}
    </div>
  </div>`;
}

const nameOf = id => (S.people().find(p => p.id === id) || {}).name || '—';

function txRow(t, showPerson){
  const now = new Date();
  if(t.type === 'in'){
    return `
    <div class="tx-row">
      <span class="tx-ico tx-in">${icon('in')}</span>
      <div class="tx-body">
        <div class="tx-t1">${showPerson ? esc(nameOf(t.personId)) : 'إيداع'} <span class="chip ok">إيداع</span></div>
        <div class="tx-t2"><span>${fdate(t.date)}</span>${t.note ? `<span>· ${esc(t.note)}</span>` : ''}${t.by ? `<span>· ${esc(t.by)}</span>` : ''}</div>
      </div>
      <div class="tx-amt pos num">+${nf(t.amount)}</div>
      <button class="icon-btn tx-del" data-deltx="${t.id}" aria-label="حذف الحركة">${icon('trash')}</button>
    </div>`;
  }
  const rel = t.releaseDate ? new Date(t.releaseDate) : null;
  const done = rel ? rel <= now : true;
  const days = rel ? Math.max(0, Math.ceil((rel - now) / 86400000)) : 0;
  const counted = t.orderPrice >= S.settings().counterMin && t.orderPrice <= S.settings().counterMax;
  return `
  <div class="tx-row">
    <span class="tx-ico tx-out">${icon('up')}</span>
    <div class="tx-body">
      <div class="tx-t1">${showPerson ? esc(nameOf(t.personId)) : 'طلبية'} <span class="chip danger">طلبية</span>${counted ? `<span class="chip brand">${icon('box')}محسوبة</span>` : ''}</div>
      <div class="tx-t2">
        <span>${fdate(t.date)}</span>
        ${t.returnPrice > 0 ? (done
            ? `<span style="color:var(--ok)">· راجعة ${nf(t.returnPrice)} أُضيفت</span>`
            : `<span style="color:var(--warn)">· راجعة ${nf(t.returnPrice)} بعد ${days} يوم</span>`) : ''}
        ${t.note ? `<span>· ${esc(t.note)}</span>` : ''}
      </div>
    </div>
    <div class="tx-amt neg num">−${nf(t.orderPrice)}</div>
    <button class="icon-btn tx-del" data-deltx="${t.id}" aria-label="حذف الحركة">${icon('trash')}</button>
  </div>`;
}

/* ─────────── جاهزة ─────────── */
function viewReady(){
  const mk = S.monthKey();
  const list = S.people().map(p => ({ p, st: S.statsOf(p.id, mk) }))
                          .filter(x => x.st.ready)
                          .sort((a, b) => a.st.balance - b.st.balance);
  return `
  <div class="page">
    <div class="page-head">
      <div><h2>حسابات جاهزة</h2><p>رصيدها نزل تحت ${nf(S.settings().readyThreshold)} ${cur()} — بتقدر ترصد لها</p></div>
    </div>
    ${list.length ? `<div class="people-grid">${list.map(({ p, st }) => pcard(p, st)).join('')}</div>`
                  : empty('check','ما في حساب جاهز','كل الحسابات لسه رصيدها فوق الحد')}
  </div>`;
}

/* ─────────── الإعدادات ─────────── */
function viewSettings(){
  const s = S.settings();
  const online = S.getMode() === 'cloud';
  return `
  <div class="page">
    <div class="page-head"><div><h2>الإعدادات</h2><p>قواعد النظام والنسخ الاحتياطي</p></div></div>

    <div class="card">
      <div class="card-head"><h3>قواعد الحساب</h3></div>
      <form id="setForm">
        <div class="row-2">
          <div class="field"><label for="s1">سقف الاستقبال الشهري الافتراضي</label>
            <input id="s1" type="number" step="any" value="${s.defaultCap}"></div>
          <div class="field"><label for="s2">حد "الحساب جاهز"</label>
            <input id="s2" type="number" step="any" value="${s.readyThreshold}"></div>
        </div>
        <div class="row-2">
          <div class="field"><label for="s3">أيام تأخير القطعة الراجعة</label>
            <input id="s3" type="number" step="1" min="0" value="${s.returnDelayDays}">
            <p class="hint">بينطبق على الحركات الجديدة فقط</p></div>
          <div class="field"><label for="s6">رمز العملة</label>
            <input id="s6" type="text" value="${esc(s.currency)}"></div>
        </div>
        <div class="row-2">
          <div class="field"><label for="s4">الكاونتر — أقل مبلغ</label>
            <input id="s4" type="number" step="any" value="${s.counterMin}"></div>
          <div class="field"><label for="s5">الكاونتر — أعلى مبلغ</label>
            <input id="s5" type="number" step="any" value="${s.counterMax}"></div>
        </div>
        <button class="btn btn-primary" type="submit">حفظ الإعدادات</button>
      </form>
    </div>

    <div class="card">
      <div class="card-head"><h3>التخزين</h3>
        <span class="chip ${online ? 'ok' : ''}">${icon('cloud')}${online ? 'متصل ومتزامن' : 'محلي فقط'}</span></div>
      <p class="muted" style="font-size:.87rem;margin-top:0">
        ${online ? 'البيانات محفوظة على Firebase وبتتحدث لحظياً عند محمد ورزان.'
                 : 'البيانات محفوظة على هذا المتصفح فقط. لتفعيل المزامنة عبئ إعدادات Firebase في ملف js/config.js.'}
      </p>
      <div class="toolbar" style="margin:0">
        <button class="btn" data-act="export">${icon('down')}تنزيل نسخة احتياطية</button>
        <button class="btn" data-act="import">${icon('upload')}استيراد نسخة</button>
        <input type="file" id="importFile" accept="application/json" hidden>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>منطقة الخطر</h3></div>
      <p class="muted" style="font-size:.87rem;margin-top:0">بيمسح كل الحسابات والحركات نهائياً.</p>
      <button class="btn btn-danger" data-act="wipe">${icon('trash')}مسح كل البيانات</button>
    </div>
  </div>`;
}

/* ============================================================
   ربط الأحداث
   ============================================================ */
function wire(){
  const pq = $('#pq');
  if(pq) pq.oninput = e => { peopleQuery = e.target.value; const v = e.target.selectionStart; render(); const n = $('#pq'); if(n){ n.focus(); n.setSelectionRange(v, v); } };
  const psort = $('#psort');
  if(psort) psort.onclick = e => { const b = e.target.closest('[data-sort]'); if(!b) return; peopleSort = b.dataset.sort; render(); };

  const tq = $('#tq');
  if(tq) tq.oninput = e => { txQuery = e.target.value; const v = e.target.selectionStart; render(); const n = $('#tq'); if(n){ n.focus(); n.setSelectionRange(v, v); } };
  const fm = $('#fMonth'); if(fm) fm.onchange = e => { mkFilter = e.target.value; render(); };
  const fp = $('#fPerson'); if(fp) fp.onchange = e => { txPerson = e.target.value; render(); };
  const ft = $('#ftype'); if(ft) ft.onclick = e => { const b = e.target.closest('[data-t]'); if(!b) return; txType = b.dataset.t; render(); };

  const sf = $('#setForm');
  if(sf) sf.onsubmit = async e => {
    e.preventDefault();
    await S.saveSettings({
      defaultCap: Number($('#s1').value) || 0,
      readyThreshold: Number($('#s2').value) || 0,
      returnDelayDays: Number($('#s3').value) || 0,
      counterMin: Number($('#s4').value) || 0,
      counterMax: Number($('#s5').value) || 0,
      currency: $('#s6').value.trim() || '₪'
    });
    toast('تم حفظ الإعدادات');
    render();
  };

  const imp = $('#importFile');
  if(imp) imp.onchange = async e => {
    const f = e.target.files[0]; if(!f) return;
    try{ await S.importData(await f.text()); toast('تم استيراد النسخة'); render(); }
    catch(err){ toast('ملف غير صالح', 'err'); }
    e.target.value = '';
  };
}

document.addEventListener('click', async e => {
  const card = e.target.closest('[data-person]');
  if(card && !e.target.closest('[data-deltx]')){ personSheet(card.dataset.person); return; }

  const del = e.target.closest('[data-deltx]');
  if(del){
    e.stopPropagation();
    if(await confirmSheet({ title: 'حذف الحركة', body: 'الحركة رح تنمسح والرصيد رح يتعدّل.', okText: 'حذف' })){
      await S.removeTx(del.dataset.deltx); toast('تم حذف الحركة'); render();
    }
    return;
  }

  const act = e.target.closest('[data-act]');
  if(!act) return;
  const a = act.dataset.act;
  if(a === 'addPerson')  personForm();
  else if(a === 'export'){
    dl('backup-' + today() + '.json', S.exportData(), 'application/json');
    toast('تم تنزيل النسخة الاحتياطية');
  }
  else if(a === 'import') $('#importFile').click();
  else if(a === 'csv')    exportCSV();
  else if(a === 'wipe'){
    if(await confirmSheet({ title: 'مسح كل البيانات', body: 'ما في تراجع عن هالخطوة. نزّل نسخة احتياطية أول.', okText: 'امسح الكل' })){
      await S.importData(JSON.stringify({ people: [], tx: [], settings: S.settings() }));
      toast('تم مسح البيانات'); render();
    }
  }
});

/* ─────────── إجراءات سريعة (زر +) ─────────── */
function quickActions(){
  openSheet(`
    <div class="sheet-head">
      <div><h3>إجراء سريع</h3><p>شو بدك تعمل؟</p></div>
      <button class="icon-btn" data-close aria-label="إغلاق">${icon('x')}</button>
    </div>
    <div style="display:grid;gap:.6rem">
      <button class="btn btn-lg" id="qaIn" style="justify-content:flex-start;background:var(--ok-soft);color:var(--ok);border-color:transparent">${icon('in')}ترصيد مبلغ لشخص</button>
      <button class="btn btn-lg" id="qaOut" style="justify-content:flex-start;background:var(--danger-soft);color:var(--danger);border-color:transparent">${icon('up')}تسجيل طلبية (سحب)</button>
      <button class="btn btn-lg btn-ghost" id="qaP" style="justify-content:flex-start">${icon('plus')}إضافة حساب جديد</button>
    </div>`);
  $('#qaIn').onclick  = () => { closeSheet(); txForm('in'); };
  $('#qaOut').onclick = () => { closeSheet(); txForm('out'); };
  $('#qaP').onclick   = () => { closeSheet(); personForm(); };
}

/* ─────────── نموذج الحساب ─────────── */
function personForm(existing = null){
  const p = existing || {};
  openSheet(`
    <div class="sheet-head">
      <div><h3>${existing ? 'تعديل الحساب' : 'حساب جديد'}</h3><p>معلومات الشخص وسقفه الشهري</p></div>
      <button class="icon-btn" data-close aria-label="إغلاق">${icon('x')}</button>
    </div>
    <form id="pf">
      <div class="field"><label for="pn">الاسم</label>
        <input id="pn" type="text" required data-autofocus value="${esc(p.name || '')}" placeholder="مثلاً: أحمد"></div>
      <div class="row-2">
        <div class="field"><label for="pp">رقم الهاتف (اختياري)</label>
          <input id="pp" type="text" inputmode="tel" dir="ltr" value="${esc(p.phone || '')}" placeholder="059..."></div>
        <div class="field"><label for="pc">سقف الاستقبال الشهري</label>
          <input id="pc" type="number" step="any" value="${p.monthlyCap ?? ''}" placeholder="${S.settings().defaultCap}">
          <p class="hint">اتركه فاضي ليستعمل الافتراضي</p></div>
      </div>
      <div class="field"><label for="pnote">ملاحظة (اختياري)</label>
        <input id="pnote" type="text" value="${esc(p.note || '')}"></div>
      <div class="sheet-actions">
        <button class="btn btn-ghost" type="button" data-close>إلغاء</button>
        <button class="btn btn-primary" type="submit">${existing ? 'حفظ' : 'إضافة'}</button>
      </div>
    </form>`);
  $('#pf').onsubmit = async ev => {
    ev.preventDefault();
    const data = {
      name: $('#pn').value.trim(),
      phone: $('#pp').value.trim(),
      monthlyCap: $('#pc').value === '' ? null : Number($('#pc').value),
      note: $('#pnote').value.trim()
    };
    if(!data.name){ toast('لازم تكتب الاسم', 'err'); return; }
    if(existing) await S.updatePerson(existing.id, data);
    else await S.addPerson(data);
    closeSheet();
    toast(existing ? 'تم حفظ التعديلات' : 'تمت إضافة الحساب');
    render();
  };
}

/* ─────────── نموذج الحركة ─────────── */
function txForm(type, personId = null, pre = {}){
  const ppl = S.people();
  if(!ppl.length){ toast('ضيف حساب أول', 'err'); personForm(); return; }
  const isIn = type === 'in';

  openSheet(`
    <div class="sheet-head">
      <div><h3>${isIn ? 'ترصيد مبلغ' : 'طلبية جديدة'}</h3>
        <p>${isIn ? 'المبلغ بينضاف للرصيد فوراً' : 'سعر الطلبية بينخصم فوراً، والقطعة الراجعة بتنضاف بعد ' + S.settings().returnDelayDays + ' أيام'}</p></div>
      <button class="icon-btn" data-close aria-label="إغلاق">${icon('x')}</button>
    </div>
    <form id="tf">
      <div class="row-2">
        <div class="field"><label for="tp">الحساب</label>
          <select id="tp" required>${ppl.map(p => `<option value="${p.id}" ${personId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="td">التاريخ</label>
          <input id="td" type="date" value="${pre.date || today()}" max="${today()}"></div>
      </div>

      ${isIn ? `
        <div class="field"><label for="ta">المبلغ المرصود</label>
          <input id="ta" type="number" step="any" min="0" required data-autofocus inputmode="decimal" placeholder="0" value="${pre.amount ?? ''}"></div>
      ` : `
        <div class="row-2">
          <div class="field"><label for="to">سعر الطلبية <span style="color:var(--danger)">(خصم فوري)</span></label>
            <input id="to" type="number" step="any" min="0" required data-autofocus inputmode="decimal" placeholder="0" value="${pre.orderPrice ?? ''}"></div>
          <div class="field"><label for="tr">سعر القطعة الراجعة <span style="color:var(--ok)">(بعد ${S.settings().returnDelayDays} أيام)</span></label>
            <input id="tr" type="number" step="any" min="0" inputmode="decimal" placeholder="0" value="${pre.returnPrice ?? ''}"></div>
        </div>
      `}

      <div class="field"><label for="tn">ملاحظة (اختياري)</label>
        <input id="tn" type="text" placeholder="رقم الطلب، تفاصيل..." value="${esc(pre.note || '')}"></div>

      <div class="preview" id="prev"></div>

      <div class="sheet-actions">
        <button class="btn btn-ghost" type="button" data-close>إلغاء</button>
        <button class="btn btn-primary" type="submit">${isIn ? 'ترصيد' : 'تسجيل الطلبية'}</button>
      </div>
    </form>`);

  const upd = () => {
    const pid = $('#tp').value;
    const st = S.statsOf(pid);
    const s = S.settings();
    let rows = '';
    if(isIn){
      const amt = Number($('#ta').value) || 0;
      const over = amt > st.capLeft;
      rows = `
        <div><span>الرصيد الحالي</span><b class="num">${nf(st.balance)}</b></div>
        <div><span>الرصيد بعد الترصيد</span><b class="num" style="color:var(--ok)">${nf(st.balance + amt)}</b></div>
        <div><span>المتبقي من سقف الشهر</span><b class="num" style="color:${over ? 'var(--danger)' : 'inherit'}">${nf(st.capLeft - amt)}</b></div>
        ${over ? `<div style="color:var(--danger);font-weight:800">⚠ المبلغ بتجاوز سقف الشهر (${nf(st.cap)})</div>` : ''}`;
    }else{
      const o = Number($('#to').value) || 0;
      const r = Number($('#tr').value) || 0;
      const rel = new Date($('#td').value || today());
      rel.setDate(rel.getDate() + Number(s.returnDelayDays || 0));
      const counted = o >= s.counterMin && o <= s.counterMax;
      rows = `
        <div><span>الرصيد الحالي</span><b class="num">${nf(st.balance)}</b></div>
        <div><span>بعد خصم الطلبية</span><b class="num" style="color:var(--danger)">${nf(st.balance - o)}</b></div>
        ${r > 0 ? `<div><span>بعد إضافة القطعة الراجعة (${fdate(rel)})</span><b class="num" style="color:var(--ok)">${nf(st.balance - o + r)}</b></div>` : ''}
        <div><span>عدّاد الطلبيات</span><b>${counted ? `بيصير ${st.orders + 1} ✔` : `بيضل ${st.orders} (المبلغ برّا ${nf(s.counterMin)}–${nf(s.counterMax)})`}</b></div>
        ${st.balance - o < s.readyThreshold ? `<div style="color:var(--ok);font-weight:800">✓ الحساب بيصير جاهز بعد هالحركة</div>` : ''}`;
    }
    $('#prev').innerHTML = rows;
  };
  ['#tp', '#ta', '#to', '#tr', '#td'].forEach(sel => { const el = $(sel); if(el) el.oninput = el.onchange = upd; });
  upd();

  $('#tf').onsubmit = async ev => {
    ev.preventDefault();
    const pid = $('#tp').value;
    const date = $('#td').value;
    const note = $('#tn').value;
    if(isIn){
      const amt = Number($('#ta').value);
      if(!(amt > 0)){ toast('اكتب مبلغ صحيح', 'err'); return; }
      const st = S.statsOf(pid);
      if(amt > st.capLeft){
        if(!await confirmSheet({ title: 'تجاوز السقف', body: `المتبقي من سقف الشهر ${nf(st.capLeft)} فقط. بدك تكمّل؟`, danger: false, okText: 'كمّل' })){
          txForm('in', pid, { amount: amt, date, note }); return;
        }
      }
      await S.addTx({ personId: pid, type: 'in', amount: amt, date, note, by: session.name });
      toast(`تم ترصيد ${money(amt)}`);
    }else{
      const o = Number($('#to').value), r = Number($('#tr').value) || 0;
      if(!(o > 0)){ toast('اكتب سعر الطلبية', 'err'); return; }
      await S.addTx({ personId: pid, type: 'out', orderPrice: o, returnPrice: r, date, note, by: session.name });
      toast('تم تسجيل الطلبية');
    }
    closeSheet();
    render();
  };
}

/* ─────────── تفاصيل الشخص ─────────── */
function personSheet(id){
  const p = S.people().find(x => x.id === id);
  if(!p) return;
  const st = S.statsOf(id);
  const list = S.personTx(id);
  const tone = st.capUsedPct >= 95 ? 'danger' : st.capUsedPct >= 75 ? 'warn' : 'ok';

  openSheet(`
    <div class="sheet-head">
      <div class="pdetail-head" style="margin:0">
        <span class="pav" style="background:${p.color}">${esc(initials(p.name))}</span>
        <div>
          <h3>${esc(p.name)}</h3>
          <p>${p.phone ? esc(p.phone) + ' · ' : ''}${st.ready ? '<span style="color:var(--ok);font-weight:800">جاهز للترصيد</span>' : 'آخر حركة ' + ago(st.lastDate)}</p>
        </div>
      </div>
      <button class="icon-btn" data-close aria-label="إغلاق">${icon('x')}</button>
    </div>

    <div class="mini-stats">
      <div class="mini"><span>الرصيد</span><b class="num">${nf(st.balance)}</b></div>
      <div class="mini"><span>معلّق (راجعة)</span><b class="num" style="color:var(--warn)">${nf(st.pending)}</b></div>
      <div class="mini"><span>طلبيات الشهر</span><b class="num">${st.orders}</b></div>
      <div class="mini"><span>متبقي السقف</span><b class="num">${nf(st.capLeft)}</b></div>
    </div>

    <div style="margin-bottom:1rem">
      <div class="bar-row"><span>سقف ${monthLabel(S.monthKey())}</span><span class="num">${nf(st.monthIn)} / ${nf(st.cap)}</span></div>
      <div class="bar ${tone}"><i style="width:${st.capUsedPct}%"></i></div>
    </div>

    <div class="toolbar" style="margin-bottom:.8rem">
      <button class="btn btn-sm" id="dIn" style="background:var(--ok-soft);color:var(--ok);border-color:transparent">${icon('in')}ترصيد</button>
      <button class="btn btn-sm" id="dOut" style="background:var(--danger-soft);color:var(--danger);border-color:transparent">${icon('up')}طلبية</button>
      <button class="btn btn-sm btn-ghost" id="dEdit">${icon('edit')}تعديل</button>
      <button class="btn btn-sm btn-danger" id="dDel" style="margin-inline-start:auto">${icon('trash')}</button>
    </div>

    <div class="card-head"><h3 style="font-size:.95rem">الحركات (${list.length})</h3></div>
    <div class="tx-list">
      ${list.length ? list.map(t => txRow(t, false)).join('')
                    : `<p class="muted" style="font-size:.88rem">ما في حركات لهذا الحساب بعد.</p>`}
    </div>`);

  $('#dIn').onclick   = () => { closeSheet(); txForm('in', id); };
  $('#dOut').onclick  = () => { closeSheet(); txForm('out', id); };
  $('#dEdit').onclick = () => { closeSheet(); personForm(p); };
  $('#dDel').onclick  = async () => {
    onSheetClose = null;
    if(await confirmSheet({ title: 'حذف الحساب', body: `رح ينمسح ${p.name} مع كل حركاته (${list.length}).`, okText: 'حذف نهائي' })){
      await S.removePerson(id); toast('تم حذف الحساب'); render();
    }
  };
}

/* ─────────── تصدير ─────────── */
function dl(name, content, type){
  const b = new Blob([content], { type });
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1500);
}

function exportCSV(){
  const rows = [['التاريخ','الحساب','النوع','المرصود','سعر الطلبية','القطعة الراجعة','تاريخ إضافة الراجعة','ملاحظة','بواسطة']];
  S.txs().slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).forEach(t => rows.push([
    fdate(t.date), nameOf(t.personId), t.type === 'in' ? 'إيداع' : 'طلبية',
    t.type === 'in' ? t.amount : '', t.type === 'out' ? t.orderPrice : '',
    t.type === 'out' ? t.returnPrice : '', t.releaseDate ? fdate(t.releaseDate) : '',
    t.note || '', t.by || ''
  ]));
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  dl('transactions-' + today() + '.csv', csv, 'text/csv;charset=utf-8');
  toast('تم تصدير الملف');
}

/* ─────────── إقلاع ─────────── */
if(session && USERS.some(u => u.user === session.user)) startApp();
else { $('#login').hidden = false; $('#app').hidden = true; }

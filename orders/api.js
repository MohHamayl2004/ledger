/* ================================================================
   طبقة البيانات للنسخة الويب — بديل window.api تبع برنامج إلكترون
   ----------------------------------------------------------------
   كل مستخدم إله بياناته الخاصة تحت users/{uid}/…
   كل طلبية/زبون مستند لحاله، فالتعديل من التلفون واللابتوب بنفس
   الوقت ما بيمسح تعديلات بعض. Firestore بيحفظ نسخة على الجهاز،
   فالصفحة بتشتغل بدون نت وبتزامن لما يرجع.
   ================================================================ */
import { auth, db, fs, currentUser, membership, logout } from '../js/fb.js';
import { createUnitedApi } from './united.js';

const COLLECTIONS = ['customers', 'orders', 'ledgers', 'expenses', 'shipments'];
const BACKUP_KEEP = 30;

let DB = null;          // نفس الكائن اللي الواجهة بتشتغل عليه
let USER = null;
let MEMBER = null;
const saved = {};       // col → Map(id → JSON) آخر نسخة محفوظة/مستلمة
let savedSettings = '';
let remoteCb = null;

const ok = (data) => ({ ok: true, data });
const fail = (e) => ({ ok: false, error: e && e.message ? e.message : String(e) });

/** JSON بترتيب مفاتيح ثابت — عشان نقارن السجل المحلي بنسخة Firestore */
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

/* Firestore ما بيقبل مصفوفة جوّا مصفوفة (مثل خيارات حقول يونايتد [[قيمة، اسم]]).
   أي سجل فيه هيك بينحفظ كنص JSON بحقل __json، وبيرجع لشكله الطبيعي وقت القراءة. */
function hasNestedArray(v, inArray) {
  if (Array.isArray(v)) return inArray || v.some((x) => hasNestedArray(x, true));
  if (v && typeof v === 'object') return Object.values(v).some((x) => hasNestedArray(x, false));
  return false;
}
const toDoc = (obj) => (hasNestedArray(obj, false) ? { __json: JSON.stringify(obj) } : obj);
const fromDoc = (data) => (data && typeof data.__json === 'string' ? JSON.parse(data.__json) : data);

const userCol = (col) => fs.collection(db, 'users', USER.uid, col);
const userDoc = (...p) => fs.doc(db, 'users', USER.uid, ...p);

/* ------------------------- الشكل الافتراضي ------------------------- */

function defaults() {
  return {
    version: 1,
    customers: [], orders: [], ledgers: [], expenses: [], shipments: [],
    settings: {
      theme: 'dark',
      currency: '₪',
      defaultProfitPercent: 10,
      lowBalanceThreshold: 10,
      deliveryCountsInProfit: false,
      returnPolicy: 'full_price',
      platforms: [
        { name: 'تيمو', percent: 28.5 },
        { name: 'شي ان', percent: 30 },
        { name: 'ايهرب', percent: 20 }
      ],
      expenseTypes: ['بريد', 'أكياس', 'أغراض شخصية'],
      pickupFee: 5,
      shipmentNames: [],
      united: {
        baseUrl: 'https://unitedexpress.ps',
        model: 'rb_delivery.order',
        mapping: {}, fixed: [], fieldsCache: [],
        areaField: '', areaModel: '', areas: [],
        statusField: 'state', statusMap: {},
        autoSync: true, syncMinutes: 20, lastSync: ''
      }
    }
  };
}

/** نفس ترحيل البرنامج القديم، ومنشيل إعدادات ADB والتتبّع اللي ما عاد إلها لزوم */
function migrate(d) {
  const def = defaults();
  d = d && typeof d === 'object' ? d : {};
  const out = Object.assign({}, def, d);
  out.settings = Object.assign({}, def.settings, d.settings || {});
  const u = out.settings.united = Object.assign({}, def.settings.united, (d.settings && d.settings.united) || {});
  delete u.partition;
  if (!u.mapping || typeof u.mapping !== 'object') u.mapping = {};
  if (!Array.isArray(u.fixed)) u.fixed = [];
  if (!Array.isArray(u.fieldsCache)) u.fieldsCache = [];
  if (!Array.isArray(u.areas)) u.areas = [];
  if (!u.statusMap || typeof u.statusMap !== 'object') u.statusMap = {};
  delete out.settings.adb;
  delete out.settings.recipe;
  delete out.settings.tracking;
  delete out.settings.sendMethod;
  if (!Array.isArray(out.settings.shipmentNames)) out.settings.shipmentNames = [];
  if (!Array.isArray(out.settings.platforms) || !out.settings.platforms.length) out.settings.platforms = def.settings.platforms;
  if (!Array.isArray(out.settings.expenseTypes) || !out.settings.expenseTypes.length) out.settings.expenseTypes = def.settings.expenseTypes;
  for (const c of COLLECTIONS) out[c] = Array.isArray(d[c]) ? d[c].filter((x) => x && x.id) : [];
  for (const o of out.orders) {
    if (o.expectedDate === undefined) o.expectedDate = '';
    if (!o.deliveryType) o.deliveryType = 'delivery';
  }
  return out;
}

/* ------------------------- التحميل ------------------------- */

const byDate = (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''));

async function loadAll() {
  const data = defaults();
  for (const c of COLLECTIONS) {
    const snap = await fs.getDocs(userCol(c));
    data[c] = snap.docs.map((d) => Object.assign({}, fromDoc(d.data()), { id: d.id })).sort(byDate);
  }
  const st = await fs.getDoc(userDoc('meta', 'settings'));
  if (st.exists()) data.settings = fromDoc(st.data());
  const out = migrate(data);
  for (const c of COLLECTIONS) saved[c] = new Map(out[c].map((x) => [x.id, stable(x)]));
  savedSettings = stable(out.settings);
  return out;
}

/** تحديثات لحظية من الجهاز الثاني */
function listen() {
  for (const c of COLLECTIONS) {
    fs.onSnapshot(userCol(c), (snap) => {
      if (!DB) return;
      let changed = false;
      for (const ch of snap.docChanges()) {
        const id = ch.doc.id;
        const list = DB[c] = Array.isArray(DB[c]) ? DB[c] : [];
        const i = list.findIndex((x) => x.id === id);
        if (ch.type === 'removed') {
          if (i >= 0) { list.splice(i, 1); changed = true; }
          saved[c].delete(id);
          continue;
        }
        const rec = Object.assign({}, fromDoc(ch.doc.data()), { id });
        const json = stable(rec);
        if (saved[c].get(id) === json) continue; // نفس اللي عنا (غالباً تعديلنا نحنا)
        saved[c].set(id, json);
        if (i >= 0) list[i] = rec; else list.push(rec);
        changed = true;
      }
      if (changed && remoteCb) remoteCb();
    }, (e) => console.error('listen', c, e));
  }
  fs.onSnapshot(userDoc('meta', 'settings'), (snap) => {
    if (!DB || !snap.exists()) return;
    const json = stable(fromDoc(snap.data()));
    if (json === savedSettings) return;
    savedSettings = json;
    DB.settings = migrate({ settings: fromDoc(snap.data()) }).settings;
    if (remoteCb) remoteCb();
  }, (e) => console.error('listen settings', e));
}

/* ------------------------- الحفظ ------------------------- */

/** بيكتب بس السجلات اللي تغيّرت (دفعات ≤ 450 عملية) */
async function saveDiff(data) {
  const ops = [];
  for (const c of COLLECTIONS) {
    const list = Array.isArray(data[c]) ? data[c] : [];
    const seen = new Set();
    for (const rec of list) {
      if (!rec || !rec.id) continue;
      seen.add(rec.id);
      const json = stable(rec);
      if (saved[c].get(rec.id) === json) continue;
      const clean = JSON.parse(JSON.stringify(rec)); // بيشيل undefined اللي Firestore ما بيقبله
      delete clean.id;
      ops.push({ kind: 'set', ref: fs.doc(db, 'users', USER.uid, c, rec.id), data: toDoc(clean), c, id: rec.id, json });
    }
    for (const id of saved[c].keys()) {
      if (!seen.has(id)) ops.push({ kind: 'del', ref: fs.doc(db, 'users', USER.uid, c, id), c, id });
    }
  }
  const sJson = stable(data.settings || {});
  if (sJson !== savedSettings) ops.push({ kind: 'settings', ref: userDoc('meta', 'settings'), data: toDoc(JSON.parse(JSON.stringify(data.settings || {}))), json: sJson });

  for (let i = 0; i < ops.length; i += 450) {
    const part = ops.slice(i, i + 450);
    const batch = fs.writeBatch(db);
    for (const op of part) {
      if (op.kind === 'del') batch.delete(op.ref);
      else batch.set(op.ref, op.data);
    }
    // بدون نت: الوعد ما بيخلص لحد ما يرجع النت، بس التعديل محفوظ على الجهاز.
    // فمنحدّث «آخر نسخة» فوراً وما منستنى السيرفر.
    const commit = batch.commit().catch((e) => {
      console.error(e);
      lastError = e;
      // فشلت الكتابة: منرجّع العلامات عشان الحفظ الجاي يعيد المحاولة
      for (const op of part) {
        if (op.kind === 'del') saved[op.c].set(op.id, '');
        else if (op.kind === 'settings') savedSettings = '';
        else saved[op.c].delete(op.id);
      }
    });
    for (const op of part) {
      if (op.kind === 'del') saved[op.c].delete(op.id);
      else if (op.kind === 'settings') savedSettings = op.json;
      else saved[op.c].set(op.id, op.json);
    }
    if (navigator.onLine) await commit;
  }
  if (lastError) { const e = lastError; lastError = null; throw e; }
}
let lastError = null;

/* ------------------------- نسخ احتياطية ------------------------- */

function snapshotJson(data) {
  const out = { app: 'orders', exportedAt: new Date().toISOString() };
  for (const k of ['version', ...COLLECTIONS, 'settings']) out[k] = data[k];
  return JSON.stringify(out, null, 2);
}

/** نسخة يومية على السيرفر (بيحتفظ بآخر 30 يوم) */
async function autoBackup() {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const ref = userDoc('backups', day);
    const ex = await fs.getDoc(ref);
    if (ex.exists()) return;
    const json = JSON.stringify(Object.fromEntries(['version', ...COLLECTIONS, 'settings'].map((k) => [k, DB[k]])));
    if (json.length > 900000) { console.warn('البيانات أكبر من حد النسخة اليومية — نزّل نسخة يدوياً'); return; }
    await fs.setDoc(ref, { at: new Date().toISOString(), json });
    const all = await fs.getDocs(userCol('backups'));
    const ids = all.docs.map((d) => d.id).sort();
    while (ids.length > BACKUP_KEEP) await fs.deleteDoc(userDoc('backups', ids.shift()));
  } catch (e) { console.warn('autoBackup', e); }
}

function download(name, content, type) {
  const blob = new Blob([content], { type: type || 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept || '';
    i.onchange = () => resolve(i.files && i.files[0] ? i.files[0] : null);
    i.click();
  });
}

/* ------------------------- window.api ------------------------- */

const stamp = () => new Date().toISOString().slice(0, 10);

const dataApi = {
  get: async () => ok(DB),
  save: async (d) => {
    try { if (d && d !== DB) DB = d; await saveDiff(DB); return ok(true); }
    catch (e) { return fail(e); }
  },
  export: async () => {
    const name = `نسخة-الطلبيات-${stamp()}.json`;
    download(name, snapshotJson(DB), 'application/json');
    return ok(name);
  },
  import: async () => {
    try {
      const f = await pickFile('application/json,.json');
      if (!f) return ok(null);
      const parsed = JSON.parse(await f.text());
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.orders)) throw new Error('ملف غير صالح — لازم يكون نسخة من برنامج الطلبيات');
      // نسخة أمان من الموجود قبل ما نستبدله
      if (COLLECTIONS.some((c) => (DB[c] || []).length)) {
        download(`قبل-الاستيراد-${stamp()}.json`, snapshotJson(DB), 'application/json');
      }
      const next = migrate(parsed);
      for (const k of Object.keys(DB)) delete DB[k];
      Object.assign(DB, next);
      await saveDiff(DB);
      return ok(DB);
    } catch (e) { return fail(e); }
  },
  saveText: async ({ defaultName, content }) => {
    download(defaultName || 'file.txt', '﻿' + content, 'text/csv;charset=utf-8');
    return ok(defaultName);
  },
  folder: async () => ok(`Firebase — ${USER && USER.email}`),
  openFolder: async () => ok(true),
  onRemote: (cb) => { remoteCb = cb; }
};

window.api = {
  data: dataApi,
  united: createUnitedApi({
    getDB: () => DB,
    save: () => saveDiff(DB)
  }),
  user: () => ({ email: USER && USER.email, name: MEMBER && MEMBER.name }),
  logout: async () => { await logout(); location.href = '../'; }
};

/* الواجهة (app.js) بتستنى هالوعد قبل ما تبلّش */
window.apiReady = (async () => {
  USER = await currentUser();
  if (!USER) { location.replace('../?next=orders'); return new Promise(() => {}); }
  MEMBER = await membership(USER);
  if (!MEMBER) { await logout(); location.replace('../?next=orders'); return new Promise(() => {}); }
  DB = await loadAll();
  listen();
  setTimeout(autoBackup, 5000);
  return true;
})();
window.dispatchEvent(new Event('api-ready'));

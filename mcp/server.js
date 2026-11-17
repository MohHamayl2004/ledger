#!/usr/bin/env node
/* ================================================================
   MCP — إدارة الطلبيات (لقطة)
   ----------------------------------------------------------------
   بيخلّي Claude يضيف طلبيات ويبعتها ليونايتد، بنفس منطق الموقع
   بالضبط: الحسابات من orders/calc.js وربط يونايتد من orders/united.js.

   القاعدة الأهم: ما في أي قيمة بتنخترع.
   • كل الحقول المهمة إجبارية — إذا ناقص إشي الأداة بترفض وبتقول شو ناقص.
   • البرنامج لازم يكون من قائمة البرامج بالإعدادات.
   • المنطقة لازم تطابق قائمة مناطق يونايتد حرفياً (وإلا بترجع اقتراحات).
   • المربح اختيار إجباري بكل طلبية: platform / none / custom.
   • كل عملية كتابة إلها dry_run بيعرض شو رح يصير بدون ما يغيّر إشي.

   الدخول: نفس حساب الموقع (Firebase) — فبيشوف بس بياناتك وقواعد
   الحماية بتنطبق عليه زي الموقع.

   المتغيرات المطلوبة (بتنحط بإعدادات MCP، مش بالكود):
     FIREBASE_EMAIL, FIREBASE_PASSWORD
     UNITED_LOGIN, UNITED_PASSWORD        (بس للإرسال ليونايتد)
   ================================================================ */
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, connectAuthEmulator } from 'firebase/auth';
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, collection
} from 'firebase/firestore';

import { FIREBASE_CONFIG } from '../js/config.js';
import { United, UnitedError } from '../orders/united.js';
import * as L from '../js/store.js'; // منطق دفتر الحسابات نفسه (statsOf، buildTx …)

const require = createRequire(import.meta.url);
const C = require('../orders/calc.js');

const log = (...a) => console.error('[laqta-mcp]', ...a); // stdout محجوز لبروتوكول MCP

/* ------------------------------------------------------------------ */
/*  Firebase                                                           */
/* ------------------------------------------------------------------ */

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
if (process.env.FIREBASE_EMULATOR === '1') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8081);
}

let uid = null;
async function ensureLogin() {
  if (uid) return uid;
  const email = process.env.FIREBASE_EMAIL;
  const password = process.env.FIREBASE_PASSWORD;
  if (!email || !password) throw new Error('ناقص FIREBASE_EMAIL أو FIREBASE_PASSWORD بإعدادات الـ MCP');
  const cred = await signInWithEmailAndPassword(auth, email, password);
  uid = cred.user.uid;
  const m = await getDoc(doc(db, 'members', uid));
  if (!m.exists()) throw new Error('هذا الحساب مش عضو بالموقع (ما في members/' + uid + ')');
  return uid;
}

/* نفس ترميز api.js للسجلات اللي فيها مصفوفات متداخلة */
function hasNestedArray(v, inArray) {
  if (Array.isArray(v)) return inArray || v.some((x) => hasNestedArray(x, true));
  if (v && typeof v === 'object') return Object.values(v).some((x) => hasNestedArray(x, false));
  return false;
}
const toDoc = (obj) => (hasNestedArray(obj, false) ? { __json: JSON.stringify(obj) } : obj);
const fromDoc = (d) => (d && typeof d.__json === 'string' ? JSON.parse(d.__json) : d);

async function loadSettings() {
  await ensureLogin();
  const s = await getDoc(doc(db, 'users', uid, 'meta', 'settings'));
  return s.exists() ? fromDoc(s.data()) : {};
}
async function loadCol(name) {
  await ensureLogin();
  const snap = await getDocs(collection(db, 'users', uid, name));
  return snap.docs.map((d) => Object.assign({}, fromDoc(d.data()), { id: d.id }));
}
async function saveRec(col, rec) {
  const clean = JSON.parse(JSON.stringify(rec));
  delete clean.id;
  await setDoc(doc(db, 'users', uid, col, rec.id), toDoc(clean));
}

/* ------------------------------------------------------------------ */
/*  أدوات مساعدة (نفس سلوك الموقع)                                     */
/* ------------------------------------------------------------------ */

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const normAr = (x) => String(x || '').trim().toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ');

const pickupFeeOf = (s) => C.num(s.pickupFee === undefined ? 5 : s.pickupFee);

function orderView(o, s) {
  const profit = C.orderProfit(o, s);
  return {
    id: o.id,
    date: o.date,
    customerName: o.customerName,
    phone: o.phone, phone2: o.phone2 || '', waPhone: o.waPhone || '',
    address1: o.address1, address1Id: o.address1Id || null, address2: o.address2 || '',
    platform: o.platform || '',
    deliveryType: o.deliveryType || 'delivery',
    pieces: o.pieces,
    price: C.num(o.price),
    deliveryPrice: C.num(o.deliveryPrice),
    discountType: o.discountType || '',
    discount: C.discountOf(o),
    customerPays: C.customerPays(o),
    profitPercent: C.num(o.profitPercent),
    status: o.status,
    profit: o.status === 'pending' ? null : profit,
    expectedProfit: C.expectedProfit(o, s),
    notes: o.notes || '',
    unitedId: o.unitedId || null,
    unitedRef: o.unitedRef || ''
  };
}

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (msg, extra) => ({ isError: true, content: [{ type: 'text', text: JSON.stringify(Object.assign({ error: msg }, extra || {}), null, 2) }] });

/* ------------------------------------------------------------------ */
/*  يونايتد — نفس United تبع الموقع، بس الطلب مباشر من Node            */
/*  (ما في CORS هون، فما بنحتاج الوسيط)                                */
/* ------------------------------------------------------------------ */

class NodeUnited extends United {
  constructor(getConfig) {
    super(getConfig);
    this.sid = '';
  }

  async _fetch(path, body) {
    const res = await fetch(this.baseUrl + path, {
      method: 'POST',
      redirect: 'manual',
      headers: Object.assign({ 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        this.sid ? { Cookie: 'session_id=' + this.sid } : {}),
      body
    });
    for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const m = /(?:^|\s)session_id=([^;]*)/.exec(c);
      if (m && m[1]) this.sid = m[1];
    }
    return { status: res.status, text: await res.text() };
  }

  async login() {
    const login = process.env.UNITED_LOGIN;
    const password = process.env.UNITED_PASSWORD;
    if (!login || !password) throw new UnitedError('ناقص UNITED_LOGIN أو UNITED_PASSWORD بإعدادات الـ MCP');
    const list = await this._fetch('/web/database/list', '{"jsonrpc":"2.0","method":"call","params":{}}');
    let dbName = '';
    try { const r = JSON.parse(list.text).result; if (Array.isArray(r) && r.length === 1) dbName = r[0]; } catch (_) {}
    if (!dbName) throw new UnitedError('ما قدرت أعرف اسم قاعدة بيانات يونايتد');
    this.sid = '';
    const r = await this._fetch('/web/session/authenticate', JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db: dbName, login, password } }));
    let j = null;
    try { j = JSON.parse(r.text); } catch (_) {}
    if (!(j && j.result && j.result.uid)) throw new UnitedError('يونايتد رفض الدخول — تأكد من UNITED_LOGIN و UNITED_PASSWORD');
    return j.result;
  }

  /** نفس rpc تبع الموقع، مع دخول تلقائي مرة وحدة إذا الجلسة منتهية */
  async rpc(path, params, timeout, retried) {
    if (!this.sid) await this.login();
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'call', params: params || {}, id: Math.floor(Math.random() * 1e9) });
    const res = await this._fetch(path, body);
    let json;
    try { json = JSON.parse(res.text); } catch (_) { throw new UnitedError('ردّ غير متوقّع من يونايتد (HTTP ' + res.status + ')'); }
    if (json.error) {
      const d = json.error.data || {};
      const msg = d.message || json.error.message || 'خطأ غير معروف';
      if (!retried && /session expired|SessionExpired/i.test(d.name + ' ' + msg)) {
        this.sid = '';
        return this.rpc(path, params, timeout, true);
      }
      throw new UnitedError(String(msg).split('\n')[0], d);
    }
    return json.result;
  }

  async sessionInfo() {
    const info = await this.rpc('/web/session/get_session_info', {});
    if (!info || !info.uid) throw new UnitedError('غير مسجّل دخول');
    return { uid: info.uid, name: info.name || info.username || '', username: info.username || '' };
  }
}

let united = null;
function getUnited(settings) {
  const cfg = () => settings.united || {};
  if (!united) united = new NodeUnited(cfg);
  else united.getConfig = cfg;
  return united;
}

/** نفس المتغيرات اللي الموقع بيبعتها (sendViaWeb) */
function unitedVars(o) {
  return {
    name: o.customerName || '', phone: o.phone || '',
    address1: o.address1 || '', address1Id: o.address1Id || null,
    address2: o.address2 || '',
    phone2: o.phone2 || '',
    pieces: o.pieces || '', price: o.price || '', deliveryPrice: o.deliveryPrice || '',
    total: o.price !== undefined && o.price !== '' ? C.customerPays(o) : '',
    notes: o.notes || ''
  };
}

/* ------------------------------------------------------------------ */
/*  الخادم والأدوات                                                    */
/* ------------------------------------------------------------------ */

const server = new McpServer({ name: 'laqta-orders', version: '1.0.0' }, {
  instructions: [
    'أدوات لإدارة طلبيات متجر «لقطة» (نفس بيانات موقع razanstore.site).',
    'قاعدة صارمة: لا تخترع ولا تخمّن أي قيمة. كل رقم أو اسم أو منطقة أو برنامج أو سعر لازم يكون صادر من المستخدم حرفياً أو من نتيجة أداة.',
    'إذا ناقص أي معلومة، اسأل المستخدم — لا تعبّي من عندك.',
    'المربح (profit_mode) قرار المستخدم بكل طلبية: لا تختار platform أو custom أو none إلا إذا المستخدم حكالك.',
    'قبل أي إضافة أو إرسال: نفّذ بـ dry_run=true، اعرض النتيجة على المستخدم، ونفّذ الحقيقي بس بعد موافقته الصريحة.',
    'المنطقة (address1) لازم تيجي من search_areas. إذا ما في تطابق حرفي، اعرض الاقتراحات واسأل.',
    'دفتر الحسابات (list_ledger_accounts / add_ledger_transaction) مشترك بين المستخدم ورزان — أي حركة بتبيّن عند الثنين، فتأكد من الحساب والمبلغ قبل التنفيذ.'
  ].join('\n')
});

/* ---------- get_settings ---------- */
server.registerTool('get_settings', {
  title: 'إعدادات الطلبيات',
  description: 'بيرجّع البرامج ونسب ربحها، نسبة الربح الافتراضية، سياسة الإرجاع، تكلفة نقطة الاستلام، وحالة ربط يونايتد. قراءة فقط.',
  inputSchema: {},
  annotations: { readOnlyHint: true }
}, async () => {
  try {
    const s = await loadSettings();
    const u = s.united || {};
    return text({
      platforms: s.platforms || [],
      defaultProfitPercent: C.num(s.defaultProfitPercent),
      returnPolicy: s.returnPolicy || 'full_price',
      deliveryCountsInProfit: !!s.deliveryCountsInProfit,
      pickupFee: pickupFeeOf(s),
      united: {
        baseUrl: u.baseUrl || '',
        mappedFields: Object.keys(u.mapping || {}).length,
        mapping: u.mapping || {},
        areasLoaded: (u.areas || []).length
      }
    });
  } catch (e) { return fail(e.message); }
});

/* ---------- search_customers ---------- */
server.registerTool('search_customers', {
  title: 'بحث بالزباين',
  description: 'بيدوّر بالزباين المحفوظين بالاسم أو بأي رقم (التوصيل، الثاني، الواتساب). قراءة فقط.',
  inputSchema: { query: z.string().min(1).describe('جزء من الاسم أو الرقم'), limit: z.number().int().min(1).max(50).optional() },
  annotations: { readOnlyHint: true }
}, async ({ query, limit }) => {
  try {
    const list = await loadCol('customers');
    const q = normAr(query);
    const qp = C.normalizePhone(query);
    const hits = list.filter((c) =>
      normAr(c.name).includes(q) ||
      (qp && qp.length >= 3 && [c.phone, c.phone2, c.waPhone].some((p) => p && C.normalizePhone(p).includes(qp))));
    return text(hits.slice(0, limit || 15).map((c) => ({
      id: c.id, name: c.name, phone: c.phone, phone2: c.phone2 || '', waPhone: c.waPhone || '',
      address1: c.address1 || '', areaId: c.areaId || null, address2: c.address2 || ''
    })));
  } catch (e) { return fail(e.message); }
});

/* ---------- search_areas ---------- */
server.registerTool('search_areas', {
  title: 'بحث بمناطق يونايتد',
  description: 'بيدوّر بقائمة مناطق يونايتد المحفوظة (نفس القائمة بالموقع). استعمل الاسم بالضبط زي ما بيرجع هون بـ add_order. قراءة فقط.',
  inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional() },
  annotations: { readOnlyHint: true }
}, async ({ query, limit }) => {
  try {
    const s = await loadSettings();
    const areas = (s.united && s.united.areas) || [];
    if (!areas.length) return text({ note: 'ما في قائمة مناطق محمّلة. حمّلها من الموقع: ربط يونايتد ← مناطق يونايتد ← تحميل القائمة.', results: [] });
    const q = normAr(query);
    const exact = areas.filter((a) => normAr(a.name) === q);
    const partial = areas.filter((a) => normAr(a.name) !== q && normAr(a.name).includes(q));
    return text({ exact, partial: partial.slice(0, limit || 15) });
  } catch (e) { return fail(e.message); }
});

/* ---------- add_order ---------- */
server.registerTool('add_order', {
  title: 'إضافة طلبية',
  description: [
    'بيضيف طلبية للموقع (بتبيّن فوراً على الموقع والتلفون). نفس منطق نافذة «إضافة طلبية».',
    'كل القيم لازم تيجي من المستخدم حرفياً — ممنوع التخمين.',
    'profit_mode: "platform" = نسبة البرنامج من الإعدادات، "none" = بدون ربح (0%)، "custom" = النسبة بـ profit_percent. قرار المستخدم فقط.',
    'دايماً نفّذ أول بـ dry_run=true واعرض النتيجة، وبعد موافقة المستخدم نفّذ بـ dry_run=false.'
  ].join('\n'),
  inputSchema: {
    dry_run: z.boolean().describe('true = معاينة بدون حفظ'),
    customer_name: z.string().min(1),
    phone: z.string().min(1).describe('رقم التوصيل زي ما المستخدم كتبه'),
    phone2: z.string().optional().describe('رقم توصيل ثاني (اختياري — بس إذا المستخدم عطاه)'),
    whatsapp_phone: z.string().optional().describe('رقم واتساب إذا غير رقم التوصيل (اختياري)'),
    address1: z.string().min(1).describe('المنطقة — لازم تطابق نتيجة search_areas حرفياً'),
    address2: z.string().optional().describe('العنوان التفصيلي'),
    platform: z.string().optional().describe('اسم البرنامج بالضبط من get_settings، أو اتركه إذا المستخدم ما حدد'),
    delivery_type: z.enum(['delivery', 'pickup']).describe('توصيل أو نقطة استلام'),
    pieces: z.number().int().min(1),
    price: z.number().min(0).describe('سعر الطلبية بدون التوصيل'),
    delivery_price: z.number().min(0).optional().describe('سعر التوصيل — إجباري للتوصيل، وبنقطة الاستلام بينحسب من الإعدادات'),
    profit_mode: z.enum(['platform', 'none', 'custom']),
    profit_percent: z.number().min(0).max(100).optional().describe('بس مع profit_mode=custom'),
    discount_type: z.enum(['none', 'free_delivery', 'amount']).optional(),
    discount_amount: z.number().min(0).optional().describe('بس مع discount_type=amount'),
    status: z.enum(['pending', 'delivered', 'returned']).optional().describe('افتراضي pending زي الموقع'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD — افتراضي اليوم زي الموقع'),
    expected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().optional()
  }
}, async (a) => {
  try {
    const s = await loadSettings();
    const problems = [];
    const pickup = a.delivery_type === 'pickup';

    // البرنامج
    const platforms = s.platforms || [];
    let plat = null;
    if (a.platform) {
      plat = platforms.find((p) => p.name === a.platform.trim());
      if (!plat) problems.push(`البرنامج «${a.platform}» مش موجود. الموجود: ${platforms.map((p) => p.name).join('، ') || '—'}`);
    }

    // المربح
    let pct = null;
    if (a.profit_mode === 'platform') {
      if (!a.platform) problems.push('profit_mode=platform بدها platform');
      else if (plat) pct = C.num(plat.percent);
    } else if (a.profit_mode === 'none') {
      pct = 0;
    } else if (a.profit_mode === 'custom') {
      if (a.profit_percent === undefined) problems.push('profit_mode=custom بدها profit_percent');
      else pct = a.profit_percent;
    }
    if (a.profit_mode !== 'custom' && a.profit_percent !== undefined) problems.push('profit_percent بينحط بس مع profit_mode=custom');

    // التوصيل
    let deliveryPrice;
    if (pickup) {
      deliveryPrice = pickupFeeOf(s);
    } else if (a.delivery_price === undefined) {
      problems.push('delivery_price إجباري للتوصيل — اسأل المستخدم');
    } else {
      deliveryPrice = a.delivery_price;
    }

    // الخصم
    const dType = a.discount_type && a.discount_type !== 'none' ? a.discount_type : '';
    if (dType === 'amount' && a.discount_amount === undefined) problems.push('discount_type=amount بدها discount_amount');
    if (dType !== 'amount' && a.discount_amount !== undefined) problems.push('discount_amount بينحط بس مع discount_type=amount');

    // الأرقام
    const p1 = C.localPhone(a.phone);
    if (p1.local.replace(/\D/g, '').length < 9) problems.push(`رقم التوصيل «${a.phone}» مش واضح`);
    const p2 = a.phone2 ? C.localPhone(a.phone2) : { local: '', prefix: '' };
    const pw = a.whatsapp_phone ? C.localPhone(a.whatsapp_phone) : { local: '', prefix: '' };

    // المنطقة: لازم تطابق قائمة يونايتد حرفياً (إذا القائمة محمّلة)
    const areas = (s.united && s.united.areas) || [];
    let area = null;
    if (areas.length) {
      area = areas.find((x) => normAr(x.name) === normAr(a.address1));
      if (!area) {
        const q = normAr(a.address1);
        const sugg = areas.filter((x) => normAr(x.name).includes(q) || q.includes(normAr(x.name))).slice(0, 8).map((x) => x.name);
        problems.push(`المنطقة «${a.address1}» مش موجودة بقائمة يونايتد بالضبط.${sugg.length ? ' اقتراحات: ' + sugg.join(' | ') : ' جرّب search_areas.'}`);
      }
    }

    if (problems.length) return fail('ما انضافت الطلبية — في معلومات ناقصة أو غلط. اسأل المستخدم:', { problems });

    const now = new Date().toISOString();
    const order = {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      customerName: a.customer_name.trim(),
      phone: p1.local,
      phone2: p2.local,
      waPhone: pw.local,
      address1: area ? area.name : a.address1.trim(),
      address1Id: area ? area.id : null,
      address2: (a.address2 || '').trim(),
      platform: plat ? plat.name : '',
      deliveryType: pickup ? 'pickup' : 'delivery',
      pieces: a.pieces,
      price: a.price,
      deliveryPrice,
      profitPercent: pct,
      discountType: dType,
      discount: dType === 'amount' ? a.discount_amount : 0,
      date: a.date || today(),
      expectedDate: a.expected_date || '',
      status: a.status || 'pending',
      notes: (a.notes || '').trim(),
      source: 'claude-mcp'
    };

    // الزبون: نفس upsertCustomer تبع الموقع (المطابقة برقم التوصيل)
    const customers = await loadCol('customers');
    const n = C.normalizePhone(order.phone);
    let cust = customers.find((c) => C.normalizePhone(c.phone) === n) || null;
    const waPrefix = pw.local ? pw.prefix : p1.prefix;
    const custIsNew = !cust;
    if (cust) {
      cust.name = order.customerName || cust.name;
      if (order.address1) cust.address1 = order.address1;
      if (order.address2) cust.address2 = order.address2;
      if (order.address1Id) cust.areaId = order.address1Id;
      if (a.phone2 !== undefined) cust.phone2 = order.phone2;
      if (a.whatsapp_phone !== undefined) cust.waPhone = order.waPhone;
      if (waPrefix) cust.waPrefix = waPrefix;
      cust.updatedAt = now;
    } else {
      cust = {
        id: newId(), notes: '', createdAt: now,
        name: order.customerName, phone: order.phone, phone2: order.phone2, waPhone: order.waPhone,
        address1: order.address1, address2: order.address2, areaId: order.address1Id || null
      };
      if (waPrefix) cust.waPrefix = waPrefix;
    }
    order.customerId = cust.id;

    const preview = {
      dry_run: a.dry_run,
      order: orderView(order, s),
      customer: { id: cust.id, isNew: custIsNew, name: cust.name },
      profitSource: a.profit_mode === 'platform' ? `نسبة ${order.platform} من الإعدادات (${pct}%)` : a.profit_mode === 'none' ? 'بدون ربح (0%)' : `نسبة محددة (${pct}%)`
    };
    if (a.dry_run) return text(Object.assign({ note: 'معاينة فقط — ما انحفظ إشي. اعرضها على المستخدم واطلب موافقته.' }, preview));

    await saveRec('customers', cust);
    await saveRec('orders', order);
    return text(Object.assign({ note: 'انحفظت الطلبية وبتبيّن على الموقع.' }, preview));
  } catch (e) { return fail(e.message); }
});

/* ---------- list_orders ---------- */
server.registerTool('list_orders', {
  title: 'عرض الطلبيات',
  description: 'بيعرض الطلبيات (الأحدث أول) مع فلاتر اختيارية. قراءة فقط.',
  inputSchema: {
    status: z.enum(['pending', 'delivered', 'returned']).optional(),
    platform: z.string().optional(),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('YYYY-MM'),
    not_sent_to_united: z.boolean().optional(),
    query: z.string().optional().describe('اسم أو رقم'),
    limit: z.number().int().min(1).max(100).optional()
  },
  annotations: { readOnlyHint: true }
}, async (f) => {
  try {
    const s = await loadSettings();
    const q = f.query ? normAr(f.query) : '';
    const qp = f.query ? C.normalizePhone(f.query) : '';
    const list = (await loadCol('orders'))
      .filter((o) => !f.status || o.status === f.status)
      .filter((o) => !f.platform || (o.platform || '') === f.platform)
      .filter((o) => !f.month || String(o.date || '').startsWith(f.month))
      .filter((o) => !f.not_sent_to_united || (!o.unitedId && o.deliveryType !== 'pickup'))
      .filter((o) => !q || normAr(o.customerName).includes(q) ||
        (qp && qp.length >= 3 && [o.phone, o.phone2, o.waPhone].some((p) => p && C.normalizePhone(p).includes(qp))))
      .sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')) || String(y.createdAt || '').localeCompare(String(x.createdAt || '')));
    return text({ total: list.length, orders: list.slice(0, f.limit || 20).map((o) => orderView(o, s)) });
  } catch (e) { return fail(e.message); }
});

/* ---------- get_order ---------- */
server.registerTool('get_order', {
  title: 'تفاصيل طلبية',
  description: 'تفاصيل طلبية وحدة برقمها (id). قراءة فقط.',
  inputSchema: { order_id: z.string().min(1) },
  annotations: { readOnlyHint: true }
}, async ({ order_id }) => {
  try {
    const s = await loadSettings();
    const o = (await loadCol('orders')).find((x) => x.id === order_id);
    if (!o) return fail('ما في طلبية بهالرقم');
    return text(orderView(o, s));
  } catch (e) { return fail(e.message); }
});

/* ---------- united_status ---------- */
server.registerTool('united_status', {
  title: 'حالة يونايتد',
  description: 'بيتأكد إنه الدخول ليونايتد شغّال. ما بيبعت ولا إشي.',
  inputSchema: {},
  annotations: { readOnlyHint: true }
}, async () => {
  try {
    const s = await loadSettings();
    const info = await getUnited(s).sessionInfo();
    return text({ loggedIn: true, user: info.name || info.username });
  } catch (e) { return fail(e.message); }
});

/* ---------- send_order_to_united ---------- */
server.registerTool('send_order_to_united', {
  title: 'إرسال طلبية ليونايتد',
  description: [
    'بيبعت طلبية محفوظة ليونايتد بنفس ربط الحقول تبع الموقع، وبيحفظ رقمها عند يونايتد على الطلبية.',
    'dry_run=true بيعرض القيم بالضبط اللي رح تنبعث بدون ما يبعت. نفّذ الحقيقي بس بعد موافقة المستخدم.',
    'بيرفض نقطة الاستلام، وبيرفض الطلبية المرسلة قبل إلا إذا resend=true (بينشئ طلبية جديدة عند يونايتد).'
  ].join('\n'),
  inputSchema: {
    order_id: z.string().min(1),
    dry_run: z.boolean(),
    resend: z.boolean().optional()
  }
}, async ({ order_id, dry_run, resend }) => {
  try {
    const s = await loadSettings();
    const u = s.united || {};
    const orders = await loadCol('orders');
    const o = orders.find((x) => x.id === order_id);
    if (!o) return fail('ما في طلبية بهالرقم');
    if (o.deliveryType === 'pickup') return fail('هاي طلبية نقطة استلام — ما بتنبعث ليونايتد (نفس الموقع)');
    if (o.unitedId && !resend) return fail(`الطلبية مرسلة أصلاً ليونايتد برقم ${o.unitedRef || o.unitedId}. الإرسال مرة ثانية بينشئ طلبية جديدة عندهم — بس إذا المستخدم طلب صراحة (resend=true).`);
    if (!Object.keys(u.mapping || {}).length) return fail('ما في ربط لحقول يونايتد بعد. من الموقع: ربط يونايتد ← اكتشاف الحقول.');

    const un = getUnited(s);
    const vars = unitedVars(o);
    const vals = await un.buildValues(u.mapping, u.fixed, vars, u.fieldsCache || []);
    const labels = Object.fromEntries((u.fieldsCache || []).map((f) => [f.name, f.label]));
    const shown = Object.entries(vals).map(([k, v]) => ({ field: k, label: labels[k] || k, value: v }));

    if (dry_run) {
      return text({ note: 'معاينة فقط — ما انبعث إشي. اعرضها على المستخدم واطلب موافقته.', order: orderView(o, s), willSend: shown });
    }

    const res = await un.createOrder(vals);
    o.unitedId = res.id;
    o.unitedRef = res.ref || '';
    o.unitedUrl = res.url || '';
    o.sentAt = new Date().toISOString();
    o.updatedAt = o.sentAt;
    await saveRec('orders', o);
    return text({ note: 'انبعتت ليونايتد وانحفظ رقمها على الطلبية.', unitedId: res.id, unitedRef: res.ref, url: res.url, sent: shown });
  } catch (e) { return fail(e.message); }
});

/* ---------- monthly_profit_summary ---------- */
const NO_PLATFORM = '__none';
const platKey = (o) => (o.platform || '').trim() || NO_PLATFORM;

server.registerTool('monthly_profit_summary', {
  title: 'ملخص الأرباح الشهري',
  description: [
    'نفس صفحة «التقارير والأرباح» بالموقع: ربح الطلبيات، الرسوم والمصاريف، والربح النهائي لكل شهر، مع توزيع حسب البرنامج.',
    'لما تحدد platform: الأرقام لطلبيات هذا البرنامج بس، والرسوم ما بتنحسب (زي الموقع). قراءة فقط.'
  ].join('\n'),
  inputSchema: {
    from_month: z.string().regex(/^\d{4}-\d{2}$/).describe('YYYY-MM'),
    to_month: z.string().regex(/^\d{4}-\d{2}$/).describe('YYYY-MM'),
    platform: z.string().optional().describe('اسم البرنامج بالضبط، أو "بدون برنامج"')
  },
  annotations: { readOnlyHint: true }
}, async ({ from_month, to_month, platform }) => {
  try {
    if (from_month > to_month) return fail('from_month لازم يكون قبل أو نفس to_month');
    const s = await loadSettings();
    const orders = await loadCol('orders');
    const expenses = await loadCol('expenses');
    const all = orders.filter((o) => C.inRange(o, from_month, to_month));
    let key = '';
    if (platform) {
      key = platform.trim() === 'بدون برنامج' ? NO_PLATFORM : platform.trim();
      const known = (s.platforms || []).map((p) => p.name).concat(orders.map((o) => o.platform || '').filter(Boolean));
      if (key !== NO_PLATFORM && !known.includes(key)) return fail(`البرنامج «${platform}» مش موجود. الموجود: ${[...new Set(known)].join('، ')}`);
    }
    const list = key ? all.filter((o) => platKey(o) === key) : all;
    const sum = C.summarize(list, s);
    const months = C.byMonth(list, s);
    const expList = key ? [] : C.expensesInRange(expenses, from_month, to_month);
    const expSum = C.summarizeExpenses(expList);
    const expByMonth = C.expensesByMonth(expList);
    const net = C.netAfterExpenses(sum, expSum);

    const keys = [...new Set(all.map(platKey))];
    const byPlatform = keys.map((k) => {
      const r = C.summarize(all.filter((o) => platKey(o) === k), s);
      return { platform: k === NO_PLATFORM ? 'بدون برنامج' : k, orders: r.count, delivered: r.delivered, returned: r.returned, pending: r.pending, sales: r.sales, profit: r.netProfit, expectedPending: r.expectedPending };
    }).sort((a, b) => b.profit - a.profit);

    return text({
      range: { from: from_month, to: to_month },
      platform: platform || 'كل البرامج',
      note: key ? 'الرسوم والمصاريف مش محسوبة لأنها مش تابعة لبرنامج معيّن (زي الموقع).' : undefined,
      totals: {
        finalProfit: net,
        ordersProfit: sum.netProfit,
        expenses: expSum.total,
        sales: sum.sales,
        orders: sum.count, delivered: sum.delivered, returned: sum.returned, pending: sum.pending,
        discounts: sum.discounts, expectedFromPending: sum.expectedPending
      },
      months: months.map((m) => {
        const ex = (expByMonth[m.month] || {}).total || 0;
        return { month: m.month, orders: m.count, delivered: m.delivered, returned: m.returned, sales: m.sales, ordersProfit: m.netProfit, expenses: ex, finalProfit: C.round2(m.netProfit - ex) };
      }),
      byPlatform,
      expensesByType: expSum.byType
    });
  } catch (e) { return fail(e.message); }
});

/* ---------- دفتر الحسابات المشترك (people / tx / meta) ---------- */

async function loadLedger() {
  await ensureLogin();
  const [p, t, st] = await Promise.all([
    getDocs(collection(db, 'people')),
    getDocs(collection(db, 'tx')),
    getDoc(doc(db, 'meta', 'settings'))
  ]);
  L.useSnapshot({
    people: p.docs.map((d) => Object.assign({}, d.data(), { id: d.id })),
    tx: t.docs.map((d) => Object.assign({}, d.data(), { id: d.id })),
    settings: st.exists() ? st.data() : {}
  });
}

function accountView(p) {
  const st = L.statsOf(p.id);
  return {
    id: p.id, name: p.name,
    balance: st.balance,
    pendingReturns: st.pending, pendingCount: st.pendingCount,
    monthIn: st.monthIn, monthCap: st.cap, capLeft: st.capLeft,
    ordersCounterThisMonth: st.orders,
    ready: st.ready
  };
}

/** الحساب لازم يطابق بالاسم الكامل أو الرقم التعريفي — وإلا اقتراحات */
function findAccount(q) {
  const people = L.people();
  const byId = people.find((p) => p.id === q);
  if (byId) return { p: byId };
  const exact = people.filter((p) => normAr(p.name) === normAr(q));
  if (exact.length === 1) return { p: exact[0] };
  const sugg = (exact.length ? exact : people.filter((p) => normAr(p.name).includes(normAr(q)) || normAr(q).includes(normAr(p.name))))
    .map((p) => ({ id: p.id, name: p.name }));
  return { p: null, sugg, ambiguous: exact.length > 1 };
}

server.registerTool('list_ledger_accounts', {
  title: 'حسابات الدفتر',
  description: 'الحسابات بدفتر الحسابات المشترك (اللي إنت ورزان بتشوفوه) مع الرصيد، القطع الراجعة المعلّقة، سقف الشهر والمتبقي منه، وعدّاد الطلبيات. نفس حسابات الموقع. قراءة فقط.',
  inputSchema: { query: z.string().optional().describe('جزء من الاسم (اختياري)') },
  annotations: { readOnlyHint: true }
}, async ({ query }) => {
  try {
    await loadLedger();
    const q = query ? normAr(query) : '';
    const list = L.people().filter((p) => !q || normAr(p.name).includes(q)).map(accountView);
    const g = L.globalStats();
    return text({ total: g, accounts: list });
  } catch (e) { return fail(e.message); }
});

server.registerTool('add_ledger_transaction', {
  title: 'حركة على الدفتر',
  description: [
    'بيضيف حركة على حساب بدفتر الحسابات المشترك (بتبيّن عندك وعند رزان فوراً). نفس نافذة «حركة جديدة» بالموقع.',
    'type="deposit": ترصيد مبلغ (amount) — بينضاف للرصيد فوراً وبينحسب من سقف الشهر.',
    'type="order": طلبية — order_price بينخصم فوراً، و return_price (اختياري) بيرجع بعد أيام الدوام (بدون جمعة وسبت).',
    'الحساب لازم يطابق الاسم الكامل أو الـ id من list_ledger_accounts. كل الأرقام من المستخدم حرفياً.',
    'دايماً dry_run=true أول واعرض النتيجة، وبعد موافقة المستخدم dry_run=false.'
  ].join('\n'),
  inputSchema: {
    dry_run: z.boolean(),
    account: z.string().min(1).describe('اسم الحساب الكامل أو id'),
    type: z.enum(['deposit', 'order']),
    amount: z.number().positive().optional().describe('بس مع deposit'),
    order_price: z.number().positive().optional().describe('بس مع order'),
    return_price: z.number().min(0).optional().describe('سعر القطعة الراجعة — بس مع order (اختياري)'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD — افتراضي اليوم زي الموقع'),
    note: z.string().optional()
  }
}, async (a) => {
  try {
    await loadLedger();
    const problems = [];
    if (a.type === 'deposit') {
      if (a.amount === undefined) problems.push('deposit بده amount');
      if (a.order_price !== undefined || a.return_price !== undefined) problems.push('order_price و return_price بس مع type=order');
    } else {
      if (a.order_price === undefined) problems.push('order بده order_price');
      if (a.amount !== undefined) problems.push('amount بس مع type=deposit');
    }
    const found = findAccount(a.account);
    if (!found.p) {
      problems.push(found.ambiguous
        ? `في أكثر من حساب باسم «${a.account}» — حدّد بالـ id`
        : `ما في حساب «${a.account}» بالضبط.${found.sugg.length ? '' : ' (ولا اقتراحات)'}`);
    }
    if (problems.length) return fail('ما انضافت الحركة — اسأل المستخدم:', { problems, suggestions: found.sugg || [] });

    const member = await getDoc(doc(db, 'members', uid));
    const by = (member.exists() && member.data().name) || '';
    const p = found.p;
    const before = L.statsOf(p.id);
    const s = L.settings();
    const t = L.buildTx({
      personId: p.id,
      type: a.type === 'deposit' ? 'in' : 'out',
      amount: a.amount, orderPrice: a.order_price, returnPrice: a.return_price,
      date: a.date, note: a.note, by
    }, s);

    const warnings = [];
    if (t.type === 'in' && t.amount > before.capLeft) warnings.push(`المبلغ بتجاوز المتبقي من سقف الشهر (${before.capLeft} من ${before.cap})`);
    const counted = t.type === 'out' && t.orderPrice >= s.counterMin && t.orderPrice <= s.counterMax;
    const after = t.type === 'in' ? C.round2(before.balance + t.amount) : C.round2(before.balance - t.orderPrice);

    const preview = {
      dry_run: a.dry_run,
      account: p.name,
      transaction: {
        type: a.type, amount: t.amount || undefined, orderPrice: t.orderPrice || undefined, returnPrice: t.returnPrice || undefined,
        date: t.date.slice(0, 10), note: t.note, by: t.by,
        returnAddedOn: t.releaseDate ? L.releaseOf(t).toISOString().slice(0, 10) : undefined
      },
      balanceBefore: before.balance,
      balanceAfter: after,
      ordersCounter: t.type === 'out' ? (counted ? `بيصير ${before.orders + 1}` : `بيضل ${before.orders} (المبلغ برّا ${s.counterMin}–${s.counterMax})`) : undefined,
      becomesReady: after < Number(s.readyThreshold) && !before.ready ? true : undefined,
      warnings: warnings.length ? warnings : undefined
    };
    if (a.dry_run) return text(Object.assign({ note: 'معاينة فقط — ما انحفظ إشي. اعرضها على المستخدم واطلب موافقته.' }, preview));

    const { id, ...data } = t;
    await setDoc(doc(db, 'tx', id), JSON.parse(JSON.stringify(data)));
    return text(Object.assign({ note: 'انحفظت الحركة وبتبيّن بالدفتر عند الكل.', id }, preview));
  } catch (e) { return fail(e.message); }
});

/* ------------------------------------------------------------------ */

const transport = new StdioServerTransport();
await server.connect(transport);
log('ready');

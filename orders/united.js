/* ================================================================
   الاتصال بموقع يونايتد (منصة Odoo) من المتصفح
   ----------------------------------------------------------------
   المتصفح بيمنع الصفحة تحكي مع موقع ثاني مباشرة (CORS)، فكل
   الطلبات بتمر من وسيط صغير على Cloudflare (worker/united-proxy.js).
   الوسيط ما بيحفظ إشي: بيوصّل الطلب ليونايتد مع كوكي الجلسة وبيرجّع الرد.
   الجلسة (session_id) بتنحفظ على هذا الجهاز فقط.
   ================================================================ */
import { UNITED_PROXY } from '../js/config.js';

const DEFAULTS = {
  baseUrl: 'https://unitedexpress.ps',
  model: 'rb_delivery.order'
};

const SESSION_KEY = 'united_session';

class UnitedError extends Error {
  constructor(message, data) {
    super(message);
    this.name = 'UnitedError';
    this.data = data || null;
  }
}

function getSession() { try { return localStorage.getItem(SESSION_KEY) || ''; } catch (_) { return ''; } }
function setSession(s) {
  try { if (s) localStorage.setItem(SESSION_KEY, s); else localStorage.removeItem(SESSION_KEY); } catch (_) {}
}

class United {
  constructor(getConfig) { this.getConfig = getConfig; }

  get cfg() { return Object.assign({}, DEFAULTS, this.getConfig() || {}); }
  get baseUrl() { return String(this.cfg.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, ''); }

  get proxy() {
    const p = String(UNITED_PROXY || '').replace(/\/+$/, '');
    if (!p) throw new UnitedError('ما في رابط للوسيط تبع يونايتد. حطه في js/config.js (UNITED_PROXY) — شوف README.');
    return p;
  }

  async _post(route, body, timeout = 45000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(this.proxy + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-United-Session': getSession() },
        body: JSON.stringify(Object.assign({ base: this.baseUrl }, body)),
        signal: controller.signal
      });
      const json = await res.json().catch(() => null);
      if (!json) throw new UnitedError('ردّ غير متوقّع من الوسيط (HTTP ' + res.status + ')');
      if (json.session) setSession(json.session);
      return json;
    } catch (e) {
      if (e instanceof UnitedError) throw e;
      if (e.name === 'AbortError') throw new UnitedError('انتهت مهلة الاتصال بموقع يونايتد');
      throw new UnitedError('تعذّر الوصول للوسيط — تأكد من الإنترنت ومن رابط UNITED_PROXY (' + e.message + ')');
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------- JSON-RPC ------------------------- */

  async rpc(path, params, timeout = 45000) {
    const payload = JSON.stringify({ jsonrpc: '2.0', method: 'call', params: params || {}, id: Math.floor(Math.random() * 1e9) });
    const res = await this._post('/rpc', { path, payload }, timeout);
    if (res.error) throw new UnitedError(res.error);
    const text = res.text || '';
    if (res.status === 401 || res.status === 403) throw new UnitedError('الجلسة منتهية — سجّل دخول من جديد');

    let json;
    try { json = JSON.parse(text); }
    catch (_) {
      if (/<form[^>]*login|name="login"/i.test(text)) throw new UnitedError('الجلسة منتهية — سجّل دخول من جديد');
      throw new UnitedError('ردّ غير متوقّع من السيرفر (HTTP ' + res.status + ')');
    }
    if (json.error) {
      const d = json.error.data || {};
      const msg = d.message || json.error.message || 'خطأ غير معروف من السيرفر';
      if (/session expired|Odoo Session Expired|AccessDenied/i.test(d.name + ' ' + msg)) {
        throw new UnitedError('الجلسة منتهية — سجّل دخول من جديد', d);
      }
      if (/AccessError/i.test(d.name || '')) {
        throw new UnitedError('ما عندك صلاحية لهاي العملية على حساب يونايتد: ' + msg, d);
      }
      throw new UnitedError(String(msg).split('\n')[0], d);
    }
    return json.result;
  }

  callKw(model, method, args = [], kwargs = {}) {
    return this.rpc('/web/dataset/call_kw', {
      model, method, args, kwargs: Object.assign({ context: {} }, kwargs)
    });
  }

  /* ------------------------- الجلسة ------------------------- */

  hasSession() { return !!getSession(); }

  async sessionInfo() {
    if (!getSession()) throw new UnitedError('غير مسجّل دخول');
    const info = await this.rpc('/web/session/get_session_info', {});
    if (!info || !info.uid) throw new UnitedError('غير مسجّل دخول');
    return {
      uid: info.uid,
      name: info.name || info.username || '',
      username: info.username || '',
      company: (info.user_companies && info.user_companies.current_company &&
        (info.user_companies.current_company[1] || info.user_companies.current_company)) || info.company_id || '',
      db: info.db || '',
      serverVersion: info.server_version || ''
    };
  }

  /** دخول بالإيميل/رقم المستخدم وكلمة السر — الوسيط بيعبّي نموذج الدخول تبع يونايتد */
  async login(login, password) {
    setSession('');
    const r = await this._post('/login', { login, password }, 60000);
    if (!r.ok || !r.session) throw new UnitedError(r.error || 'يونايتد رفض الدخول — تأكد من الاسم وكلمة السر');
    setSession(r.session);
    return this._verify();
  }

  /** بيتأكد إنه الجلسة شغّالة، وإذا لا بيمسحها */
  async _verify() {
    try { return await this.sessionInfo(); }
    catch (e) { setSession(''); throw e; }
  }

  /** بديل: لصق قيمة كوكي session_id من المتصفح يدوياً */
  async useSession(sid) {
    setSession(String(sid || '').trim().replace(/^session_id=/, ''));
    return this._verify();
  }

  async logout() {
    try { await this._post('/logout', {}, 15000); } catch (_) {}
    setSession('');
    return true;
  }

  async diagnose() {
    const out = { baseUrl: this.baseUrl, model: this.cfg.model, proxy: UNITED_PROXY || '(فاضي)', hasSession: !!getSession(), sessionInfo: null, errors: [] };
    try { const r = await this._post('/ping', {}, 15000); out.proxyOk = !!r.ok; out.reach = r.status || r.error || null; }
    catch (e) { out.errors.push('الوسيط: ' + e.message); }
    try { out.sessionInfo = await this.sessionInfo(); }
    catch (e) { out.errors.push('session_info: ' + e.message); }
    return out;
  }

  /* ------------------------- البيانات الوصفية ------------------------- */
  /** كل حقول الجدول مع أسمائها العربية */
  async fieldsGet(model) {
    const m = model || this.cfg.model;
    const raw = await this.callKw(m, 'fields_get', [[], ['string', 'type', 'required', 'readonly', 'relation', 'selection', 'help']]);
    return Object.entries(raw)
      .map(([name, f]) => ({
        name,
        label: f.string || name,
        type: f.type,
        required: !!f.required,
        readonly: !!f.readonly,
        relation: f.relation || '',
        selection: f.selection || null,
        help: f.help || ''
      }))
      .filter((f) => !f.readonly && !['one2many', 'many2many', 'binary'].includes(f.type))
      .sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }

  /** القيم الافتراضية التي يعبّيها يونايتد لوحده (حتى لا ننبّه عليها كنواقص) */
  async defaultsFor(model, fieldNames) {
    try {
      const res = await this.callKw(model || this.cfg.model, 'default_get', [fieldNames || []]);
      return res && typeof res === 'object' ? res : {};
    } catch (_) {
      return {};
    }
  }

  /** بحث بالاسم داخل جدول مرتبط (للحقول من نوع many2one) */
  async nameSearch(model, query, limit = 12) {
    const res = await this.callKw(model, 'name_search', [], { name: String(query || ''), args: [], operator: 'ilike', limit });
    return (res || []).map(([id, name]) => ({ id, name }));
  }

  /** تنزيل قائمة كاملة من جدول مرتبط (المدن/القرى مثلاً) */
  async loadAll(model, limit = 5000) {
    const rows = await this.callKw(model, 'search_read', [[], ['display_name']], { limit });
    return (rows || [])
      .map((r) => ({ id: r.id, name: r.display_name || String(r.id) }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
  }

  /** يقرأ حقول محددة لمجموعة سجلات (على دفعات) */
  async readMany(ids, fields, model) {
    const m = model || this.cfg.model;
    const out = [];
    const chunk = 150;
    for (let i = 0; i < ids.length; i += chunk) {
      const part = ids.slice(i, i + chunk);
      const rows = await this.callKw(m, 'read', [part, fields]);
      out.push(...(rows || []));
    }
    return out;
  }

  /* ------------------------- الإنشاء ------------------------- */

  /**
   * يبني قيم السجل من الربط ثم ينشئه.
   * @param {object} mapping { حقل_يونايتد: 'name'|'phone'|... }
   * @param {Array}  fixed   [{ field, value, label }]
   * @param {object} vars    قيم الطلبية/الزبون
   * @param {Array}  fields  ناتج fieldsGet (لمعرفة الأنواع)
   */
  async buildValues(mapping, fixed, vars, fields) {
    const byName = new Map((fields || []).map((f) => [f.name, f]));
    const vals = {};

    for (const [target, source] of Object.entries(mapping || {})) {
      if (!target || !source) continue;
      const meta = byName.get(target);
      // إذا عندنا رقم السجل جاهز (مثل المنطقة المختارة من قائمة يونايتد) نستعمله مباشرة
      const idKey = source + 'Id';
      if (meta && meta.type === 'many2one' && vars[idKey]) {
        vals[target] = vars[idKey];
        continue;
      }
      const raw = vars[source];
      if (raw === undefined || raw === null || raw === '') continue;
      vals[target] = await this._coerce(meta, raw, target);
    }

    for (const f of fixed || []) {
      if (!f || !f.field) continue;
      if (f.id !== undefined && f.id !== null && f.id !== '') { vals[f.field] = f.id; continue; }
      if (f.value === undefined || f.value === '') continue;
      vals[f.field] = await this._coerce(byName.get(f.field), f.value, f.field);
    }
    return vals;
  }

  async _coerce(meta, raw, target) {
    if (!meta) return raw;
    switch (meta.type) {
      case 'integer': {
        const n = parseInt(raw, 10);
        if (!Number.isFinite(n)) throw new UnitedError(`قيمة غير صالحة للحقل «${meta.label}» — لازم رقم صحيح`);
        return n;
      }
      case 'float':
      case 'monetary': {
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) throw new UnitedError(`قيمة غير صالحة للحقل «${meta.label}» — لازم رقم`);
        return n;
      }
      case 'boolean':
        return !!raw && raw !== '0' && raw !== 'false';
      case 'many2one': {
        if (typeof raw === 'number') return raw;
        if (/^\d+$/.test(String(raw))) return parseInt(raw, 10);
        const found = await this.nameSearch(meta.relation, raw, 2);
        if (!found.length) {
          throw new UnitedError(`ما لقيت «${raw}» ضمن خيارات الحقل «${meta.label}» عند يونايتد. اختر قيمة ثابتة لهذا الحقل من شاشة الربط.`);
        }
        return found[0].id;
      }
      case 'selection': {
        const opts = meta.selection || [];
        const hit = opts.find(([v, l]) => String(v) === String(raw) || String(l) === String(raw));
        if (!hit) throw new UnitedError(`قيمة «${raw}» غير مقبولة للحقل «${meta.label}»`);
        return hit[0];
      }
      case 'date':
        return String(raw).slice(0, 10);
      default:
        return String(raw);
    }
  }

  async createOrder(vals, model) {
    const m = model || this.cfg.model;
    const id = await this.callKw(m, 'create', [vals]);
    if (!id) throw new UnitedError('السيرفر ما رجّع رقم الطلبية');
    let ref = '';
    try {
      const rows = await this.callKw(m, 'read', [[id], ['display_name']]);
      ref = (rows && rows[0] && rows[0].display_name) || '';
    } catch (_) {}
    return { id, ref, url: `${this.baseUrl}/web#id=${id}&model=${m}&view_type=form` };
  }
}

/** تخمين الربط تلقائياً من أسماء الحقول العربية */
const GUESS_RULES = [
  { source: 'name',
    exact: ['customer_name'],
    any: ['اسم الزبون', 'اسم العميل', 'اسم المستلم', 'receiver name', 'client name', 'customer name'],
    not: ['تاجر', 'مرسل', 'سائق', 'موظف', 'merchant', 'sender', 'driver', 'agent', 'business'] },

  { source: 'phone',
    exact: ['customer_mobile'],
    any: ['رقم التلفون الأول', 'التلفون الاول', 'هاتف الزبون', 'جوال الزبون', 'رقم المستلم', 'رقم الزبون',
          'receiver mobile', 'customer mobile', 'client phone', 'receiver phone'],
    not: ['تاجر', 'ثاني', 'الثاني', 'واتس', 'ونس', 'merchant', 'sender', 'second', 'two', 'whatsapp', 'alt'] },

  { source: 'address1',
    exact: ['customer_sub_area', 'customer_area'],
    any: ['receiver sub area', 'receiver area', 'عنوان الزبون', 'منطقة الزبون', 'منطقة المستلم', 'مدينة', 'المنطقة'],
    not: ['تاجر', 'merchant', 'sender', 'كامل', 'full'] },

  { source: 'address2',
    exact: ['address_tag'],
    any: ['full address', 'العنوان الكامل', 'عنوان المستلم', 'العنوان التفصيلي', 'تفاصيل العنوان', 'address tag'],
    not: ['تاجر', 'merchant', 'sender', 'alternative', 'بديل'] },

  { source: 'pieces',
    exact: ['items_count', 'number_of_items', 'pieces_count'],
    any: ['عدد العناصر', 'عدد القطع', 'عدد الطرود', 'الكمية', 'items count', 'number of items', 'pieces', 'quantity'],
    not: ['وزن', 'weight'] },

  { source: 'price',
    exact: ['copy_total_cost', 'order_value'],
    any: ['قيمة الطلبية', 'سعر الطلبية', 'قيمة الشحنة', 'التحصيل', 'total amount', 'order value', 'cod amount'],
    not: ['computed', 'محسوب', 'توصيل', 'delivery', 'شحن', 'shipping', 'agent', 'cost for'] },

  { source: 'deliveryPrice',
    exact: ['delivery_cost', 'delivery_price', 'shipping_cost'],
    any: ['سعر التوصيل', 'أجرة التوصيل', 'اجرة التوصيل', 'قيمة التوصيل', 'تكلفة الشحن',
          'delivery cost', 'delivery price', 'shipping cost'],
    not: ['computed', 'محسوب', 'agent', 'saved'] },

  { source: 'notes',
    exact: ['special_note'],
    any: ['ملاحظات', 'ملاحظة', 'special note', 'note', 'comment'],
    not: ['داخلية', 'internal', 'stuck', 'solve', 'returned'] }
];

function guessMapping(fields) {
  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const mapping = {};
  const used = new Set();

  for (const rule of GUESS_RULES) {
    let best = null;
    let bestScore = 0;

    for (const f of fields) {
      if (used.has(f.name)) continue;
      const label = norm(f.label);
      const tech = norm(f.name);
      const hay = label + ' | ' + tech;

      if ((rule.not || []).some((n) => hay.includes(norm(n)))) continue;

      // مطابقة الاسم التقني بالضبط = أقوى دليل
      const ex = (rule.exact || []).indexOf(f.name);
      if (ex !== -1) {
        const score = 1000 - ex;
        if (score > bestScore) { bestScore = score; best = f; }
        continue;
      }

      for (let i = 0; i < rule.any.length; i++) {
        const needle = norm(rule.any[i]);
        if (!needle) continue;
        const inLabel = label.includes(needle);
        const inTech = tech.includes(needle);
        if (!inLabel && !inTech) continue;
        let score = 100 - i * 4;
        if (label === needle || tech === needle) score += 40;
        if (inLabel) score += 6;
        score -= Math.min(20, Math.abs((inLabel ? label.length : tech.length) - needle.length));
        if (score > bestScore) { bestScore = score; best = f; }
      }
    }

    if (best) { mapping[best.name] = rule.source; used.add(best.name); }
  }
  return mapping;
}

/**
 * يخمّن ربط حالات يونايتد بحالاتنا.
 * @param {Array} selection [[value, label], ...]
 */
function guessStatusMap(selection) {
  const map = {};
  const DELIVERED = /deliver|delivered|تسليم|تم التسليم|مسلم|مستلم|received|complete|done|success|closed|paid/i;
  const RETURNED = /return|returned|راجع|مرتجع|ارجاع|إرجاع|reject|refus|cancel|ملغ|فشل|failed|undeliver/i;
  for (const pair of selection || []) {
    const value = Array.isArray(pair) ? pair[0] : pair;
    const label = Array.isArray(pair) ? String(pair[1] || '') : String(pair);
    const hay = String(value) + ' ' + label;
    if (RETURNED.test(hay)) map[value] = 'returned';
    else if (DELIVERED.test(hay)) map[value] = 'delivered';
    else map[value] = '';   // فارغ = لا تغيّر شي (لسا بالطريق)
  }
  return map;
}

/** يخمّن أي حقل هو حقل المنطقة/المدينة (many2one) */
function guessAreaField(fields) {
  const mapped = guessMapping(fields);
  for (const [target, src] of Object.entries(mapped)) {
    if (src !== 'address1') continue;
    const f = fields.find((x) => x.name === target);
    if (f && f.type === 'many2one' && f.relation) return f;
  }
  const norm = (s) => String(s || '').toLowerCase();
  return fields.find((f) =>
    f.type === 'many2one' && f.relation &&
    /sub area|area|منطق|مدين/.test(norm(f.label) + ' ' + norm(f.name)) &&
    !/merchant|تاجر|sender|مرسل/.test(norm(f.label) + ' ' + norm(f.name))) || null;
}


/* ================================================================
   window.api.united — نفس واجهة نسخة إلكترون (main.js) بس بالمتصفح
   ================================================================ */

export function createUnitedApi({ getDB, save }) {
  const cfg = () => getDB().settings.united;
  const united = new United(cfg);
  const ok = (data) => ({ ok: true, data });
  const fail = (e) => ({ ok: false, error: e && e.message ? e.message : String(e) });
  const wrap = (fn) => async (arg) => { try { return ok(await fn(arg || {})); } catch (e) { return fail(e); } };

  return {
    status: async () => {
      try { return ok({ loggedIn: true, info: await united.sessionInfo() }); }
      catch (e) { return ok({ loggedIn: false, reason: e.message }); }
    },

    /** { login, password } أو { session } */
    login: wrap(async ({ login, password, session }) => {
      const info = session ? await united.useSession(session) : await united.login(login, password);
      return { loggedIn: true, info };
    }),

    diagnose: wrap(() => united.diagnose()),
    logout: wrap(() => united.logout()),

    fields: wrap(async () => {
      const fields = await united.fieldsGet();
      const defs = await united.defaultsFor(null, fields.map((f) => f.name));
      for (const f of fields) {
        const v = defs[f.name];
        f.hasDefault = v !== undefined && v !== null && v !== false && v !== '';
      }
      const u = cfg();
      u.fieldsCache = fields;
      if (!Object.keys(u.mapping || {}).length) u.mapping = guessMapping(fields);
      const stField = fields.find((f) => f.name === (u.statusField || 'state') && f.selection)
        || fields.find((f) => f.type === 'selection' && /state|status|حال/i.test(f.name + ' ' + f.label));
      if (stField) {
        u.statusField = stField.name;
        if (!Object.keys(u.statusMap || {}).length) u.statusMap = guessStatusMap(stField.selection);
      }
      if (!u.areaField) {
        const af = guessAreaField(fields);
        if (af) { u.areaField = af.name; u.areaModel = af.relation; }
      }
      await save();
      return {
        fields, mapping: u.mapping, areaField: u.areaField, areaModel: u.areaModel,
        statusField: u.statusField, statusMap: u.statusMap
      };
    }),

    guess: wrap(async () => guessMapping(cfg().fieldsCache || [])),

    loadAreas: wrap(async ({ field }) => {
      const u = cfg();
      const name = field || u.areaField;
      const meta = (u.fieldsCache || []).find((f) => f.name === name);
      if (!meta || !meta.relation) throw new Error('حدّد حقل المنطقة أولاً (لازم يكون حقل قائمة عند يونايتد)');
      const areas = await united.loadAll(meta.relation);
      u.areaField = meta.name;
      u.areaModel = meta.relation;
      u.areas = areas;
      await save();
      return { areas, areaField: u.areaField, areaModel: u.areaModel, label: meta.label };
    }),

    nameSearch: wrap(({ model, query }) => united.nameSearch(model, query)),

    preview: wrap(({ vars }) => {
      const u = cfg();
      return united.buildValues(u.mapping, u.fixed, vars || {}, u.fieldsCache || []);
    }),

    send: wrap(async ({ vars }) => {
      const u = cfg();
      if (!Object.keys(u.mapping || {}).length) {
        throw new Error('ما في ربط للحقول بعد. افتح «ربط يونايتد» واضغط «اكتشاف الحقول».');
      }
      const vals = await united.buildValues(u.mapping, u.fixed, vars || {}, u.fieldsCache || []);
      return united.createOrder(vals);
    }),

    /** مزامنة حالات الطلبيات من يونايتد */
    sync: wrap(async ({ orderIds }) => {
      const data = getDB();
      const u = data.settings.united;
      const field = u.statusField || 'state';
      if (!Object.keys(u.statusMap || {}).length) {
        throw new Error('ما في ربط لحالات يونايتد بعد. اضغط «اكتشاف الحقول» أول.');
      }
      let orders = data.orders.filter((o) => o.unitedId);
      if (Array.isArray(orderIds) && orderIds.length) orders = orders.filter((o) => orderIds.includes(o.id));
      if (!orders.length) return { checked: 0, changed: [], skipped: 0 };

      const rows = await united.readMany(orders.map((o) => o.unitedId), [field, 'display_name']);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const changed = [];
      for (const o of orders) {
        const row = byId.get(o.unitedId);
        if (!row) continue;
        let raw = row[field];
        if (Array.isArray(raw)) raw = raw[0];
        if (raw === false || raw === undefined) continue;
        const key = String(raw);
        o.unitedState = key;
        if (row.display_name && !o.unitedRef) o.unitedRef = row.display_name;
        const target = (u.statusMap || {})[key];
        if (!target || target === o.status) continue;
        const before = o.status;
        o.status = target;
        o.updatedAt = new Date().toISOString();
        o.statusSource = 'united';
        changed.push({ id: o.id, customerName: o.customerName, date: o.date, from: before, to: target, unitedState: key, ref: o.unitedRef || '' });
      }
      u.lastSync = new Date().toISOString();
      await save();
      return { checked: orders.length, changed, lastSync: u.lastSync };
    }),

    open: wrap(async (url) => {
      window.open(typeof url === 'string' && url ? url : cfg().baseUrl + '/web', '_blank', 'noopener');
      return true;
    })
  };
}

export { United, UnitedError, guessMapping, guessAreaField, guessStatusMap, DEFAULTS };

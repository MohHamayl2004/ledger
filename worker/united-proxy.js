/* ================================================================
   وسيط يونايتد — Cloudflare Worker (مجاني)
   ----------------------------------------------------------------
   المتصفح ما بيسمح لصفحتنا تحكي مع unitedexpress.ps مباشرة (CORS)،
   فهاد الوسيط بيوصّل الطلبات ويرجّع الرد. ما بيخزّن ولا إشي:
   كوكي الجلسة بيجي من المتصفح بهيدر X-United-Session وبيرجع بالرد.

   محمي بثلاث أشياء:
   1) بيقبل بس المواقع المذكورة في ALLOWED_ORIGINS
   2) بيوصّل بس للمواقع المذكورة في UNITED_BASES
   3) بيسمح بس بمسارات Odoo اللي البرنامج بيحتاجها
   ================================================================ */

const RPC_PATHS = [
  /^\/web\/session\/get_session_info$/,
  /^\/web\/dataset\/call_kw(\/[\w.]+)*$/,
  /^\/web\/session\/destroy$/
];

const list = (s, def) => String(s || def || '').split(',').map((x) => x.trim().replace(/\/+$/, '')).filter(Boolean);

export default {
  async fetch(req, env) {
    const origins = list(env.ALLOWED_ORIGINS);
    const bases = list(env.UNITED_BASES, 'https://unitedexpress.ps');
    const origin = req.headers.get('Origin') || '';
    const allowed = origins.includes(origin);

    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-United-Session',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    const reply = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors)
    });

    if (req.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (!allowed) return reply({ ok: false, error: 'هذا الموقع غير مسموح له باستخدام الوسيط (ALLOWED_ORIGINS)' }, 403);
    if (req.method !== 'POST') return reply({ ok: false, error: 'POST فقط' }, 405);

    let body;
    try { body = await req.json(); } catch (_) { return reply({ ok: false, error: 'طلب غير صالح' }, 400); }
    const base = String(body.base || '').replace(/\/+$/, '');
    if (!bases.includes(base)) return reply({ ok: false, error: 'رابط يونايتد غير مسموح (UNITED_BASES): ' + base }, 400);

    const sid = (req.headers.get('X-United-Session') || '').replace(/[^\w.-]/g, '');
    const route = new URL(req.url).pathname;

    try {
      if (route === '/ping') {
        const r = await fetch(base + '/web/login', { redirect: 'manual' });
        return reply({ ok: true, status: r.status });
      }
      if (route === '/rpc') return reply(await rpc(base, sid, body));
      if (route === '/login') return reply(await login(base, body));
      if (route === '/logout') {
        if (sid) await rpc(base, sid, { path: '/web/session/destroy', payload: '{"jsonrpc":"2.0","method":"call","params":{}}' });
        return reply({ ok: true });
      }
      return reply({ ok: false, error: 'مسار غير معروف' }, 404);
    } catch (e) {
      return reply({ ok: false, error: 'تعذّر الوصول لموقع يونايتد: ' + (e && e.message || e) }, 502);
    }
  }
};

/* ------------------------------------------------------------------ */

function sessionFrom(res) {
  const all = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : (res.headers.get('Set-Cookie') || '').split(/,(?=\s*\w+=)/);
  for (const c of all) {
    const m = /(?:^|\s)session_id=([^;]*)/.exec(c);
    if (m && m[1]) return m[1];
  }
  return '';
}

async function rpc(base, sid, { path, payload }) {
  path = String(path || '');
  if (!RPC_PATHS.some((re) => re.test(path))) return { ok: false, error: 'مسار غير مسموح: ' + path };
  if (typeof payload !== 'string' || payload.length > 2_000_000) return { ok: false, error: 'طلب غير صالح' };
  const res = await fetch(base + path, {
    method: 'POST',
    redirect: 'manual',
    headers: Object.assign(
      { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      sid ? { Cookie: 'session_id=' + sid } : {}
    ),
    body: payload
  });
  const text = await res.text();
  const out = { ok: true, status: res.status, text };
  const fresh = sessionFrom(res);
  if (fresh && fresh !== sid) out.session = fresh;
  return out;
}

/**
 * تسجيل الدخول بنفس طريقة المتصفح: منفتح صفحة الدخول، منوخذ csrf_token
 * وكوكي الجلسة، ومنبعت النموذج. Odoo بيرجّع تحويل (303) لما ينجح.
 */
async function login(base, { login, password }) {
  if (!login || !password) return { ok: false, error: 'اكتب اسم المستخدم وكلمة السر' };

  const page = await fetch(base + '/web/login', { redirect: 'manual' });
  const html = await page.text();
  const sid0 = sessionFrom(page);
  const csrf = (/name="csrf_token"\s+value="([^"]+)"/.exec(html) || /value="([^"]+)"\s+name="csrf_token"/.exec(html) || [])[1];
  if (!csrf) return { ok: false, error: 'ما قدرت أقرأ صفحة الدخول تبع يونايتد (csrf_token)' };

  const form = new URLSearchParams({ csrf_token: csrf, login, password, redirect: '' });
  const res = await fetch(base + '/web/login', {
    method: 'POST',
    redirect: 'manual',
    headers: Object.assign(
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      sid0 ? { Cookie: 'session_id=' + sid0 } : {}
    ),
    body: form.toString()
  });
  const sid = sessionFrom(res) || sid0;
  const loc = res.headers.get('Location') || '';

  if (res.status >= 300 && res.status < 400 && !/\/web\/login/.test(loc)) {
    return { ok: true, session: sid };
  }
  const t = await res.text();
  // رسالة الخطأ اللي يونايتد نفسه بيعرضها بصفحة الدخول
  const alert = /<(?:p|div)[^>]*class="[^"]*alert-danger[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/i.exec(t);
  const said = alert ? alert[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (/name="totp_token"|two.?factor|verification code/i.test(t)) return { ok: false, error: 'حسابك عليه تحقق بخطوتين — استعمل خيار «لصق الجلسة يدوياً»' };
  if (said) return { ok: false, error: 'يونايتد رفض الدخول: «' + said.slice(0, 200) + '»' };
  return { ok: false, error: 'يونايتد رجّع صفحة الدخول بدون سبب واضح (HTTP ' + res.status + ') — جرّب الإيميل بدل رقم التلفون، أو تأكد من كلمة السر' };
}

/* ================================================================
   MCP عن بُعد (Cloudflare Worker) — Connector لـ claude.ai والتلفون
   ----------------------------------------------------------------
   • /mcp        الأدوات (نفس core/tools.js) — بس بتوكن OAuth صالح
   • /authorize  صفحة دخول: نفس إيميل وكلمة سر الموقع
   • الباقي (token/register/discovery) من مكتبة OAuth

   الحماية:
   • لازم تسجيل دخول بحساب الموقع، والحساب لازم يكون عضو (members/{uid}).
   • كل طلب لـ Firestore بتوكن المستخدم نفسه → قواعد firestore.rules بتنطبق.
   • الدخول بيقبل بس إذا التوكن رايح لـ Claude (ALLOWED_REDIRECT_HOSTS).
   • كلمة السر ما بتنحفظ — بس refresh token مشفّر داخل مكتبة OAuth.
   • بيانات يونايتد بـ Worker secrets (UNITED_LOGIN / UNITED_PASSWORD).
   ================================================================ */
import { OAuthProvider, AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { FIREBASE_CONFIG } from '../js/config.js';
import { endpoints, signIn, refresh, Firestore } from './core/firestore.js';
import { registerTools, SERVER_INFO, INSTRUCTIONS } from './core/tools.js';

const SCOPES = ['mcp'];
const apiKey = FIREBASE_CONFIG.apiKey;

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const allowedHosts = (env) => String(env.ALLOWED_REDIRECT_HOSTS || 'claude.ai,claude.com')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const hostAllowed = (env, uri) => {
  let h = '';
  try { h = new URL(uri).hostname.toLowerCase(); } catch (_) { return false; }
  return allowedHosts(env).some((a) => h === a || h.endsWith('.' + a));
};

/* ------------------------------------------------------------------ */
/*  /mcp — الأدوات                                                     */
/* ------------------------------------------------------------------ */

// توكنات Firebase مؤقتة بالذاكرة (لكل isolate) عشان ما نجدّد بكل طلب
const tokens = new Map();     // uid → { idToken, expiresAt }
const members = new Map();    // uid → وقت آخر تأكيد عضوية

const McpApi = {
  async fetch(request, env, ctx) {
    const props = ctx.props || {};
    if (!props.uid || !props.refreshToken) return new Response('Unauthorized', { status: 401 });
    const ep = endpoints(env.FIREBASE_EMULATOR === '1');

    const getToken = async () => {
      const t = tokens.get(props.uid);
      if (t && Date.now() < t.expiresAt - 5 * 60 * 1000) return t.idToken;
      const r = await refresh(ep, apiKey, props.refreshToken);
      tokens.set(props.uid, { idToken: r.idToken, expiresAt: r.expiresAt });
      return r.idToken;
    };
    const fs = new Firestore({ ep, projectId: FIREBASE_CONFIG.projectId, getToken });

    // العضوية بتنفحص كل 5 دقائق — إذا انشال الشخص من members بيوقف وصوله
    const checked = members.get(props.uid) || 0;
    if (Date.now() - checked > 5 * 60 * 1000) {
      let ok = false;
      try { ok = !!(await fs.get('members', props.uid)); } catch (_) { ok = false; }
      if (!ok) return new Response(JSON.stringify({ error: 'هذا الحساب مش عضو بالموقع' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      members.set(props.uid, Date.now());
    }

    const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
    registerTools(server, {
      fs,
      uid: props.uid,
      unitedCreds: () => ({ login: env.UNITED_LOGIN, password: env.UNITED_PASSWORD })
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  }
};

/* ------------------------------------------------------------------ */
/*  صفحة الدخول                                                        */
/* ------------------------------------------------------------------ */

function page({ handle, clientName, redirectHost, clientDomain, loopback, error, email }) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ربط لقطة مع Claude</title>
<style>
  :root{--bg:#f4f5fb;--card:#fff;--text:#14161f;--muted:#5f6475;--brand:#ff7a1a;--line:#e3e5ee;--err:#c62828;--errbg:#fdecea}
  @media (prefers-color-scheme:dark){:root{--bg:#0e1017;--card:#171a24;--text:#eef0f6;--muted:#9aa0b4;--line:#2a2e3d;--errbg:#3a1a1a;--err:#ff8a80}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;padding:16px}
  .card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px 24px}
  h1{font-size:20px;margin:0 0 6px}
  p{color:var(--muted);font-size:14px;line-height:1.7;margin:0 0 14px}
  .who{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:10px 12px;font-size:13px;margin-bottom:16px;line-height:1.8}
  .who b{color:var(--text)}
  label{display:block;font-size:13px;font-weight:600;margin:12px 0 6px}
  input{width:100%;height:44px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--text);padding:0 12px;font-size:15px}
  input:focus{outline:2px solid var(--brand);outline-offset:1px}
  button{margin-top:18px;width:100%;height:46px;border:0;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;font-weight:700;cursor:pointer}
  .err{background:var(--errbg);color:var(--err);border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:12px}
  .warn{color:var(--err);font-weight:600}
  .fine{font-size:12px;margin-top:14px}
</style>
</head>
<body>
<form class="card" method="post" autocomplete="on">
  <h1>ربط «لقطة» مع ${esc(clientName || 'Claude')}</h1>
  <p>سجّل دخول بنفس إيميل وكلمة سر موقع razanstore.site. بعدها Claude بيقدر يضيف طلبيات ويبعتها ليونايتد ويضيف حركات على الدفتر — بموافقتك بكل مرة.</p>
  <div class="who">
    التطبيق: <b>${esc(clientName || '—')}</b>${clientDomain ? ` (<b>${esc(clientDomain)}</b>)` : ''}<br>
    الصلاحية رايحة لـ: <b dir="ltr">${esc(redirectHost || '—')}</b>
    ${loopback ? '<br><span class="warn">تنبيه: الصلاحية رايحة لتطبيق على جهاز — كمّل بس إذا إنت اللي بلّشت الربط هلأ.</span>' : ''}
  </div>
  ${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
  <input type="hidden" name="handle" value="${esc(handle)}">
  <input type="hidden" name="client_name" value="${esc(clientName)}">
  <input type="hidden" name="redirect_host" value="${esc(redirectHost)}">
  <label for="email">الإيميل</label>
  <input id="email" name="email" type="email" dir="ltr" required autocomplete="username" value="${esc(email || '')}">
  <label for="password">كلمة المرور</label>
  <input id="password" name="password" type="password" dir="ltr" required autocomplete="current-password">
  <button type="submit">دخول وربط</button>
  <p class="fine">كلمة السر ما بتنحفظ. بتقدر تلغي الربط بأي وقت من إعدادات Claude ← Connectors.</p>
</form>
</body>
</html>`;
}

const htmlHeaders = (extra) => {
  const h = new Headers(extra || {});
  h.set('Content-Type', 'text/html; charset=utf-8');
  h.set('X-Frame-Options', 'DENY');
  h.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Cache-Control', 'no-store');
  return h;
};
const plain = (msg, status = 400) => new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

async function authorize(request, env) {
  const oauth = env.OAUTH_PROVIDER;

  if (request.method === 'GET') {
    const req = await oauth.parseAuthRequest(request);
    if (!hostAllowed(env, req.redirectUri)) {
      return plain('هذا الربط مسموح بس لـ Claude. التطبيق اللي طلب الدخول مش معروف: ' + (() => { try { return new URL(req.redirectUri).hostname; } catch (_) { return '?'; } })(), 403);
    }
    const details = await oauth.describeConsent(req);
    const consent = await oauth.beginConsent(req);
    return new Response(page({
      handle: consent.handle,
      clientName: details.clientName,
      clientDomain: details.clientDomain,
      redirectHost: details.redirectHost,
      loopback: details.redirectIsLoopback
    }), { headers: htmlHeaders(consent.headers) });
  }

  if (request.method === 'POST') {
    const form = await request.formData();
    const handle = String(form.get('handle') || '');
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');
    const again = (error) => new Response(page({
      handle, email, error,
      clientName: String(form.get('client_name') || ''),
      redirectHost: String(form.get('redirect_host') || '')
    }), { status: 400, headers: htmlHeaders() });

    // ٠) هل المتصفح بعت علامة الصفحة (cookie)؟ في متصفحات/نوافذ بتمنع الكوكيز.
    //    إذا ما وصلت، منكمّل بدونها: منقرأ الطلب من الرابط نفسه (parseAuthRequest
    //    بيتحقق من العميل ورابط الرجوع و PKCE من جديد). هاد آمن هون لأنه الدخول
    //    بيحتاج كلمة سر الموقع بكل مرة، والتوكن بيروح بس لـ Claude.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(handle));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const want = `__Host-oauth-consent-${hash.slice(0, 16)}`;
    const names = String(request.headers.get('Cookie') || '').split(';').map((p) => p.split('=')[0].trim()).filter(Boolean);
    const hasCookie = names.includes(want);

    // ١) نتأكد من الحساب قبل ما نستهلك الطلب (handle بيشتغل مرة وحدة)
    const ep = endpoints(env.FIREBASE_EMULATOR === '1');
    let auth;
    try { auth = await signIn(ep, apiKey, email, password); }
    catch (e) { return again(e.message); }
    const fs = new Firestore({ ep, projectId: FIREBASE_CONFIG.projectId, getToken: async () => auth.idToken });
    const member = await fs.get('members', auth.uid).catch(() => null);
    if (!member) return again('هذا الحساب مش مفعّل على الموقع (مش عضو).');

    // ٢) الموافقة
    let authReq;
    let headers;
    if (hasCookie) {
      // الطريق العادي: الطلب الأصلي من التخزين، مربوط بهالمتصفح
      const approved = await oauth.approveConsent(request, handle, { scope: SCOPES });
      authReq = approved.request;
      headers = approved.headers;
    } else {
      // بدون كوكي: نفس الطلب من الرابط، بكل فحوصات المكتبة
      console.log('consent cookie missing — using URL request', JSON.stringify({ got: names.length, ua: request.headers.get('User-Agent') }));
      authReq = await oauth.parseAuthRequest(request);
      headers = htmlHeaders();
    }
    if (!hostAllowed(env, authReq.redirectUri)) return plain('هذا الربط مسموح بس لـ Claude.', 403);

    const { redirectTo } = await oauth.completeAuthorization({
      request: authReq,
      userId: auth.uid,
      metadata: { email: auth.email, name: member.name || '' },
      scope: SCOPES,
      props: { uid: auth.uid, email: auth.email, name: member.name || '', refreshToken: auth.refreshToken }
    });
    headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers });
  }

  return plain('Method not allowed', 405);
}

/** صفحة «ابدأ من جديد» — بدل رسائل المكتبة الإنجليزية */
function restartPage(detail) {
  const d = String(detail || '');
  const why = /not started in this browser|different browser/i.test(d)
    ? 'صفحة الدخول انفتحت بمتصفح أو جلسة غير هاي، أو مرّ عليها أكثر من 10 دقائق.'
    : /expired|already used/i.test(d)
      ? 'صفحة الدخول انتهت صلاحيتها (10 دقائق) أو انستعملت قبل.'
      : 'صار خطأ بطلب الربط.';
  return new Response(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>ابدأ الربط من جديد</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,Tahoma,sans-serif;background:#f4f5fb;color:#14161f;padding:16px}
@media (prefers-color-scheme:dark){body{background:#0e1017;color:#eef0f6}}
.c{max-width:440px;line-height:1.8}h1{font-size:20px}small{opacity:.6}</style></head>
<body><div class="c"><h1>لازم تبدأ الربط من جديد</h1>
<p>${esc(why)}</p>
<p>سكّر هاي الصفحة، ارجع لـ Claude ← Settings ← Connectors، واضغط <b>Connect</b> مرة ثانية — وسجّل دخول خلال 10 دقائق بنفس الصفحة اللي بتنفتح.</p>
<p><small>${esc(d)}</small></p></div></body></html>`, { status: 400, headers: htmlHeaders() });
}

const DefaultHandler = {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/authorize') return await authorize(request, env);
      if (url.pathname === '/') {
        return plain('خادم MCP لـ «لقطة». أضف الرابط ' + url.origin + '/mcp بإعدادات Claude ← Connectors.', 200);
      }
      return plain('Not found', 404);
    } catch (error) {
      if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
      if (error instanceof AuthorizationError) return restartPage(error.description);
      if (error instanceof CimdFetchError) return restartPage('ما قدرنا نتأكد من التطبيق اللي طلب الدخول.');
      throw error;
    }
  }
};

/* المكتبة بدها رابط الخادم الكامل (resource) — منبنيها أول طلب من PUBLIC_URL */
let provider = null;
function getProvider(env, request) {
  if (provider) return provider;
  const base = String(env.PUBLIC_URL || new URL(request.url).origin).replace(/\/+$/, '');
  provider = new OAuthProvider({
    apiRoute: '/mcp',
    apiHandler: McpApi,
    defaultHandler: DefaultHandler,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/token',
    clientRegistrationEndpoint: '/register',
    clientIdMetadataDocumentEnabled: env.FIREBASE_EMULATOR !== '1',
    scopesSupported: SCOPES,
    resourceMetadata: { resource: base + '/mcp', authorization_servers: [base] }
  });
  return provider;
}

export default {
  fetch(request, env, ctx) {
    return getProvider(env, request).fetch(request, env, ctx);
  }
};

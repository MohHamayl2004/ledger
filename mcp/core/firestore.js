/* ================================================================
   Firebase عبر REST — بيشتغل بـ Node وبـ Cloudflare Workers
   ----------------------------------------------------------------
   الدخول بنفس إيميل وكلمة سر الموقع، وكل طلب بيروح بتوكن المستخدم،
   فقواعد Firestore (firestore.rules) بتنطبق بالضبط زي الموقع.
   ================================================================ */

/** عناوين Firebase — أو المحاكي للتجربة (emulator=true) */
export function endpoints(emulator) {
  return emulator
    ? {
        auth: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1',
        token: 'http://127.0.0.1:9099/securetoken.googleapis.com/v1/token',
        firestore: 'http://127.0.0.1:8081/v1'
      }
    : {
        auth: 'https://identitytoolkit.googleapis.com/v1',
        token: 'https://securetoken.googleapis.com/v1/token',
        firestore: 'https://firestore.googleapis.com/v1'
      };
}

const AUTH_ERRORS = {
  INVALID_LOGIN_CREDENTIALS: 'الإيميل أو كلمة المرور غير صحيحة',
  INVALID_PASSWORD: 'الإيميل أو كلمة المرور غير صحيحة',
  EMAIL_NOT_FOUND: 'الإيميل أو كلمة المرور غير صحيحة',
  INVALID_EMAIL: 'الإيميل مش صحيح',
  USER_DISABLED: 'هذا الحساب موقوف',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'محاولات كثيرة — استنى شوي وجرّب مرة ثانية'
};

/** دخول بالإيميل وكلمة السر → { uid, email, idToken, refreshToken } */
export async function signIn(ep, apiKey, email, password) {
  const r = await fetch(`${ep.auth}/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = String((j.error && j.error.message) || '').split(' ')[0];
    throw new Error(AUTH_ERRORS[code] || 'تعذّر تسجيل الدخول (' + (code || r.status) + ')');
  }
  return { uid: j.localId, email: j.email, idToken: j.idToken, refreshToken: j.refreshToken, expiresAt: Date.now() + (Number(j.expiresIn) || 3600) * 1000 };
}

/** توكن جديد من refreshToken → { idToken, refreshToken, expiresAt } */
export async function refresh(ep, apiKey, refreshToken) {
  const r = await fetch(`${ep.token}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString()
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('انتهت جلسة الدخول — اعمل Connect مرة ثانية (' + ((j.error && j.error.message) || r.status) + ')');
  return { idToken: j.id_token, refreshToken: j.refresh_token, uid: j.user_id, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
}

/* ------------------------- تحويل القيم ------------------------- */

function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isSafeInteger(v) && !Object.is(v, -0) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.filter((x) => x !== undefined).map(enc) } };
  if (typeof v === 'object') return { mapValue: { fields: encFields(v) } };
  return { stringValue: String(v) };
}
function encFields(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = enc(v);
  return out;
}
function dec(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decFields(v.mapValue.fields || {});
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('bytesValue' in v) return v.bytesValue;
  return null;
}
function decFields(f) {
  const out = {};
  for (const [k, v] of Object.entries(f || {})) out[k] = dec(v);
  return out;
}

/* ------------------------- العميل ------------------------- */

export class Firestore {
  /**
   * @param {object} o { ep, projectId, getToken: async () => idToken }
   */
  constructor({ ep, projectId, getToken }) {
    this.base = `${ep.firestore}/projects/${projectId}/databases/(default)/documents`;
    this.getToken = getToken;
  }

  async _req(method, path, body) {
    const token = await this.getToken();
    const r = await fetch(this.base + path, {
      method,
      headers: Object.assign({ Authorization: 'Bearer ' + token }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    if (r.status === 404) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j.error && (j.error.status || j.error.message)) || r.status;
      if (r.status === 403) throw new Error('ما عندك صلاحية (PERMISSION_DENIED) — تأكد إنك عضو بالموقع');
      throw new Error('Firestore: ' + msg);
    }
    return j;
  }

  /** مستند واحد (أو null) */
  async get(...segs) {
    const j = await this._req('GET', '/' + segs.map(encodeURIComponent).join('/'));
    return j ? decFields(j.fields) : null;
  }

  /** كل مستندات مجموعة → [{ id, ...data }] */
  async list(...segs) {
    const out = [];
    let pageToken = '';
    do {
      const q = '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
      const j = await this._req('GET', '/' + segs.map(encodeURIComponent).join('/') + q);
      for (const d of (j && j.documents) || []) {
        out.push(Object.assign(decFields(d.fields), { id: d.name.split('/').pop() }));
      }
      pageToken = (j && j.nextPageToken) || '';
    } while (pageToken);
    return out;
  }

  /** كتابة مستند كامل (زي setDoc) */
  async set(segs, data) {
    await this._req('PATCH', '/' + segs.map(encodeURIComponent).join('/'), { fields: encFields(data) });
  }
}

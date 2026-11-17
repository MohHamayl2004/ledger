# دفتر الحسابات + إدارة الطلبيات

موقع واحد بيشتغل على GitHub Pages مجاناً، بيفتح من التلفون واللابتوب، وفيه:

| الصفحة | الرابط | البيانات |
|---|---|---|
| **دفتر الحسابات** | `/` | **مشتركة** بين كل الأعضاء (زي قبل) |
| **إدارة الطلبيات** | `/orders/` | **خاصة** بكل مستخدم — ما حدا بيشوف طلبيات غيره |

- تسجيل دخول حقيقي (إيميل + كلمة سر) عن طريق Firebase.
- بيشتغل **بدون نت** وبيزامن لما يرجع. التعديل من التلفون بيبيّن على اللابتوب فوراً.
- الطلبيات: نسخة احتياطية يومية تلقائية (آخر 30 يوم) + زر «تصدير نسخة احتياطية» لملف على جهازك.
- التقارير فيها **فلتر حسب البرنامج** (تيمو / شي ان / ايهرب …) وجدول «الربح حسب البرنامج».
- الإرسال ليونايتد ومزامنة الحالات شغّالين عن طريق وسيط صغير مجاني (Cloudflare Worker).
- انشالت ميزة تتبّع الطرود وميزة المحاكي (ADB). بيانات «الطلبيات الكبيرة» القديمة ما انمسحت — بتضل محفوظة وبتطلع بالنسخ الاحتياطية.

---

## ١) إعداد Firebase (مرة وحدة)

> **الترتيب مهم** عشان الموقع ما يوقف ولا دقيقة: اعمل الخطوات بالترتيب.

**أ. فعّل الدخول بالإيميل**
[console.firebase.google.com](https://console.firebase.google.com) → مشروع `ledger-375cb` → **Build → Authentication → Sign-in method** → فعّل **Email/Password** → Save.

**ب. اعمل حساب لكل شخص**
**Authentication → Users → Add user** → اكتب الإيميل وكلمة سر → Add user.
انسخ الـ **User UID** اللي بيطلع جنب الإيميل.

**ج. خلّي الشخص «عضو»** (بدون هاي الخطوة ما بيقدر يدخل)
**Firestore Database → Data → Start collection** → اسمها `members`
- Document ID: الصق الـ **UID**
- ضيف حقل: `name` (string) = الاسم اللي بيطلع بالموقع، مثلاً `محمد`

كرّر (ب) و(ج) لرزان أو أي حدا بدك تضيفه.

**د. ارفع الكود الجديد على GitHub** (شوف القسم ٥).

**هـ. انشر قواعد الحماية**
**Firestore Database → Rules** → امسح الموجود والصق محتوى ملف [`firestore.rules`](firestore.rules) كامل → **Publish**.

**و. طفّي الدخول المجهول**
**Authentication → Sign-in method → Anonymous** → Disable. (هاد كان الثغرة القديمة.)

> بيانات دفتر الحسابات الموجودة ما بتتأثر — بتضل بمكانها وبتبيّن أول ما تدخل.

---

## ٢) نقل بيانات برنامج الطلبيات القديم

1. افتح الموقع → **الطلبيات** → سجّل دخول.
2. **الإعدادات → استيراد نسخة** → اختار الملف:
   `C:\Users\<اسمك>\AppData\Roaming\delivery-manager\data.json`
   (اكتب `%APPDATA%\delivery-manager` بشريط العنوان تبع مستكشف الملفات وبتوصله.)
3. خلص — كل الزباين والطلبيات والأرصدة والرسوم وإعدادات يونايتد صاروا على حسابك.

البرنامج القديم ما بيتأثر، وملفاته بتضل على جهازك كنسخة أمان.

---

## ٣) الإرسال ليونايتد (Cloudflare Worker — مجاني)

المتصفح ما بيسمح للموقع يحكي مع unitedexpress.ps مباشرة، فبنحط وسيط صغير بيوصّل الطلبات.
الوسيط **ما بيحفظ ولا إشي** وبيقبل بس موقعك وبس مسارات يونايتد اللي البرنامج بيحتاجها.

1. اعمل حساب مجاني على [dash.cloudflare.com](https://dash.cloudflare.com).
2. **Workers & Pages → Create → Create Worker** → سمّيه `united-proxy` → Deploy.
3. **Edit code** → امسح الموجود والصق محتوى [`worker/united-proxy.js`](worker/united-proxy.js) → **Deploy**.
4. **Settings → Variables and Secrets → Add**:
   - `ALLOWED_ORIGINS` = `https://mohhamayl2004.github.io`
     (لما تشتري دومين ضيفه بفاصلة: `https://mohhamayl2004.github.io,https://دومينك.com`)
   - `UNITED_BASES` = `https://unitedexpress.ps`
5. انسخ رابط الـ Worker (مثل `https://united-proxy.اسمك.workers.dev`) وحطه في [`js/config.js`](js/config.js):
   ```js
   export const UNITED_PROXY = "https://united-proxy.اسمك.workers.dev";
   ```
6. بالموقع: **الطلبيات → ربط يونايتد → تسجيل الدخول** → اسم المستخدم وكلمة السر تبع يونايتد.
   كلمة السر ما بتنحفظ؛ بس «الجلسة» على الجهاز. كل جهاز بتسجّل منه مرة وحدة.

> إذا بتستعمل سطر الأوامر: `cd worker` ثم `npx wrangler deploy` (الإعدادات جاهزة بـ `wrangler.toml`).

إذا ما زبط الدخول: اضغط **تشخيص** وشوف السجل. في كمان خيار **«لصق الجلسة يدوياً»** بنافذة الدخول.

---

## ٤) دومين خاص

1. اشتري الدومين من أي مكان (Namecheap، Cloudflare، …).
2. بالـ DNS تبعه ضيف سجل **CNAME**: `www` → `mohhamayl2004.github.io`
   (وللدومين بدون www ضيف 4 سجلات **A** لـ `185.199.108.153` · `185.199.109.153` · `185.199.110.153` · `185.199.111.153`).
3. GitHub → الريبو → **Settings → Pages → Custom domain** → اكتب الدومين → Save → فعّل **Enforce HTTPS**.
4. ضيف الدومين لـ:
   - Firebase → **Authentication → Settings → Authorized domains**
   - Cloudflare Worker → متغيّر `ALLOWED_ORIGINS`

---

## ٥) الرفع على GitHub

من المجلد على جهازك:

```bash
git push origin orders-merge
```

وبعدين على GitHub اعمل Pull Request ودمجه بـ `main` — أو إذا بدك مباشرة:

```bash
git checkout main && git merge orders-merge && git push
```

GitHub Pages بيحدّث الموقع لحاله خلال دقيقة.

---

## ٦) كيف بيشتغل دفتر الحسابات

| العملية | شو بتعمل |
|---|---|
| **ترصيد مبلغ** | بينضاف للرصيد فوراً، وبينخصم من سقف الاستقبال الشهري |
| **سعر الطلبية** | بينخصم من الرصيد فوراً |
| **سعر القطعة الراجعة** | بينضاف للرصيد بعد عدد أيام التأخير من تاريخ الحركة |
| **الحساب جاهز** | لما الرصيد ينزل تحت الحد بيظهر بادج أخضر + بصفحة "جاهزة" |
| **سقف الاستقبال** | لكل حساب، وبتقدر تحدد رقم مختلف لكل شخص |
| **تجديد السقف** | تلقائي أول كل شهر ميلادي جديد |
| **عدّاد الطلبيات** | بيزيد ١ عند كل خصم ضمن مدى الكاونتر، وبيصفّر أول كل شهر |

كل هالأرقام بتقدر تغيّرها من داخل الموقع: **الإعدادات → قواعد الحساب**.

---

## ٧) النسخ الاحتياطي

- **دفتر الحسابات:** الإعدادات → التخزين → تنزيل نسخة احتياطية / استيراد نسخة.
- **الطلبيات:** الإعدادات → تصدير نسخة احتياطية / استيراد نسخة. وفي نسخة يومية تلقائية على حسابك (آخر 30 يوم).
- نصيحة: نزّل نسخة على جهازك كل أسبوع أو أسبوعين.

---

## ملفات المشروع

```
index.html, css/, js/      دفتر الحسابات
js/config.js               ← الإعدادات (Firebase + رابط وسيط يونايتد)
js/fb.js                   تسجيل الدخول والاتصال بـ Firebase (مشترك)
orders/                    إدارة الطلبيات
  api.js                   حفظ ومزامنة البيانات على Firebase
  united.js                الاتصال بيونايتد عبر الوسيط
  app.js, index.html       الواجهة
firestore.rules            قواعد الحماية (بتنلصق بلوحة Firebase)
worker/                    وسيط يونايتد (Cloudflare Worker)
```

### تجربة على الجهاز (للمطوّر)
شغّل سيرفر محلي من مجلد المشروع (مثلاً `python -m http.server 8080`) وافتح `http://localhost:8080`.
لتجربة بدون ما تلمس البيانات الحقيقية: شغّل Firebase Emulator (Auth على 9099 وFirestore على 8081) واكتب في Console المتصفح:
`localStorage.setItem('useEmulator','1')`.

---

## ٨) Claude كأداة للطلبيات (MCP)

مجلد [`mcp/`](mcp/) فيه خادم MCP بيخلّي Claude يضيف طلبيات ويبعتها ليونايتد — بنفس حسابات الموقع بالضبط (`orders/calc.js` و`orders/united.js`).

**الأدوات:** `get_settings` · `search_customers` · `search_areas` · `add_order` · `list_orders` · `get_order` · `united_status` · `send_order_to_united` · `monthly_profit_summary` · `list_ledger_accounts` · `add_ledger_transaction`

**قواعد ما بتنكسر (مفروضة بالكود):**
- كل حقل مهم إجباري — إذا ناقص، الأداة بترفض وبتقول شو ناقص.
- البرنامج لازم يكون من قائمة البرامج، والمنطقة لازم تطابق قائمة مناطق يونايتد حرفياً.
- المربح قرارك بكل طلبية: `platform` (نسبة البرنامج) أو `none` (بدون ربح) أو `custom` (نسبة بتحددها).
- كل إضافة وإرسال إلها معاينة (`dry_run`) قبل التنفيذ. والطلبية المرسلة ما بتنبعت مرة ثانية إلا إذا طلبت صراحة.

**التركيب (مرة وحدة):**
```bash
cd mcp
npm install
```
وبعدين سجّله بـ Claude Code (اكتب قيمك مكان النقاط — بتنحفظ على جهازك بس):
```bash
claude mcp add laqta --scope user -e FIREBASE_EMAIL=... -e FIREBASE_PASSWORD=... -e UNITED_LOGIN=... -e UNITED_PASSWORD=... -- node "C:\Users\Owner's\Desktop\ledger\mcp\server.js"
```

---

## ٩) Connector عن بُعد (claude.ai + التلفون)

نفس الأدوات، بس على Cloudflare: بتشتغل من claude.ai وتطبيق Claude على التلفون حتى لو اللابتوب مطفي.
- الملف: [`mcp/worker.js`](mcp/worker.js) — الأدوات نفسها من [`mcp/core/tools.js`](mcp/core/tools.js).
- الدخول: صفحة بتطلب إيميل وكلمة سر الموقع (OAuth). بس الأعضاء بيقدروا يربطوا، وبس لـ Claude.
- كلمة سر الموقع ما بتنحفظ. بيانات يونايتد بـ Cloudflare secrets.

**النشر (مرة وحدة، من مجلد `mcp` بـ PowerShell):**
1. `npx wrangler kv namespace create OAUTH_KV` → انسخ الـ `id` وحطه بـ [`mcp/wrangler.toml`](mcp/wrangler.toml) مكان `PUT_KV_NAMESPACE_ID_HERE`.
2. `npx wrangler secret put UNITED_LOGIN --env=""` (بيسألك عن القيمة)
3. `npx wrangler secret put UNITED_PASSWORD --env=""`
4. `npx wrangler deploy --env=""`

**الربط بـ Claude:** claude.ai ← Settings ← Connectors ← Add custom connector ← الرابط:
`https://laqta-mcp.palestiniantemu.workers.dev/mcp` ← Connect ← سجّل دخول بحساب الموقع.

لإلغاء الربط: من نفس المكان بـ Claude (Disconnect). ولإيقاف أي حساب: امسح مستنده من `members` (بيوقف خلال 5 دقائق).

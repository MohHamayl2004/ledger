# دفتر الحسابات

موقع صغير لإدارة حسابات الأشخاص اللي بتعطيهم مصاري وبتسحب منهم — بيشتغل على GitHub Pages مجاناً.

---

## ١) الرفع على GitHub Pages (٣ دقايق)

1. افتح [github.com/new](https://github.com/new) واعمل ريبو جديد، سمّيه مثلاً `ledger`، واختاره **Public**.
2. من صفحة الريبو اضغط **Add file → Upload files**، وارفع **كل** الملفات اللي بالمجلد:
   - `index.html`
   - `manifest.json`
   - `.nojekyll`
   - مجلد `css`
   - مجلد `js`
   > أسهل طريقة: افتح المجلد على جهازك، حدّد كل الملفات، واسحبها على صفحة الرفع.
3. اضغط **Commit changes**.
4. روح على **Settings → Pages**، وتحت *Build and deployment*:
   - Source: **Deploy from a branch**
   - Branch: **main** ومجلد **/ (root)** → **Save**
5. استنى دقيقة، وبيطلعلك الرابط:
   `https://<اسم-حسابك>.github.io/ledger/`

خلص — الموقع شغّال. افتحه على الموبايل واضغط "إضافة إلى الشاشة الرئيسية" ليصير زي التطبيق.

---

## ٢) تفعيل المزامنة بين محمد ورزان (Firebase — مجاني)

بدون هالخطوة الموقع بيشتغل عادي بس البيانات بتنحفظ على الجهاز نفسه فقط.

1. افتح [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → سمّيه `ledger` → كمّل (بتقدر تطفّي Google Analytics).
2. من القائمة اليسار: **Build → Firestore Database → Create database** → اختار **Start in production mode** → اختار أقرب منطقة → Enable.
3. من **Build → Authentication → Get started** → تبويب **Sign-in method** → فعّل **Anonymous** → Save.
4. من **Firestore Database → Rules** الصق هذا واضغط **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

5. من ⚙️ **Project settings → General**، انزل لتحت لـ *Your apps* → اضغط أيقونة الويب `</>` → سمّي التطبيق → **Register app**.
6. رح يعطيك كود فيه `firebaseConfig` — انسخ القيم وحطها في ملف `js/config.js`:

```js
export const FIREBASE_CONFIG = {
  apiKey: "AIza....",
  authDomain: "ledger-xxxx.firebaseapp.com",
  projectId: "ledger-xxxx",
  storageBucket: "ledger-xxxx.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234:web:abcd"
};
```

7. ارفع `js/config.js` المعدّل على GitHub (Add file → Upload files، وبيستبدل القديم).

بتعرف إنها اشتغلت لما تشوف كلمة **"مزامنة"** بدل **"محلي"** فوق بالشريط.

---

## ٣) تغيير المستخدمين وكلمات المرور

كلهم في أول `js/config.js`:

```js
export const USERS = [
  { user: "mohammad", pass: "123", name: "محمد" },
  { user: "razan",    pass: "123", name: "رزان" }
];
```

⚠️ **ملاحظة أمان مهمة:** بما إن الموقع ستاتيك على GitHub Pages، أي حدا بيفتح كود الصفحة بيقدر يشوف كلمات المرور. الدخول هون هو "قفل بسيط" مش حماية حقيقية. إذا الريبو **Private** ما بتقدر تستخدم Pages مجاناً، فإذا البيانات حساسة خبّرني وبعملك حل ثاني (تسجيل دخول حقيقي عبر Firebase Auth).

---

## ٤) كيف بيشتغل النظام

| العملية | شو بتعمل |
|---|---|
| **ترصيد مبلغ** | بينضاف للرصيد فوراً، وبينخصم من سقف الاستقبال الشهري |
| **سعر الطلبية** | بينخصم من الرصيد فوراً |
| **سعر القطعة الراجعة** | بينضاف للرصيد بعد **٣ أيام** من تاريخ الحركة (بدون ما يأثر على السقف الشهري) |
| **الحساب جاهز** | لما الرصيد ينزل تحت **١٠٠** بيظهر بادج أخضر + بصفحة "جاهزة" |
| **سقف الاستقبال** | **٥٧٠٠** لكل حساب افتراضياً، وبتقدر تحدد رقم مختلف لكل شخص |
| **تجديد السقف** | تلقائي أول كل شهر ميلادي جديد |
| **عدّاد الطلبيات** | بيزيد ١ عند كل خصم قيمته بين **١٦٥٠ و١٧٥٠**، وبيصفّر أول كل شهر |

كل هالأرقام بتقدر تغيّرها من داخل الموقع: **الإعدادات → قواعد الحساب**.

---

## ٥) النسخ الاحتياطي

من **الإعدادات → التخزين**:
- **تنزيل نسخة احتياطية** → ملف JSON فيه كل شي.
- **استيراد نسخة** → لإرجاع البيانات على جهاز ثاني.
- من **الحركات → تصدير CSV** بتفتح السجل كامل في Excel.

---

## ملفات المشروع

```
index.html        الصفحة الوحيدة
css/styles.css    التصميم (فاتح + داكن)
js/config.js      ← الملف الوحيد اللي بتعدّل عليه
js/store.js       البيانات والحسابات والمزامنة
js/app.js         الواجهات
manifest.json     ليشتغل كتطبيق على الموبايل
.nojekyll         ضروري لـ GitHub Pages
```

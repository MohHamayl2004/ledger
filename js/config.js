/* ============================================================
   ملف الإعدادات — هذا الملف الوحيد اللي بتعدّل عليه
   ============================================================ */

/* 1) المستخدمين
      صاروا حسابات حقيقية على Firebase (إيميل + كلمة سر).
      لإضافة شخص جديد شوف README → «إضافة مستخدم». */

/* 2) الإعدادات الافتراضية لدفتر الحسابات
      (بتقدر تغيّرها كمان من داخل الموقع → الإعدادات) */
export const DEFAULTS = {
  defaultCap: 5700,       // سقف الاستقبال الشهري الافتراضي لكل حساب
  readyThreshold: 100,    // إذا الرصيد نزل تحت هالرقم → الحساب "جاهز"
  returnDelayDays: 2,     // بعد كم يوم بتنضاف "القطعة الراجعة" للرصيد
  counterMin: 1650,       // أقل مبلغ خصم بيحسب طلبية في الكاونتر
  counterMax: 1750,       // أعلى مبلغ خصم بيحسب طلبية في الكاونتر
  currency: "₪"
};

/* 3) إعدادات Firebase — مشروع: ledger-375cb
      (هاي القيم مش سرّية؛ الحماية الحقيقية بقواعد Firestore بملف firestore.rules) */
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCwl5clICUQspKA0v6B-ZZA9u28t6RXqGs",
  authDomain: "ledger-375cb.firebaseapp.com",
  projectId: "ledger-375cb",
  storageBucket: "ledger-375cb.firebasestorage.app",
  messagingSenderId: "864369781592",
  appId: "1:864369781592:web:6171b2b5a6d9674fca532d"
};

/* 4) رابط الوسيط تبع يونايتد (Cloudflare Worker)
      بعد ما ترفع ملف worker/united-proxy.js حط الرابط هون، مثلاً:
      "https://united-proxy.اسمك.workers.dev" */
export const UNITED_PROXY = "https://united-proxy.palestiniantemu.workers.dev";

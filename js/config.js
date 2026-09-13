/* ============================================================
   ملف الإعدادات — هذا الملف الوحيد اللي بتعدّل عليه
   ============================================================ */

/* 1) المستخدمين المسموح لهم بالدخول
      غيّر الاسم أو كلمة المرور من هون */
export const USERS = [
  { user: "mohammad", pass: "123", name: "محمد" },
  { user: "razan",    pass: "123", name: "رزان" }
];

/* 2) الإعدادات الافتراضية للنظام
      (بتقدر تغيّرها كمان من داخل الموقع → الإعدادات) */
export const DEFAULTS = {
  defaultCap: 5700,       // سقف الاستقبال الشهري الافتراضي لكل حساب
  readyThreshold: 100,    // إذا الرصيد نزل تحت هالرقم → الحساب "جاهز"
  returnDelayDays: 2,     // بعد كم يوم بتنضاف "القطعة الراجعة" للرصيد
  counterMin: 1650,       // أقل مبلغ خصم بيحسب طلبية في الكاونتر
  counterMax: 1750,       // أعلى مبلغ خصم بيحسب طلبية في الكاونتر
  currency: "₪"
};

/* 3) إعدادات Firebase — المزامنة بين محمد ورزان
      مشروع: ledger-375cb */
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCwl5clICUQspKA0v6B-ZZA9u28t6RXqGs",
  authDomain: "ledger-375cb.firebaseapp.com",
  projectId: "ledger-375cb",
  storageBucket: "ledger-375cb.firebasestorage.app",
  messagingSenderId: "864369781592",
  appId: "1:864369781592:web:6171b2b5a6d9674fca532d"
};

/* ============================================================
   Firebase — تهيئة مشتركة لكل صفحات الموقع
   تسجيل دخول حقيقي (إيميل + كلمة سر) وتخزين يشتغل بدون نت
   ============================================================ */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, setPersistence, browserLocalPersistence, connectAuthEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  doc, getDoc, getDocFromServer, setDoc, updateDoc, deleteDoc, collection, onSnapshot,
  writeBatch, getDocs, query, orderBy, limit, connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { FIREBASE_CONFIG } from './config.js';

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

/* نسخة محلية من البيانات على الجهاز (IndexedDB):
   الموقع بيفتح وبيشتغل حتى لو النت مقطوع، وبيزامن لما يرجع */
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  console.warn('التخزين المحلي غير متاح — رح نشتغل بالذاكرة فقط', e);
  db = initializeFirestore(app, { localCache: memoryLocalCache() });
}
export { db };

/* للتجربة على الجهاز فقط: localhost + localStorage.useEmulator=1 → Firebase Emulator */
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && localStorage.getItem('useEmulator') === '1') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8081);
}

export const fs = {
  doc, getDoc, getDocFromServer, setDoc, updateDoc, deleteDoc, collection, onSnapshot,
  writeBatch, getDocs, query, orderBy, limit
};

/** بيستنى أول ما Firebase يقرّر إذا في مستخدم مسجّل أو لا */
export function currentUser(){
  return new Promise(resolve => {
    const off = onAuthStateChanged(auth, u => { off(); resolve(u); });
  });
}

export const onUser = cb => onAuthStateChanged(auth, cb);

export async function login(email, password){
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export const logout = () => signOut(auth);
export const resetPassword = email => sendPasswordResetEmail(auth, email.trim());

/**
 * عضوية الموقع: لازم يكون للمستخدم مستند في members/{uid}
 * (بتضيفه إنت من لوحة Firebase). بيرجع { name } أو null.
 */
export async function membership(user){
  if(!user) return null;
  const ref = doc(db, 'members', user.uid);
  const fallback = (user.email || '').split('@')[0];
  let snap;
  try{
    // مباشرة بعد تسجيل الدخول (خصوصاً مع أكثر من تبويب مفتوح) ممكن Firestore
    // لسا ما استلم الدخول الجديد فبيرفض. منجدّد التوكن ومنعيد المحاولة قبل ما نحكم.
    for(let attempt = 0; ; attempt++){
      try{ snap = await getDocFromServer(ref); break; }
      catch(e){
        if(!(e && e.code === 'permission-denied') || attempt >= 3) throw e;
        await user.getIdToken(true).catch(() => {});
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }catch(e){
    console.warn('membership check failed', e && e.code, e);
    if(e && e.code === 'permission-denied') return null;
    // ما قدرنا نتأكد (بدون نت مثلاً): منكمّل بالنسخة المحفوظة. هذا مش «رفض» —
    // قواعد Firestore بتضل تحمي البيانات على السيرفر بكل الأحوال.
    try{ snap = await getDoc(ref); }catch(_){ return { name: fallback, unverified: true }; }
    if(!snap.exists()) return { name: fallback, unverified: true };
  }
  if(!snap.exists()) return null;
  const d = snap.data() || {};
  return { name: d.name || fallback };
}

/** رسائل أخطاء تسجيل الدخول بالعربي */
export function authError(e){
  const c = (e && e.code) || '';
  if(/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return 'الإيميل أو كلمة المرور غير صحيحة';
  if(/too-many-requests/.test(c)) return 'محاولات كثيرة — استنى شوي وجرّب مرة ثانية';
  if(/network-request-failed/.test(c)) return 'ما في اتصال بالإنترنت';
  if(/user-disabled/.test(c)) return 'هذا الحساب موقوف';
  return 'تعذّر تسجيل الدخول' + (c ? ` (${c})` : '');
}

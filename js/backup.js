/* ============================================================
   نسخة احتياطية أسبوعية بتنزل لحالها على الجهاز
   ------------------------------------------------------------
   أول ما المستخدم يفتح الموقع (الدفتر أو الطلبيات)، إذا صار
   أسبوع من آخر نسخة، بينزل ملف JSON فيه:
     • دفتر الحسابات المشترك (الأشخاص + الحركات + الإعدادات)
     • طلبيات هذا المستخدم (الزباين، الطلبيات، الأرصدة، الرسوم…)
   تاريخ آخر نسخة محفوظ على حساب المستخدم، فكل حساب إله نسخته.
   ============================================================ */
import { db, fs } from './fb.js';

const EVERY_DAYS = 7;
const ORDER_COLS = ['customers', 'orders', 'ledgers', 'expenses', 'shipments'];

const fromDoc = (d) => (d && typeof d.__json === 'string' ? JSON.parse(d.__json) : d);
const rows = (snap) => snap.docs.map((d) => Object.assign({}, fromDoc(d.data()), { id: d.id }));

/** بيجمع كل بيانات المستخدم بملف واحد */
export async function collectBackup(user) {
  const [people, tx, ledgerSettings] = await Promise.all([
    fs.getDocs(fs.collection(db, 'people')),
    fs.getDocs(fs.collection(db, 'tx')),
    fs.getDoc(fs.doc(db, 'meta', 'settings'))
  ]);
  const orders = {};
  await Promise.all(ORDER_COLS.map(async (c) => {
    orders[c] = rows(await fs.getDocs(fs.collection(db, 'users', user.uid, c)));
  }));
  const os = await fs.getDoc(fs.doc(db, 'users', user.uid, 'meta', 'settings'));
  orders.settings = os.exists() ? fromDoc(os.data()) : {};
  orders.version = 1;

  return {
    app: 'ledger+orders',
    kind: 'weekly-backup',
    exportedAt: new Date().toISOString(),
    account: user.email || user.uid,
    // نفس شكل «تنزيل نسخة احتياطية» بالدفتر — بينفع للاستيراد هناك
    ledger: {
      app: 'ledger', version: 1,
      people: rows(people), tx: rows(tx),
      settings: ledgerSettings.exists() ? ledgerSettings.data() : {}
    },
    // نفس شكل «تصدير نسخة» بصفحة الطلبيات — بينفع للاستيراد هناك
    orders
  };
}

function download(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

export function backupFileName(user) {
  const who = String((user && user.email) || 'user').split('@')[0].replace(/[^\w.-]+/g, '_');
  return `نسخة-أسبوعية-${who}-${new Date().toISOString().slice(0, 10)}.json`;
}

/** بينزّل نسخة الآن (بدون ما يسأل عن التاريخ) ويسجّل الموعد */
export async function downloadBackupNow(user) {
  const data = await collectBackup(user);
  download(backupFileName(user), JSON.stringify(data, null, 2));
  await fs.setDoc(fs.doc(db, 'users', user.uid, 'meta', 'backupInfo'), { lastDownload: new Date().toISOString() }, { merge: true });
  return data;
}

/**
 * بيتفقّد إذا صار أسبوع من آخر نسخة، وإذا آه بينزّلها.
 * بيرجع تاريخ النسخة إذا نزلت، أو null.
 */
let running = false;
export async function weeklyBackupIfDue(user) {
  if (!user || running || !navigator.onLine) return null;
  running = true;
  try {
    const ref = fs.doc(db, 'users', user.uid, 'meta', 'backupInfo');
    const snap = await fs.getDocFromServer(ref);
    const last = snap.exists() ? Date.parse(snap.data().lastDownload || '') : NaN;
    if (Number.isFinite(last) && Date.now() - last < EVERY_DAYS * 86400000) return null;
    await downloadBackupNow(user);
    return new Date();
  } catch (e) {
    console.warn('weekly backup', e);
    return null;
  } finally {
    running = false;
  }
}

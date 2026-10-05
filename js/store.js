/* ============================================================
   طبقة البيانات — تشتغل محلياً أو مع Firebase (مزامنة لحظية)
   ============================================================ */
import { DEFAULTS } from './config.js';

const LS_KEY = 'ledger_data_v1';

const state = {
  people: [],
  tx: [],
  settings: { ...DEFAULTS }
};

let mode = 'local';          // 'local' | 'cloud'
let cloud = null;            // { db, fns... }
const subs = new Set();

export const getMode = () => mode;
export const people = () => state.people;
export const txs = () => state.tx;
export const settings = () => state.settings;

export function subscribe(fn){ subs.add(fn); return () => subs.delete(fn); }
function emit(){ subs.forEach(f => { try { f(); } catch(e){ console.error(e); } }); }

const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

/* ─────────── التخزين المحلي ─────────── */
function loadLocal(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return;
    const d = JSON.parse(raw);
    state.people   = Array.isArray(d.people) ? d.people : [];
    state.tx       = Array.isArray(d.tx) ? d.tx : [];
    state.settings = { ...DEFAULTS, ...(d.settings || {}) };
  }catch(e){ console.warn('تعذّرت قراءة البيانات المحلية', e); }
}
function saveLocal(){
  if(mode === 'cloud') return;
  try{
    localStorage.setItem(LS_KEY, JSON.stringify({
      people: state.people, tx: state.tx, settings: state.settings
    }));
  }catch(e){ console.warn('تعذّر الحفظ المحلي', e); }
}

/* ─────────── التشغيل ─────────── */
/* الدفتر مشترك بين كل الأعضاء: people / tx / meta بأعلى قاعدة البيانات.
   الدخول لازم يكون بحساب حقيقي (شوف js/fb.js). */
let unsubs = [];
let ready = false;

export async function initStore(){
  if(ready) return mode;
  await initCloud();
  mode = 'cloud';
  ready = true;
  emit();
  return mode;
}

/** عند تسجيل الخروج: نوقف الاستماع ونفضّي الذاكرة */
export function stopStore(){
  unsubs.forEach(u => { try{ u(); }catch(_){} });
  unsubs = [];
  ready = false;
  state.people = []; state.tx = []; state.settings = { ...DEFAULTS };
}

async function initCloud(){
  const { db, fs } = await import('./fb.js');
  cloud = { db, ...fs };

  await new Promise((resolve, reject) => {
    let got = 0;
    const tick = () => { if(++got >= 2) resolve(); };
    const fail = err => {
      console.error(err);
      if(err && err.code === 'permission-denied') reject(err); else tick();
    };
    unsubs.push(cloud.onSnapshot(cloud.collection(db, 'people'), snap => {
      state.people = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      emit(); tick();
    }, fail));

    unsubs.push(cloud.onSnapshot(cloud.collection(db, 'tx'), snap => {
      state.tx = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      emit(); tick();
    }, fail));

    unsubs.push(cloud.onSnapshot(cloud.doc(db, 'meta', 'settings'), snap => {
      state.settings = { ...DEFAULTS, ...(snap.exists() ? snap.data() : {}) };
      emit();
    }, err => console.error(err)));

    setTimeout(resolve, 6000); // ما نعلّق للأبد
  });
}

/* ─────────── الحسابات (الأشخاص) ─────────── */
const PALETTE = ['#6366f1','#ec4899','#f59e0b','#10b981','#06b6d4','#8b5cf6','#ef4444','#14b8a6','#f97316','#3b82f6'];

export async function addPerson({ name, phone = '', monthlyCap = null, note = '' }){
  const p = {
    id: uid(),
    name: name.trim(),
    phone: phone.trim(),
    monthlyCap: monthlyCap === null || monthlyCap === '' ? null : Number(monthlyCap),
    note: note.trim(),
    color: PALETTE[state.people.length % PALETTE.length],
    createdAt: new Date().toISOString()
  };
  if(mode === 'cloud'){
    const { id, ...data } = p;
    await cloud.setDoc(cloud.doc(cloud.db, 'people', id), data);
  }else{
    state.people.push(p); saveLocal(); emit();
  }
  return p;
}

export async function updatePerson(id, patch){
  if(mode === 'cloud'){
    await cloud.updateDoc(cloud.doc(cloud.db, 'people', id), patch);
  }else{
    const p = state.people.find(x => x.id === id);
    if(p) Object.assign(p, patch);
    saveLocal(); emit();
  }
}

export async function removePerson(id){
  if(mode === 'cloud'){
    const related = state.tx.filter(t => t.personId === id);
    await Promise.all(related.map(t => cloud.deleteDoc(cloud.doc(cloud.db, 'tx', t.id))));
    await cloud.deleteDoc(cloud.doc(cloud.db, 'people', id));
  }else{
    state.people = state.people.filter(p => p.id !== id);
    state.tx = state.tx.filter(t => t.personId !== id);
    saveLocal(); emit();
  }
}

/* ─────────── أيام الدوام ─────────── */
/* الجمعة والسبت عطلة — ما بينعدّوا ضمن أيام إرجاع القطعة */
const WEEKEND = [5, 6]; // getDay(): الجمعة = 5، السبت = 6

/** بيضيف n يوم دوام على التاريخ (بيتخطّى الجمعة والسبت) */
export function addWorkdays(date, n){
  const d = new Date(date);
  let left = Math.max(0, Math.round(Number(n) || 0));
  while(left > 0){
    d.setDate(d.getDate() + 1);
    if(!WEEKEND.includes(d.getDay())) left--;
  }
  return d;
}

/**
 * موعد رجوع القطعة. الحركات القديمة كانت تنحسب بأيام عادية —
 * منعيد حسابها بأيام الدوام بنفس عدد الأيام اللي انحفظ وقتها.
 */
export function releaseOf(t){
  if(!t || !t.releaseDate) return null;
  if(t.releaseRule === 'workdays') return new Date(t.releaseDate);
  const base = new Date(t.date);
  const n = Math.round((new Date(t.releaseDate) - base) / 86400000);
  return addWorkdays(base, n);
}

/* ─────────── الحركات ─────────── */
/* type 'in'  → إيداع: بترصد فوراً
   type 'out' → طلبية: orderPrice بتنخصم فوراً،
                returnPrice بتنضاف بعد returnDelayDays يوم */
export async function addTx(input){
  const now = new Date();
  const date = input.date ? new Date(input.date + 'T' + now.toTimeString().slice(0,8)) : now;
  const t = {
    id: uid(),
    personId: input.personId,
    type: input.type,
    amount: Number(input.amount || 0),
    orderPrice: Number(input.orderPrice || 0),
    returnPrice: Number(input.returnPrice || 0),
    note: (input.note || '').trim(),
    by: input.by || '',
    date: date.toISOString(),
    createdAt: now.toISOString(),
    releaseDate: null
  };
  if(t.type === 'out' && t.returnPrice > 0){
    const rel = new Date(date);
    t.releaseDate = addWorkdays(date, Number(state.settings.returnDelayDays || 3)).toISOString();
    t.releaseRule = 'workdays';
  }
  if(mode === 'cloud'){
    const { id, ...data } = t;
    await cloud.setDoc(cloud.doc(cloud.db, 'tx', id), data);
  }else{
    state.tx.push(t); saveLocal(); emit();
  }
  return t;
}

export async function removeTx(id){
  if(mode === 'cloud'){
    await cloud.deleteDoc(cloud.doc(cloud.db, 'tx', id));
  }else{
    state.tx = state.tx.filter(t => t.id !== id);
    saveLocal(); emit();
  }
}

/* ─────────── الإعدادات ─────────── */
export async function saveSettings(patch){
  const next = { ...state.settings, ...patch };
  if(mode === 'cloud'){
    await cloud.setDoc(cloud.doc(cloud.db, 'meta', 'settings'), next);
  }else{
    state.settings = next; saveLocal(); emit();
  }
}

/* ─────────── الحسابات الرياضية ─────────── */
export function monthKey(d = new Date()){
  const x = (d instanceof Date) ? d : new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0');
}

export function capOf(p){
  return (p && p.monthlyCap != null && p.monthlyCap !== '') ? Number(p.monthlyCap)
                                                            : Number(state.settings.defaultCap);
}

/**
 * كل أرقام حساب واحد.
 * mk = الشهر المطلوب (افتراضي: الشهر الحالي)
 */
export function statsOf(personId, mk = monthKey()){
  const s = state.settings;
  const p = state.people.find(x => x.id === personId);
  const now = new Date();
  let balance = 0, pending = 0, pendingCount = 0;
  let monthIn = 0, monthOut = 0, orders = 0;
  let totalIn = 0, totalOut = 0, totalBack = 0;
  let lastDate = null;

  for(const t of state.tx){
    if(t.personId !== personId) continue;
    const d = new Date(t.date);
    const inMonth = monthKey(d) === mk;
    if(!lastDate || d > lastDate) lastDate = d;

    if(t.type === 'in'){
      balance += t.amount; totalIn += t.amount;
      if(inMonth) monthIn += t.amount;
    }else{
      balance -= t.orderPrice; totalOut += t.orderPrice;
      if(inMonth){
        monthOut += t.orderPrice;
        if(t.orderPrice >= s.counterMin && t.orderPrice <= s.counterMax) orders++;
      }
      if(t.returnPrice > 0){
        const rel = releaseOf(t) || d;
        if(rel <= now){ balance += t.returnPrice; totalBack += t.returnPrice; }
        else { pending += t.returnPrice; pendingCount++; }
      }
    }
  }
  const cap = capOf(p);
  return {
    balance: round2(balance),
    pending: round2(pending), pendingCount,
    monthIn: round2(monthIn), monthOut: round2(monthOut),
    cap, capLeft: round2(cap - monthIn), capUsedPct: cap > 0 ? Math.min(100, (monthIn / cap) * 100) : 0,
    orders,
    totalIn: round2(totalIn), totalOut: round2(totalOut), totalBack: round2(totalBack),
    ready: balance < Number(s.readyThreshold),
    lastDate
  };
}

export function globalStats(mk = monthKey()){
  let balance = 0, pending = 0, pendingCount = 0, ready = 0, orders = 0, monthIn = 0, monthOut = 0;
  for(const p of state.people){
    const st = statsOf(p.id, mk);
    balance += st.balance; pending += st.pending; pendingCount += st.pendingCount;
    orders += st.orders; monthIn += st.monthIn; monthOut += st.monthOut;
    if(st.ready) ready++;
  }
  return {
    balance: round2(balance), pending: round2(pending), pendingCount,
    ready, orders, monthIn: round2(monthIn), monthOut: round2(monthOut),
    peopleCount: state.people.length
  };
}

/** القطع الراجعة اللي لسه ما انضافت — مرتبة حسب تاريخ الإضافة */
export function pendingReturns(){
  const now = new Date();
  return state.tx
    .filter(t => t.type === 'out' && t.returnPrice > 0 && t.releaseDate && releaseOf(t) > now)
    .map(t => {
      const rel = releaseOf(t);
      const days = Math.max(0, Math.ceil((rel - now) / 86400000));
      const p = state.people.find(x => x.id === t.personId);
      return { ...t, rel, days, personName: p ? p.name : '—', color: p ? p.color : '#888' };
    })
    .sort((a, b) => a.rel - b.rel);
}

export function personTx(personId){
  return state.tx.filter(t => t.personId === personId)
                 .sort((a, b) => new Date(b.date) - new Date(a.date));
}

export function allMonths(){
  const set = new Set(state.tx.map(t => monthKey(new Date(t.date))));
  set.add(monthKey());
  return [...set].sort().reverse();
}

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/* ─────────── نسخ احتياطي ─────────── */
export function exportData(){
  return JSON.stringify({
    app: 'ledger', version: 1, exportedAt: new Date().toISOString(),
    people: state.people, tx: state.tx, settings: state.settings
  }, null, 2);
}

export async function importData(json){
  const d = JSON.parse(json);
  if(!d.people || !d.tx) throw new Error('ملف غير صالح');
  if(mode === 'cloud'){
    for(const p of d.people){ const { id, ...data } = p; await cloud.setDoc(cloud.doc(cloud.db, 'people', id || uid()), data); }
    for(const t of d.tx){ const { id, ...data } = t; await cloud.setDoc(cloud.doc(cloud.db, 'tx', id || uid()), data); }
    if(d.settings) await cloud.setDoc(cloud.doc(cloud.db, 'meta', 'settings'), { ...DEFAULTS, ...d.settings });
  }else{
    state.people = d.people;
    state.tx = d.tx;
    state.settings = { ...DEFAULTS, ...(d.settings || {}) };
    saveLocal(); emit();
  }
}

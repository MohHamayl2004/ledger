/* منطق الحسابات — يعمل في Node وفي المتصفح */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.Calc = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  /**
   * ربح الطلبية الواحدة.
   * settings.deliveryCountsInProfit : هل يُضاف سعر التوصيل للربح
   * settings.returnPolicy : full_price | full_price_and_delivery | delivery_only | none
   */
  /** تكلفة نقطة الاستلام إن وُجدت (تُخصم من الربح) */
  function pickupCost(order, settings) {
    if (!order || order.deliveryType !== 'pickup') return 0;
    const s = settings || {};
    const fee = s.pickupFee === undefined ? 5 : num(s.pickupFee);
    return round2(fee);
  }

  function orderProfit(order, settings) {
    const s = settings || {};
    const price = num(order.price);
    const delivery = num(order.deliveryPrice);
    const pct = num(order.profitPercent);
    const base = round2((price * pct) / 100);
    const deliveryPart = s.deliveryCountsInProfit ? delivery : 0;
    const pickup = pickupCost(order, s);

    if (order.status === 'delivered') return round2(base + deliveryPart - pickup);

    if (order.status === 'returned') {
      switch (s.returnPolicy || 'full_price') {
        case 'full_price_and_delivery': return round2(-(price + delivery) - pickup);
        case 'delivery_only': return round2(-delivery - pickup);
        case 'none': return round2(-pickup);
        case 'full_price':
        default: return round2(-price - pickup);
      }
    }
    return 0; // قيد الانتظار
  }

  /** الربح المتوقّع لو تم تسليم الطلبية */
  function expectedProfit(order, settings) {
    return orderProfit(Object.assign({}, order, { status: 'delivered' }), settings);
  }

  /** مفتاح الشهر YYYY-MM من تاريخ الطلبية */
  function monthKey(dateStr) {
    if (!dateStr) return '';
    return String(dateStr).slice(0, 7);
  }

  /** تصفية الطلبيات ضمن مدى شهور شامل الطرفين */
  function inRange(order, fromMonth, toMonth) {
    const k = monthKey(order.date);
    if (!k) return false;
    if (fromMonth && k < fromMonth) return false;
    if (toMonth && k > toMonth) return false;
    return true;
  }

  /** ملخّص مجموعة طلبيات */
  function summarize(orders, settings) {
    const out = {
      count: orders.length,
      delivered: 0,
      returned: 0,
      pending: 0,
      pieces: 0,
      pickup: 0,         // عدد طلبيات نقطة الاستلام
      pickupCost: 0,     // مجموع تكلفة نقاط الاستلام
      sales: 0,          // مجموع أسعار الطلبيات المسلّمة
      deliveryFees: 0,   // مجموع أجور التوصيل للمسلّمة
      grossProfit: 0,    // ربح الطلبيات المسلّمة
      losses: 0,         // خسائر الراجعة (قيمة موجبة)
      netProfit: 0,      // الصافي
      expectedPending: 0 // الربح المتوقع من قيد الانتظار
    };
    for (const o of orders) {
      const p = orderProfit(o, settings);
      out.pieces += num(o.pieces);
      if (o.deliveryType === 'pickup') {
        out.pickup++;
        if (o.status !== 'pending') out.pickupCost += pickupCost(o, settings);
      }
      if (o.status === 'delivered') {
        out.delivered++;
        out.sales += num(o.price);
        out.deliveryFees += num(o.deliveryPrice);
        out.grossProfit += p;
      } else if (o.status === 'returned') {
        out.returned++;
        out.losses += Math.abs(p);
      } else {
        out.pending++;
        out.expectedPending += expectedProfit(o, settings);
      }
      out.netProfit += p;
    }
    for (const k of ['sales', 'deliveryFees', 'grossProfit', 'losses', 'netProfit', 'expectedPending', 'pickupCost']) {
      out[k] = round2(out[k]);
    }
    return out;
  }

  /** تجميع حسب الشهر → [{month, ...summary}] مرتب تصاعدياً */
  function byMonth(orders, settings) {
    const map = new Map();
    for (const o of orders) {
      const k = monthKey(o.date);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(o);
    }
    return [...map.keys()].sort().map((m) => Object.assign({ month: m }, summarize(map.get(m), settings)));
  }

  /* ------------------------- المصاريف (مستقلة عن الطلبيات) ------------------------- */

  /** تصفية المصاريف ضمن مدى شهور شامل الطرفين */
  function expensesInRange(expenses, fromMonth, toMonth) {
    return (expenses || []).filter((e) => {
      const k = monthKey(e.date);
      if (!k) return false;
      if (fromMonth && k < fromMonth) return false;
      if (toMonth && k > toMonth) return false;
      return true;
    });
  }

  /** ملخّص المصاريف مع تفصيل حسب النوع */
  function summarizeExpenses(expenses) {
    const list = expenses || [];
    const byType = new Map();
    let total = 0;
    for (const e of list) {
      const a = round2(Math.abs(num(e.amount)));
      total += a;
      const t = e.type || 'غير محدد';
      if (!byType.has(t)) byType.set(t, { type: t, total: 0, count: 0 });
      const row = byType.get(t);
      row.total = round2(row.total + a);
      row.count++;
    }
    return {
      count: list.length,
      total: round2(total),
      byType: [...byType.values()].sort((a, b) => b.total - a.total)
    };
  }

  /** الربح النهائي = ربح الطلبيات − المصاريف */
  function netAfterExpenses(ordersSummary, expensesSummary) {
    return round2(num(ordersSummary && ordersSummary.netProfit) - num(expensesSummary && expensesSummary.total));
  }

  /** تجميع المصاريف حسب الشهر */
  function expensesByMonth(expenses) {
    const map = new Map();
    for (const e of expenses || []) {
      const k = monthKey(e.date);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    const out = {};
    for (const [k, v] of map) out[k] = summarizeExpenses(v);
    return out;
  }

  /** رصيد شخص = مجموع الحركات */
  function ledgerBalance(ledger) {
    return round2((ledger.entries || []).reduce((a, e) => a + num(e.amount), 0));
  }

  /** تطبيع رقم الهاتف للمقارنة (أرقام فقط، مع تجاهل صفر البداية ورمز الدولة) */
  function normalizePhone(p) {
    let s = String(p || '')
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/\D/g, '');
    if (s.startsWith('00')) s = s.slice(2);
    if (s.startsWith('972')) s = s.slice(3);
    if (s.startsWith('970')) s = s.slice(3);
    if (s.startsWith('0')) s = s.slice(1);
    return s;
  }

  /* ================================================================
     الطلبيات الكبيرة (الشحنات) وتتبّع الطرود
     ================================================================ */

  /** مدة الانتظار المعتمدة لشحنة: الخاصة فيها، وإلا العامة، وإلا يومين */
  function waitDaysFor(shipment, settings) {
    const t = (settings && settings.tracking) || {};
    const own = shipment && shipment.waitDays;
    const v = own === null || own === undefined || own === '' ? t.waitDays : own;
    const n = num(v === undefined ? 2 : v);
    return n < 0 ? 0 : n;
  }

  /** تاريخ ووقت اكتمال مدة الانتظار (ISO) */
  function readyAt(parcel, days) {
    if (!parcel || !parcel.arrivedAt) return '';
    const t = Date.parse(parcel.arrivedAt);
    if (!Number.isFinite(t)) return '';
    return new Date(t + num(days) * 86400000).toISOString();
  }

  /** كم يوم باقي لحد ما يدخل قائمة «وصلت» (ممكن يكون صفر) */
  function daysLeft(parcel, days, now) {
    const r = readyAt(parcel, days);
    if (!r) return null;
    const ms = Date.parse(r) - (now ? new Date(now).getTime() : Date.now());
    return ms <= 0 ? 0 : Math.ceil(ms / 86400000);
  }

  /**
   * حالة الطرد:
   *   'ready'   وصل وخلصت مدة الانتظار → بقائمة «وصلت»
   *   'waiting' وصل وبعده بمدة الانتظار
   *   'transit' لسا بالطريق
   */
  function parcelState(parcel, shipment, settings, now) {
    if (!parcel) return 'transit';
    if (parcel.takenAt) return 'done';               // استلمته بإيدي — خلص
    if (!parcel.arrivedAt) return 'transit';
    const d = waitDaysFor(shipment, settings);
    const left = daysLeft(parcel, d, now);
    return left === 0 ? 'ready' : 'waiting';
  }

  /** إحصاء شحنة كاملة */
  function shipmentStats(shipment, settings, now) {
    const parcels = (shipment && shipment.parcels) || [];
    let transit = 0, waiting = 0, ready = 0, errors = 0, done = 0;
    for (const p of parcels) {
      if (p.error) errors++;
      const st = parcelState(p, shipment, settings, now);
      if (st === 'ready') ready++;
      else if (st === 'waiting') waiting++;
      else if (st === 'done') done++;
      else transit++;
    }
    const orderIds = new Set((shipment && shipment.orderIds) || []);
    for (const p of parcels) for (const id of (p.orderIds || [])) orderIds.add(id);
    return {
      parcels: parcels.length,
      transit, waiting, ready, errors, done,
      orders: orderIds.size,
      orderIds: [...orderIds],
      received: !!(shipment && shipment.receivedAt),
      allArrived: parcels.length > 0 && transit === 0
    };
  }

  /** كل الطرود اللي خلصت مدة انتظارها — قائمة «وصلت» */
  function readyParcels(shipments, settings, now) {
    const out = [];
    for (const sh of shipments || []) {
      for (const p of sh.parcels || []) {
        if (parcelState(p, sh, settings, now) === 'ready') {
          out.push({ shipmentId: sh.id, shipmentName: sh.name, parcel: p });
        }
      }
    }
    return out.sort((a, b) => String(b.parcel.arrivedAt || '').localeCompare(String(a.parcel.arrivedAt || '')));
  }

  /** هل حان وقت الفحص التلقائي؟ */
  function dueForCheck(settings, now) {
    const t = (settings && settings.tracking) || {};
    if (t.autoCheck === false) return false;
    if (!t.lastCheck) return true;
    const last = Date.parse(t.lastCheck);
    if (!Number.isFinite(last)) return true;
    const hours = num(t.checkHours === undefined ? 6 : t.checkHours) || 6;
    return (now ? new Date(now).getTime() : Date.now()) - last >= hours * 3600000;
  }

  return {
    num, round2, orderProfit, expectedProfit, pickupCost, monthKey, inRange,
    summarize, byMonth, ledgerBalance, normalizePhone,
    expensesInRange, summarizeExpenses, expensesByMonth, netAfterExpenses,
    waitDaysFor, readyAt, daysLeft, parcelState, shipmentStats, readyParcels, dueForCheck
  };
});

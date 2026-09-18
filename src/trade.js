// Wirtualne śledzenie sygnału – ta sama logika w backteście (świece 15m) i na żywo (świece 1m).
// Plan: limit na cenie wejścia, 50% zamknięte na TP1 i SL przesunięty na wejście, reszta na TP2.
// Gdy w jednej świecy padły i SL, i TP – liczymy SL (ostrożnie). Wynik w R (1R = strata na stop lossie).
import { BAR_SEC } from './strategies/common.js';

export function newTrade(symbol, sig, prm) {
  const closeT = sig.t + BAR_SEC;
  return {
    id: `${symbol}-${sig.t}`,
    symbol,
    ...sig,
    maxHoldHours: prm.maxHoldHours,
    status: 'pending', // pending → open → tp1 → closed
    result: null,      // expired | sl | be | tp2 | timeout
    validUntil: closeT + prm.validityMinutes * 60,
    lastT: closeT - 1,
    r: 0,
  };
}

/** Przetwarza jedną zamkniętą świecę (k.t = początek, dur = długość w s). Zwraca listę zdarzeń. */
export function advance(tr, k, dur, costs) {
  const events = [];
  if (tr.status === 'closed' || k.t <= tr.lastT) return events;
  tr.lastT = k.t;
  const long = tr.side === 'LONG';
  const risk = Math.abs(tr.entry - tr.sl);
  const gainR = (price) => (Math.abs(price - tr.entry) / risk);

  const close = (result, r, t = k.t + dur) => {
    tr.r += r - (2 * costs.feeRate * tr.entry) / risk;
    tr.status = 'closed';
    tr.result = result;
    tr.closedT = t;
    events.push(result);
  };

  if (tr.status === 'pending') {
    if (k.t >= tr.validUntil) {
      tr.status = 'closed';
      tr.result = 'expired';
      tr.closedT = tr.validUntil;
      events.push('expired');
      return events;
    }
    if (long ? k.l > tr.entry : k.h < tr.entry) return events;
    tr.status = 'open';
    tr.filledT = k.t;
    events.push('filled');
    if (long ? k.l <= tr.sl : k.h >= tr.sl) close('sl', -1 - costs.slippageR);
    return events;
  }

  const stop = tr.status === 'tp1' ? tr.entry : tr.sl;
  const target = tr.status === 'open' ? tr.tp1 : tr.tp2;
  if (long ? k.l <= stop : k.h >= stop) {
    if (tr.status === 'open') close('sl', -1 - costs.slippageR);
    else close('be', 0);
  } else if (long ? k.h >= target : k.l <= target) {
    if (tr.status === 'open') {
      tr.r += 0.5 * gainR(tr.tp1);
      tr.status = 'tp1';
      events.push('tp1');
      if (long ? k.h >= tr.tp2 : k.l <= tr.tp2) close('tp2', 0.5 * gainR(tr.tp2));
    } else {
      close('tp2', 0.5 * gainR(tr.tp2));
    }
  } else if (k.t + dur - tr.filledT >= tr.maxHoldHours * 3600) {
    const part = tr.status === 'tp1' ? 0.5 : 1;
    tr.exitPrice = k.c;
    close('timeout', (part * (k.c - tr.entry) * (long ? 1 : -1)) / risk);
  }
  return events;
}

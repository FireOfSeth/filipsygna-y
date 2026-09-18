// Wybicie: zamknięcie świecy poza zakresem ostatnich `lookback` świec, z podwyższonym wolumenem,
// zgodnie z kierunkiem wyższego interwału (cena vs EMA50). Stop loss slAtr × ATR od wejścia.
import { finalize, finite } from './common.js';

export const breakout = {
  label: 'Wybicie z zakresu',
  defaults: {
    entryTf: 3600, htfTf: 14400,
    lookback: 48, minVolRatio: 1.5, maxExtensionAtr: 1.0, slAtr: 1.5,
    minSlPct: 0.4, maxSlPct: 6, tp1R: 1.5, tp2R: 3, validityMinutes: 60, maxHoldHours: 24,
  },

  signal({ E, H }, e, h, t, prm) {
    const L = prm.lookback;
    if (e < Math.max(60, L + 1)) return null;
    const k = E.c[e];
    const atrV = E.atr[e], e50 = E.ema50[e], e50h = H.ema50[h], hc = H.c[h].c;
    if (!finite(atrV, e50, e50h) || atrV <= 0) return null;
    const volRatio = E.volAvg[e - 1] > 0 ? k.v / E.volAvg[e - 1] : 0;
    if (volRatio < prm.minVolRatio) return null;

    let hh = -Infinity, ll = Infinity;
    for (let j = e - L; j < e; j++) {
      hh = Math.max(hh, E.c[j].h);
      ll = Math.min(ll, E.c[j].l);
    }
    const entry = k.c;
    const rangePct = ((hh - ll) / entry) * 100;
    const score = 40 + Math.min(volRatio, 5) * 8 + Math.min(E.adx[e] || 0, 50) * 0.4;
    const hours = (L * (prm.entryTf / 3600)).toFixed(0);

    if (k.c > hh && k.c - hh <= prm.maxExtensionAtr * atrV && k.c > e50 && hc > e50h) {
      return finalize({
        side: 'LONG', entry, t, prm, score, sl: entry - prm.slAtr * atrV,
        why: `wybicie ponad szczyt z ostatnich ${hours}h (zakres ${rangePct.toFixed(1)}%), wolumen ${volRatio.toFixed(1)}× średniej, wyższy interwał wzrostowy`,
      });
    }
    if (k.c < ll && ll - k.c <= prm.maxExtensionAtr * atrV && k.c < e50 && hc < e50h) {
      return finalize({
        side: 'SHORT', entry, t, prm, score, sl: entry + prm.slAtr * atrV,
        why: `wybicie poniżej dołka z ostatnich ${hours}h (zakres ${rangePct.toFixed(1)}%), wolumen ${volRatio.toFixed(1)}× średniej, wyższy interwał spadkowy`,
      });
    }
    return null;
  },
};

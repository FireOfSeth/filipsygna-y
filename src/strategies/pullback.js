// Korekta w trendzie: wejście w kierunku trendu wyższego interwału po zakończonej korekcie.
// LONG (SHORT lustrzanie):
//  1. Wyższy interwał: cena > EMA50 > EMA200 i EMA50 rośnie
//  2. Interwał wejścia: EMA21 > EMA50, ADX >= minAdx
//  3. Korekta: w ostatnich świecach cena dotknęła EMA21, a RSI spadło poniżej rsiPullback
//  4. Wznowienie: świeca wzrostowa zamyka się nad szczytem poprzedniej i nad EMA21, RSI > 50
//  5. Stop loss pod dołkiem korekty (min. minSlAtr ATR)
import { finalize, finite } from './common.js';

const tfName = (sec) => (sec >= 3600 ? `${sec / 3600}h` : `${sec / 60}m`);

export const pullback = {
  label: 'Korekta w trendzie',
  defaults: {
    entryTf: 900, htfTf: 3600,
    pullbackBars: 8, minAdx: 20, minVolRatio: 1.0, rsiPullback: 45, maxExtensionAtr: 1.0,
    slBufferAtr: 0.2, minSlAtr: 1.0, minSlPct: 0.4, maxSlPct: 4,
    tp1R: 1.5, tp2R: 3, validityMinutes: 30, maxHoldHours: 12,
  },

  signal({ E, H }, e, h, t, prm) {
    const L = prm.pullbackBars;
    if (e < Math.max(60, L + 1) || h < 3) return null;
    const k = E.c[e], prev = E.c[e - 1];
    const atrV = E.atr[e], adxV = E.adx[e], rsiV = E.rsi[e], e21 = E.ema21[e], e50 = E.ema50[e];
    const hc = H.c[h].c, e50h = H.ema50[h], e200h = H.ema200[h], slope = e50h - H.ema50[h - 3];
    if (!finite(atrV, adxV, rsiV, e21, e50, e50h, e200h, slope) || atrV <= 0) return null;
    if (adxV < prm.minAdx) return null;
    const volRatio = E.volAvg[e - 1] > 0 ? k.v / E.volAvg[e - 1] : 0;
    if (volRatio < prm.minVolRatio) return null;

    let minRsi = Infinity, maxRsi = -Infinity, fromAbove = false, fromBelow = false, low = k.l, high = k.h;
    for (let j = e - L; j < e; j++) {
      const c = E.c[j];
      minRsi = Math.min(minRsi, E.rsi[j]);
      maxRsi = Math.max(maxRsi, E.rsi[j]);
      if (c.l <= E.ema21[j]) fromAbove = true;
      if (c.h >= E.ema21[j]) fromBelow = true;
      low = Math.min(low, c.l);
      high = Math.max(high, c.h);
    }

    const entry = k.c;
    const trendPct = (Math.abs(e50h - e200h) / e200h) * 100;
    const score = Math.min(adxV, 50) + Math.min(volRatio, 4) * 8 + Math.min(trendPct, 5) * 3.6;
    const tf = tfName(prm.entryTf), htf = tfName(prm.htfTf);

    if (
      hc > e50h && e50h > e200h && slope > 0 && e21 > e50 && fromAbove && minRsi < prm.rsiPullback &&
      rsiV > 50 && k.c > k.o && k.c > prev.h && k.c > e21 && k.c - e21 <= prm.maxExtensionAtr * atrV
    ) {
      return finalize({
        side: 'LONG', entry, t, prm, score,
        sl: Math.min(low - prm.slBufferAtr * atrV, entry - prm.minSlAtr * atrV),
        why: `trend ${htf} wzrostowy (EMA50 > EMA200), korekta na ${tf} do EMA21 zakończona, ADX ${adxV.toFixed(0)}, wolumen ${volRatio.toFixed(1)}× średniej`,
      });
    }
    if (
      hc < e50h && e50h < e200h && slope < 0 && e21 < e50 && fromBelow && maxRsi > 100 - prm.rsiPullback &&
      rsiV < 50 && k.c < k.o && k.c < prev.l && k.c < e21 && e21 - k.c <= prm.maxExtensionAtr * atrV
    ) {
      return finalize({
        side: 'SHORT', entry, t, prm, score,
        sl: Math.max(high + prm.slBufferAtr * atrV, entry + prm.minSlAtr * atrV),
        why: `trend ${htf} spadkowy (EMA50 < EMA200), odbicie na ${tf} do EMA21 zakończone, ADX ${adxV.toFixed(0)}, wolumen ${volRatio.toFixed(1)}× średniej`,
      });
    }
    return null;
  },
};

// Powrót do średniej: w rynku bez wyraźnego trendu (niski ADX) cena zamyka się daleko poza
// wstęgą Bollingera przy skrajnym RSI – gramy odbicie w stronę średniej.
import { finalize, finite } from './common.js';

export const meanrev = {
  label: 'Powrót do średniej',
  defaults: {
    entryTf: 900, htfTf: 3600,
    bbMult: 2.5, rsiExtreme: 25, maxAdx: 25, slAtr: 1.0,
    minSlPct: 0.4, maxSlPct: 4, tp1R: 1, tp2R: 2, validityMinutes: 30, maxHoldHours: 6,
  },

  signal({ E }, e, h, t, prm) {
    if (e < 60) return null;
    const k = E.c[e];
    const atrV = E.atr[e], adxV = E.adx[e], rsiV = E.rsi[e], mid = E.sma20[e], sd = E.sd20[e];
    if (!finite(atrV, adxV, rsiV, mid, sd) || atrV <= 0 || sd <= 0 || adxV > prm.maxAdx) return null;

    const entry = k.c;
    const zDist = Math.abs(entry - mid) / sd;
    const score = 30 + Math.min(zDist, 4) * 10 + Math.abs(50 - rsiV) * 0.6;

    if (entry < mid - prm.bbMult * sd && rsiV < prm.rsiExtreme) {
      return finalize({
        side: 'LONG', entry, t, prm, score, sl: Math.min(k.l, entry) - prm.slAtr * atrV,
        why: `cena ${zDist.toFixed(1)} odchylenia poniżej średniej, RSI ${rsiV.toFixed(0)} (wyprzedanie), brak silnego trendu (ADX ${adxV.toFixed(0)})`,
      });
    }
    if (entry > mid + prm.bbMult * sd && rsiV > 100 - prm.rsiExtreme) {
      return finalize({
        side: 'SHORT', entry, t, prm, score, sl: Math.max(k.h, entry) + prm.slAtr * atrV,
        why: `cena ${zDist.toFixed(1)} odchylenia powyżej średniej, RSI ${rsiV.toFixed(0)} (wykupienie), brak silnego trendu (ADX ${adxV.toFixed(0)})`,
      });
    }
    return null;
  },
};

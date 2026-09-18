import { ema, sma, rsi, atr, adx, stdev } from '../indicators.js';

export const BAR_SEC = 900;

/** Skleja zamknięte świece 15m w pełne świece o długości sec (1h, 4h...). */
export function aggregate(c15, sec) {
  if (sec === BAR_SEC) return c15;
  const need = sec / BAR_SEC;
  const out = [];
  let cur = null;
  for (const k of c15) {
    const bt = Math.floor(k.t / sec) * sec;
    if (!cur || cur.t !== bt) {
      if (cur?.n === need) out.push(cur);
      cur = { t: bt, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v, n: 1 };
    } else {
      cur.h = Math.max(cur.h, k.h);
      cur.l = Math.min(cur.l, k.l);
      cur.c = k.c;
      cur.v += k.v;
      cur.n++;
    }
  }
  if (cur?.n === need) out.push(cur);
  return out;
}

function series(c) {
  const closes = c.map((k) => k.c);
  return {
    c,
    ema21: ema(closes, 21),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    rsi: rsi(closes, 14),
    atr: atr(c, 14),
    adx: adx(c, 14),
    volAvg: sma(c.map((k) => k.v), 20),
    sma20: sma(closes, 20),
    sd20: stdev(closes, 20),
  };
}

// Dla każdej świecy 15m: indeks ostatniej pełnej świecy zakończonej najpóźniej razem z nią (bez zaglądania w przyszłość)
function mapIndex(c15, bars, sec) {
  const idx = new Int32Array(c15.length);
  let j = -1;
  for (let i = 0; i < c15.length; i++) {
    const end = c15[i].t + BAR_SEC;
    while (j + 1 < bars.length && bars[j + 1].t + sec <= end) j++;
    idx[i] = j;
  }
  return idx;
}

/** Widok rynku: interwał wejścia (E) i interwał wyższy (H) z policzonymi wskaźnikami. */
export function buildView(c15, entryTf, htfTf) {
  const E = series(aggregate(c15, entryTf));
  const H = series(aggregate(c15, htfTf));
  return { c15, E, H, eIdx: mapIndex(c15, E.c, entryTf), hIdx: mapIndex(c15, H.c, htfTf) };
}

export const finite = (...xs) => xs.every(Number.isFinite);

export function finalize({ side, entry, sl, t, prm, score, why }) {
  const risk = Math.abs(entry - sl);
  const slPct = (risk / entry) * 100;
  if (!(risk > 0) || slPct < prm.minSlPct || slPct > prm.maxSlPct) return null;
  const dir = side === 'LONG' ? 1 : -1;
  return {
    side, t, entry, sl,
    tp1: entry + dir * prm.tp1R * risk,
    tp2: entry + dir * prm.tp2R * risk,
    slPct,
    score: Math.max(0, Math.min(100, Math.round(score))),
    why,
  };
}

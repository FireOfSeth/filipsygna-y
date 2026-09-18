// Wskaźniki techniczne (metody Wildera dla RSI/ATR/ADX). Wartości przed rozgrzaniem = NaN.

export function sma(values, period) {
  const out = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function stdev(values, period) {
  const out = new Array(values.length).fill(NaN);
  let sum = 0, sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    sumSq += values[i] * values[i];
    if (i >= period) {
      sum -= values[i - period];
      sumSq -= values[i - period] * values[i - period];
    }
    if (i >= period - 1) {
      const mean = sum / period;
      out[i] = Math.sqrt(Math.max(0, sumSq / period - mean * mean));
    }
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(values, period = 14) {
  const out = new Array(values.length).fill(NaN);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function trueRange(c, i) {
  if (i === 0) return c[0].h - c[0].l;
  const pc = c[i - 1].c;
  return Math.max(c[i].h - c[i].l, Math.abs(c[i].h - pc), Math.abs(c[i].l - pc));
}

export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(NaN);
  if (candles.length <= period) return out;
  let a = 0;
  for (let i = 1; i <= period; i++) a += trueRange(candles, i);
  a /= period;
  out[period] = a;
  for (let i = period + 1; i < candles.length; i++) {
    a = (a * (period - 1) + trueRange(candles, i)) / period;
    out[i] = a;
  }
  return out;
}

export function adx(candles, period = 14) {
  const n = candles.length;
  const out = new Array(n).fill(NaN);
  if (n < 2 * period + 1) return out;
  const dx = new Array(n).fill(NaN);
  let tr = 0, plusDm = 0, minusDm = 0;
  for (let i = 1; i < n; i++) {
    const up = candles[i].h - candles[i - 1].h;
    const down = candles[i - 1].l - candles[i].l;
    const pdm = up > down && up > 0 ? up : 0;
    const mdm = down > up && down > 0 ? down : 0;
    const t = trueRange(candles, i);
    if (i <= period) {
      tr += t; plusDm += pdm; minusDm += mdm;
      if (i < period) continue;
    } else {
      tr = tr - tr / period + t;
      plusDm = plusDm - plusDm / period + pdm;
      minusDm = minusDm - minusDm / period + mdm;
    }
    const pdi = tr ? (100 * plusDm) / tr : 0;
    const mdi = tr ? (100 * minusDm) / tr : 0;
    dx[i] = pdi + mdi ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
  }
  let a = 0;
  for (let i = period; i < 2 * period; i++) a += dx[i];
  a /= period;
  out[2 * period - 1] = a;
  for (let i = 2 * period; i < n; i++) {
    a = (a * (period - 1) + dx[i]) / period;
    out[i] = a;
  }
  return out;
}

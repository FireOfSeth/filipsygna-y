// Publiczne API kontraktów MEXC – nie wymaga kluczy ani logowania.
const BASE = 'https://contract.mexc.com/api/v1/contract';
const MIN_GAP_MS = 125; // ~8 zapytań/s (limit MEXC: 20 na 2 s)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let queue = Promise.resolve();
let lastCall = 0;

function throttle() {
  queue = queue
    .then(() => sleep(Math.max(0, lastCall + MIN_GAP_MS - Date.now())))
    .then(() => { lastCall = Date.now(); });
  return queue;
}

async function get(path, params = {}, attempt = 1) {
  await throttle();
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) throw new Error('limit zapytań (429)');
    const json = await res.json();
    if (!json.success) throw new Error(`MEXC ${path}: ${json.code} ${json.message ?? ''}`);
    return json.data;
  } catch (err) {
    if (attempt >= 4) throw err;
    await sleep(1500 * attempt);
    return get(path, params, attempt + 1);
  }
}

export async function getContracts() {
  const list = await get('/detail');
  const map = new Map();
  for (const c of list) {
    if (c.quoteCoin !== 'USDT' || c.settleCoin !== 'USDT' || c.state !== 0 || c.isHidden) continue;
    map.set(c.symbol, {
      symbol: c.symbol,
      contractSize: c.contractSize,
      minVol: c.minVol,
      volUnit: c.volUnit || 1,
      priceScale: c.priceScale,
      maxLeverage: c.maxLeverage,
      mmr: c.maintenanceMarginRate,
      takerFee: c.takerFeeRate,
    });
  }
  return map;
}

export async function getTickers() {
  return get('/ticker');
}

function toCandles(d) {
  if (!d?.time) return [];
  return d.time.map((t, i) => ({ t, o: d.open[i], h: d.high[i], l: d.low[i], c: d.close[i], v: d.vol[i] }));
}

/** Świece z zakresu [start, end] (sekundy). interval: Min1, Min15, Min60... Zwraca tylko zamknięte świece. */
export async function getKlines(symbol, interval, start, end = Math.floor(Date.now() / 1000)) {
  const sec = { Min1: 60, Min5: 300, Min15: 900, Min30: 1800, Min60: 3600, Hour4: 14400 }[interval];
  const window = 1999 * sec;
  const byTime = new Map();
  for (let s = start; s <= end; s += window + sec) {
    const data = await get(`/kline/${symbol}`, { interval, start: s, end: Math.min(s + window, end) });
    for (const k of toCandles(data)) byTime.set(k.t, k);
  }
  const now = Date.now() / 1000;
  return [...byTime.values()].filter((k) => k.t + sec <= now).sort((a, b) => a.t - b.t);
}

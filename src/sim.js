// Wspólny silnik testów historycznych: puszcza kilka wariantów strategii po świecach 15m jednej pary.
import path from 'node:path';
import { buildView, BAR_SEC } from './strategies/common.js';
import { signalAt } from './strategies/index.js';
import { newTrade, advance } from './trade.js';
import { getKlines } from './mexc.js';
import { readJson, writeJson, DATA_DIR } from './config.js';

export function runVariants(symbol, c15, variants, costs, cooldownHours) {
  const views = new Map();
  return variants.map((v) => {
    const key = `${v.prm.entryTf}/${v.prm.htfTf}`;
    if (!views.has(key)) views.set(key, buildView(c15, v.prm.entryTf, v.prm.htfTf));
    const view = views.get(key);
    const trades = [];
    let active = null, cooldownUntil = 0;
    for (let i = 1; i < c15.length; i++) {
      if (active) {
        advance(active, c15[i], BAR_SEC, costs);
        if (active.status === 'closed') { trades.push(active); active = null; }
        continue;
      }
      if (c15[i].t < cooldownUntil) continue;
      const sig = signalAt(view, i, v);
      if (sig) {
        active = newTrade(symbol, sig, v.prm);
        cooldownUntil = sig.t + cooldownHours * 3600;
      }
    }
    return trades;
  });
}

/** Świece 15m z pamięcią podręczną na dysku (ważna 12 h). */
export async function cachedCandles(symbol, days) {
  const file = path.join(DATA_DIR, 'cache', `${symbol}_15m_${days}d.json`);
  const cached = readJson(file, null);
  if (cached && Date.now() - cached.savedAt < 12 * 3600_000) return cached.candles;
  const end = Math.floor(Date.now() / 1000);
  const candles = await getKlines(symbol, 'Min15', end - days * 86400, end);
  writeJson(file, { savedAt: Date.now(), candles });
  return candles;
}

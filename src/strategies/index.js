import { BAR_SEC } from './common.js';
import { pullback } from './pullback.js';
import { breakout } from './breakout.js';
import { meanrev } from './meanrev.js';

export const STRATEGIES = { pullback, breakout, meanrev };

export function resolveStrategy(name, params = {}) {
  const st = STRATEGIES[name];
  if (!st) throw new Error(`Nieznana strategia "${name}". Dostępne: ${Object.keys(STRATEGIES).join(', ')}`);
  return { name, st, prm: { ...st.defaults, ...params } };
}

/** Sygnał na świecy 15m o indeksie i – tylko gdy właśnie zamknęła się świeca interwału wejścia. */
export function signalAt(view, i, { st, prm }) {
  const e = view.eIdx[i];
  if (e < 0 || view.E.c[e].t + prm.entryTf !== view.c15[i].t + BAR_SEC) return null;
  const h = view.hIdx[i];
  if (h < 0) return null;
  return st.signal(view, e, h, view.c15[i].t, prm);
}

/** Ile świec 15m potrzeba, żeby EMA200 na wyższym interwale była wiarygodna. */
export function warmupBars(prm) {
  return Math.ceil((230 * Math.max(prm.entryTf, prm.htfTf)) / BAR_SEC);
}

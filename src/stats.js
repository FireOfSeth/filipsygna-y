export function summarize(trades) {
  const closed = trades.filter((t) => t.status === 'closed');
  const taken = closed.filter((t) => t.result !== 'expired').sort((a, b) => a.filledT - b.filledT);
  const wins = taken.filter((t) => t.r > 0);
  const grossWin = wins.reduce((a, t) => a + t.r, 0);
  const grossLoss = -taken.filter((t) => t.r <= 0).reduce((a, t) => a + t.r, 0);
  const totalR = grossWin - grossLoss;

  let streak = 0, maxStreak = 0, cum = 0, peak = 0, maxDdR = 0;
  for (const t of taken) {
    streak = t.r <= 0 ? streak + 1 : 0;
    maxStreak = Math.max(maxStreak, streak);
    cum += t.r;
    peak = Math.max(peak, cum);
    maxDdR = Math.max(maxDdR, peak - cum);
  }
  const byResult = {};
  for (const t of closed) byResult[t.result] = (byResult[t.result] || 0) + 1;

  return {
    signals: trades.length,
    taken: taken.length,
    expired: byResult.expired || 0,
    wins: wins.length,
    winRate: taken.length ? (wins.length / taken.length) * 100 : 0,
    avgR: taken.length ? totalR / taken.length : 0,
    totalR,
    profitFactor: grossLoss ? grossWin / grossLoss : Infinity,
    maxLossStreak: maxStreak,
    maxDrawdownR: maxDdR,
    byResult,
  };
}

/** Symulacja kapitału: jedna pozycja naraz, każda transakcja ryzykuje riskPct aktualnego kapitału. */
export function equityCurve(trades, riskPct, capital) {
  const list = trades
    .filter((t) => t.status === 'closed' && t.result !== 'expired')
    .sort((a, b) => a.filledT - b.filledT);
  let eq = capital, peak = capital, maxDd = 0, busyUntil = 0, count = 0, minEq = capital;
  for (const t of list) {
    if (t.filledT < busyUntil) continue;
    busyUntil = t.closedT;
    count++;
    eq = Math.max(0, eq * (1 + (riskPct / 100) * t.r));
    peak = Math.max(peak, eq);
    minEq = Math.min(minEq, eq);
    maxDd = Math.max(maxDd, (peak - eq) / peak);
  }
  return { final: eq, returnPct: (eq / capital - 1) * 100, maxDrawdownPct: maxDd * 100, minEquity: minEq, trades: count };
}

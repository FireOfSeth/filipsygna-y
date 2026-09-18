// Uczciwe porównanie strategii: parametry wybierane na starszych danych (TRENING),
// sprawdzane na najnowszych, których wybór nie widział (TEST).
// Użycie: node src/research.js --days 180 --test-days 60
import path from 'node:path';
import { loadConfig, writeJson, DATA_DIR } from './config.js';
import { getTickers, getContracts } from './mexc.js';
import { resolveStrategy } from './strategies/index.js';
import { runVariants, cachedCandles } from './sim.js';
import { summarize, equityCurve } from './stats.js';

const args = Object.fromEntries(
  process.argv.slice(2).join(' ').split('--').filter(Boolean).map((a) => a.trim().split(/\s+/)),
);
const cfg = loadConfig();
const days = Number(args.days ?? 180);
const testDays = Number(args['test-days'] ?? 60);
const WARMUP_DAYS = 40; // EMA200 na 4h
const MIN_TRAIN_TRADES = 60;

const TP = [[1.5, 3], [1, 2], [2, 4]];
const variants = [];
const add = (name, family, params) => {
  const v = resolveStrategy(name, params);
  v.family = family;
  v.id = `${family} ${Object.entries(params).filter(([k]) => !['entryTf', 'htfTf', 'validityMinutes', 'minSlPct', 'maxSlPct'].includes(k)).map(([k, x]) => `${k}=${x}`).join(' ')}`;
  variants.push(v);
};
for (const [tp1R, tp2R] of TP) for (const maxHoldHours of [12, 24])
  add('pullback', 'pullback 15m/1h', { tp1R, tp2R, maxHoldHours });
for (const [tp1R, tp2R] of TP) for (const maxHoldHours of [24, 48])
  add('pullback', 'pullback 1h/4h', { entryTf: 3600, htfTf: 14400, validityMinutes: 60, minSlPct: 0.6, maxSlPct: 6, tp1R, tp2R, maxHoldHours });
for (const lookback of [48, 96]) for (const [tp1R, tp2R] of [[1.5, 3], [2, 4]])
  add('breakout', 'breakout 15m/1h', { entryTf: 900, htfTf: 3600, validityMinutes: 30, maxSlPct: 4, lookback, tp1R, tp2R, maxHoldHours: 12 });
for (const lookback of [24, 48]) for (const slAtr of [1.5, 2.5]) for (const [tp1R, tp2R] of [[1.5, 3], [2, 4]])
  add('breakout', 'breakout 1h/4h', { lookback, slAtr, tp1R, tp2R });
for (const bbMult of [2.5, 3]) for (const rsiExtreme of [25, 20]) for (const [tp1R, tp2R] of [[1, 2], [1.5, 3]])
  add('meanrev', 'meanrev 15m/1h', { bbMult, rsiExtreme, tp1R, tp2R });
for (const bbMult of [2.5, 3]) for (const [tp1R, tp2R] of [[1, 2], [1.5, 3]])
  add('meanrev', 'meanrev 1h/4h', { entryTf: 3600, htfTf: 14400, validityMinutes: 60, maxSlPct: 6, maxHoldHours: 12, bbMult, tp1R, tp2R });

async function main() {
  const [tickers, contracts] = await Promise.all([getTickers(), getContracts()]);
  const symbols = tickers
    .filter((t) => contracts.has(t.symbol) && t.amount24 >= cfg.market.minTurnover24hUsdt && !cfg.market.exclude.includes(t.symbol))
    .sort((a, b) => b.amount24 - a.amount24)
    .map((t) => t.symbol);

  const now = Math.floor(Date.now() / 1000);
  const trainFrom = now - days * 86400;
  const testFrom = now - testDays * 86400;
  console.log(`Porównanie ${variants.length} wariantów na ${symbols.length} parach.`);
  console.log(`TRENING: ${new Date(trainFrom * 1000).toISOString().slice(0, 10)} – ${new Date(testFrom * 1000).toISOString().slice(0, 10)}, TEST: ostatnie ${testDays} dni\n`);

  const train = variants.map(() => []);
  const test = variants.map(() => []);
  for (const [n, symbol] of symbols.entries()) {
    process.stdout.write(`\r  ${n + 1}/${symbols.length} ${symbol.padEnd(20)}`);
    try {
      const candles = await cachedCandles(symbol, days + WARMUP_DAYS);
      if (candles.length < 3000) continue;
      runVariants(symbol, candles, variants, cfg.costs, cfg.market.cooldownHours).forEach((trades, vi) => {
        for (const t of trades) {
          if (t.t >= testFrom) test[vi].push(t);
          else if (t.t >= trainFrom) train[vi].push(t);
        }
      });
    } catch (err) {
      console.log(`\n  ${symbol}: błąd ${err.message}`);
    }
  }
  process.stdout.write('\r' + ' '.repeat(40) + '\r');

  const rows = variants.map((v, i) => ({ id: v.id, family: v.family, name: v.name, prm: v.prm, train: summarize(train[i]), test: summarize(test[i]), testTrades: test[i] }));
  const cell = (s) => `${String(s.taken).padStart(4)} ${s.winRate.toFixed(0).padStart(3)}% ${s.avgR.toFixed(3).padStart(7)} ${(isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : ' inf').padStart(5)}`;
  console.log(`${'wariant'.padEnd(58)} | TRENING: trans traf  śr.R    PF | TEST:  trans traf  śr.R    PF`);
  for (const r of rows) console.log(`${r.id.padEnd(58)} |        ${cell(r.train)} |       ${cell(r.test)}`);

  // Wybór tylko na podstawie TRENINGU
  const best = {};
  for (const r of rows) {
    if (r.train.taken < MIN_TRAIN_TRADES) continue;
    if (!best[r.family] || r.train.avgR > best[r.family].train.avgR) best[r.family] = r;
  }
  console.log('\n=== NAJLEPSZY WARIANT KAŻDEJ RODZINY (wybrany na TRENINGU) → wynik na TEŚCIE ===');
  const picks = Object.values(best).sort((a, b) => b.train.avgR - a.train.avgR);
  for (const r of picks) {
    const e5 = equityCurve(r.testTrades, 5, cfg.capitalUsdt);
    const e20 = equityCurve(r.testTrades, cfg.riskPerTradePct, cfg.capitalUsdt);
    console.log(
      `${r.id.padEnd(58)} trening ${r.train.avgR.toFixed(3).padStart(7)} R → test ${r.test.avgR.toFixed(3).padStart(7)} R (${r.test.taken} tr., seria strat ${r.test.maxLossStreak}) | ` +
        `100 USDT przy 5%: ${e5.final.toFixed(0)}, przy ${cfg.riskPerTradePct}%: ${e20.final.toFixed(0)}`,
    );
  }

  writeJson(path.join(DATA_DIR, 'research.json'), {
    createdAt: new Date().toISOString(), days, testDays, symbols,
    rows: rows.map(({ testTrades, ...r }) => r),
  });
  console.log('\nZapisano: data/research.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

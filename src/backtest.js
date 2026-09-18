// Test strategii ustawionej w config.json na danych historycznych MEXC.
// Użycie: npm run backtest -- --days 90
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
const strat = resolveStrategy(cfg.strategy.name, cfg.strategy.params);
const days = Number(args.days ?? 90);
const WARMUP_DAYS = 40;

const pct = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;
const line = (name, x) =>
  `${name.padEnd(8)} transakcji ${String(x.taken).padStart(4)} | trafność ${x.winRate.toFixed(1).padStart(5)}% | średnio ${x.avgR.toFixed(3).padStart(6)} R | suma ${x.totalR.toFixed(1).padStart(7)} R | PF ${x.profitFactor.toFixed(2)}`;

async function main() {
  const [tickers, contracts] = await Promise.all([getTickers(), getContracts()]);
  const symbols = tickers
    .filter((t) => contracts.has(t.symbol) && t.amount24 >= cfg.market.minTurnover24hUsdt && !cfg.market.exclude.includes(t.symbol))
    .sort((a, b) => b.amount24 - a.amount24)
    .map((t) => t.symbol);
  const from = Math.floor(Date.now() / 1000) - days * 86400;
  console.log(`Backtest „${strat.st.label}” na ${symbols.length} parach, ${days} dni\n`);

  const all = [];
  const perSymbol = [];
  for (const [n, symbol] of symbols.entries()) {
    process.stdout.write(`\r  ${n + 1}/${symbols.length} ${symbol.padEnd(20)}`);
    try {
      const candles = await cachedCandles(symbol, days + WARMUP_DAYS);
      const [trades] = runVariants(symbol, candles, [strat], cfg.costs, cfg.market.cooldownHours);
      const inRange = trades.filter((t) => t.t >= from);
      all.push(...inRange);
      if (inRange.length) perSymbol.push({ symbol, ...summarize(inRange) });
    } catch (err) {
      console.log(`\n  ${symbol}: błąd ${err.message}`);
    }
  }
  process.stdout.write('\r' + ' '.repeat(40) + '\r');

  const sum = summarize(all);
  console.log('=== WYNIK SYGNAŁÓW (R = wielokrotność ryzyka na transakcję, po prowizjach) ===');
  console.log(`Sygnałów: ${sum.signals}, niewypełnionych: ${sum.expired}`);
  console.log(line('RAZEM', sum));
  console.log(line('LONG', summarize(all.filter((t) => t.side === 'LONG'))));
  console.log(line('SHORT', summarize(all.filter((t) => t.side === 'SHORT'))));
  console.log(`Wyniki: ${JSON.stringify(sum.byResult)}`);
  console.log(`Najdłuższa seria strat: ${sum.maxLossStreak}, największe obsunięcie: ${sum.maxDrawdownR.toFixed(1)} R`);

  console.log(`\n=== SYMULACJA ${cfg.capitalUsdt} USDT (jedna pozycja naraz, wejście w każdy sygnał) ===`);
  for (const risk of [...new Set([2, 5, 10, cfg.riskPerTradePct])]) {
    const e = equityCurve(all, risk, cfg.capitalUsdt);
    console.log(
      `ryzyko ${String(risk).padStart(2)}%: ${String(e.trades).padStart(4)} transakcji → ${e.final.toFixed(2).padStart(9)} USDT (${pct(e.returnPct)}), ` +
        `najgłębszy spadek ${e.maxDrawdownPct.toFixed(1)}%`,
    );
  }

  perSymbol.sort((a, b) => b.totalR - a.totalR);
  const fmt = (x) => `${x.symbol.padEnd(16)} ${String(x.taken).padStart(3)} tr. ${x.totalR.toFixed(1).padStart(6)} R`;
  console.log('\nNajlepsze pary:  ' + perSymbol.slice(0, 5).map(fmt).join('\n                 '));
  console.log('Najsłabsze pary: ' + perSymbol.slice(-5).reverse().map(fmt).join('\n                 '));

  writeJson(path.join(DATA_DIR, 'backtest-trades.json'), all);
  console.log('\nSzczegóły: data/backtest-trades.json');
  console.log('Wyniki historyczne nie gwarantują przyszłych.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

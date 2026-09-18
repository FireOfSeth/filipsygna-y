// Skaner okazji MEXC Futures → alerty na Telegram. Aplikacja NIE składa zleceń – tylko podpowiada.
// Tryby: ciągły (własny serwer)            →  node src/index.js
//        jednorazowy (GitHub Actions)      →  node src/index.js --once
import path from 'node:path';
import { loadConfig, readJson, writeJson, DATA_DIR } from './config.js';
import { getContracts, getTickers, getKlines } from './mexc.js';
import { resolveStrategy, signalAt, warmupBars } from './strategies/index.js';
import { buildView, BAR_SEC } from './strategies/common.js';
import { newTrade, advance } from './trade.js';
import { sizePosition } from './sizing.js';
import { summarize, equityCurve } from './stats.js';
import { signalMessage, eventMessage, statusMessage, statsMessage, HELP } from './format.js';
import { Telegram } from './telegram.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' }), ...a);

const STATE_FILE = path.join(DATA_DIR, 'state.json');
const cfg = loadConfig();
const strat = resolveStrategy(cfg.strategy.name, cfg.strategy.params);
const state = {
  capital: cfg.capitalUsdt,
  riskPct: cfg.riskPerTradePct,
  paused: false,
  chatId: '',
  lastScanBar: 0,
  lastSummaryDay: '',
  lastScan: null,
  cooldowns: {},
  trades: [],
  ...readJson(STATE_FILE, {}),
};
const save = () => {
  state.trades = state.trades.slice(-2000);
  writeJson(STATE_FILE, state);
};
const tg = new Telegram(cfg.telegram.botToken);
const chatId = () => String(cfg.telegram.chatId || state.chatId || '');

let contracts = new Map();
let contractsAt = 0;
let lastErrorNotice = 0;

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const roundTo = (x, scale) => Number(x.toFixed(scale));

function statusText() {
  return statusMessage({
    paused: state.paused, testMode: cfg.testMode, strategyLabel: strat.st.label, prm: strat.prm,
    capital: state.capital, riskPct: state.riskPct, maxLeverage: cfg.maxLeverage, lastScan: state.lastScan, trades: state.trades,
  });
}

function statsText() {
  return statsMessage(summarize(state.trades), equityCurve(state.trades, state.riskPct, cfg.capitalUsdt), state.riskPct, cfg.capitalUsdt);
}

/** Codzienny znak życia – bez niego nie wiadomo, czy skaner nadal działa. */
async function maybeDailySummary() {
  if (!Number.isFinite(cfg.dailySummaryHour) || !chatId()) return;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', dateStyle: 'short' }).format(new Date());
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', hour12: false }).format(new Date()));
  if (state.lastSummaryDay === day || hour !== cfg.dailySummaryHour) return;
  state.lastSummaryDay = day;
  save();
  await tg.send(chatId(), `☀️ <b>Raport dzienny</b>\n\n${statusText()}\n\n${statsText()}`);
}

async function refreshContracts() {
  if (Date.now() - contractsAt < 3600_000) return;
  contracts = await getContracts();
  contractsAt = Date.now();
}

function sizeFor(sig, contract) {
  return sizePosition({
    entry: sig.entry, sl: sig.sl, capital: state.capital, riskPct: state.riskPct,
    maxLeverage: cfg.maxLeverage, liqBufferMult: cfg.liqBufferMult, contract, feeRate: cfg.costs.feeRate,
  });
}

function messageFor(tr, size, funding, header, lateMinutes = 0) {
  return signalMessage(tr, size, {
    testMode: cfg.testMode, strategyLabel: strat.st.label, prm: strat.prm, capital: state.capital, funding, header, lateMinutes,
  });
}

/** Czy spóźniony sygnał nadal ma sens przy obecnej cenie. Zwraca powód pominięcia albo null. */
function skipReason(tr, lastPrice) {
  if (tr.validUntil - Date.now() / 1000 < 10 * 60) return 'zostało za mało czasu na wejście';
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return null;
  const long = tr.side === 'LONG';
  const risk = Math.abs(tr.entry - tr.sl);
  if (long ? lastPrice <= tr.sl : lastPrice >= tr.sl) return 'cena zdążyła dojść do stop lossa';
  if (long ? lastPrice >= tr.tp1 : lastPrice <= tr.tp1) return 'cena zdążyła dojść do TP1';
  if ((long ? lastPrice - tr.entry : tr.entry - lastPrice) / risk > 0.5) return 'cena uciekła od wejścia';
  return null;
}

async function scan(barEnd) {
  const lateMinutes = (Date.now() / 1000 - barEnd) / 60;
  await refreshContracts();
  const tickers = await getTickers();
  const bySymbol = new Map(tickers.map((t) => [t.symbol, t]));
  const universe = tickers
    .filter((t) => contracts.has(t.symbol) && t.amount24 >= cfg.market.minTurnover24hUsdt && !cfg.market.exclude.includes(t.symbol))
    .map((t) => t.symbol);

  const bars = warmupBars(strat.prm);
  const found = [];
  for (const symbol of universe) {
    try {
      const c15 = await getKlines(symbol, 'Min15', barEnd - (bars + 20) * BAR_SEC, barEnd);
      if (c15.length < bars * 0.8 || c15.at(-1).t + BAR_SEC !== barEnd) continue;
      const sig = signalAt(buildView(c15, strat.prm.entryTf, strat.prm.htfTf), c15.length - 1, strat);
      if (sig) found.push({ symbol, sig });
    } catch (err) {
      log(`${symbol}: ${err.message}`);
    }
  }
  state.lastScan = { at: Date.now(), pairs: universe.length, found: found.length };
  log(`Skan: ${universe.length} par, sygnałów: ${found.length}`);

  const busy = new Set(state.trades.filter((t) => t.status !== 'closed').map((t) => t.symbol));
  const fresh = found
    .filter(({ symbol, sig }) => !busy.has(symbol) && (state.cooldowns[symbol] ?? 0) <= sig.t)
    .sort((a, b) => b.sig.score - a.sig.score);

  let sent = 0;
  for (const { symbol, sig } of fresh) {
    if (sent >= cfg.market.maxAlertsPerScan) break;
    const contract = contracts.get(symbol);
    const scale = contract.priceScale;
    const rounded = {
      ...sig,
      entry: roundTo(sig.entry, scale), sl: roundTo(sig.sl, scale),
      tp1: roundTo(sig.tp1, scale), tp2: roundTo(sig.tp2, scale),
    };
    if (rounded.sl === rounded.entry || rounded.tp1 === rounded.entry) continue;
    const size = sizeFor(rounded, contract);
    if (!size) {
      log(`${symbol}: pozycja poniżej minimalnej wielkości kontraktu – pomijam`);
      continue;
    }
    const tr = { ...newTrade(symbol, rounded, strat.prm), priceScale: scale, size, alerted: !state.paused };
    const skip = skipReason(tr, Number(bySymbol.get(symbol)?.lastPrice));
    if (skip) {
      log(`${symbol}: pomijam – ${skip}`);
      continue;
    }
    state.trades.push(tr);
    state.cooldowns[symbol] = sig.t + cfg.market.cooldownHours * 3600;
    sent++;
    log(`SYGNAŁ ${tr.side} ${symbol} @ ${tr.entry} (SL ${tr.sl}, TP ${tr.tp1}/${tr.tp2})`);
    if (tr.alerted) await tg.send(chatId(), messageFor(tr, size, bySymbol.get(symbol)?.fundingRate, null, lateMinutes));
  }
}

async function track() {
  const now = Math.floor(Date.now() / 1000);
  for (const tr of state.trades.filter((t) => t.status !== 'closed')) {
    try {
      const candles = await getKlines(tr.symbol, 'Min1', tr.lastT + 1, now);
      for (const k of candles) {
        for (const ev of advance(tr, k, 60, cfg.costs)) {
          log(`${tr.symbol} ${tr.side}: ${ev}`);
          if (tr.alerted) await tg.send(chatId(), eventMessage(tr, ev));
        }
        if (tr.status === 'closed') break;
      }
    } catch (err) {
      log(`Śledzenie ${tr.symbol}: ${err.message}`);
    }
  }
}

async function sampleAlert() {
  await refreshContracts();
  const symbol = 'BTC_USDT';
  const contract = contracts.get(symbol);
  const ticker = (await getTickers()).find((t) => t.symbol === symbol);
  const scale = contract.priceScale;
  const entry = roundTo(ticker.lastPrice, scale);
  const risk = entry * 0.012;
  const sig = {
    side: 'LONG', t: Math.floor(Date.now() / 1000 / BAR_SEC) * BAR_SEC - BAR_SEC, entry,
    sl: roundTo(entry - risk, scale), tp1: roundTo(entry + 1.5 * risk, scale), tp2: roundTo(entry + 3 * risk, scale),
    score: 72, why: 'to tylko przykład – sprawdź, czy słyszysz dźwięk powiadomienia',
  };
  const tr = { ...newTrade(symbol, sig, strat.prm), priceScale: scale };
  return messageFor(tr, sizeFor(sig, contract), ticker.fundingRate, '🔔 <b>PRZYKŁADOWY ALERT</b> – nie wchodź, to test dźwięku.');
}

async function onMessage(msg) {
  const from = String(msg.chat.id);
  if (!chatId()) {
    state.chatId = from;
    save();
    log(`Połączono z czatem Telegram ${from}`);
    await tg.send(from, `✅ Połączono! Alerty będą przychodzić tutaj.\n\n${HELP}`);
    return;
  }
  if (from !== chatId()) return; // ignoruj obcych
  const [rawCmd, arg = ''] = msg.text.trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase().replace(/@.*/, '');
  const num = parseFloat(arg.replace(',', '.'));
  const reply = (html) => tg.send(from, html);

  switch (cmd) {
    case '/start':
    case '/pomoc':
    case '/help':
      return reply(HELP);
    case '/status':
      return reply(statusText());
    case '/stats':
      return reply(statsText());
    case '/kapital':
      if (!(num > 0)) return reply('Podaj kwotę, np. <code>/kapital 120</code>');
      state.capital = num;
      save();
      return reply(`Kapitał ustawiony: <b>${num} USDT</b>. Ryzyko na transakcję: ${((num * state.riskPct) / 100).toFixed(2)} USDT.`);
    case '/ryzyko':
      if (!(num > 0 && num <= 20)) return reply('Podaj procent od 0.1 do 20, np. <code>/ryzyko 5</code>');
      state.riskPct = num;
      save();
      return reply(`Ryzyko ustawione: <b>${num}%</b> (${((state.capital * num) / 100).toFixed(2)} USDT na transakcję).`);
    case '/pauza':
      state.paused = true;
      save();
      return reply('⏸ Alerty wstrzymane. Sygnały dalej liczą się w statystykach. /wznow – włącz ponownie.');
    case '/wznow':
      state.paused = false;
      save();
      return reply('▶️ Alerty włączone.');
    case '/test':
      return reply(await sampleAlert());
    default:
      return reply(`Nie znam tej komendy.\n\n${HELP}`);
  }
}

/** Jeden obieg: skan świeżo zamkniętej świecy + śledzenie otwartych sygnałów. */
async function cycle() {
  const nowSec = Date.now() / 1000;
  const entryEnd = Math.floor(nowSec / strat.prm.entryTf) * strat.prm.entryTf;
  if (entryEnd > state.lastScanBar && nowSec >= entryEnd + 20) {
    const lateMin = (nowSec - entryEnd) / 60;
    state.lastScanBar = entryEnd;
    if (lateMin <= cfg.maxLatenessMinutes) await scan(entryEnd);
    else log(`Świeca zamknęła się ${Math.round(lateMin)} min temu – skan pominięty (limit ${cfg.maxLatenessMinutes} min).`);
  }
  await track();
  await maybeDailySummary();
  save();
}

async function loop() {
  for (;;) {
    try {
      await cycle();
    } catch (err) {
      log(`Błąd: ${err.message}`);
      if (chatId() && Date.now() - lastErrorNotice > 3600_000) {
        lastErrorNotice = Date.now();
        await tg.send(chatId(), `⚠️ Błąd skanera: ${escHtml(err.message)}\nAplikacja próbuje dalej sama. /status`);
      }
    }
    const ms = Date.now() % 60_000; // kolejny obieg ~22 s po pełnej minucie
    await sleep(ms < 22_000 ? 22_000 - ms : 82_000 - ms);
  }
}

async function main() {
  if (process.argv.includes('--test-alert')) {
    if (tg.enabled && !chatId()) console.log('Najpierw napisz /start do swojego bota, żeby połączyć czat.');
    await tg.send(chatId(), await sampleAlert());
    return;
  }

  const once = process.argv.includes('--once');
  log(`Start${once ? ' (jednorazowy)' : ''}: ${strat.st.label}, kapitał ${state.capital} USDT, ryzyko ${state.riskPct}%, ${cfg.testMode ? 'TRYB TEST' : 'NA ŻYWO'}`);
  if (!tg.enabled) log('Brak tokenu Telegram – alerty będą tylko w tym oknie.');

  if (once) {
    // Najpierw komendy (pierwsze /start łączy czat), potem skan i śledzenie
    state.tgOffset = await tg.drainUpdates((msg) => onMessage(msg).catch((err) => log(`Komenda: ${err.message}`)), state.tgOffset ?? 0);
    save();
    try {
      await cycle();
    } catch (err) {
      log(`Błąd: ${err.message}`);
      save();
      if (chatId()) await tg.send(chatId(), `⚠️ Błąd skanera: ${escHtml(err.message)}\nNastępna próba za 15 minut.`);
    }
    return;
  }

  if (!tg.enabled || chatId()) {
    if (tg.enabled) await tg.send(chatId(), `🟢 Skaner uruchomiony · ${strat.st.label} · ${cfg.testMode ? '🧪 TEST' : 'NA ŻYWO'}\n/status – szczegóły`);
  } else {
    log('Napisz /start do swojego bota w Telegramie, żeby połączyć czat.');
  }
  tg.poll((msg) => onMessage(msg).catch((err) => log(`Komenda: ${err.message}`)));
  await loop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

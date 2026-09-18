// Treść wiadomości na Telegram (HTML). Wartości w <code> można skopiować jednym dotknięciem.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const signed = (x, digits = 2) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;
export const clock = (sec) =>
  new Date(sec * 1000).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });
const tfName = (sec) => (sec >= 3600 ? `${sec / 3600}h` : `${sec / 60}m`);

export const HELP = [
  '<b>Komendy</b>',
  '/status – stan skanera i aktywne sygnały',
  '/stats – skuteczność sygnałów',
  '/kapital 120 – ustaw aktualny kapitał w USDT',
  '/ryzyko 5 – ryzyko na transakcję w % (max 20)',
  '/pauza – wstrzymaj alerty',
  '/wznow – wznów alerty',
  '/test – przykładowy alert (sprawdź dźwięk)',
].join('\n');

export function signalMessage(tr, size, { testMode, strategyLabel, prm, capital, funding, header, lateMinutes = 0 }) {
  const p = (x) => Number(x).toFixed(tr.priceScale);
  const long = tr.side === 'LONG';
  const base = tr.symbol.split('_')[0];
  const half = Math.floor(size.contracts / 2);
  const cs = size.coins / size.contracts;
  const profit = half * cs * Math.abs(tr.tp1 - tr.entry) + (size.contracts - half) * cs * Math.abs(tr.tp2 - tr.entry);
  const move = (x) => `${signed(((x - tr.entry) / tr.entry) * 100)}%`;

  const lines = [];
  if (header) lines.push(header, '');
  if (testMode) lines.push('🧪 <b>TRYB TEST</b> – strategia nie ma jeszcze potwierdzonej przewagi. Traktuj jako naukę, nie wchodź prawdziwymi pieniędzmi.', '');
  lines.push(
    `${long ? '🟢' : '🔴'} <b>${tr.side} — ${esc(tr.symbol)}</b>`,
    `${esc(strategyLabel)} ${tfName(prm.entryTf)}/${tfName(prm.htfTf)} · siła ${tr.score}/100`,
    '',
    `Wejście (Limit): <code>${p(tr.entry)}</code>`,
    `Stop loss: <code>${p(tr.sl)}</code> (${move(tr.sl)})`,
    `TP1 (50%): <code>${p(tr.tp1)}</code> (${move(tr.tp1)})`,
    `TP2 (50%): <code>${p(tr.tp2)}</code> (${move(tr.tp2)})`,
    '',
    `Dźwignia: <b>${size.lev}x</b> · Isolated`,
    `Ilość: <code>${size.contracts}</code> Cont (= ${+size.coins.toFixed(6)} ${esc(base)}, wartość ${size.notional.toFixed(2)} USDT)`,
    `Depozyt: ${size.margin.toFixed(2)} USDT · likwidacja ~${p(size.liq)}`,
    `Strata przy SL: <b>−${size.risk.toFixed(2)} USDT</b> (${size.riskPctActual.toFixed(1)}% z ${capital} USDT)`,
    `Zysk przy TP1+TP2: <b>+${profit.toFixed(2)} USDT</b>`,
  );
  if (size.reduced) lines.push('⚠️ Stop loss jest blisko – pozycję zmniejszono, żeby likwidacja wypadła za stop lossem.');
  if (lateMinutes >= 3) lines.push(`⚠️ Sygnał powstał ${Math.round(lateMinutes)} min temu (opóźnienie darmowego hostingu). Wchodź wyłącznie zleceniem limit po podanej cenie – nigdy po rynku.`);
  lines.push(
    '',
    `⏳ Ważny do <b>${clock(tr.validUntil)}</b>`,
    '',
    '<b>Kroki na MEXC:</b>',
    `1. Futures → wyszukaj <b>${esc(base)}USDT</b> (Perpetual)`,
    `2. Ustaw <b>Isolated</b> i dźwignię <b>${size.lev}x</b>`,
    `3. <b>Open → Limit</b>: cena ${p(tr.entry)}, ilość ${size.contracts} Cont, zaznacz TP/SL: TP ${p(tr.tp2)}, SL ${p(tr.sl)} → <b>${long ? 'Open Long' : 'Open Short'}</b>`,
    `4. Po wejściu: <b>Close → Limit</b>, cena ${p(tr.tp1)}, ilość ${half} Cont`,
    `5. Gdy przyjdzie info o TP1 → przesuń SL na ${p(tr.entry)}`,
    `6. Jeśli do ${clock(tr.validUntil)} zlecenie się nie wypełni → anuluj je`,
    '',
    `<i>Dlaczego: ${esc(tr.why)}.</i>`,
  );
  if (Number.isFinite(funding)) lines.push(`<i>Funding: ${signed(funding * 100, 4)}% (co 8h)</i>`);
  return lines.join('\n');
}

export function eventMessage(tr, event) {
  const p = (x) => Number(x).toFixed(tr.priceScale);
  const name = `<b>${esc(tr.symbol)} ${tr.side}</b>`;
  switch (event) {
    case 'filled':
      return `📥 ${name}: cena wejścia ${p(tr.entry)} osiągnięta – zlecenie powinno być wypełnione. Ustaw Close → Limit na TP1 (${p(tr.tp1)}), jeśli jeszcze nie.`;
    case 'expired':
      return `⌛ ${name}: cena nie wróciła do ${p(tr.entry)} – <b>anuluj zlecenie limit</b>.`;
    case 'tp1':
      return `✅ ${name}: TP1 ${p(tr.tp1)} osiągnięty – połowa zamknięta z zyskiem.\n➡️ <b>Przesuń stop loss na ${p(tr.entry)}</b> (cena wejścia).`;
    case 'tp2':
      return `🎯 ${name}: TP2 ${p(tr.tp2)} osiągnięty – cała pozycja zamknięta z zyskiem.`;
    case 'sl':
      return `❌ ${name}: stop loss ${p(tr.sl)} – pozycja zamknięta ze stratą.`;
    case 'be':
      return `➖ ${name}: cena wróciła do wejścia – reszta zamknięta na zero, zysk z TP1 zostaje.`;
    case 'timeout':
      return `⏱ ${name}: minęło ${tr.maxHoldHours} h bez rozstrzygnięcia – <b>zamknij pozycję po rynku</b> (Close → Market). Cena: ${p(tr.exitPrice)}.`;
    default:
      return `${name}: ${event}`;
  }
}

const STATUS_PL = { pending: 'czeka na wejście', open: 'otwarta', tp1: 'po TP1, SL na wejściu' };

export function statusMessage({ paused, testMode, strategyLabel, prm, capital, riskPct, maxLeverage, lastScan, trades }) {
  const active = trades.filter((t) => t.status !== 'closed');
  const lines = [
    '⚙️ <b>Status</b>',
    `Alerty: ${paused ? '⏸ wstrzymane (/wznow)' : '▶️ włączone'} · tryb ${testMode ? '🧪 TEST' : 'NA ŻYWO'}`,
    `Strategia: ${esc(strategyLabel)} ${tfName(prm.entryTf)}/${tfName(prm.htfTf)}`,
    `Kapitał: ${capital} USDT · ryzyko ${riskPct}% (${((capital * riskPct) / 100).toFixed(2)} USDT) · max dźwignia ${maxLeverage}x`,
    lastScan
      ? `Ostatni skan: ${clock(lastScan.at / 1000)} · par: ${lastScan.pairs} · sygnałów: ${lastScan.found}`
      : 'Ostatni skan: jeszcze nie było',
    '',
    active.length ? '<b>Aktywne sygnały:</b>' : 'Brak aktywnych sygnałów.',
    ...active.map((t) => `• ${esc(t.symbol)} ${t.side} @ ${Number(t.entry).toFixed(t.priceScale)} – ${STATUS_PL[t.status]}`),
  ];
  return lines.join('\n');
}

export function statsMessage(sum, equity, riskPct, capital) {
  if (!sum.signals) return '📊 Nie było jeszcze żadnych sygnałów.';
  const b = sum.byResult;
  const open = sum.signals - Object.values(b).reduce((a, x) => a + x, 0);
  const lines = [
    '📊 <b>Skuteczność sygnałów</b> (wirtualnie: jakbyś wchodził w każdy)',
    `Sygnałów: ${sum.signals} · w toku: ${open} · niewypełnionych: ${sum.expired}`,
  ];
  if (sum.taken) {
    lines.push(
      `Zamkniętych: ${sum.taken} · trafność ${sum.winRate.toFixed(0)}%`,
      `Średnio ${signed(sum.avgR)} R na transakcję · suma ${signed(sum.totalR, 1)} R`,
      `TP2: ${b.tp2 || 0} · TP1→wejście: ${b.be || 0} · SL: ${b.sl || 0} · czas: ${b.timeout || 0}`,
      `Najdłuższa seria strat: ${sum.maxLossStreak}`,
      '',
      `Symulacja ${capital} USDT przy ryzyku ${riskPct}%: <b>${equity.final.toFixed(2)} USDT</b> (${signed(equity.returnPct, 1)}%), najgłębszy spadek ${equity.maxDrawdownPct.toFixed(0)}%`,
      '<i>R = kwota ryzyka na transakcję. Wiarygodne wnioski dopiero po ~50+ transakcjach.</i>',
    );
  }
  return lines.join('\n');
}

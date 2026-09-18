import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');

export const DEFAULTS = {
  telegram: { botToken: '', chatId: '' },

  // Kapitał i ryzyko (kapitał i ryzyko można potem zmieniać komendami /kapital i /ryzyko)
  capitalUsdt: 100,
  riskPerTradePct: 20,     // ile % kapitału tracisz, gdy zadziała stop loss
  maxLeverage: 36,
  liqBufferMult: 2,        // likwidacja musi być co najmniej 2x dalej od wejścia niż stop loss

  market: {
    minTurnover24hUsdt: 3_000_000, // pomija pary z małym obrotem (manipulacje, knoty)
    exclude: [],                   // np. ["PEPE_USDT"]
    maxAlertsPerScan: 3,
    cooldownHours: 4,              // po sygnale na parze kolejny najwcześniej po tym czasie
  },

  // Dopóki strategia nie udowodni przewagi na żywo, alerty są oznaczone jako TEST
  testMode: true,

  // Ile minut po zamknięciu świecy sygnał jest jeszcze aktualny (darmowy hosting bywa spóźniony)
  maxLatenessMinutes: 25,

  // Codzienny raport (godzina w czasie polskim) – potwierdza, że serwer żyje. null = wyłącz
  dailySummaryHour: 9,

  // Strategia: pullback | breakout | meanrev; params nadpisują domyślne (patrz src/strategies/*.js).
  // Domyślnie: korekta w trendzie 1h/4h – ok. 2 sygnały dziennie. Bez potwierdzonej przewagi (patrz data/research.json).
  strategy: {
    name: 'pullback',
    params: { entryTf: 3600, htfTf: 14400, validityMinutes: 60, minSlPct: 0.6, maxSlPct: 6, tp1R: 2, tp2R: 4, maxHoldHours: 48 },
  },

  costs: {
    feeRate: 0.0002,   // prowizja za stronę (do statystyk)
    slippageR: 0.05,   // poślizg na stop lossie w R (do statystyk)
  },
};

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

export function loadConfig() {
  const file = path.join(ROOT, 'config.json');
  const user = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const cfg = merge(DEFAULTS, user);
  // Na GitHub Actions token i czat przychodzą ze zmiennych środowiskowych (sekretów)
  if (process.env.TELEGRAM_BOT_TOKEN) cfg.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (process.env.TELEGRAM_CHAT_ID) cfg.telegram.chatId = process.env.TELEGRAM_CHAT_ID;
  // Strategia z config.json zastępuje domyślną w całości (parametry innej strategii nie mogą się wymieszać)
  if (user.strategy) cfg.strategy = { name: user.strategy.name ?? DEFAULTS.strategy.name, params: user.strategy.params ?? {} };
  return cfg;
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

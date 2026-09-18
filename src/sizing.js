// Wielkość pozycji liczona od stop lossa: przy SL tracisz założoną kwotę, niezależnie od dźwigni.
// Dźwignia jest najniższa możliwa, przy której depozyt mieści się w kapitale, i nigdy tak wysoka,
// żeby likwidacja wypadła przed stop lossem.
export function sizePosition({ entry, sl, capital, riskPct, maxLeverage, liqBufferMult, contract, feeRate }) {
  const dist = Math.abs(entry - sl) / entry;
  const mmr = contract.mmr || 0.01;
  const fee = contract.takerFee ?? feeRate;
  const safeLev = 1 / (liqBufferMult * dist + mmr);
  const levCap = Math.max(1, Math.floor(Math.min(maxLeverage, contract.maxLeverage || maxLeverage, safeLev)));

  // 10% kapitału zostaje wolne na prowizje i wahania
  const maxMargin = capital * 0.9;
  let notional = (capital * riskPct) / 100 / (dist + 2 * fee);
  let lev = Math.max(1, Math.ceil(notional / maxMargin));
  let reduced = false;
  if (lev > levCap) {
    lev = levCap;
    notional = maxMargin * lev;
    reduced = true;
  }

  const contractValue = entry * contract.contractSize;
  const contracts = Math.floor(notional / contractValue / contract.volUnit) * contract.volUnit;
  if (contracts < contract.minVol) return null;

  notional = contracts * contractValue;
  const long = sl < entry;
  const risk = notional * (dist + 2 * fee);
  return {
    lev,
    contracts,
    coins: contracts * contract.contractSize,
    notional,
    margin: notional / lev,
    risk,
    riskPctActual: (risk / capital) * 100,
    liq: long ? entry * (1 - 1 / lev + mmr) : entry * (1 + 1 / lev - mmr),
    reduced,
  };
}

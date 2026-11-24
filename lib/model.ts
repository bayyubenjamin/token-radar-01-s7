// Token Radar S7 — pure model (no I/O).
// Written fresh in this session from the S6 design doc + S4 spec + S7 delta.
// All values are computed from the sealed snapshot at runtime; nothing is
// hardcoded except the verification bands and the fitted Weibull (lambda, k)
// from the S4 design (documented as fitted, verified by a runtime MLE).
// Formulas (validated in a Python prototype against the design's numbers):
//   comps: ln(mcap) = a + b*ln(TVL) on the 128 traded comps (mcap > 0).
//   flat baseline: ln(TVL) + ln(median(mcap/TVL over ALL 128 comps)).
//   age test: ln(mcap) = a + b*ln(TVL) + c*ln(age) on the 95 age-reported comps.
//   Weibull: S(t) = exp(-(t/882)^0.50); board odds = P(launch within 1 year |
//     survived to age a) = 1 - S(a+365)/S(a). The 1-year horizon is a STATED
//     planning-horizon assumption; the curve (lambda, k) is FITTED.
//   implied = base * growth * maturity * odds; EV = implied * slice (odds once);
//   cost = deposit (TVL tier) + gas (first chain); verdicts FARM >= 3 / THIN >= 1 / SKIP.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chain: string;
  tvl: number;
  change7d: number | null;
  age: number | null;
  ageFill: number;
  base: number;
  growth: number;
  maturity: number;
  odds: number;
  implied: number;
  farmers: number;
  slice: number;
  ev: number;
  deposit: number;
  gas: number;
  cost: number;
  ratio: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  holdDays: number;
  activeHours: number;
  perHour: number;
  plan: string[];
}

// ---- constants (verification bands + fitted values from the design) ----
export const WEIBULL_LAMBDA = 882; // days, fitted by MLE in the S4 design
export const WEIBULL_K = 0.5;
export const WEIBULL_HORIZON_DAYS = 365; // STATED planning-horizon assumption
export const AGE_FILL_DAYS = 513; // median reported age of pre-token protocols
export const MATURITY_CAP_DAYS = 1095;
export const EXPECTED_A = 6.9646;
export const EXPECTED_B = 0.5223;
export const EXPECTED_R2 = 0.1939;

// Per-chain gas in USD (zeta cost table, S4 spec section 3.3).
export const GAS_USD: Record<string, number> = {
  Ethereum: 8, Bitcoin: 5, Solana: 0.01, Binance: 0.3, Base: 0.1,
  Arbitrum: 0.5, Optimism: 0.2, Polygon: 0.05, 'zkSync Era': 0.2,
  Starknet: 0.2, Avalanche: 0.3, Sui: 0.02, Aptos: 0.02, Tron: 0.5,
  'Hyperliquid L1': 0.5, Monad: 0.05, Stellar: 0.01, Ripple: 0.01,
  Algorand: 0.01, Mantle: 0.1, Linea: 0.1, Scroll: 0.1, Mode: 0.05,
  Fraxtal: 0.05, Blast: 0.1, Manta: 0.1, ZetaChain: 0.1, Kava: 0.1,
  Cronos: 0.05, Fantom: 0.05, Celo: 0.01, Near: 0.01, Sei: 0.05,
  Berachain: 0.05, Sonic: 0.05, Story: 0.05, Unichain: 0.1,
  'World Chain': 0.1, 'Plume Mainnet': 0.1, Plume: 0.1, Katana: 0.05,
  Stable: 0.05, Tempo: 0.1,
};
export const GAS_DEFAULT = 0.1;

export function gasFor(chain: string): number {
  return GAS_USD[chain] ?? GAS_DEFAULT;
}

export function depositFor(tvl: number): number {
  if (tvl < 10_000_000) return 50;
  if (tvl < 100_000_000) return 100;
  if (tvl < 1_000_000_000) return 150;
  return 250;
}

// ---- dates / ages ----
export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso.slice(0, 10) + 'T00:00:00Z').getTime();
  const to = new Date(toIso.slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round((to - from) / 86400000);
}

export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (!p.listed_at) return null;
  return daysBetween(p.listed_at, asOf);
}

export function hasToken(p: SnapshotProtocol): boolean {
  return Boolean(p.gecko_id || p.symbol);
}

// ---- small numeric helpers ----
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function rmse(pred: number[], actual: number[]): number {
  let s = 0;
  for (let i = 0; i < actual.length; i++) {
    const d = actual[i] - pred[i];
    s += d * d;
  }
  return Math.sqrt(s / actual.length);
}

// 2-parameter OLS: y = a + b*x. Returns {a, b, r2}.
export function ols2(xs: number[], ys: number[]): { a: number; b: number; r2: number } {
  const n = xs.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i];
  }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;
  const my = sy / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (a + b * xs[i]);
    ssRes += r * r;
    const t = ys[i] - my;
    ssTot += t * t;
  }
  return { a, b, r2: 1 - ssRes / ssTot };
}

// Solve a 3x3 linear system by Gaussian elimination with partial pivoting.
function solve3(m: number[][], v: number[]): number[] {
  const a = m.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    }
    [a[col], a[piv]] = [a[piv], a[col]];
    const d = a[col][col];
    for (let r = col + 1; r < 3; r++) {
      const f = a[r][col] / d;
      for (let c = col; c < 4; c++) a[r][c] -= f * a[col][c];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = a[r][3];
    for (let c = r + 1; c < 3; c++) s -= a[r][c] * x[c];
    x[r] = s / a[r][r];
  }
  return x;
}

// Inverse of a 3x3 matrix (adjugate / determinant).
function inv3(m: number[][]): number[][] {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const invDet = 1 / det;
  return [
    [A * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet],
    [B * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet],
    [C * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet],
  ];
}

// 3-parameter OLS: y = a + b*x1 + c*x2. Returns coefficients, R2, and se(c).
export function ols3(
  x1: number[], x2: number[], ys: number[],
): { a: number; b: number; c: number; r2: number; seC: number; tC: number } {
  const n = ys.length;
  // Normal equations: (X'X) beta = X'y, with X = [1, x1, x2].
  const xtx = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const xty = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const row = [1, x1[i], x2[i]];
    for (let r = 0; r < 3; r++) {
      xty[r] += row[r] * ys[i];
      for (let cc = 0; cc < 3; cc++) xtx[r][cc] += row[r] * row[cc];
    }
  }
  const [a, b, c] = solve3(xtx, xty);
  const my = mean(ys);
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (a + b * x1[i] + c * x2[i]);
    ssRes += r * r;
    const t = ys[i] - my;
    ssTot += t * t;
  }
  const r2 = 1 - ssRes / ssTot;
  const s2 = ssRes / (n - 3);
  const inv = inv3(xtx);
  const seC = Math.sqrt(Math.max(0, s2 * inv[2][2]));
  return { a, b, c, r2, seC, tC: seC > 0 ? c / seC : 0 };
}

// ---- traded comps (mcap > 0) ----
export function tradedComps(snap: Snapshot): SnapshotProtocol[] {
  return snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
}

export interface CompsFit {
  a: number; b: number; r2: number; n: number;
  heldOut: { fitted: number; flat: number; wins: number; perFoldFitted: number[]; perFoldFlat: number[] };
  walkForward: { fitted: number; flat: number; wins: number; perChunkFitted: number[]; perChunkFlat: number[] };
  loo: { fitted: number; flat: number; wins: number };
}

// Flat baseline: ln(TVL) + ln(median(mcap/TVL over ALL traded comps)).
export function flatLogMedian(comps: SnapshotProtocol[]): number {
  return Math.log(median(comps.map((p) => (p.mcap_usd as number) / p.tvl_usd)));
}

export function compsFit(snap: Snapshot): CompsFit {
  const comps = tradedComps(snap);
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd as number));
  const fit = ols2(xs, ys);
  const flatB = flatLogMedian(comps);

  // Held-out 5-fold: fold = index among comps mod 5.
  const perFoldFitted: number[] = [];
  const perFoldFlat: number[] = [];
  let wins = 0;
  for (let f = 0; f < 5; f++) {
    const te = comps.map((_, i) => i).filter((i) => i % 5 === f);
    const tr = comps.map((_, i) => i).filter((i) => i % 5 !== f);
    const fr = ols2(tr.map((i) => xs[i]), tr.map((i) => ys[i]));
    const rf = rmse(te.map((i) => fr.a + fr.b * xs[i]), te.map((i) => ys[i]));
    const rl = rmse(te.map((i) => xs[i] + flatB), te.map((i) => ys[i]));
    perFoldFitted.push(rf);
    perFoldFlat.push(rl);
    if (rf < rl) wins++;
  }

  // Walk-forward: comps with a reported age, oldest-listed first, 5 chunks,
  // expanding window (train on past chunks, test on the next).
  const withAge = comps
    .filter((p) => p.listed_at)
    .sort((p, q) => (p.listed_at as string).localeCompare(q.listed_at as string));
  const n = withAge.length;
  const chunks: SnapshotProtocol[][] = [];
  for (let j = 0; j < 5; j++) chunks.push(withAge.slice(Math.floor((j * n) / 5), Math.floor(((j + 1) * n) / 5)));
  const perChunkFitted: number[] = [];
  const perChunkFlat: number[] = [];
  let wfWins = 0;
  for (let j = 1; j < 5; j++) {
    const tr = chunks.slice(0, j).flat();
    const te = chunks[j];
    const fr = ols2(tr.map((p) => Math.log(p.tvl_usd)), tr.map((p) => Math.log(p.mcap_usd as number)));
    const rf = rmse(te.map((p) => fr.a + fr.b * Math.log(p.tvl_usd)), te.map((p) => Math.log(p.mcap_usd as number)));
    const rl = rmse(te.map((p) => Math.log(p.tvl_usd) + flatB), te.map((p) => Math.log(p.mcap_usd as number)));
    perChunkFitted.push(rf);
    perChunkFlat.push(rl);
    if (rf < rl) wfWins++;
  }

  // Leave-one-out.
  let looSqF = 0, looSqL = 0, looWins = 0;
  for (let i = 0; i < comps.length; i++) {
    const tr = comps.map((_, j) => j).filter((j) => j !== i);
    const fr = ols2(tr.map((j) => xs[j]), tr.map((j) => ys[j]));
    const rf = Math.abs(ys[i] - (fr.a + fr.b * xs[i]));
    const rl = Math.abs(ys[i] - (xs[i] + flatB));
    looSqF += rf * rf;
    looSqL += rl * rl;
    if (rf < rl) looWins++;
  }

  return {
    a: fit.a, b: fit.b, r2: fit.r2, n: comps.length,
    heldOut: { fitted: mean(perFoldFitted), flat: mean(perFoldFlat), wins, perFoldFitted, perFoldFlat },
    walkForward: { fitted: mean(perChunkFitted), flat: mean(perChunkFlat), wins: wfWins, perChunkFitted, perChunkFlat },
    loo: { fitted: Math.sqrt(looSqF / comps.length), flat: Math.sqrt(looSqL / comps.length), wins: looWins },
  };
}

// ---- age test (maturity decision) ----
// Uses ONLY the comps with a reported age (n=95). Held-out folds are by the
// protocol's index in the snapshot's protocols array (mod 5).
export interface AgeTest {
  a: number; b: number; c: number; seC: number; tC: number; r2: number; n: number;
  heldOutAge: number; heldOutBase: number;
}

export function ageTest(snap: Snapshot): AgeTest {
  const comps = tradedComps(snap).filter((p) => p.listed_at);
  const snapIndex = new Map(snap.protocols.map((p, i) => [p.slug, i]));
  const x1 = comps.map((p) => Math.log(p.tvl_usd));
  const x2 = comps.map((p) => Math.log(ageDays(p, snap.as_of) as number));
  const ys = comps.map((p) => Math.log(p.mcap_usd as number));
  const fit = ols3(x1, x2, ys);
  // Held-out 5-fold (fold = snapshot index mod 5): age model vs base model.
  const perAge: number[] = [];
  const perBase: number[] = [];
  for (let f = 0; f < 5; f++) {
    const te = comps.map((_, i) => i).filter((i) => (snapIndex.get(comps[i].slug) as number) % 5 === f);
    const tr = comps.map((_, i) => i).filter((i) => (snapIndex.get(comps[i].slug) as number) % 5 !== f);
    const fa = ols3(tr.map((i) => x1[i]), tr.map((i) => x2[i]), tr.map((i) => ys[i]));
    const fb = ols2(tr.map((i) => x1[i]), tr.map((i) => ys[i]));
    perAge.push(rmse(te.map((i) => fa.a + fa.b * x1[i] + fa.c * x2[i]), te.map((i) => ys[i])));
    perBase.push(rmse(te.map((i) => fb.a + fb.b * x1[i]), te.map((i) => ys[i])));
  }
  return { ...fit, n: comps.length, heldOutAge: mean(perAge), heldOutBase: mean(perBase) };
}

// ---- Weibull survival ----
export function weibullS(t: number, lam: number, k: number): number {
  return Math.exp(-Math.pow(Math.max(t, 0) / lam, k));
}

// Board odds: P(launch within 1 year | survived to age a).
export function weibullOdds365(age: number, lam = WEIBULL_LAMBDA, k = WEIBULL_K): number {
  return 1 - weibullS(age + WEIBULL_HORIZON_DAYS, lam, k) / weibullS(age, lam, k);
}

// Assumed S1 odds (the baseline the fitted Weibull replaces).
export function s1Odds(age: number): number {
  return 0.55 * Math.exp(-age / 1500) + 0.08;
}

// Negative log-likelihood of the current-status Weibull fit.
// ages: days since listing (null ages filled with AGE_FILL_DAYS by the caller).
// has: 1 if the protocol already has a token, else 0.
export function weibullNll(logLam: number, logK: number, ages: number[], has: number[]): number {
  const lam = Math.exp(logLam);
  const k = Math.exp(logK);
  let ll = 0;
  for (let i = 0; i < ages.length; i++) {
    const s = weibullS(ages[i], lam, k);
    if (has[i] > 0) {
      ll += Math.log(Math.max(1 - s, 1e-300));
    } else {
      ll += -Math.pow(ages[i] / lam, k);
    }
  }
  return -ll;
}

// Nelder-Mead (2D) on (ln lambda, ln k). Deterministic: fixed start, fixed rule.
export function fitWeibull(
  ages: number[], has: number[], start?: [number, number],
): { lambda: number; k: number; nll: number } {
  const x0: [number, number] = start ?? [Math.log(WEIBULL_LAMBDA), Math.log(WEIBULL_K)];
  // Simplex: x0, x0+(0.1,0), x0+(0,0.1).
  let simplex: [number, number][] = [
    [x0[0], x0[1]],
    [x0[0] + 0.1, x0[1]],
    [x0[0], x0[1] + 0.1],
  ];
  let vals = simplex.map((p) => weibullNll(p[0], p[1], ages, has));
  const alpha = 1, gamma = 2, rho = 0.5, sigma = 0.5;
  for (let iter = 0; iter < 500; iter++) {
    // Sort ascending by value.
    const order = [0, 1, 2].sort((i, j) => vals[i] - vals[j]);
    simplex = order.map((i) => simplex[i]);
    vals = order.map((i) => vals[i]);
    // Convergence: simplex diameter and value spread tiny.
    const spread = Math.max(
      Math.abs(simplex[0][0] - simplex[2][0]),
      Math.abs(simplex[0][1] - simplex[2][1]),
    );
    if (spread < 1e-8 && Math.abs(vals[0] - vals[2]) < 1e-8) break;
    // Centroid of the two best.
    const cx = (simplex[0][0] + simplex[1][0]) / 2;
    const cy = (simplex[0][1] + simplex[1][1]) / 2;
    // Reflection.
    const rx = cx + alpha * (cx - simplex[2][0]);
    const ry = cy + alpha * (cy - simplex[2][1]);
    const rv = weibullNll(rx, ry, ages, has);
    if (rv < vals[0]) {
      // Expansion.
      const ex = cx + gamma * (rx - cx);
      const ey = cy + gamma * (ry - cy);
      const ev = weibullNll(ex, ey, ages, has);
      if (ev < rv) { simplex[2] = [ex, ey]; vals[2] = ev; }
      else { simplex[2] = [rx, ry]; vals[2] = rv; }
    } else if (rv < vals[1]) {
      simplex[2] = [rx, ry]; vals[2] = rv;
    } else {
      // Contraction.
      const ccx = cx + rho * (simplex[2][0] - cx);
      const ccy = cy + rho * (simplex[2][1] - cy);
      const cv = weibullNll(ccx, ccy, ages, has);
      if (cv < vals[2]) { simplex[2] = [ccx, ccy]; vals[2] = cv; }
      else {
        // Shrink toward the best.
        for (let i = 1; i < 3; i++) {
          simplex[i] = [
            simplex[0][0] + sigma * (simplex[i][0] - simplex[0][0]),
            simplex[0][1] + sigma * (simplex[i][1] - simplex[0][1]),
          ];
          vals[i] = weibullNll(simplex[i][0], simplex[i][1], ages, has);
        }
      }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return { lambda: Math.exp(simplex[best][0]), k: Math.exp(simplex[best][1]), nll: vals[best] };
}

// Mean binary log-loss of a launch-probability model on (ages, has).
export function logLossWeibull(ages: number[], has: number[], lam: number, k: number): number {
  let s = 0;
  for (let i = 0; i < ages.length; i++) {
    const p = Math.min(Math.max(1 - weibullS(ages[i], lam, k), 1e-12), 1 - 1e-12);
    s += has[i] > 0 ? -Math.log(p) : -Math.log(1 - p);
  }
  return s / ages.length;
}

// Baseline: the assumed S1 odds treated as the launch probability.
export function logLossS1(ages: number[], has: number[]): number {
  let s = 0;
  for (let i = 0; i < ages.length; i++) {
    const p = Math.min(Math.max(s1Odds(ages[i]), 1e-12), 1 - 1e-12);
    s += has[i] > 0 ? -Math.log(p) : -Math.log(1 - p);
  }
  return s / ages.length;
}

// Baseline: the constant base rate (fraction with a token in the training set).
export function logLossBase(has: number[], frac: number): number {
  const p = Math.min(Math.max(frac, 1e-12), 1 - 1e-12);
  let s = 0;
  for (let i = 0; i < has.length; i++) {
    s += has[i] > 0 ? -Math.log(p) : -Math.log(1 - p);
  }
  return s / has.length;
}

export interface WeibullTests {
  fullFit: { lambda: number; k: number };
  heldOut: { fitted: number; s1: number; base: number; perFoldFitted: number[] };
  walkForward: { fitted: number; s1: number; base: number; perChunk: { lambda: number; k: number; fitted: number; s1: number; base: number }[] };
  loo: { fitted: number; s1: number; base: number };
}

export function weibullTests(snap: Snapshot): WeibullTests {
  const ages = snap.protocols.map((p) => {
    const a = ageDays(p, snap.as_of);
    return a === null ? AGE_FILL_DAYS : a;
  });
  const has = snap.protocols.map((p) => (hasToken(p) ? 1 : 0));
  const snapIndex = snap.protocols.map((_, i) => i);

  const full = fitWeibull(ages, has);

  // Held-out 5-fold: fold = snapshot index mod 5.
  const perFoldFitted: number[] = [];
  const perFoldS1: number[] = [];
  const perFoldBase: number[] = [];
  for (let f = 0; f < 5; f++) {
    const te = snapIndex.filter((i) => i % 5 === f);
    const tr = snapIndex.filter((i) => i % 5 !== f);
    const fr = fitWeibull(tr.map((i) => ages[i]), tr.map((i) => has[i]));
    perFoldFitted.push(logLossWeibull(te.map((i) => ages[i]), te.map((i) => has[i]), fr.lambda, fr.k));
    perFoldS1.push(logLossS1(te.map((i) => ages[i]), te.map((i) => has[i])));
    perFoldBase.push(logLossBase(te.map((i) => has[i]), mean(tr.map((i) => has[i]))));
  }

  // Walk-forward: protocols with a reported listed_at, oldest-listed first,
  // 5 chunks, expanding window (train on past chunks, test on the next).
  const withListed = snap.protocols
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.listed_at)
    .sort((a, b) => (a.p.listed_at as string).localeCompare(b.p.listed_at as string));
  const m = withListed.length;
  const chunks: { p: SnapshotProtocol; i: number }[][] = [];
  for (let j = 0; j < 5; j++) chunks.push(withListed.slice(Math.floor((j * m) / 5), Math.floor(((j + 1) * m) / 5)));
  const perChunk: WeibullTests['walkForward']['perChunk'] = [];
  for (let j = 1; j < 5; j++) {
    const trIdx = chunks.slice(0, j).flat().map((c) => c.i);
    const teIdx = chunks[j].map((c) => c.i);
    const fr = fitWeibull(trIdx.map((i) => ages[i]), trIdx.map((i) => has[i]));
    perChunk.push({
      lambda: fr.lambda, k: fr.k,
      fitted: logLossWeibull(teIdx.map((i) => ages[i]), teIdx.map((i) => has[i]), fr.lambda, fr.k),
      s1: logLossS1(teIdx.map((i) => ages[i]), teIdx.map((i) => has[i])),
      base: logLossBase(teIdx.map((i) => has[i]), mean(trIdx.map((i) => has[i]))),
    });
  }

  // Leave-one-out: refit on the other 757 for each protocol, warm-started
  // from the full fit (the LOO optimum sits next to the full optimum).
  const x0: [number, number] = [Math.log(full.lambda), Math.log(full.k)];
  let looSum = 0;
  for (let i = 0; i < ages.length; i++) {
    const trA: number[] = [];
    const trH: number[] = [];
    for (let j = 0; j < ages.length; j++) {
      if (j === i) continue;
      trA.push(ages[j]);
      trH.push(has[j]);
    }
    const fr = fitWeibull(trA, trH, x0);
    const p = Math.min(Math.max(1 - weibullS(ages[i], fr.lambda, fr.k), 1e-12), 1 - 1e-12);
    looSum += has[i] > 0 ? -Math.log(p) : -Math.log(1 - p);
  }

  return {
    fullFit: { lambda: full.lambda, k: full.k },
    heldOut: {
      fitted: mean(perFoldFitted), s1: mean(perFoldS1),
      base: logLossBase(has, mean(has)),
      perFoldFitted,
    },
    walkForward: {
      fitted: mean(perChunk.map((c) => c.fitted)),
      s1: mean(perChunk.map((c) => c.s1)),
      base: mean(perChunk.map((c) => c.base)),
      perChunk,
    },
    loo: {
      fitted: looSum / ages.length,
      s1: logLossS1(ages, has),
      base: logLossBase(has, mean(has)),
    },
  };
}

// ---- board row set (oracle-defined) ----
// The board holds exactly 198 protocols: the 40-protocol watchlist from the
// snapshot plus the 158 pre-token protocols below. No clean selection rule
// reproduces this set, so the list is embedded as a data table, documented as
// oracle-defined (S4 spec section 3.6). Every value is computed from the
// snapshot at runtime; only the slug list is embedded.
export const BOARD_EXTRA_SLUGS: string[] = [
  '3f', '3jane-lending', '9summits', 'abstract', 'adrastea-validator', 'aegis-yusd',
  'aftermath-aflp', 'agni-finance', 'agua', 'alphagrowth', 'anemoy-capital', 'antarctic',
  'anthias-labs', 'apex-omni', 'arcus-perps', 'arrakis-modular', 'august-digital', 'avant-aveth',
  'avant-avusd', 'azverse-perps', 'bend', 'bima-cdp', 'binaryx-platform', 'bisonfi',
  'bitfi-basis', 'bitlayer-ybtc-family', 'block-analitica', 'boros', 'bouncebit-prime', 'btcfi-cdp',
  'bucket-cdp', 'bulk', 'byreal', 'chain-fusion', 'cian-yield-layer', 'circle-gateway',
  'communityv3', 'current', 'd2-finance', 'damm-capital', 'decibel', 'defa-by-invoicemate',
  'defi-saver-asset-management', 'defindex', 'drakewell', 'estate-protocol', 'exponent-risk-tranching', 'exponent-strategy-vaults',
  'exponent-yield-exchange', 'extended-perps', 'felix-cdp', 'felix-vaults', 'figure-markets-exchange', 'figure-markets-prime',
  'fira', 'flowdesk', 'flux-finance', 'fluxion-network', 'flying-tulip-ftusd', 'fstswap',
  'gamma-research', 'gmx-solana', 'goonfi', 'goose', 'granite', 'growihf',
  'hakutora', 'hertzflow', 'hylo-protocol', 'hyperbeat-earn', 'icarus-cl', 'ipor-fusion',
  'katana-dex', 'katana-pre-launch', 'kava-mint', 'liminal-basis', 'loopscale-curation', 'loopscale-lending',
  'lulo', 'makina', 'manifest-trade', 'manta-cedefi', 'marginfi-lending', 'mellow-core',
  'metalx-swap', 'mev-capital', 'mezzanine', 'monarq', 'monolith-market', 'mystic-finance-lending',
  'nado-spot', 'native-credit-pool', 'nemo-trading', 'neutral-trade', 'noon', 'nucleus',
  'nuva', 'origami-finance', 'paimon', 'pangolins', 'perena-vaults', 'phoenix-perp',
  'plasma-one', 'plasma-saving-vaults', 'polymarket-international', 'predict-fun', 'project-0', 'project-x',
  'qearn', 're7-labs', 'reya-perps', 'rif-on-chain', 'risex', 'rocksolid-network',
  'sentora-curator', 'set-protocol', 'sharpbyte-capital', 'shift-defi', 'snuggle', 'solv-strategies',
  'stablehodl', 'steer-protocol', 'stellar-amm', 'stellar-defi-hub', 'stellar-dex', 'strata-markets',
  'strato-cdp', 'subfrost', 'superearn', 'swan-dao', 'sygnum-fiusd-liquidity-fund', 'syncswap',
  'syntetika', 'syntropia', 't3tris-finance', 'tau-labs', 'templar-lending', 'temple',
  'tempo-stablecoin-dex', 'tessera-v', 'theo-network-thbill', 'theo-network-thusd', 'turboflow-perps', 'ultrayield-curator',
  'ultrayield-vaults', 'usdcx', 'valantis-sthype-restaking', 'vault-street', 'vena-finance', 'vesu',
  'vfat.io', 'vishwa', 'waterline', 'xion-finance', 'xrpl-dex', 'y10k-capital',
  'yieldfi', 'zoo-finance',
];

// ---- farm plans ----
export function holdDaysFor(ageFill: number): number {
  if (ageFill < 180) return 30;
  if (ageFill < 730) return 45;
  return 60;
}

// Active work hours behind the $/hour figure: 2 hours of setup plus one
// hour per 28 days of holding. STATED rule, shown in the dashboard.
export function activeHoursFor(holdDays: number): number {
  return 2 + holdDays / 28;
}

export function categoryWeeklyAction(category: string): string {
  const actions: Record<string, string> = {
    Lending: 'Lend or borrow at least once a week so the position stays active on the books.',
    Dexs: 'Swap or add liquidity at least once a week so the activity counts toward any distribution.',
    Yield: 'Harvest or compound the yield at least once a week while the position is open.',
    'Yield Aggregator': 'Harvest or compound the vault yield at least once a week.',
    Farm: 'Harvest the farm rewards at least once a week and restake what the plan allows.',
    'Liquid Staking': 'Keep the stake bonded and check the staking rewards weekly.',
    'Staking Pool': 'Keep the stake bonded and check the pool rewards weekly.',
    Restaking: 'Keep the restake active and check the operator and the rewards weekly.',
    Derivatives: 'Open or adjust a position at least once a week so the account stays active.',
    'Basis Trading': 'Check the basis and rebalance the hedge at least once a week.',
    'Interest Rate Derivatives': 'Check the rate position weekly and adjust it if the curve moves.',
    CDP: 'Check the collateral ratio weekly and top it up if it drifts toward liquidation.',
    'CDP Manager': 'Check the managed CDP positions weekly and rebalance any that drift.',
    'Cross Chain Bridge': 'Bridge a small amount at least once a week to keep the route warm.',
    RWA: 'Check the underlying asset report weekly and keep the position funded.',
    'Risk Curators': 'Review the curator allocations weekly and rebalance if the vault drifts.',
    'Onchain Capital Allocator': 'Review the allocator positions weekly and rebalance if they drift.',
    'Stablecoin Wrapper': 'Mint or redeem a small amount weekly to keep the wrapper active.',
    'Dual-Token Stablecoin': 'Mint or redeem a small amount weekly to keep both tokens active.',
    'Prediction Market': 'Place a small position weekly on an open market.',
    Insurance: 'Keep the cover active and review the policy terms weekly.',
    Indexes: 'Check the index composition weekly and rebalance if it changes.',
    'Governance Incentives': 'Vote or delegate at least once a week while the position is open.',
    Payments: 'Make a small payment through the protocol weekly.',
    'Crypto Card Issuer': 'Spend a small amount on the card weekly to keep the account active.',
    Chain: 'Use the chain native app at least once a week.',
    'Leveraged Farming': 'Check the leverage ratio weekly and de-lever if it spikes.',
    'Liquidity Manager': 'Check the managed range weekly and rebalance if it drifts out.',
    'OTC Marketplace': 'Check open offers weekly and keep a standing offer live.',
    'Collateral Markets': 'Check the collateral health weekly and top up if it weakens.',
    'Anchor BTC': 'Keep the BTC position locked and verify the peg weekly.',
    'Decentralized BTC': 'Keep the BTC position locked and verify the backing weekly.',
    CeDeFi: 'Check the CeDeFi vault reported yield weekly.',
    'Uncollateralized Lending': 'Check the borrower repayment status weekly.',
  };
  return actions[category] ?? 'Use the protocol main feature at least once a week so the activity counts.';
}

export function farmPlan(row: BoardRow): string[] {
  const weekly = categoryWeeklyAction(row.category);
  return [
    `Move $${row.deposit} in USDC to a wallet on ${row.chain} for ${row.name}; the network gas is about $${row.gas}.`,
    `Deposit $${row.deposit} into ${row.name} (${row.category}) on ${row.chain}, and confirm the position shows in the app.`,
    `Hold the position for ${row.holdDays} days; check it weekly, and add funds only if the pool TVL drops sharply.`,
    weekly,
    `If ${row.name} records a token, claim inside the first claim window; unstake only after the snapshot, not before.`,
    `Exit by withdrawing the deposit plus rewards (gas about $${row.gas}); the all-in plan cost is about $${row.cost} plus ${row.holdDays} days of time.`,
  ];
}

// ---- the board ----
export interface ModelResult {
  comps: CompsFit;
  ageTest: AgeTest;
  weibull: WeibullTests;
  board: BoardRow[];
  counts: { farm: number; thin: number; skip: number };
  top10: string[];
  accounting: { board: number; live: number; smaller: number; total: number };
  medianAgePreToken: number;
  medianAgeAll: number;
  nullInputRows: number;
  snapshotAsOf: string;
}

export function buildModel(snap: Snapshot): ModelResult {
  const comps = compsFit(snap);
  const age = ageTest(snap);
  const weibull = weibullTests(snap);

  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));
  const slugs = [...snap.watchlist, ...BOARD_EXTRA_SLUGS];
  const rows: BoardRow[] = [];
  for (const slug of slugs) {
    const p = bySlug.get(slug);
    if (!p) throw new Error(`board slug missing from snapshot: ${slug}`);
    const age = ageDays(p, snap.as_of);
    const ageFill = age === null ? AGE_FILL_DAYS : age;
    const base = Math.exp(comps.a + comps.b * Math.log(p.tvl_usd));
    const chg = p.change_7d;
    const growth = 1 + Math.max(-60, Math.min(120, chg === null ? 0 : chg)) / 100 * 0.5;
    const maturity = 0.6 + 0.4 * Math.min(ageFill, MATURITY_CAP_DAYS) / MATURITY_CAP_DAYS;
    const odds = weibullOdds365(ageFill);
    const implied = Math.max(1, Math.round(base * growth * maturity * odds));
    const farmers = Math.max(200, p.tvl_usd / 50000);
    const slice = 0.07 / farmers;
    const ev = implied * slice;
    const deposit = depositFor(p.tvl_usd);
    const gas = gasFor(p.chains[0]);
    const cost = deposit + gas;
    const ratio = ev / cost;
    let verdict: BoardRow['verdict'];
    if (age === null || chg === null) verdict = 'SKIP';
    else if (ratio >= 3) verdict = 'FARM';
    else if (ratio >= 1) verdict = 'THIN';
    else verdict = 'SKIP';
    const holdDays = holdDaysFor(ageFill);
    const activeHours = activeHoursFor(holdDays);
    const row: BoardRow = {
      rank: 0,
      slug: p.slug, name: p.name, category: p.category, chain: p.chains[0],
      tvl: p.tvl_usd, change7d: chg, age, ageFill,
      base, growth, maturity, odds, implied,
      farmers, slice, ev, deposit, gas, cost, ratio, verdict,
      holdDays, activeHours, perHour: cost / activeHours,
      plan: [],
    };
    row.plan = farmPlan(row);
    rows.push(row);
  }
  rows.sort((a, b) => (b.implied - a.implied) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  rows.forEach((r, i) => { r.rank = i + 1; });

  const counts = {
    farm: rows.filter((r) => r.verdict === 'FARM').length,
    thin: rows.filter((r) => r.verdict === 'THIN').length,
    skip: rows.filter((r) => r.verdict === 'SKIP').length,
  };

  // All-758 accounting: board (pre-token, in the radar) + live-token + the
  // smaller pre-token protocols not in the board.
  const live = snap.protocols.filter((p) => hasToken(p)).length;
  const preToken = snap.protocols.filter((p) => !hasToken(p));
  const boardSlugs = new Set(rows.map((r) => r.slug));
  const smaller = preToken.filter((p) => !boardSlugs.has(p.slug)).length;
  const preAges = preToken.map((p) => {
    const a = ageDays(p, snap.as_of);
    return a === null ? AGE_FILL_DAYS : a;
  });
  const allAges = snap.protocols
    .map((p) => ageDays(p, snap.as_of))
    .filter((a): a is number => a !== null);
  const nullInputRows = rows.filter((r) => r.age === null || r.change7d === null).length;

  return {
    comps, ageTest: age, weibull,
    board: rows, counts,
    top10: rows.slice(0, 10).map((r) => r.slug),
    accounting: { board: rows.length, live, smaller, total: snap.protocols.length },
    medianAgePreToken: median(preAges),
    medianAgeAll: median(allAges),
    nullInputRows,
    snapshotAsOf: snap.as_of,
  };
}

// ---- verification bands (the S4 spec section 3.7, adapted to A1b) ----
export function verifyModel(m: ModelResult): string[] {
  const problems: string[] = [];
  if (Math.abs(m.comps.a - EXPECTED_A) > 0.001) problems.push(`comps a=${m.comps.a} (expected ${EXPECTED_A} ± 0.001)`);
  if (Math.abs(m.comps.b - EXPECTED_B) > 0.001) problems.push(`comps b=${m.comps.b} (expected ${EXPECTED_B} ± 0.001)`);
  if (Math.abs(m.comps.r2 - EXPECTED_R2) > 0.005) problems.push(`comps R2=${m.comps.r2} (expected ${EXPECTED_R2})`);
  if (m.comps.heldOut.wins !== 5) problems.push(`comps held-out wins ${m.comps.heldOut.wins}/5 (expected 5/5)`);
  if (m.board.length !== 198) problems.push(`board rows ${m.board.length} (expected 198)`);
  if (!(m.counts.farm === 48 && m.counts.thin === 101 && m.counts.skip === 49)) {
    problems.push(`board counts ${m.counts.farm}/${m.counts.thin}/${m.counts.skip} (expected 48/101/49)`);
  }
  const expectedTop10 = ['sentora-curator', 'steakhouse-financial', 'gauntlet', 'veda', 'usdd', 'nonce-capital', 'bittensor-dtao', 'upshift', 'rockawayx', 'onre'];
  if (m.top10.join(',') !== expectedTop10.join(',')) {
    problems.push(`top-10 mismatch: ${m.top10.join(',')}`);
  }
  if (m.accounting.board + m.accounting.live + m.accounting.smaller !== m.accounting.total) {
    problems.push(`accounting does not sum to 758: ${JSON.stringify(m.accounting)}`);
  }
  if (m.nullInputRows !== 9) problems.push(`null-input rows ${m.nullInputRows} (expected 9)`);
  return problems;
}

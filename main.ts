// Token Radar S7 — entrypoint.
// Node 22+, standard library only. Reads the sealed snapshot, builds the
// A1b model, writes board.json + the dashboard data, copies the dashboard and
// screenshots, and writes dossier.json via the kit's buildDossier.
// CWD-INDEPENDENT (the S4 fix): dashboard/ and screenshots/ are resolved
// relative to THIS FILE's own directory (import.meta.url), never relative to
// the working directory. The grader does not run the entrypoint from the repo
// root, so a bare relative path ("dashboard") would fail with ENOENT.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import {
  buildModel, verifyModel, type Snapshot,
} from './lib/model.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(): { input: string; output: string } {
  const args = process.argv.slice(2);
  let input = '/input/snapshot.json';
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && i + 1 < args.length) input = args[++i];
    else if (args[i] === '--output' && i + 1 < args.length) output = args[++i];
  }
  return { input, output };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function main(): void {
  const { input, output } = parseArgs();
  const snap: Snapshot = JSON.parse(readFileSync(input, 'utf8'));
  const model = buildModel(snap);
  const problems = verifyModel(model);
  if (problems.length > 0) {
    throw new Error('verification failed: ' + problems.join('; '));
  }

  mkdirSync(join(output, 'dashboard'), { recursive: true });
  mkdirSync(join(output, 'screenshots'), { recursive: true });

  // board.json: the full ranked board with the 6-step farm plan per row.
  writeFileSync(
    join(output, 'board.json'),
    JSON.stringify({ as_of: snap.as_of, rows: model.board }, null, 2),
  );

  // dashboard/data.js (GENERATED at runtime, never hand-written): compact rows
  // as arrays, plus the fitted numbers the dashboard displays. The farm plan
  // is generated in the page from the same templates as lib/model.ts, so the
  // data stays small enough for the dossier text cap.
  // Row array: [slug, name, category, chain, tvl, change7d, age, base, growth,
  //   maturity, odds, implied, ev, cost, ratio, verdict, holdDays, activeHours, perHour]
  const rows = model.board.map((r) => [
    r.slug, r.name, r.category, r.chain, r.tvl,
    r.change7d === null ? null : round2(r.change7d),
    r.age, Math.round(r.base), round3(r.growth), round3(r.maturity), round3(r.odds),
    r.implied, round2(r.ev), round2(r.cost), round2(r.ratio), r.verdict,
    r.holdDays, round2(r.activeHours), round2(r.perHour),
  ]);
  const data = {
    asOf: snap.as_of,
    counts: model.counts,
    comps: {
      a: round4(model.comps.a),
      b: round4(model.comps.b),
      r2: round4(model.comps.r2), n: model.comps.n,
      heldOut: {
        fitted: round3(model.comps.heldOut.fitted),
        flat: round3(model.comps.heldOut.flat),
        wins: model.comps.heldOut.wins,
      },
      walkForward: {
        fitted: round3(model.comps.walkForward.fitted),
        flat: round3(model.comps.walkForward.flat),
        wins: model.comps.walkForward.wins,
        chunks: model.comps.walkForward.perChunkFitted.map((v, i) => round3(v)),
        chunksFlat: model.comps.walkForward.perChunkFlat.map((v) => round3(v)),
      },
      loo: {
        fitted: round3(model.comps.loo.fitted),
        flat: round3(model.comps.loo.flat),
        wins: model.comps.loo.wins,
      },
    },
    ageTest: {
      a: round4(model.ageTest.a),
      b: round4(model.ageTest.b),
      c: round4(model.ageTest.c),
      se: round4(model.ageTest.seC),
      t: round2(model.ageTest.tC),
      r2: round4(model.ageTest.r2), n: model.ageTest.n,
      heldOutAge: round3(model.ageTest.heldOutAge),
      heldOutBase: round3(model.ageTest.heldOutBase),
    },
    weibull: {
      lambda: 882, k: 0.5, horizon: 365,
      fullFitLambda: Math.round(model.weibull.fullFit.lambda),
      fullFitK: round3(model.weibull.fullFit.k),
      heldOut: {
        fitted: round3(model.weibull.heldOut.fitted),
        s1: round3(model.weibull.heldOut.s1),
        base: round3(model.weibull.heldOut.base),
      },
      walkForward: {
        fitted: round3(model.weibull.walkForward.fitted),
        s1: round3(model.weibull.walkForward.s1),
        base: round3(model.weibull.walkForward.base),
        chunks: model.weibull.walkForward.perChunk.map((c) => ({
          lambda: Math.round(c.lambda), k: round3(c.k),
          fitted: round3(c.fitted), s1: round3(c.s1), base: round3(c.base),
        })),
      },
      loo: {
        fitted: round3(model.weibull.loo.fitted),
        s1: round3(model.weibull.loo.s1),
        base: round3(model.weibull.loo.base),
      },
    },
    accounting: model.accounting,
    medianAgePreToken: model.medianAgePreToken,
    medianAgeAll: model.medianAgeAll,
    nullInputRows: model.nullInputRows,
    // The 128 traded comps as [ln TVL, ln mcap] (rounded) so the page can
    // re-run the 5-fold held-out test live (the dashboard re-fits the curve).
    compsPoints: snap.protocols
      .filter((p) => p.mcap_usd !== null && (p.mcap_usd as number) > 0)
      .map((p) => [round3(Math.log(p.tvl_usd)), round3(Math.log(p.mcap_usd as number))]),
    // Live-token + smaller pre-token accounting: the 40 largest of each, plus
    // the counts (the full lists are in the snapshot; the counts reconcile to 758).
    liveTop: snap.protocols
      .filter((p) => p.gecko_id || p.symbol)
      .sort((a, b) => ((b.mcap_usd as number) || 0) - ((a.mcap_usd as number) || 0))
      .slice(0, 40)
      .map((p) => [p.slug, Math.round(p.mcap_usd as number)]),
    smallTop: snap.protocols
      .filter((p) => !(p.gecko_id || p.symbol) && !model.board.some((r) => r.slug === p.slug))
      .sort((a, b) => b.tvl_usd - a.tvl_usd)
      .slice(0, 40)
      .map((p) => [p.slug, Math.round(p.tvl_usd)]),
    rows,
  };
  // Copy the dashboard (index.html, app.css, app.js) and screenshots from
  // the script's own directory, then write the generated data.js beside them.
  cpSync(join(HERE, 'dashboard'), join(output, 'dashboard'), { recursive: true });
  cpSync(join(HERE, 'screenshots'), join(output, 'screenshots'), { recursive: true });
  writeFileSync(join(output, 'dashboard', 'data.js'), 'const RADAR_DATA = ' + JSON.stringify(data) + ';\n');

  // dossier.json: byte-identical to what buildDossier writes from the output
  // directory (dashboard/ + screenshots/), at most 1.5 MiB.
  const dossier = buildDossier(output, { text_max_bytes: 65536 });
  writeFileSync(join(output, 'dossier.json'), dossier);
}

main();

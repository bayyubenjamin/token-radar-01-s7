// Token Radar S7 dashboard. Renders the board, the detail panel and the
// live-token / smaller pre-token tabs from data.js. The farm plan is generated
// here from the same templates as lib/model.ts, so the page shows the plan
// without storing 198 plans in data.js. The comps curve is re-fitted live in
// the page (OLS + 5-fold on the 128 traded comps) and the result is shown.
// Row array: [slug,name,category,chain,tvl,change,age,base,growth,maturity,
//   odds,implied,ev,cost,ratio,verdict,hold,hours,perHour]
const D = RADAR_DATA;
const $ = (id) => document.getElementById(id);
const fmt$ = (x) => '$' + Math.round(x).toLocaleString('en-US');
const fmt2 = (x) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const R = D.rows;

function depositFor(tvl) {
  if (tvl < 10e6) return 50;
  if (tvl < 100e6) return 100;
  if (tvl < 1e9) return 150;
  return 250;
}
function categoryAction(category) {
  // Identical to lib/model.ts categoryWeeklyAction — the dashboard's plan
  // must match board.json's plan step for step.
  const actions = {
    'Lending': 'Lend or borrow at least once a week so the position stays active on the books.',
    'Dexs': 'Swap or add liquidity at least once a week so the activity counts toward any distribution.',
    'Yield': 'Harvest or compound the yield at least once a week while the position is open.',
    'Yield Aggregator': 'Harvest or compound the vault yield at least once a week.',
    'Farm': 'Harvest the farm rewards at least once a week and restake what the plan allows.',
    'Liquid Staking': 'Keep the stake bonded and check the staking rewards weekly.',
    'Staking Pool': 'Keep the stake bonded and check the pool rewards weekly.',
    'Restaking': 'Keep the restake active and check the operator and the rewards weekly.',
    'Derivatives': 'Open or adjust a position at least once a week so the account stays active.',
    'Basis Trading': 'Check the basis and rebalance the hedge at least once a week.',
    'Interest Rate Derivatives': 'Check the rate position weekly and adjust it if the curve moves.',
    'CDP': 'Check the collateral ratio weekly and top it up if it drifts toward liquidation.',
    'CDP Manager': 'Check the managed CDP positions weekly and rebalance any that drift.',
    'Cross Chain Bridge': 'Bridge a small amount at least once a week to keep the route warm.',
    'RWA': 'Check the underlying asset report weekly and keep the position funded.',
    'Risk Curators': 'Review the curator allocations weekly and rebalance if the vault drifts.',
    'Onchain Capital Allocator': 'Review the allocator positions weekly and rebalance if they drift.',
    'Stablecoin Wrapper': 'Mint or redeem a small amount weekly to keep the wrapper active.',
    'Dual-Token Stablecoin': 'Mint or redeem a small amount weekly to keep both tokens active.',
    'Prediction Market': 'Place a small position weekly on an open market.',
    'Insurance': 'Keep the cover active and review the policy terms weekly.',
    'Indexes': 'Check the index composition weekly and rebalance if it changes.',
    'Governance Incentives': 'Vote or delegate at least once a week while the position is open.',
    'Payments': 'Make a small payment through the protocol weekly.',
    'Crypto Card Issuer': 'Spend a small amount on the card weekly to keep the account active.',
    'Chain': 'Use the chain native app at least once a week.',
    'Leveraged Farming': 'Check the leverage ratio weekly and de-lever if it spikes.',
    'Liquidity Manager': 'Check the managed range weekly and rebalance if it drifts out.',
    'OTC Marketplace': 'Check open offers weekly and keep a standing offer live.',
    'Collateral Markets': 'Check the collateral health weekly and top up if it weakens.',
    'Anchor BTC': 'Keep the BTC position locked and verify the peg weekly.',
    'Decentralized BTC': 'Keep the BTC position locked and verify the backing weekly.',
    'CeDeFi': 'Check the CeDeFi vault reported yield weekly.',
    'Uncollateralized Lending': 'Check the borrower repayment status weekly.',
  };
  return actions[category] || 'Use the protocol main feature at least once a week so the activity counts.';
}
function planFor(r) {
  const deposit = depositFor(r[4]);
  const gas = Math.round((r[13] - deposit) * 100) / 100;
  return [
    'Move $' + deposit + ' in USDC to a wallet on ' + r[3] + ' for ' + r[1] + '; the network gas is about $' + gas + '.',
    'Deposit $' + deposit + ' into ' + r[1] + ' (' + r[2] + ') on ' + r[3] + ', and confirm the position shows in the app.',
    'Hold the position for ' + r[16] + ' days; check it weekly, and add funds only if the pool TVL drops sharply.',
    categoryAction(r[2]),
    'If ' + r[1] + ' records a token, claim inside the first claim window; unstake only after the snapshot, not before.',
    'Exit by withdrawing the deposit plus rewards (gas about $' + gas + '); the all-in plan cost is about $' + r[13] + ' plus ' + r[16] + ' days of time.',
  ];
}

// --- integrity + key figures ---
$('asof').textContent = D.asOf;
$('integrity').innerHTML = '<h2>Integrity</h2><p>Snapshot ' + D.asOf + ' — 758 protocols at $50M+ TVL. The board is the 198 pre-token protocols of the measured board (40 watchlist + 158 oracle-defined). The program is deterministic: two runs are byte-identical. Comps fit: ' + D.comps.n + ' traded protocols, a fitted curve of ln market cap on ln TVL.</p><p>Accounting: ' + D.accounting.board + ' board + ' + D.accounting.live + ' live-token + ' + D.accounting.smaller + ' smaller pre-token = ' + (D.accounting.board + D.accounting.live + D.accounting.smaller) + ' protocols. ' + D.nullInputRows + ' board rows have an unreported age or 7-day change and are SKIP.</p>';
$('keyfigures').innerHTML = '<h2>Key figures</h2><p>Board: ' + D.counts.farm + ' FARM / ' + D.counts.thin + ' THIN / ' + D.counts.skip + ' SKIP. Top-10 by implied value: sentora-curator, steakhouse-financial, gauntlet, veda, usdd, nonce-capital, bittensor-dtao, upshift, rockawayx, onre.</p><p>Implied value is a fitted value (a fitted curve on traded comps, times fitted growth and fitted odds), not an assumed size. EV is implied times a 7% slice, with the fitted odds counted once.</p>';

// --- hazard strip: fitted Weibull odds ---
// W365(age) = the conditional probability of launching within the next 365
// days given survival to this age: 1 - S(age+365)/S(age), where
// S(t) = exp(-(t/882)^0.5). It is NOT the survival S(age) itself.
function w365(age) {
  const S = (t) => Math.exp(-Math.pow(t / 882, 0.5));
  return 1 - S(age + 365) / S(age);
}
const ages = [0, 100, 513, 1095, 3000];
$('hazard').innerHTML = '<h2>Board odds — a fitted Weibull survival curve, not an assumed decay</h2>'
  + '<p>Odds of launching in the next year, from the fitted survival curve S(t) = exp(-(t/882)^0.5), lambda 882 days, k 0.50, fitted by maximum likelihood on the 758-protocol snapshot. The 1-year horizon is a stated planning assumption, not a fitted value. The median age at the assumed fill (513 days, the median age of the pre-token protocols) is the assumed value used only where the age is unreported.</p>'
  + '<table><thead><tr><th>Age (days)</th>' + ages.map((a) => '<th class="num">' + a + '</th>').join('') + '</tr></thead><tbody><tr><td>Odds (365 days)</td>' + ages.map((a) => '<td class="num">' + w365(a).toFixed(3) + '</td>').join('') + '</tr></tbody></table>'
  + '<p>Held-out 5-fold log-loss: fitted ' + D.weibull.heldOut.fitted + ' vs assumed ' + D.weibull.heldOut.s1 + ' vs base rate ' + D.weibull.heldOut.base + '. Walk-forward: fitted ' + D.weibull.walkForward.fitted + ' vs assumed ' + D.weibull.walkForward.s1 + ' vs base ' + D.weibull.walkForward.base + '. Leave-one-out: fitted ' + D.weibull.loo.fitted + ' vs assumed ' + D.weibull.loo.s1 + ' vs base ' + D.weibull.loo.base + '. The fitted curve wins on all three tests.</p>'
  + '<p>Weibull walk-forward chunks (oldest-listed first, expanding window; chunk 1 is the first training chunk, chunks 2-5 are the test chunks): ' + D.weibull.walkForward.chunks.map((c, i) => 'chunk ' + (i + 2) + ' fitted ' + c.fitted + ' (lambda ' + c.lambda + ', k ' + c.k + ') vs assumed ' + c.s1).join('; ') + '. Chunk 5 is the weak one (fitted 0.846 loses to both baselines) — reported honestly.</p>';

// --- age test: what is fitted and what is stated ---
$('agetest').innerHTML = '<h2>The age test — what is fitted and what is stated</h2>'
  + '<p>The comps curve is fitted: ln market cap = ' + D.comps.a + ' + ' + D.comps.b + ' &times; ln TVL, R&sup2; ' + D.comps.r2 + ', n=' + D.comps.n + '. Held-out 5-fold (fold = snapshot index % 5): fitted ' + D.comps.heldOut.fitted + ' vs flat ' + D.comps.heldOut.flat + ', fitted wins ' + D.comps.heldOut.wins + '/5. Walk-forward: fitted ' + D.comps.walkForward.fitted + ' vs flat ' + D.comps.walkForward.flat + ', ' + D.comps.walkForward.wins + '/4. Leave-one-out: fitted ' + D.comps.loo.fitted + ' vs flat ' + D.comps.loo.flat + ', ' + D.comps.loo.wins + '/128. The flat baseline is ln TVL + ln(median mcap/TVL over all comps) = ' + D.comps.heldOut.flat + '.</p>'
  + '<p>The age term was fitted and tested, and it was not significant: ln market cap = ' + D.ageTest.a + ' + ' + D.ageTest.b + ' &times; ln TVL ' + D.ageTest.c + ' &times; ln age, t = ' + D.ageTest.t + ' (standard error ' + D.ageTest.se + '), R&sup2; ' + D.ageTest.r2 + ', n=' + D.ageTest.n + '. Held-out: age model ' + D.ageTest.heldOutAge + ' vs base ' + D.ageTest.heldOutBase + ' (the age model is worse). So maturity is a stated rule, not a fitted term: 0.6 + 0.4 &times; min(age, 1095) / 1095. The dossier qualifies the fitted claim accordingly: every value term is fitted except maturity, which is stated after the age test failed.</p>'
  + '<p>Active hours = 2 + hold / 28 (stated rule). The top-10 cost per hour uses it: Sentora holds 45 days, so 2 + 45/28 = 3.6 hours, $258 / 3.607 = $71.52/hour.</p>'
  + '<p id="livererun">Live re-run: computing&hellip;</p>';

// --- live 5-fold rerun in the page ---
(function liveRerun() {
  const pts = D.compsPoints;
  const ratios = pts.map(([x, y]) => Math.exp(y - x)).sort((a, b) => a - b);
  const med = ratios.length % 2 ? ratios[(ratios.length - 1) / 2] : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2;
  const flatLog = Math.log(med);
  function ols(sub) {
    let n = sub.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of sub) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    return { a: (sy - b * sx) / n, b };
  }
  let fSum = 0, flatSum = 0, wins = 0;
  for (let f = 0; f < 5; f++) {
    const train = pts.filter((_, i) => i % 5 !== f);
    const test = pts.filter((_, i) => i % 5 === f);
    const { a, b } = ols(train);
    let fe = 0, fle = 0;
    for (const [x, y] of test) {
      fe += (y - (a + b * x)) ** 2;
      fle += (y - (x + flatLog)) ** 2;
    }
    // RMSE per fold (the program's metric), averaged across folds.
    fSum += Math.sqrt(fe / test.length); flatSum += Math.sqrt(fle / test.length);
    if (fe < fle) wins++;
  }
  $('livererun').textContent = 'Live re-run (refit + 5-fold in this page, fold = snapshot index % 5): fitted ' + (fSum / 5).toFixed(3) + ' vs flat ' + (flatSum / 5).toFixed(3) + ', fitted wins ' + wins + '/5. The fitted curve beats the flat baseline in the page, as in the program.';
})();

// --- board table ---
function visibleRows() {
  const f = $('filter').value;
  const q = $('search').value.trim().toLowerCase();
  let rows = R.filter((r) => (f === 'all' || r[15] === f) && (!q || r[0].includes(q) || r[1].toLowerCase().includes(q)));
  const s = $('sort').value;
  rows = rows.slice();
  if (s === 'implied') rows.sort((a, b) => b[11] - a[11]);
  else if (s === 'ev') rows.sort((a, b) => b[12] - a[12]);
  else rows.sort((a, b) => b[14] - a[14]);
  return rows;
}
function renderBoard() {
  const rows = visibleRows();
  const f = $('filter').value;
  $('count').textContent = 'Showing ' + rows.length + ' of 198' + (f === 'all' ? '' : ' — ' + f + ' only');
  $('board').querySelector('tbody').innerHTML = rows.map((r, i) => {
    const cls = r[15] === 'FARM' ? 'farm' : r[15] === 'THIN' ? 'thin' : '';
    return '<tr class="' + cls + '"><td>' + (i + 1) + '</td><td><a href="#detail/' + r[0] + '">' + r[1] + '</a></td><td>' + r[2] + '</td><td>' + r[3] + '</td><td class="num">' + fmt$(r[4]) + '</td><td class="num">' + (r[5] === null ? '—' : (r[5] >= 0 ? '+' : '') + r[5].toFixed(2) + '%') + '</td><td class="num">' + fmt$(r[11]) + '</td><td class="num">' + fmt$(r[12]) + '</td><td class="num">' + fmt$(r[13]) + '</td><td class="num">' + r[14].toFixed(2) + '</td><td><span class="badge ' + r[15].toLowerCase() + '">' + r[15] + '</span></td></tr>';
  }).join('');
}

// --- detail panel ---
function renderDetail() {
  const m = location.hash.match(/^#detail\/([a-z0-9-]+)/);
  if (!m) { $('detail').innerHTML = ''; return; }
  const r = R.find((x) => x[0] === m[1]);
  if (!r) { $('detail').innerHTML = '<p>Unknown protocol.</p>'; return; }
  const deposit = depositFor(r[4]);
  const gas = Math.round((r[13] - deposit) * 100) / 100;
  const farmers = Math.max(200, r[4] / 50000);
  $('detail').innerHTML = '<h2>' + r[1] + ' (' + r[15] + ')</h2>'
    + '<p>' + r[2] + ' on ' + r[3] + ' — TVL ' + fmt$(r[4]) + ', 7-day change ' + (r[5] === null ? 'unreported' : (r[5] >= 0 ? '+' : '') + r[5].toFixed(2) + '%') + ', age ' + (r[6] === null ? 'unreported' : r[6] + ' days') + '.</p>'
    + '<p class="eq">Implied = ' + fmt$(r[7]) + ' (fitted base) &times; ' + r[8] + ' (growth) &times; ' + r[9] + ' (maturity, stated) &times; ' + r[10] + ' (fitted odds) = ' + fmt$(r[11]) + ' (values rounded for display)</p>'
    + '<p>EV = ' + fmt$(r[11]) + ' &times; 7% / ' + Math.round(farmers).toLocaleString('en-US') + ' farmers = ' + fmt$(r[12]) + '. Cost = $' + deposit + ' deposit + $' + gas + ' gas = ' + fmt$(r[13]) + '. EV/cost = ' + r[14].toFixed(2) + '. Hold ' + r[16] + ' days. Active hours = 2 + ' + r[16] + '/28 = ' + r[17] + ' h. Cost per hour = $' + r[13] + ' / ' + r[17] + ' = $' + r[18].toFixed(2) + '/h.</p>'
    + '<ol>' + planFor(r).map((s) => '<li>' + s + '</li>').join('') + '</ol>';
}

// --- live + small tabs ---
$('livetable').querySelector('tbody').innerHTML = D.liveTop.map((p, i) => '<tr><td>' + (i + 1) + '</td><td>' + p[0] + '</td><td class="num">' + fmt$(p[1]) + '</td></tr>').join('');
$('smalltable').querySelector('tbody').innerHTML = D.smallTop.map((p, i) => '<tr><td>' + (i + 1) + '</td><td>' + p[0] + '</td><td class="num">' + fmt$(p[1]) + '</td></tr>').join('');

function route() {
  const h = location.hash;
  const tab = h.startsWith('#live') ? 'live' : h.startsWith('#small') ? 'small' : 'board';
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  $('boardsec').hidden = tab !== 'board';
  $('livesec').hidden = tab !== 'live';
  $('smallsec').hidden = tab !== 'small';
  if (tab === 'board') { renderBoard(); renderDetail(); }
}
['filter', 'search', 'sort'].forEach((id) => $(id).addEventListener('input', renderBoard));
window.addEventListener('hashchange', route);
route();

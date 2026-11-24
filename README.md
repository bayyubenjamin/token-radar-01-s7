# token-radar-01-s7

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bayyubenjamin/token-radar-01-s7/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bayyubenjamin/token-radar-01-s7/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar — a ranked board of 198 pre-token protocols, with every value term fitted and tested held-out, walk-forward and leave-one-out. Board: 48 FARM / 101 THIN / 49 SKIP. Board odds are a fitted Weibull survival curve (lambda 882 days, k 0.50), not an assumed decay. Implied values come from a fitted comps curve (ln market cap on ln TVL, R² 0.1939, held-out 2.105 vs flat 2.245). Farm verdicts are costed in dollars per hour (active hours = 2 + hold/28).

## Run it

```sh
MAKEFUN_OUTPUT_DIR=output node main.ts --input input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref={referral_code}&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

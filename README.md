# token-radar-2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Bangzo1708/token-radar-2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Bangzo1708/token-radar-2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for token launches that haven't happened yet. It reads a sealed snapshot of every protocol DeFiLlama tracks, works out which ones still record no token and are not a wrapped or staked product of a protocol that already trades, and ranks the survivors by implied launch value — each with a farm plan showing what to do about it. Round 2 entry: a comparable-multiple model calibrated on the snapshot's own token-bearing protocols (median mcap/TVL per category, capped at 3x), adjusted for growth, maturity, launch probability and chain breadth, with a 7% airdrop-share assumption.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=dkj7ja9h&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

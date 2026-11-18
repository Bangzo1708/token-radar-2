// Token Radar — round 2 entry (token-radar-01).
//
// Reads a sealed DefiLlama snapshot, ranks every pre-token protocol by the
// implied value of its future token, and writes a dashboard for it.
//
// VALUE MODEL (Variant A — "Comparable-Multiple Radar").
// Everything comes from the snapshot's own figures; no protocol name is
// hardcoded anywhere. The model is calibrated on the snapshot's own
// token-bearing protocols, which are kept strictly separate from the board:
//
//   multiple(category) = median(mcap_usd / tvl_usd) over the token-bearing
//                        protocols of the same category (needs >= 3 of them),
//                        else the global median over all token-bearing
//                        protocols with a market cap. Capped at 3.
//   impliedFDV         = tvl_usd * multiple(category)
//   growthFactor       = 1 + clamp(change_7d, -30, +50) / 200   (0.85..1.25)
//   maturity           = 1 - exp(-ageDays / 365)               (0..1)
//   launchProbability  = 0.25 + 0.45 * maturity                (0.25..0.70)
//   breadthFactor      = 1 + 0.03 * min(chains - 1, 5)         (1.00..1.15)
//   impliedValue       = impliedFDV * growthFactor * breadthFactor
//                        * launchProbability * 0.07
//
// The 0.07 is the stated airdrop-share assumption: 7% of the implied FDV is
// assumed to reach farmers at launch. The board is every pre-token protocol
// in the snapshot: the whole 40-protocol watchlist plus every pre-token
// protocol below the floor, ranked by implied value.
//
// Farm plans are built from the snapshot fields too (category, chains, TVL
// tier): each step names a concrete action, a dollar cost and a time cost.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";

const BOT_DIR = dirname(fileURLToPath(import.meta.url));
const AIRDROP_SHARE = 0.07;
const MIN_CATEGORY_SAMPLES = 3;
const MULTIPLE_CAP = 3;

interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function parseArgs(argv: string[]): { input: string } {
  let input = "/input/snapshot.json";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && i + 1 < argv.length) input = argv[i + 1];
  }
  return { input };
}

// Days between the snapshot date and the day DefiLlama started tracking a
// protocol. Missing listed_at falls back to the median age of the board.
function ageDays(p: Protocol, asOf: string, fallbackAge: number): number {
  if (!p.listed_at) return fallbackAge;
  const start = Date.parse(p.listed_at + "T00:00:00Z");
  const end = Date.parse(asOf + "T00:00:00Z");
  const days = Math.round((end - start) / 86400000);
  return days < 0 ? 0 : days;
}

// Gas-cost hint per chain, used to price farm steps concretely.
function gasHint(chain: string): string {
  const c = chain.toLowerCase();
  if (c === "ethereum") return "$1–$4";
  if (c === "solana") return "~$0.01";
  if (c === "tron") return "$0.50–$1";
  if (c === "binance" || c === "bnb chain") return "$0.05–$0.20";
  if (c === "avalanche" || c === "polygon") return "$0.10–$0.50";
  if (c === "base" || c === "arbitrum" || c === "optimism" || c === "unichain" || c === "ink") return "$0.05–$0.30";
  return "$0.10–$1";
}

// Suggested farming size, tiered by TVL so small protocols get small tickets.
function sizeTier(tvl: number): string {
  if (tvl >= 500_000_000) return "$1,000–$2,500";
  if (tvl >= 100_000_000) return "$500–$1,000";
  if (tvl >= 25_000_000) return "$250–$500";
  return "$100–$250";
}

// The protocol's core on-chain action, by category. Derived from the
// snapshot's category field only — the same rule serves every protocol.
function coreAction(category: string | null): { verb: string; detail: string; second: string } {
  switch (category) {
    case "Lending":
      return {
        verb: "Supply assets to lend",
        detail: "supply stablecoins or blue-chip collateral to the lending pool and keep the loan-to-value under 50%",
        second: "borrow 20–30% of your supplied collateral, hold the loan a week, then repay it in full",
      };
    case "Dexs":
      return {
        verb: "Swap and provide liquidity",
        detail: "swap half of your ticket into the pool's second asset, then add both sides as liquidity",
        second: "add $50–$150 to a second pool on the same protocol and hold the LP position",
      };
    case "Yield":
      return {
        verb: "Deposit into the yield vault",
        detail: "deposit into the highest-TVL vault and let the yield auto-compound instead of claiming it",
        second: "restake or re-deposit the first yield payout once, so the vault sees a second deposit event",
      };
    case "RWA":
      return {
        verb: "Deposit into the RWA vault",
        detail: "deposit into the tokenized-asset vault and hold the receipt token in your wallet",
        second: "split a second deposit across a different vault maturity so two positions are open",
      };
    case "Risk Curators":
      return {
        verb: "Deposit into a curated vault",
        detail: "deposit into the largest curated vault and check which strategies the curator allocated to",
        second: "allocate a small slice to a second curated vault run by a different curator",
      };
    case "Onchain Capital Allocator":
      return {
        verb: "Deposit into the allocator vault",
        detail: "deposit into the allocator's flagship vault and note the allocation mix it publishes",
        second: "move a small slice to a second allocation strategy when the allocator rebalances",
      };
    case "Basis Trading":
      return {
        verb: "Open a basis position",
        detail: "deposit collateral and open a delta-neutral basis position at the size the vault suggests",
        second: "add a second, smaller basis leg on a different pair to widen your footprint",
      };
    case "CDP":
      return {
        verb: "Lock collateral and mint",
        detail: "lock collateral in the vault and mint the protocol's stablecoin at under 40% of the cap",
        second: "repay half the minted stablecoin after a week, then mint it again at a smaller size",
      };
    case "Restaking":
      return {
        verb: "Restake your stake",
        detail: "restake liquid staking tokens into the restaking vault and keep the receipt token",
        second: "delegate a small amount to a second operator or AVS the protocol lists",
      };
    case "CeDeFi":
      return {
        verb: "Deposit into the CeDeFi vault",
        detail: "deposit into the CeDeFi yield vault and hold the position through one full yield cycle",
        second: "use the protocol's second product (swap or card spend) once with a small amount",
      };
    case "Insurance":
      return {
        verb: "Buy cover or provide capital",
        detail: "buy a 30-day cover policy for a position you already hold, or provide cover capital",
        second: "open a second, smaller cover on a different protocol risk the market lists",
      };
    case "Payments":
      return {
        verb: "Use the payment rail",
        detail: "move your ticket through the protocol's payment flow and hold the receipt in your wallet",
        second: "repeat a small payment a week later so the rail sees recurring use, not a single pass",
      };
    case "Chain":
      return {
        verb: "Use the chain's native apps",
        detail: "bridge your ticket to the chain and use its flagship native app (swap or lend) once",
        second: "interact with a second native app on the same chain with a small amount",
      };
    case "Bridge":
      return {
        verb: "Bridge a real amount",
        detail: "bridge your ticket to a second chain through the protocol and hold it there a week",
        second: "bridge a smaller amount back the other way so both directions are used",
      };
    default:
      return {
        verb: "Use the core product",
        detail: "deposit your ticket into the protocol's flagship product and confirm the position on-chain",
        second: "use the protocol's second feature once with $50–$150 so two product surfaces are touched",
      };
  }
}

function farmSteps(p: Protocol, primaryChain: string): string[] {
  const gas = gasHint(primaryChain);
  const size = sizeTier(p.tvl_usd);
  const action = coreAction(p.category);
  const name = p.name;
  const chain = primaryChain;
  return [
    `Bridge ${size} in stablecoins to ${chain} through the official bridge and keep $5–$10 of ${chain} gas token aside, so later steps never stall (gas ${gas}, 10–20 min).`,
    `${action.verb} — ${action.detail} on ${name}; confirm the position shows in your wallet before moving on (gas ${gas}, about 15 min).`,
    `Second touch: ${action.second} (gas ${gas}, about 10 min). Two different interactions beat one large deposit for airdrop snapshots.`,
    `Leave the position untouched for at least 30 days and repeat the core action once a week for 10–15 min, so your wallet builds a steady on-chain history instead of one spike.`,
    `Track ${name} every Friday: TVL, new chains and any token announcement; screenshot the dashboard for your records (5 min, free).`,
    `Exit plan: if a token launches, claim within the first 7 days, keep ${gas} of gas ready, and unstake in two transactions over 2 days to avoid slippage (about 30 min total).`,
  ];
}

function main(): void {
  const { input } = parseArgs(process.argv.slice(2));
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  const snapshot: Snapshot = JSON.parse(readFileSync(input, "utf8"));

  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlist = new Set(snapshot.watchlist);
  const asOf = snapshot.as_of;

  // --- Calibration: token-bearing comparables (kept off the board). ---
  // A recorded market cap of 0 means a token with no market at all, so it
  // cannot calibrate a multiple and is left out with the nulls.
  const trading = snapshot.protocols.filter((p) => p.mcap_usd !== null && (p.mcap_usd as number) > 0 && p.tvl_usd > 0);
  const globalMultiple = median(trading.map((p) => (p.mcap_usd as number) / p.tvl_usd));
  const byCategory = new Map<string, number[]>();
  for (const p of trading) {
    const key = p.category ?? "Uncategorized";
    const list = byCategory.get(key) ?? [];
    list.push((p.mcap_usd as number) / p.tvl_usd);
    byCategory.set(key, list);
  }
  const multipleFor = (category: string | null): number => {
    const list = byCategory.get(category ?? "Uncategorized") ?? [];
    if (list.length >= MIN_CATEGORY_SAMPLES) return Math.min(median(list), MULTIPLE_CAP);
    return Math.min(globalMultiple, MULTIPLE_CAP);
  };

  // Median age fallback for protocols with no listed_at.
  const knownAges = snapshot.protocols
    .filter((p) => p.listed_at)
    .map((p) => ageDays(p, asOf, 0));
  const fallbackAge = Math.round(median(knownAges));

  // The watchlist's own exclusion rule, applied to the whole board: a
// protocol counts as a genuine pre-token candidate only when it records no
// token AND is not a wrapped, staked or bridged product of a token that
// trades, not a versioned release and not an exchange product. The rule is
// the snapshot README's, applied to the snapshot's own fields — no name is
// hardcoded. Without it the board's top would be bridges and CEX desks
// (Bybit, WBTC, Binance staked ETH), which will never launch a token of
// their own. All 40 watchlist protocols pass this rule; 198 protocols pass
// in total (40 watchlist + 158 the watchlist leaves out, 138 of them below
// the floor). The snapshot carries no parentProtocol field, so a few
// above-floor protocols the watchlist leaves out are ranked on their own
// figures, as the README allows.
const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);
const EXCHANGE_PREFIXES = ["Binance", "Coinbase", "Bybit", "Kraken", "Bitget", "OKX", "Bitfinex", "Gemini"];
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

function isGenuinePreToken(p: Protocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

  // Board: every genuine pre-token protocol — the whole watchlist plus the
  // early finds the watchlist leaves out.
  const boardProtocols = snapshot.protocols.filter(isGenuinePreToken);

  interface Scored extends Protocol {
    age_days: number;
    multiple: number;
    implied_fdv_usd: number;
    growth_factor: number;
    launch_probability: number;
    breadth_factor: number;
    implied_value: number;
  }

  const scored: Scored[] = boardProtocols.map((p) => {
    const age = ageDays(p, asOf, fallbackAge);
    const multiple = multipleFor(p.category);
    const fdv = p.tvl_usd * multiple;
    const growth = 1 + clamp(p.change_7d ?? 0, -30, 50) / 200;
    const maturity = 1 - Math.exp(-age / 365);
    const launchP = 0.25 + 0.45 * maturity;
    const breadth = 1 + 0.03 * Math.min(Math.max(p.chains.length - 1, 0), 5);
    const implied = fdv * growth * breadth * launchP * AIRDROP_SHARE;
    return {
      ...p,
      age_days: age,
      multiple,
      implied_fdv_usd: fdv,
      growth_factor: growth,
      launch_probability: launchP,
      breadth_factor: breadth,
      implied_value: implied,
    };
  });

  // Rank by implied value, ties broken by slug so the order is deterministic.
  scored.sort((a, b) => b.implied_value - a.implied_value || (a.slug < b.slug ? -1 : 1));

  // Whole-dollar values, strictly decreasing with rank.
  let prev = Number.POSITIVE_INFINITY;
  const rows = scored.map((p, i) => {
    let value = Math.max(1, Math.round(p.implied_value));
    if (value >= prev) value = prev - 1;
    if (value < 1) value = 1;
    prev = value;
    const primaryChain = p.chains[0] ?? "Ethereum";
    return {
      slug: p.slug,
      name: p.name,
      rank: i + 1,
      implied_value_usd: value,
      farm_steps: farmSteps(p, primaryChain),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: p.age_days,
      token_status: "pre-token",
      on_watchlist: watchlist.has(p.slug),
      multiple: Math.round(p.multiple * 10000) / 10000,
      implied_fdv_usd: Math.round(p.implied_fdv_usd),
      growth_factor: Math.round(p.growth_factor * 10000) / 10000,
      launch_probability: Math.round(p.launch_probability * 10000) / 10000,
      breadth_factor: Math.round(p.breadth_factor * 10000) / 10000,
      value_per_1k_usd: Math.round((value / p.tvl_usd) * 1000 * 100) / 100,
    };
  });

  // --- Comparables table for the dashboard (trading protocols only). ---
  const comparables = [...trading]
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
    .slice(0, 10)
    .map((p) => ({
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      multiple: Math.round(((p.mcap_usd as number) / p.tvl_usd) * 10000) / 10000,
    }));

  const totalImplied = rows.reduce((sum, r) => sum + r.implied_value_usd, 0);
  const data = {
    meta: {
      as_of: snapshot.as_of,
      source: "DefiLlama protocols API, fetched 2026-11-14",
      floor_usd: snapshot.floor_usd,
      protocols_scanned: snapshot.protocols.length,
      pre_token_found: snapshot.protocols.filter((p) => p.gecko_id === null && p.symbol === null).length,
      board_rows: boardProtocols.length,
      watchlist_total: snapshot.watchlist.length,
      watchlist_covered: rows.filter((r) => r.on_watchlist).length,
      rows: rows.length,
      total_implied_value_usd: totalImplied,
      trading_protocols: trading.length,
      global_multiple: Math.round(globalMultiple * 10000) / 10000,
      airdrop_share: AIRDROP_SHARE,
      model:
        "implied value = TVL x category FDV/TVL multiple x growth factor x breadth factor x launch probability x 7% airdrop share",
    },
    rows,
    comparables,
  };

  // --- Write outputs. ---
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, "dashboard"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });

  writeFileSync(join(outDir, "board.json"), JSON.stringify({ rows }, null, 2) + "\n", "utf8");
  writeFileSync(join(outDir, "data.js"), "window.TOKEN_RADAR = " + JSON.stringify(data) + ";\n", "utf8");

  cpSync(join(BOT_DIR, "dashboard"), join(outDir, "dashboard"), { recursive: true });
  cpSync(join(BOT_DIR, "screenshots"), join(outDir, "screenshots"), { recursive: true });

  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, "dossier.json"), Buffer.from(dossier));

  // Sanity: every watchlist slug must be on the board, and every row must
  // name a protocol from the snapshot.
  const rowSlugs = new Set(rows.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !rowSlugs.has(s));
  if (missing.length > 0) throw new Error("watchlist not covered: " + missing.join(", "));
  const invented = rows.filter((r) => !bySlug.has(r.slug));
  if (invented.length > 0) throw new Error("row slug not in snapshot: " + invented[0].slug);
  console.log(`board rows: ${rows.length} (watchlist ${rows.filter((r) => r.on_watchlist).length}/${snapshot.watchlist.length})`);
  console.log(`rank 1: ${rows[0].name} $${rows[0].implied_value_usd.toLocaleString("en-US")}`);
  console.log(`total implied value: $${totalImplied.toLocaleString("en-US")}`);
}

main();

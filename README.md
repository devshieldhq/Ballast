# Ballast

A Nimiq Pay Mini App: shield volatile crypto into USDC during high
volatility, parked in Aave V3 on Base to earn yield while it waits,
unshield anytime.

Built for the Nimiq Mini Apps Competition, Cycle II.

**Tested end to end on Base mainnet.**

## What it does

- **Shield** — swap ETH into USDC via Uniswap V3, or supply USDC directly
  if you already hold it, straight into Aave V3 on Base.
- **Earn** — the deposited USDC earns real Aave yield the whole time it's
  parked, shown as a live APY, not a placeholder.
- **Unshield** — withdraw everything (principal + accrued interest) and
  either swap back to ETH or keep it as USDC — your choice.

No custom smart contracts. Every fund-moving step calls an
already-audited protocol (Uniswap V3, Aave V3) — Ballast is a thin,
non-custodial layer on top, not a new place for funds to be at risk.

## Project structure

- `index.html` / `src/main.js` / `src/style.css` — the app itself: a
  landing page (asset pitch, contract links, trust statement) that reveals
  a dashboard once you tap "Open app" and connect a wallet.
- `src/lib/swap.js` — Uniswap V3 swap calls (SwapRouter02 + Quoter, both
  directly, no aggregator or API key).
- `src/lib/aave.js` — Aave V3 supply/withdraw, live APY, live position
  balance.
- `src/lib/erc20.js` — shared ERC-20 helpers (balance reads, approvals,
  reading real transferred amounts from receipts).
- `src/lib/price.js` — live price feed (Binance WebSocket + CoinGecko),
  volatility/risk classification.
- `src/lib/activity.js` — local, per-wallet shield/unshield history
  (device-local, not synced — the real record is always the chain).
- `src/sdk/wallet.js` — wallet connect, with a fallback so the whole app
  is testable against MetaMask in a normal browser, not just inside
  Nimiq Pay.
- `api/track.js` / `api/stats.js` — a public "total shielded" counter.
  Verifies a real Aave Supply event on-chain before crediting anything;
  never trusts a client-reported amount.
- `verify-track-logic.mjs` — standalone script to check `api/track.js`'s
  parsing logic against a real transaction. Run with `node
  verify-track-logic.mjs`.
- `vercel.json` — security headers (CSP, frame protection, etc.) built
  from an actual audit of the app's real network calls.

## Setup

```bash
npm install
npm run dev
```

No API key or `.env` file needed for local development — price feeds and
quotes are public reads, and swap/supply/withdraw are wallet-mediated.

The public counter (`api/track.js` / `api/stats.js`) needs Upstash Redis
connected in your Vercel project (Storage tab → Create Database →
Upstash → Redis). Until that's set up, the stat just stays hidden rather
than showing an error or a fake number.

Mini Apps load over HTTPS inside the Nimiq Pay WebView, so for on-device
testing, tunnel your local dev server (ngrok, cloudflared) and open the
tunnel URL via the current Nimiq Pay preview mechanism — check
nimiq.dev/mini-apps, since this can change.

## Things worth knowing before relying on this further

- **Contract addresses** were verified against official sources
  (Uniswap's deployments docs, Circle's USDC docs, Aave's address-book
  package) at the time this was written. Addresses don't change often,
  but re-verify if meaningful time has passed.
- **Pool fee tier** (`POOL_FEE` in `swap.js`) is set to the 0.05% tier,
  the most liquid USDC/WETH pool on Base as of writing — pool liquidity
  shifts over time in a way contract addresses don't.
- **The public counter** can't be inflated by a lying client (the amount
  is read from the chain, not trusted from the browser), but it also
  doesn't stop someone from running many small real supply transactions
  themselves. That's real volume at real cost, not spoofed data, so the
  number stays honest to what it claims to measure.
- **Base's public RPC** (`mainnet.base.org`, used in `api/track.js`) is
  labeled by Base's own docs as "rate limited, not for production." Fine
  at competition scale; swap in a paid provider if traffic grows.
- **Activity history is local to the device/browser** it was created on,
  not synced anywhere. The Basescan link on each position is the real,
  permanent record regardless.

## License

MIT, per the competition rules.

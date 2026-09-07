# Ballast

Shield volatile crypto into USDC during a crash, earn yield on it via Aave while you wait, unshield whenever. A Nimiq Pay Mini App, built for Cycle II of the Mini Apps Competition.

Tested end to end on Base mainnet with real funds.

## What it does

- **Shield** — ETH → USDC via Uniswap, or supply USDC directly if you already hold it. Also works with cbETH, wstETH, and cbBTC.
- **Earn** — USDC sits in Aave V3 earning real yield. APY shown is live, not made up.
- **Unshield** — pull everything out (principal + interest), swap back to ETH or keep it as USDC.

No custom contracts. Everything routes through Uniswap V3 and Aave V3 — audited, existing infrastructure. Ballast doesn't hold your funds at any point.

## Structure

- `index.html`, `src/main.js`, `src/style.css` — landing page + dashboard, one file, toggled by state.
- `src/lib/swap.js` — Uniswap calls (SwapRouter02, Quoter). No aggregator, no API key.
- `src/lib/aave.js` — supply/withdraw/APY/balance reads.
- `src/lib/erc20.js` — approvals, balances, reading real transfer amounts off receipts.
- `src/lib/price.js` — Binance WS + CoinGecko for price/volatility.
- `src/lib/activity.js` — local shield/unshield history, per wallet, device-only.
- `src/sdk/wallet.js` — wallet connect, falls back to plain MetaMask outside Nimiq Pay so this is actually testable in a browser.
- `api/track.js`, `api/stats.js` — public "total shielded" counter. Verifies the on-chain Supply event before counting anything; doesn't trust the client.
- `verify-track-logic.mjs` — run this once against a real tx to sanity-check the verification logic above actually works.
- `vercel.json` — CSP + security headers.

## Setup

```bash
npm install
npm run dev
```

No env vars needed to run it locally — swaps/quotes/price are either public reads or wallet-mediated.

The public counter needs Upstash Redis wired up in Vercel (Storage → Create Database → Upstash → Redis) or it just stays hidden — no fake numbers.

To test inside Nimiq Pay, tunnel the dev server (ngrok/cloudflared) and load it via whatever Nimiq's current preview mechanism is — check nimiq.dev/mini-apps, this has moved before.

## Known limitations

- Addresses were checked against official sources when this was written — Uniswap docs, Circle, Aave's address-book package. Re-check if it's been a while.
- ETH/USDC swap uses the 0.05% fee tier. cbETH/wstETH/cbBTC try a few common tiers and use whatever actually quotes — their liquidity hasn't been checked as carefully.
- Single-hop only. No pool against USDC at a common fee tier means the swap just fails, it doesn't try to route around it.
- Only ETH and USDC-direct have been tested with real money. The other three assets haven't — start small.
- The counter can't be spoofed with a fake number (it reads the chain, not the client), but nothing stops someone from running a bunch of tiny real transactions to pad it. Still real volume, just maybe not diverse users.
- Uses Base's public RPC in `api/track.js`, which Base's own docs call "not for production." Fine at this scale — swap in a real provider if traffic ever grows.
- Activity history lives in the browser it was created in. Doesn't sync anywhere. The Basescan link on your position is the real record either way.

## License

MIT.

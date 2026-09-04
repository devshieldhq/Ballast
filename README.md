# Ballast

A Nimiq Pay Mini App: shield volatile crypto into USDC during high
volatility, parked in Aave V3 on Base to earn yield while it waits,
unshield anytime.

Built for the Nimiq Mini Apps Competition, Cycle II.

## Status — read this before demoing

- **Wallet connect** — real, uses `@nimiq/mini-app-sdk` `init()` plus
  `window.ethereum` per the documented pattern. SDK is at v0.1.0 (early;
  check its repo for updates).
- **Price/volatility** — real, hits CoinGecko's public API.
- **Swap** — real, calls Uniswap V3's SwapRouter02 directly on Base — no
  third-party aggregator or API key needed. Includes on-chain slippage
  protection via Uniswap's Quoter contract (see `src/lib/swap.js`).
- **Aave supply/withdraw** — real contract calls, pool address pulled from
  the official `@bgd-labs/aave-address-book` package rather than hardcoded.
- **Shielded asset is USDC, not USDT** — Aave's Base market doesn't list
  USDT as a reserve with real liquidity, only USDC. Verify this hasn't
  changed at app.aave.com/markets before assuming otherwise.
- **Shield amount** — read from the user's real ETH balance and their own
  input. A gas buffer (`GAS_BUFFER_ETH` in `main.js`) is reserved.
- **Supply/withdraw amounts** — read from each transaction's actual
  `Transfer` event after it's mined, not assumed from a quote.
- **APY** — read live from Aave's `getReserveData`, not a placeholder.
- **Position persistence** — read live from the actual aUSDC balance on
  connect, so it survives a page reload instead of living only in memory.
- **Live price feed** — a Binance WebSocket trade stream for real-time
  price, layered with CoinGecko for the 24h reference figure. Includes a
  risk classification (calm/watch/high/critical) based on both 24h change
  and rolling 1-minute volatility, plus a small price chart.

## Still left for you to verify

- **Pool fee tier** (`POOL_FEE` in `swap.js`) — set to the 0.05% tier,
  which is typically the most liquid USDC/WETH pool on Base, but pool
  liquidity shifts over time in a way contract addresses don't. Check
  info.uniswap.org before relying on this for real amounts.
- **Contract addresses** — verified against official sources at the time
  this was written (Uniswap's deployments docs, Circle's USDC docs, Aave's
  address book package). Addresses don't change often, but re-verify
  before real funds move, especially if time has passed.

## Setup

```bash
npm install
npm run dev
```

No API key or `.env` file needed — everything is either a public read
(price, quotes) or a wallet-mediated call (swap, supply, withdraw).

Mini Apps load over HTTPS inside the Nimiq Pay WebView, so for on-device
testing, tunnel your local dev server (ngrok, cloudflared) and open the
tunnel URL via the current Nimiq Pay preview mechanism — check
nimiq.dev/mini-apps, since this can change.

## Before touching real funds

- Confirm every contract address against a block explorer, not memory.
- Test the full shield → unshield loop on Base Sepolia (testnet) first —
  note that Uniswap liquidity on testnets is typically thin to nonexistent,
  so a full swap test may only be realistic with a small amount on mainnet.
- Get a second pair of eyes on the swap and supply code before any real
  money runs through it. Neither Uniswap's router nor Aave's pool is your
  code, but the amounts, addresses, and slippage settings you pass them
  are.

## License

MIT, per the competition rules.

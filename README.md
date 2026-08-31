# Ballast

A Nimiq Pay Mini App: shield volatile crypto into USDT during high volatility,
parked in Aave V3 on Base to earn yield while it waits, unshield anytime.

Built for the Nimiq Mini Apps Competition, Cycle II.

## Status — read this before demoing

This is a scaffold, not a finished product. What's real vs. stubbed:

- **Wallet connect** — real, uses `@nimiq/mini-app-sdk` `init()` plus
  `window.ethereum` per the documented pattern.
- **Price/volatility** — real, hits CoinGecko's public API.
- **Swap** — shaped correctly but untested against a live 1inch API key.
  Verify the endpoint/auth against https://portal.1inch.dev before relying
  on it; API shapes shift.
- **Aave supply/withdraw** — real contract calls, pool address pulled from
  the official `@bgd-labs/aave-address-book` package rather than hardcoded,
  but not yet tested with real funds.
- **Shield amount** — read from the user's real ETH balance and their own
  input, not hardcoded. A gas buffer (`GAS_BUFFER_ETH` in `main.js`) is
  reserved so shielding the full balance doesn't leave nothing for gas.
- **Supply amount** — read from the swap transaction's actual `Transfer`
  event after it's mined, not assumed from the pre-trade quote. Slippage
  means the real figure can differ from the estimate; this reads the truth.
- **Unshield** — withdraws everything from Aave (principal + accrued
  interest, via Aave's max-uint sentinel) and swaps it back to ETH, both
  legs using the same real-receipt-reading approach as shield.

## Still stubbed / left for you to verify

- **APY display** — shows "earning" as a placeholder, not a live rate read
  from Aave's reserve data. Cosmetic only, doesn't affect fund safety.
- **No persistence** — position state lives in memory and resets on page
  reload. Fine for a demo, not fine for a real user closing the app mid-flow.
- **1inch endpoint** — shaped correctly but unverified against a live key;
  see the note in `src/lib/swap.js`.

## Setup

```bash
npm install
cp .env.example .env
# add your 1inch API key to .env
npm run dev
```

Mini Apps load over HTTPS inside the Nimiq Pay WebView, so for on-device
testing, tunnel your local dev server (ngrok, cloudflared) and open the
tunnel URL via:

```
nimiqpay://miniapp?url=your-tunnel-url.com
```

## Before touching real funds

- Confirm every contract address against a block explorer, not memory —
  the Aave address book handles the Pool address; double-check any token
  address you add.
- Test the full shield → unshield loop on Base Sepolia (testnet) first.
- Get a second pair of eyes on the swap and supply code before any real
  money runs through it. Neither the swap router nor Aave's pool is your
  code, but the amounts and addresses you pass them are.

## License

MIT, per the competition rules.

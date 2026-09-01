// Supplies/withdraws USDC from Aave V3 on Base.
//
// Why USDC and not USDT: Aave's Base market lists USDC as its major
// stablecoin reserve with real liquidity; USDT is not a listed Base
// reserve. Supplying an unsupported asset simply reverts, so USDC is the
// correct choice here even though the project shields into "a stablecoin"
// conceptually — verify current reserves at app.aave.com/markets before
// assuming this hasn't changed.
//
// The Pool contract address itself comes from Aave's own verified address
// book package rather than being hardcoded — addresses are proxied and a
// wrong one either reverts (best case) or sends funds nowhere (worst
// case). Never paste a pool address from memory into code that moves
// real funds.
import { AaveV3Base } from '@bgd-labs/aave-address-book'
import { ethers } from 'ethers'
import { ensureApproval } from './erc20.js'

const POOL_ADDRESS = AaveV3Base.POOL

const POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external',
  'function withdraw(address asset, uint256 amount, address to) external returns (uint256)'
]

// Aave's own sentinel for "withdraw everything, including any interest
// accrued" — avoids us having to track and re-supply an exact figure.
export const WITHDRAW_ALL = ethers.MaxUint256

export async function supply(tokenAddress, amount, signer) {
  await ensureApproval(POOL_ADDRESS, tokenAddress, amount, signer)
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, signer)
  const owner = await signer.getAddress()
  const tx = await pool.supply(tokenAddress, amount, owner, 0)
  return tx.wait()
}

export async function withdraw(tokenAddress, amount, signer) {
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, signer)
  const owner = await signer.getAddress()
  const tx = await pool.withdraw(tokenAddress, amount, owner)
  return tx.wait()
}

// Supplies/withdraws USDT from Aave V3 on Base.
//
// We pull the Pool contract address from Aave's own verified address book
// package instead of hardcoding it — addresses are upgradeable/proxied and
// a wrong one either reverts (best case) or sends funds nowhere (worst
// case). Never paste a pool address from memory or a random search result
// into code that moves real funds; use the address book or read it live
// from the on-chain PoolAddressesProvider.
import { AaveV3Base } from '@bgd-labs/aave-address-book'
import { ethers } from 'ethers'
import { ERC20_ABI } from './erc20.js'

const POOL_ADDRESS = AaveV3Base.POOL

// Minimal ABI — just the two functions this app calls.
const POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external',
  'function withdraw(address asset, uint256 amount, address to) external returns (uint256)'
]

// Aave's own sentinel for "withdraw everything, including any interest
// accrued" — avoids us having to track and re-supply an exact figure.
export const WITHDRAW_ALL = ethers.MaxUint256

function getSigner() {
  const provider = new ethers.BrowserProvider(window.ethereum)
  return provider.getSigner()
}

export async function ensureApproval(tokenAddress, amount) {
  const signer = await getSigner()
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer)
  const owner = await signer.getAddress()
  const current = await token.allowance(owner, POOL_ADDRESS)
  if (current < amount) {
    const tx = await token.approve(POOL_ADDRESS, amount)
    await tx.wait()
  }
}

export async function supply(tokenAddress, amount) {
  await ensureApproval(tokenAddress, amount)
  const signer = await getSigner()
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, signer)
  const owner = await signer.getAddress()
  const tx = await pool.supply(tokenAddress, amount, owner, 0)
  return tx.wait()
}

export async function withdraw(tokenAddress, amount) {
  const signer = await getSigner()
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, signer)
  const owner = await signer.getAddress()
  const tx = await pool.withdraw(tokenAddress, amount, owner)
  return tx.wait()
}

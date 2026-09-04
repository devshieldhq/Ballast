// Supplies/withdraws USDC from Aave V3 on Base.
// USDC, not USDT — Aave's Base market only has real listed liquidity in
// USDC. Verify at app.aave.com/markets if this changes.
// Pool address comes from Aave's official address-book package, not
// hardcoded — addresses are proxied and wrong ones fail silently.
import { AaveV3Base } from '@bgd-labs/aave-address-book'
import { ethers } from 'ethers'
import { ensureApproval } from './erc20.js'

const POOL_ADDRESS = AaveV3Base.POOL

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const ATOKEN_USDC = '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB'

const POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external',
  'function withdraw(address asset, uint256 amount, address to) external returns (uint256)'
]

// Withdraws everything, principal + accrued interest.
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


export async function getUsdcSupplyApy(provider) {
  const pool = new ethers.Contract(POOL_ADDRESS, [
    'function getReserveData(address asset) view returns (tuple(uint256 configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt))'
  ], provider)
  const data = await pool.getReserveData(USDC_ADDRESS)
  const ray = 1e27
  const apr = Number(data.currentLiquidityRate) / ray
  return (Math.pow(1 + apr / 365, 365) - 1) * 100
}

export async function getShieldedUsdcBalance(provider, userAddress) {
  const token = new ethers.Contract(ATOKEN_USDC, ['function balanceOf(address) view returns (uint256)'], provider)
  return token.balanceOf(userAddress)
}

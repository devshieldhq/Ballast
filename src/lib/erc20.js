import { ethers } from 'ethers'

export const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
]

const erc20Interface = new ethers.Interface(ERC20_ABI)

export async function getEthBalance(provider, address) {
  return provider.getBalance(address)
}

export async function getTokenBalance(provider, tokenAddress, ownerAddress) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider)
  return token.balanceOf(ownerAddress)
}

export async function ensureApproval(spenderAddress, tokenAddress, amount, signer) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer)
  const owner = await signer.getAddress()
  const current = await token.allowance(owner, spenderAddress)
  if (current < amount) {
    const tx = await token.approve(spenderAddress, amount)
    await tx.wait()
  }
}

// Reads the actual amount moved by decoding the token's Transfer event
// from the mined receipt, rather than trusting a pre-trade quote.
export function parseReceivedAmount(receipt, tokenAddress, toAddress) {
  const normalizedToken = tokenAddress.toLowerCase()
  const normalizedTo = toAddress.toLowerCase()

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== normalizedToken) continue
    try {
      const parsed = erc20Interface.parseLog(log)
      if (parsed?.name === 'Transfer' && parsed.args.to.toLowerCase() === normalizedTo) {
        return parsed.args.value
      }
    } catch {
      // Not a Transfer log on this token — ignore and keep scanning.
    }
  }
  throw new Error('Could not find a matching Transfer event in the receipt')
}

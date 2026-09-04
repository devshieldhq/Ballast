import { Redis } from '@upstash/redis'

const redis = Redis.fromEnv()

export default async function handler(req, res) {
  const [totalUsd, totalCount] = await Promise.all([
    redis.get('ballast:total_shielded_usd'),
    redis.get('ballast:total_shield_count')
  ])

  res.status(200).json({
    totalShieldedUsd: Number(totalUsd) || 0,
    totalShieldCount: Number(totalCount) || 0
  })
}

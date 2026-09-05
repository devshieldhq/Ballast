import { Redis } from '@upstash/redis'

// Vercel's Upstash Marketplace integration sets KV_REST_API_URL and
// KV_REST_API_TOKEN, not the plain UPSTASH_REDIS_REST_URL/TOKEN names
// @upstash/redis's Redis.fromEnv() looks for by default — so we build
// the client explicitly against the names Vercel actually provides.
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
})

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

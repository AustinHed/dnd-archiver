import { Redis } from '@upstash/redis'

function resolveRedisConfig() {
  const url = process.env.DND_KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.DND_KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    throw new Error('Missing Redis credentials. Set DND_KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_URL/TOKEN.')
  }

  return { url, token }
}

let redisClient = null

export function getKv() {
  if (!redisClient) {
    redisClient = new Redis(resolveRedisConfig())
  }
  return redisClient
}

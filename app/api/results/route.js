import { Redis } from '@upstash/redis'

function getKv() {
  return new Redis({
    url: process.env.DND_KV_REST_API_URL,
    token: process.env.DND_KV_REST_API_TOKEN,
  })
}

export async function GET() {
  const kv = getKv()

  // Scan for all result:{uuid} keys
  const allKeys = new Set()
  let cursor = 0
  do {
    const [nextCursor, keys] = await kv.scan(cursor, { match: 'result:*', count: 100 })
    for (const key of keys) {
      // Only match result:{uuid} — not result:anything:else
      if (/^result:[0-9a-f-]{36}$/.test(key)) {
        allKeys.add(key)
      }
    }
    cursor = typeof nextCursor === 'string' ? parseInt(nextCursor, 10) : nextCursor
  } while (cursor !== 0)

  if (!allKeys.size) return Response.json([])

  // Fetch all results in parallel
  const results = await Promise.all([...allKeys].map(k => kv.get(k)))
  const metas = results
    .filter(Boolean)
    .map(r => ({ id: r.id, fileName: r.fileName, title: r.title, createdAt: r.createdAt }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))

  return Response.json(metas)
}

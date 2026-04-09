import { Redis } from '@upstash/redis'

function getKv() {
  return new Redis({
    url: process.env.DND_KV_REST_API_URL,
    token: process.env.DND_KV_REST_API_TOKEN,
  })
}

export function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

export async function GET() {
  const kv = getKv()
  const slugs = await kv.smembers('npcs:index')
  if (!slugs.length) return Response.json([])

  const npcs = await Promise.all(slugs.map(s => kv.get(`npc:${s}`)))
  return Response.json(
    npcs
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
  )
}

export async function POST(request) {
  const { name, description } = await request.json()
  if (!name?.trim()) {
    return Response.json({ error: 'Name is required.' }, { status: 400 })
  }

  const kv = getKv()
  const slug = slugify(name.trim())

  const existing = await kv.get(`npc:${slug}`)
  if (existing) {
    return Response.json({ error: 'An NPC with that name already exists.' }, { status: 409 })
  }

  const npc = {
    name: name.trim(),
    slug,
    description: description?.trim() || '',
    sessionIds: [],
    notes: [],
    createdAt: new Date().toISOString(),
  }

  await kv.set(`npc:${slug}`, npc)
  await kv.sadd('npcs:index', slug)

  return Response.json(npc, { status: 201 })
}

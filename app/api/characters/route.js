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
  const slugs = await kv.smembers('characters:index')
  if (!slugs.length) return Response.json([])

  const characters = await Promise.all(slugs.map(s => kv.get(`character:${s}`)))
  return Response.json(
    characters
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
  )
}

export async function POST(request) {
  const body = await request.json()
  const name = body.name?.trim()
  if (!name) return Response.json({ error: 'Name is required.' }, { status: 400 })

  const kv = getKv()
  const slug = slugify(name)

  const existing = await kv.get(`character:${slug}`)
  if (existing) {
    return Response.json({ error: 'A character with that name already exists.' }, { status: 409 })
  }

  const character = {
    name,
    slug,
    player: body.player?.trim() || '',
    race: body.race?.trim() || '',
    class: body.class?.trim() || '',
    level: Number(body.level) || 1,
    background: body.background?.trim() || '',
    description: body.description?.trim() || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  await kv.set(`character:${slug}`, character)
  await kv.sadd('characters:index', slug)

  return Response.json(character, { status: 201 })
}

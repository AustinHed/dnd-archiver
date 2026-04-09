import { Redis } from '@upstash/redis'

function getKv() {
  return new Redis({
    url: process.env.DND_KV_REST_API_URL,
    token: process.env.DND_KV_REST_API_TOKEN,
  })
}

export async function GET(request, { params }) {
  const { name } = await params
  const kv = getKv()
  const character = await kv.get(`character:${name}`)
  if (!character) return Response.json({ error: 'Character not found.' }, { status: 404 })
  return Response.json(character)
}

export async function PUT(request, { params }) {
  const { name } = await params
  const kv = getKv()
  const character = await kv.get(`character:${name}`)
  if (!character) return Response.json({ error: 'Character not found.' }, { status: 404 })

  const body = await request.json()

  if (body.player !== undefined) character.player = body.player?.trim() ?? ''
  if (body.race !== undefined) character.race = body.race?.trim() ?? ''
  if (body.class !== undefined) character.class = body.class?.trim() ?? ''
  if (body.level !== undefined) character.level = Number(body.level) || character.level
  if (body.background !== undefined) character.background = body.background?.trim() ?? ''
  if (body.description !== undefined) character.description = body.description?.trim() ?? ''
  character.updatedAt = new Date().toISOString()

  await kv.set(`character:${name}`, character)
  return Response.json(character)
}

export async function DELETE(request, { params }) {
  const { name } = await params
  const kv = getKv()
  await kv.del(`character:${name}`)
  await kv.srem('characters:index', name)
  return Response.json({ ok: true })
}

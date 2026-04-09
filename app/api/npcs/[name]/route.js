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
  const npc = await kv.get(`npc:${name}`)
  if (!npc) return Response.json({ error: 'NPC not found.' }, { status: 404 })
  return Response.json(npc)
}

export async function PUT(request, { params }) {
  const { name } = await params
  const kv = getKv()
  const npc = await kv.get(`npc:${name}`)
  if (!npc) return Response.json({ error: 'NPC not found.' }, { status: 404 })

  const body = await request.json()

  if (body.description !== undefined) {
    npc.description = body.description
  }
  if (body.sessionId) {
    npc.sessionIds = [...new Set([...npc.sessionIds, body.sessionId])]
  }
  if (body.note) {
    npc.notes = [
      ...npc.notes,
      {
        text: body.note.text,
        author: body.note.author || '',
        createdAt: new Date().toISOString(),
      },
    ]
  }
  if (body.deleteNoteIndex !== undefined) {
    npc.notes = npc.notes.filter((_, i) => i !== body.deleteNoteIndex)
  }
  if (body.removeSessionId) {
    npc.sessionIds = npc.sessionIds.filter(id => id !== body.removeSessionId)
  }

  await kv.set(`npc:${name}`, npc)
  return Response.json(npc)
}

export async function DELETE(request, { params }) {
  const { name } = await params
  const kv = getKv()
  await kv.del(`npc:${name}`)
  await kv.srem('npcs:index', name)
  return Response.json({ ok: true })
}

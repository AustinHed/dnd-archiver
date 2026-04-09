import { Redis } from '@upstash/redis'

function getKv() {
  return new Redis({
    url: process.env.DND_KV_REST_API_URL,
    token: process.env.DND_KV_REST_API_TOKEN,
  })
}

export async function DELETE(request, { params }) {
  const { id } = await params
  // Basic UUID format guard
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return Response.json({ error: 'Invalid id.' }, { status: 400 })
  }
  const kv = getKv()
  await kv.del(`result:${id}`)
  return Response.json({ ok: true })
}

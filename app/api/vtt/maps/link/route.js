import { emitVttEvent } from '@/lib/pusher'
import { linkMapToResult } from '@/lib/vttStore'

export const runtime = 'nodejs'

export async function POST(request) {
  const body = await request.json().catch(() => ({}))
  const mapId = body?.mapId
  const resultId = body?.resultId

  if (!mapId || !resultId) {
    return Response.json({ error: 'mapId and resultId are required.' }, { status: 400 })
  }

  const link = await linkMapToResult(mapId, resultId)
  if (!link.ok) {
    return Response.json({
      error: 'Map or result not found.',
      mapFound: link.map,
      resultFound: link.result,
    }, { status: 404 })
  }

  await emitVttEvent('map.updated', {
    mapId,
    timestamp: new Date().toISOString(),
    version: null,
    actorId: body?.actorId ?? 'system',
    patch: { type: 'map.linked', resultId },
  })

  return Response.json({
    ok: true,
    mapId,
    resultId,
    mapLinks: link.mapLinks,
    resultLinks: link.resultLinks,
  })
}

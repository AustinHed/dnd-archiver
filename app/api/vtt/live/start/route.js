import { emitVttEvent } from '@/lib/pusher'
import { getLiveSession, listMapIds, saveLiveSession } from '@/lib/vttStore'

export const runtime = 'nodejs'

export async function POST(request) {
  const body = await request.json().catch(() => ({}))
  const requestedMapId = body?.mapId

  const [live, mapIds] = await Promise.all([getLiveSession(), listMapIds()])

  const activeMapId = requestedMapId
    ?? live.activeMapId
    ?? mapIds[0]
    ?? null

  const nextLive = {
    ...live,
    active: true,
    activeMapId,
    startedAt: new Date().toISOString(),
    stoppedAt: null,
  }

  await saveLiveSession(nextLive)

  await emitVttEvent('session.started', {
    mapId: activeMapId,
    timestamp: new Date().toISOString(),
    version: null,
    actorId: body?.actorId ?? 'system',
    patch: { active: true, activeMapId },
  })

  return Response.json({ live: nextLive })
}

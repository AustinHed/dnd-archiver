import { emitVttEvent } from '@/lib/pusher'
import {
  getLiveSession,
  listMapIds,
  saveLiveSession,
} from '@/lib/vttStore'

export const runtime = 'nodejs'

const VALID_STATUSES = new Set(['preparing', 'active'])

export async function POST(request) {
  const body = await request.json().catch(() => ({}))
  const actorRole = body?.actorRole === 'dm' ? 'dm' : 'player'
  if (actorRole !== 'dm') {
    return Response.json({ error: 'Only the Dungeon Master can update game state.' }, { status: 403 })
  }

  const requestedMapId = body?.mapId
  const requestedStatus = String(body?.status ?? 'active').toLowerCase()
  const status = VALID_STATUSES.has(requestedStatus) ? requestedStatus : 'active'

  const [live, mapIds] = await Promise.all([getLiveSession(), listMapIds()])

  const activeMapId = requestedMapId
    ?? live.activeMapId
    ?? mapIds[0]
    ?? null

  const nextLive = {
    ...live,
    active: status === 'active',
    status,
    activeMapId,
    startedAt: status === 'active' ? new Date().toISOString() : live.startedAt,
    stoppedAt: status === 'active' ? null : live.stoppedAt,
  }

  await saveLiveSession(nextLive)

  const eventName = status === 'active' ? 'session.started' : 'map.updated'
  await emitVttEvent(eventName, {
    mapId: activeMapId,
    timestamp: new Date().toISOString(),
    version: null,
    actorId: body?.actorId ?? 'system',
    patch: { active: status === 'active', status, activeMapId },
  })

  return Response.json({ live: nextLive })
}

import { emitVttEvent } from '@/lib/pusher'
import { getLiveSession, saveLiveSession } from '@/lib/vttStore'

export const runtime = 'nodejs'

export async function POST(request) {
  const body = await request.json().catch(() => ({}))
  const actorRole = body?.actorRole === 'dm' ? 'dm' : 'player'
  if (actorRole !== 'dm') {
    return Response.json({ error: 'Only the Dungeon Master can update game state.' }, { status: 403 })
  }

  const live = await getLiveSession()

  const nextLive = {
    ...live,
    active: false,
    status: 'closed',
    stoppedAt: new Date().toISOString(),
  }

  await saveLiveSession(nextLive)

  await emitVttEvent('session.stopped', {
    mapId: live.activeMapId,
    timestamp: new Date().toISOString(),
    version: null,
    actorId: body?.actorId ?? 'system',
    patch: { active: false },
  })

  return Response.json({ live: nextLive })
}

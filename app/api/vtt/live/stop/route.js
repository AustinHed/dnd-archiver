import { emitVttEvent } from '@/lib/pusher'
import { getLiveSession, saveLiveSession } from '@/lib/vttStore'

export const runtime = 'nodejs'

export async function POST(request) {
  const body = await request.json().catch(() => ({}))
  const live = await getLiveSession()

  const nextLive = {
    ...live,
    active: false,
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

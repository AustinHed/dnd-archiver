import { emitVttEvent } from '@/lib/pusher'
import {
  getLiveSession,
  getMap,
  getOrCreateState,
  listCharacters,
  listMapIds,
  mutateVttState,
  saveLiveSession,
} from '@/lib/vttStore'

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

  if (activeMapId) {
    const [map, state, characters] = await Promise.all([
      getMap(activeMapId),
      getOrCreateState(activeMapId),
      listCharacters(),
    ])

    const hasPlayerTokens = (state?.tokens ?? []).some((token) => token.role === 'player')

    if (map && characters.length && !hasPlayerTokens) {
      const spacing = 90
      const centerX = map.width / 2
      const y = map.height / 2
      const startX = centerX - ((characters.length - 1) * spacing) / 2

      await mutateVttState(activeMapId, (current) => ({
        ...current,
        tokens: [
          ...(current.tokens ?? []),
          ...characters.map((entry, index) => ({
            id: crypto.randomUUID(),
            role: 'player',
            name: entry.name,
            size: 'medium',
            ringColor: 'blue',
            darkvision: false,
            x: startX + index * spacing,
            y,
          })),
        ],
      }))
    }
  }

  await emitVttEvent('session.started', {
    mapId: activeMapId,
    timestamp: new Date().toISOString(),
    version: null,
    actorId: body?.actorId ?? 'system',
    patch: { active: true, activeMapId },
  })

  return Response.json({ live: nextLive })
}

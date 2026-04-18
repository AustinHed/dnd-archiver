import { v4 as uuidv4 } from 'uuid'
import { emitVttEvent } from '@/lib/pusher'
import { mergeExploredCells } from '@/lib/vttGeometry.mjs'
import {
  getMap,
  getOrCreateState,
  mutateVttState,
  saveCharacterProfile,
  updateMapRecord,
} from '@/lib/vttStore'

export const runtime = 'nodejs'

function ensurePoints(points, { min = 2 } = {}) {
  if (!Array.isArray(points) || points.length < min) {
    return null
  }

  const normalized = points
    .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))

  if (normalized.length < min) return null
  return normalized
}

function toSegments(points) {
  const segments = []
  for (let i = 0; i < points.length - 1; i += 1) {
    segments.push({ a: points[i], b: points[i + 1] })
  }
  return segments
}

function normalizeShape(raw, defaults = {}) {
  const minPoints = raw?.shapeType === 'circle' ? 1 : 2
  const points = ensurePoints(raw?.points, { min: minPoints })
  if (!points) return null

  const center = raw?.center && Number.isFinite(Number(raw.center.x)) && Number.isFinite(Number(raw.center.y))
    ? { x: Number(raw.center.x), y: Number(raw.center.y) }
    : null

  const radius = Number(raw?.radius)

  return {
    id: raw?.id ?? uuidv4(),
    kind: raw?.kind ?? raw?.shapeType ?? defaults.kind ?? defaults.shapeType ?? 'shape',
    shapeType: raw?.shapeType ?? defaults.shapeType ?? raw?.kind ?? null,
    color: raw?.color ?? defaults.color ?? '#4ecdc4',
    colorName: raw?.colorName ?? defaults.colorName ?? null,
    fill: raw?.fill ?? defaults.fill ?? 'rgba(78,205,196,0.2)',
    closed: raw?.closed ?? defaults.closed ?? true,
    center: center ?? defaults.center ?? null,
    radius: Number.isFinite(radius) ? radius : (defaults.radius ?? null),
    points,
  }
}

function eventForOp(op) {
  if (op === 'ping') return 'ping.created'
  if (op === 'setCharacter') return 'character.updated'
  if (op.startsWith('setFog') || op.startsWith('mergeFog')) return 'fog.updated'
  if (op.includes('Token')) return 'token.updated'
  if (op.includes('Shape') || op.includes('Wall') || op.includes('Darkness')) return 'shape.updated'
  return 'map.updated'
}

function applyMutation(currentState, op, payload) {
  switch (op) {
    case 'addWall': {
      const points = ensurePoints(payload?.points, { min: 2 })
      if (!points) return null
      const segments = toSegments(points)
      return {
        ...currentState,
        walls: [
          ...(currentState.walls ?? []),
          ...segments.map((segment) => ({ id: uuidv4(), ...segment })),
        ],
      }
    }
    case 'addDarknessZone': {
      const shape = normalizeShape({ ...payload, kind: 'darkness', closed: true }, {
        kind: 'darkness',
        fill: 'rgba(15, 15, 20, 0.45)',
      })
      if (!shape) return null
      return {
        ...currentState,
        darknessZones: [...(currentState.darknessZones ?? []), shape],
      }
    }
    case 'addShape': {
      const shape = normalizeShape(payload)
      if (!shape) return null
      return {
        ...currentState,
        shapes: [...(currentState.shapes ?? []), shape],
      }
    }
    case 'updateWall': {
      const wallId = payload?.id
      if (!wallId) return null
      const a = payload?.a
      const b = payload?.b
      if (!a || !b) return null
      const nextA = { x: Number(a.x), y: Number(a.y) }
      const nextB = { x: Number(b.x), y: Number(b.y) }
      if (!Number.isFinite(nextA.x) || !Number.isFinite(nextA.y) || !Number.isFinite(nextB.x) || !Number.isFinite(nextB.y)) return null
      return {
        ...currentState,
        walls: (currentState.walls ?? []).map((wall) => (
          wall.id === wallId
            ? { ...wall, a: nextA, b: nextB }
            : wall
        )),
      }
    }
    case 'removeWall': {
      const wallId = payload?.id
      if (!wallId) return null
      return {
        ...currentState,
        walls: (currentState.walls ?? []).filter((wall) => wall.id !== wallId),
      }
    }
    case 'restoreWall': {
      const wall = payload?.wall
      if (!wall?.id || !wall?.a || !wall?.b) return null
      const nextA = { x: Number(wall.a.x), y: Number(wall.a.y) }
      const nextB = { x: Number(wall.b.x), y: Number(wall.b.y) }
      if (!Number.isFinite(nextA.x) || !Number.isFinite(nextA.y) || !Number.isFinite(nextB.x) || !Number.isFinite(nextB.y)) return null
      return {
        ...currentState,
        walls: [...(currentState.walls ?? []), { id: wall.id, a: nextA, b: nextB }],
      }
    }
    case 'updateShape': {
      const shapeId = payload?.id
      if (!shapeId) return null
      const candidatePoints = payload.points ? ensurePoints(payload.points, { min: payload.shapeType === 'circle' ? 1 : 2 }) : null
      const candidateCenter = payload.center && Number.isFinite(Number(payload.center.x)) && Number.isFinite(Number(payload.center.y))
        ? { x: Number(payload.center.x), y: Number(payload.center.y) }
        : undefined
      const candidateRadius = Number(payload.radius)

      return {
        ...currentState,
        shapes: (currentState.shapes ?? []).map((shape) => (
          shape.id === shapeId
            ? {
                ...shape,
                ...payload,
                points: candidatePoints ?? shape.points,
                center: candidateCenter ?? shape.center,
                radius: Number.isFinite(candidateRadius) ? candidateRadius : shape.radius,
              }
            : shape
        )),
      }
    }
    case 'removeShape': {
      const shapeId = payload?.id
      if (!shapeId) return null
      return {
        ...currentState,
        shapes: (currentState.shapes ?? []).filter((shape) => shape.id !== shapeId),
      }
    }
    case 'addToken': {
      const x = Number(payload?.x)
      const y = Number(payload?.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null

      return {
        ...currentState,
        tokens: [
          ...(currentState.tokens ?? []),
          {
            id: uuidv4(),
            name: payload?.name ?? 'Token',
            size: payload?.size ?? 'medium',
            ringColor: payload?.ringColor ?? 'clear',
            role: payload?.role ?? 'npc',
            darkvision: Boolean(payload?.darkvision),
            x,
            y,
          },
        ],
      }
    }
    case 'updateToken': {
      const tokenId = payload?.id
      if (!tokenId) return null

      return {
        ...currentState,
        tokens: (currentState.tokens ?? []).map((token) => (
          token.id === tokenId
            ? {
                ...token,
                ...payload,
                x: Number.isFinite(Number(payload.x)) ? Number(payload.x) : token.x,
                y: Number.isFinite(Number(payload.y)) ? Number(payload.y) : token.y,
                darkvision: payload?.darkvision !== undefined ? Boolean(payload.darkvision) : token.darkvision,
              }
            : token
        )),
      }
    }
    case 'removeToken': {
      const tokenId = payload?.id
      if (!tokenId) return null
      return {
        ...currentState,
        tokens: (currentState.tokens ?? []).filter((token) => token.id !== tokenId),
      }
    }
    case 'ping': {
      const x = Number(payload?.x)
      const y = Number(payload?.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null

      const ping = {
        id: uuidv4(),
        x,
        y,
        createdAt: new Date().toISOString(),
      }

      const all = [...(currentState.pings ?? []), ping]
      return {
        ...currentState,
        pings: all.slice(-20),
      }
    }
    case 'clearPings': {
      return {
        ...currentState,
        pings: [],
      }
    }
    case 'setFogEnabled': {
      return {
        ...currentState,
        fog: {
          ...(currentState.fog ?? {}),
          enabled: Boolean(payload?.enabled),
        },
      }
    }
    case 'mergeFogExplored': {
      const incoming = Array.isArray(payload?.exploredCells) ? payload.exploredCells : []
      return {
        ...currentState,
        fog: {
          ...(currentState.fog ?? {}),
          cols: Number(payload?.cols) || currentState.fog?.cols || 0,
          rows: Number(payload?.rows) || currentState.fog?.rows || 0,
          gridSize: Number(payload?.gridSize) || currentState.fog?.gridSize || 24,
          exploredCells: mergeExploredCells(currentState.fog?.exploredCells, incoming),
        },
      }
    }
    default:
      return null
  }
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}))
  const mapId = body?.mapId
  const op = body?.op
  const payload = body?.payload ?? {}
  const actorId = body?.actorId ?? 'anonymous'

  if (!mapId || !op) {
    return Response.json({ error: 'mapId and op are required.' }, { status: 400 })
  }

  const map = await getMap(mapId)
  if (!map) {
    return Response.json({ error: 'Map not found.' }, { status: 404 })
  }

  if (op === 'setCalibration') {
    const feetDistance = Number(payload?.feetDistance)
    const pxDistance = Number(payload?.pxDistance)

    if (!feetDistance || !pxDistance) {
      return Response.json({ error: 'Calibration requires feetDistance and pxDistance.' }, { status: 400 })
    }

    const updatedMap = await updateMapRecord(mapId, (current) => ({
      ...current,
      calibration: {
        feetDistance,
        pxDistance,
        feetPerPx: feetDistance / pxDistance,
      },
    }))

    await emitVttEvent('map.updated', {
      mapId,
      version: null,
      timestamp: new Date().toISOString(),
      actorId,
      patch: { type: op, payload: updatedMap?.calibration },
    })

    return Response.json({ ok: true, map: updatedMap })
  }

  if (op === 'setCharacter') {
    const clientId = payload?.clientId
    if (!clientId) {
      return Response.json({ error: 'clientId is required for setCharacter.' }, { status: 400 })
    }

    const character = await saveCharacterProfile(clientId, {
      moveSpeed: Number(payload.moveSpeed) || 30,
      darkvision: Boolean(payload.darkvision),
    })

    await emitVttEvent('character.updated', {
      mapId,
      version: null,
      timestamp: new Date().toISOString(),
      actorId,
      patch: { type: op, payload: character },
    })

    return Response.json({ ok: true, character })
  }

  const current = await getOrCreateState(mapId)
  const candidate = applyMutation(current, op, payload)

  if (!candidate) {
    return Response.json({ error: `Invalid payload for op: ${op}` }, { status: 400 })
  }

  const state = await mutateVttState(mapId, () => candidate)

  await emitVttEvent(eventForOp(op), {
    mapId,
    version: state.version,
    timestamp: state.updatedAt,
    actorId,
    patch: { type: op, payload },
  })

  return Response.json({ ok: true, state })
}

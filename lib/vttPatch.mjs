import { createDefaultVttState } from './vttDefaults.js'
import { mergeExploredCellsDelta } from './vttGeometry.mjs'

function replaceById(items, nextItem) {
  return (items ?? []).map((item) => (item.id === nextItem.id ? nextItem : item))
}

function removeById(items, id) {
  return (items ?? []).filter((item) => item.id !== id)
}

function withDefaultState(state) {
  return state ?? createDefaultVttState()
}

export function applyVttPatch(state, patch) {
  const current = withDefaultState(state)
  if (!patch?.type) return current

  switch (patch.type) {
    case 'state.replace': {
      return patch.payload?.state ?? current
    }
    case 'token.added': {
      const token = patch.payload?.token
      if (!token?.id) return current
      const exists = (current.tokens ?? []).some((entry) => entry.id === token.id)
      return {
        ...current,
        tokens: exists ? replaceById(current.tokens, token) : [...(current.tokens ?? []), token],
      }
    }
    case 'token.updated': {
      const token = patch.payload?.token
      if (!token?.id) return current
      return {
        ...current,
        tokens: replaceById(current.tokens, token),
      }
    }
    case 'token.removed': {
      const tokenId = patch.payload?.id
      if (!tokenId) return current
      return {
        ...current,
        tokens: removeById(current.tokens, tokenId),
      }
    }
    case 'shape.added': {
      const shape = patch.payload?.shape
      if (!shape?.id) return current
      const exists = (current.shapes ?? []).some((entry) => entry.id === shape.id)
      return {
        ...current,
        shapes: exists ? replaceById(current.shapes, shape) : [...(current.shapes ?? []), shape],
      }
    }
    case 'shape.updated': {
      const shape = patch.payload?.shape
      if (!shape?.id) return current
      return {
        ...current,
        shapes: replaceById(current.shapes, shape),
      }
    }
    case 'shape.removed': {
      const shapeId = patch.payload?.id
      if (!shapeId) return current
      return {
        ...current,
        shapes: removeById(current.shapes, shapeId),
      }
    }
    case 'wall.added': {
      const walls = Array.isArray(patch.payload?.walls) ? patch.payload.walls : []
      if (!walls.length) return current
      return {
        ...current,
        walls: [...(current.walls ?? []), ...walls],
      }
    }
    case 'wall.updated': {
      const wall = patch.payload?.wall
      if (!wall?.id) return current
      return {
        ...current,
        walls: replaceById(current.walls, wall),
      }
    }
    case 'wall.removed': {
      const wallId = patch.payload?.id
      if (!wallId) return current
      return {
        ...current,
        walls: removeById(current.walls, wallId),
      }
    }
    case 'darkness.added': {
      const zone = patch.payload?.zone
      if (!zone?.id) return current
      const exists = (current.darknessZones ?? []).some((entry) => entry.id === zone.id)
      return {
        ...current,
        darknessZones: exists
          ? replaceById(current.darknessZones, zone)
          : [...(current.darknessZones ?? []), zone],
      }
    }
    case 'darkness.removed': {
      const zoneId = patch.payload?.id
      if (!zoneId) return current
      return {
        ...current,
        darknessZones: removeById(current.darknessZones, zoneId),
      }
    }
    case 'ping.added': {
      const ping = patch.payload?.ping
      if (!ping?.id) return current
      return {
        ...current,
        pings: [...(current.pings ?? []), ping].slice(-20),
      }
    }
    case 'ping.cleared': {
      return {
        ...current,
        pings: [],
      }
    }
    case 'fog.enabled': {
      return {
        ...current,
        fog: {
          ...(current.fog ?? {}),
          enabled: Boolean(patch.payload?.enabled),
        },
      }
    }
    case 'fog.reset': {
      return {
        ...current,
        fog: {
          ...(current.fog ?? {}),
          exploredCells: [],
          exploredByToken: {},
        },
      }
    }
    case 'fog.merged': {
      const tokenId = patch.payload?.tokenId
      const delta = Array.isArray(patch.payload?.delta) ? patch.payload.delta : []
      const nextGridSize = Number(patch.payload?.gridSize) || Number(current.fog?.gridSize) || 4
      const currentGridSize = Number(current.fog?.gridSize) || nextGridSize
      const gridChanged = currentGridSize !== nextGridSize

      const exploredByToken = gridChanged ? {} : { ...(current.fog?.exploredByToken ?? {}) }
      if (tokenId) {
        const mergedToken = mergeExploredCellsDelta(exploredByToken[tokenId], delta)
        exploredByToken[tokenId] = mergedToken.merged
      }
      const mergedGlobal = mergeExploredCellsDelta(
        gridChanged ? [] : current.fog?.exploredCells,
        delta,
      )

      return {
        ...current,
        fog: {
          ...(current.fog ?? {}),
          cols: Number(patch.payload?.cols) || current.fog?.cols || 0,
          rows: Number(patch.payload?.rows) || current.fog?.rows || 0,
          gridSize: nextGridSize,
          exploredCells: mergedGlobal.merged,
          exploredByToken,
        },
      }
    }
    default:
      return current
  }
}

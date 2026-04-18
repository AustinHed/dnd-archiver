const EPSILON = 1e-7
const LARGE_MAP_AREA_THRESHOLD = 2_000_000

export function feetPerPixelFromCalibration(calibration) {
  if (!calibration || !calibration.pxDistance || !calibration.feetDistance) {
    return null
  }
  if (calibration.pxDistance <= 0 || calibration.feetDistance <= 0) return null
  return calibration.feetDistance / calibration.pxDistance
}

export function distancePx(a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.hypot(dx, dy)
}

export function pointInPolygon(point, polygonPoints) {
  if (!polygonPoints?.length) return false
  let inside = false

  for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
    const xi = polygonPoints[i].x
    const yi = polygonPoints[i].y
    const xj = polygonPoints[j].x
    const yj = polygonPoints[j].y

    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || EPSILON) + xi)

    if (intersects) inside = !inside
  }

  return inside
}

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
  if (Math.abs(value) <= EPSILON) return 0
  return value > 0 ? 1 : 2
}

function onSegment(a, b, c) {
  return (
    b.x <= Math.max(a.x, c.x) + EPSILON
    && b.x + EPSILON >= Math.min(a.x, c.x)
    && b.y <= Math.max(a.y, c.y) + EPSILON
    && b.y + EPSILON >= Math.min(a.y, c.y)
  )
}

export function segmentsIntersect(a1, a2, b1, b2) {
  const o1 = orientation(a1, a2, b1)
  const o2 = orientation(a1, a2, b2)
  const o3 = orientation(b1, b2, a1)
  const o4 = orientation(b1, b2, a2)

  if (o1 !== o2 && o3 !== o4) return true

  if (o1 === 0 && onSegment(a1, b1, a2)) return true
  if (o2 === 0 && onSegment(a1, b2, a2)) return true
  if (o3 === 0 && onSegment(b1, a1, b2)) return true
  if (o4 === 0 && onSegment(b1, a2, b2)) return true

  return false
}

export function segmentBlocksLine(start, end, blockerSegments) {
  if (!blockerSegments?.length) return false

  return blockerSegments.some((segment) => (
    segmentsIntersect(start, end, segment.a, segment.b)
  ))
}

export function shapeToSegments(shape) {
  if (!shape?.points?.length) return []
  const segments = []

  for (let i = 0; i < shape.points.length - 1; i += 1) {
    segments.push({ a: shape.points[i], b: shape.points[i + 1] })
  }

  if (shape.closed && shape.points.length > 2) {
    segments.push({ a: shape.points.at(-1), b: shape.points[0] })
  }

  return segments
}

export function buildBlockerSegments(state) {
  const wallSegments = (state?.walls ?? []).map((wall) => ({ a: wall.a, b: wall.b }))
  const barrierSegments = []

  for (const barrier of state?.barrierShapes ?? []) {
    barrierSegments.push(...shapeToSegments(barrier))
  }

  for (const shape of state?.shapes ?? []) {
    if (shape.kind === 'barrier') {
      barrierSegments.push(...shapeToSegments(shape))
    }
  }

  return [...wallSegments, ...barrierSegments]
}

export function isPointInDarkness(point, state) {
  const allDarkness = [...(state?.darknessZones ?? [])]

  for (const shape of state?.shapes ?? []) {
    if (shape.kind === 'darkness') {
      allDarkness.push(shape)
    }
  }

  return allDarkness.some((zone) => pointInPolygon(point, zone.points))
}

export function computePathDistanceFeet(pathPoints, feetPerPixel) {
  if (!pathPoints || pathPoints.length < 2 || !feetPerPixel) return 0
  let totalPx = 0

  for (let i = 0; i < pathPoints.length - 1; i += 1) {
    totalPx += distancePx(pathPoints[i], pathPoints[i + 1])
  }

  return totalPx * feetPerPixel
}

export function computeVisibilityGrid({
  state,
  mapWidth,
  mapHeight,
  token,
  darkvision,
  feetPerPixel,
  gridSize: explicitGridSize,
  bounds,
}) {
  const gridSize = Number(explicitGridSize) || deriveVisibilityGridSize(mapWidth, mapHeight)
  const cols = Math.ceil(mapWidth / gridSize)
  const rows = Math.ceil(mapHeight / gridSize)

  const blockers = buildBlockerSegments(state)
  const visible = []

  if (!token) {
    return { cols, rows, gridSize, visible }
  }

  const visibilityBounds = bounds ?? deriveVisibilityBounds({
    mapWidth,
    mapHeight,
    token,
    darkvision,
    feetPerPixel,
    gridSize,
  })

  const origin = { x: token.x, y: token.y }
  const darknessLimitFeet = darkvision ? 60 : 30

  const minCol = clampInt(Math.floor(visibilityBounds.minX / gridSize), 0, cols - 1)
  const maxCol = clampInt(Math.ceil(visibilityBounds.maxX / gridSize), 0, cols - 1)
  const minRow = clampInt(Math.floor(visibilityBounds.minY / gridSize), 0, rows - 1)
  const maxRow = clampInt(Math.ceil(visibilityBounds.maxY / gridSize), 0, rows - 1)

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const point = {
        x: col * gridSize + gridSize / 2,
        y: row * gridSize + gridSize / 2,
      }

      if (segmentBlocksLine(origin, point, blockers)) continue

      const inDarkness = isPointInDarkness(point, state)
      if (inDarkness && feetPerPixel) {
        const distFeet = distancePx(origin, point) * feetPerPixel
        if (distFeet > darknessLimitFeet) {
          continue
        }
      }

      visible.push(row * cols + col)
    }
  }

  return { cols, rows, gridSize, visible }
}

function clampInt(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function deriveVisibilityGridSize(mapWidth, mapHeight) {
  const width = Number(mapWidth) || 0
  const height = Number(mapHeight) || 0
  const area = width * height
  return area > LARGE_MAP_AREA_THRESHOLD ? 6 : 4
}

export function deriveVisibilityBounds({
  mapWidth,
  mapHeight,
  token,
  darkvision,
  feetPerPixel,
  gridSize = 4,
}) {
  const width = Number(mapWidth) || 0
  const height = Number(mapHeight) || 0
  if (!token || !Number.isFinite(token.x) || !Number.isFinite(token.y)) {
    return {
      minX: 0,
      minY: 0,
      maxX: width,
      maxY: height,
    }
  }

  const fallbackRadiusPx = darkvision ? 1200 : 900
  const maxRangeFeet = darkvision ? 240 : 180
  const derivedRadius = feetPerPixel
    ? Math.max(220, maxRangeFeet / feetPerPixel)
    : fallbackRadiusPx
  const margin = Math.max(24, (Number(gridSize) || 4) * 2)

  return {
    minX: Math.max(0, token.x - derivedRadius - margin),
    minY: Math.max(0, token.y - derivedRadius - margin),
    maxX: Math.min(width, token.x + derivedRadius + margin),
    maxY: Math.min(height, token.y + derivedRadius + margin),
  }
}

export function mergeExploredCells(current, incoming) {
  const set = new Set(current ?? [])
  for (const cell of incoming ?? []) set.add(cell)
  return Array.from(set).sort((a, b) => a - b)
}

export function mergeExploredCellsDelta(current, incoming) {
  const set = new Set(current ?? [])
  const delta = []
  for (const cell of incoming ?? []) {
    if (!set.has(cell)) {
      set.add(cell)
      delta.push(cell)
    }
  }
  return {
    merged: Array.from(set).sort((a, b) => a - b),
    delta,
  }
}

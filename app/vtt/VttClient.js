'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer, Rect, Line, Circle, Text } from 'react-konva'
import {
  computePathDistanceFeet,
  computeVisibilityGrid,
  distancePx,
  feetPerPixelFromCalibration,
} from '@/lib/vttGeometry.mjs'

const TOOL_OPTIONS = {
  select: { id: 'select', label: 'Select' },
  move: { id: 'move', label: 'Move Token' },
  path: { id: 'path', label: 'Path Move' },
  wall: { id: 'wall', label: 'Draw Walls' },
  darkness: { id: 'darkness', label: 'Draw Darkness' },
  barrier: { id: 'barrier', label: 'Draw Barrier' },
  shape: { id: 'shape', label: 'Shape Tool' },
  measure: { id: 'measure', label: 'Measure' },
  ping: { id: 'ping', label: 'Ping' },
  calibrate: { id: 'calibrate', label: 'Calibrate' },
  token: { id: 'token', label: 'Add Player Token' },
  npcToken: { id: 'npcToken', label: 'Add NPC Token' },
}

const TOOL_ICONS = {
  select: '🖱️',
  move: '🧭',
  path: '👣',
  wall: '🧱',
  darkness: '🌑',
  barrier: '🚧',
  shape: '🔷',
  measure: '📏',
  ping: '📡',
  calibrate: '🎯',
  token: '🧙',
  npcToken: '👤',
}

const MAP_SETUP_TOOL_IDS = ['select', 'wall', 'darkness', 'calibrate']
const DM_TOOL_IDS = ['npcToken']

const RING_COLORS = {
  clear: 'transparent',
  white: '#f4f4f4',
  black: '#111111',
  red: '#d9534f',
  blue: '#4a90e2',
}

const TOKEN_RADIUS = {
  small: 16,
  medium: 16,
  large: 24,
}

const SHAPE_TYPE_OPTIONS = [
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'circle', label: 'Circle' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'square', label: 'Square' },
]

const SHAPE_COLOR_OPTIONS = [
  { id: 'red', label: 'Red', stroke: '#d9534f' },
  { id: 'blue', label: 'Blue', stroke: '#4a90e2' },
  { id: 'green', label: 'Green', stroke: '#4caf50' },
  { id: 'white', label: 'White', stroke: '#f4f4f4' },
  { id: 'black', label: 'Black', stroke: '#111111' },
  { id: 'darkness', label: 'Darkness Zone', stroke: '#1f2430' },
]

const SNAP_THRESHOLD_PX = 14
const PING_FADE_MS = 3000
const STAGING_AREA_WIDTH = 260

function resolvePdfWorkerSrc(version) {
  try {
    // Prefer a bundled worker so uploads do not depend on third-party CDNs.
    return new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
  } catch {
    // Fallback for environments that cannot resolve the bundled URL.
    return `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/legacy/build/pdf.worker.min.mjs`
  }
}

function flattenPoints(points = []) {
  return points.flatMap((point) => [point.x, point.y])
}

function formatFeet(value) {
  if (!Number.isFinite(value)) return '0'
  return value.toFixed(1).replace(/\.0$/, '')
}

function buildRectanglePoints(x, y, width = 120, height = 80) {
  return [
    { x: x - width / 2, y: y - height / 2 },
    { x: x + width / 2, y: y - height / 2 },
    { x: x + width / 2, y: y + height / 2 },
    { x: x - width / 2, y: y + height / 2 },
  ]
}

function buildSquarePoints(x, y, side = 110) {
  return buildRectanglePoints(x, y, side, side)
}

function buildTrianglePoints(x, y, side = 130) {
  const height = (Math.sqrt(3) / 2) * side
  return [
    { x, y: y - (2 * height) / 3 },
    { x: x - side / 2, y: y + height / 3 },
    { x: x + side / 2, y: y + height / 3 },
  ]
}

function polylineTotalLength(points = []) {
  if (!Array.isArray(points) || points.length < 2) return 0
  let total = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    total += distancePx(points[i], points[i + 1])
  }
  return total
}

function pointAlongPath(points = [], targetDistance = 0) {
  if (!Array.isArray(points) || !points.length) return null
  if (points.length === 1) return { ...points[0] }
  const clampedDistance = Math.max(0, targetDistance)
  let traversed = 0

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    const segmentLength = distancePx(a, b)
    if (segmentLength <= 0.001) continue
    if (traversed + segmentLength >= clampedDistance) {
      const ratio = (clampedDistance - traversed) / segmentLength
      return {
        x: a.x + ((b.x - a.x) * ratio),
        y: a.y + ((b.y - a.y) * ratio),
      }
    }
    traversed += segmentLength
  }

  return { ...points[points.length - 1] }
}

function preferredPlayerTokenId(tokens = []) {
  const players = (tokens ?? []).filter((token) => token.role === 'player')
  if (!players.length) return ''
  const aren = players.find((token) => String(token.name || '').trim().toLowerCase() === 'aren')
  return aren?.id ?? players[0].id
}

function getBounds(points = []) {
  if (!points.length) return null
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

function getPointsCenter(points = []) {
  if (!points.length) return { x: 0, y: 0 }
  const total = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 })
  return { x: total.x / points.length, y: total.y / points.length }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function rgbaFromHex(hex, alpha) {
  if (!hex || typeof hex !== 'string') return `rgba(74,144,226,${alpha})`
  const normalized = hex.replace('#', '')
  const value = normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized
  const channel = Number.parseInt(value, 16)
  if (!Number.isFinite(channel)) return `rgba(74,144,226,${alpha})`
  const r = (channel >> 16) & 255
  const g = (channel >> 8) & 255
  const b = channel & 255
  return `rgba(${r},${g},${b},${alpha})`
}

function shapeStrokeFromColorId(colorId = 'blue') {
  return SHAPE_COLOR_OPTIONS.find((entry) => entry.id === colorId)?.stroke ?? '#4a90e2'
}

function shapeFillFromColorId(colorId = 'blue') {
  const stroke = shapeStrokeFromColorId(colorId)
  const alpha = colorId === 'black' ? 0.22 : colorId === 'darkness' ? 0.45 : 0.2
  return rgbaFromHex(stroke, alpha)
}

function inferShapeColorId(shape) {
  if (shape?.colorName) return shape.colorName
  const color = String(shape?.color ?? '').toLowerCase()
  const match = SHAPE_COLOR_OPTIONS.find((entry) => entry.stroke.toLowerCase() === color)
  return match?.id ?? 'blue'
}

function createMapShapePayload(shapeType, x, y, colorId) {
  const colorName = colorId || 'blue'
  const color = shapeStrokeFromColorId(colorName)
  const fill = shapeFillFromColorId(colorName)
  const kind = colorName === 'darkness' ? 'darkness' : shapeType

  if (shapeType === 'circle') {
    const radius = 56
    const center = { x, y }
    return {
      points: [center, { x: x + radius, y }],
      closed: true,
      kind,
      shapeType: 'circle',
      center,
      radius,
      colorName,
      color,
      fill,
    }
  }

  if (shapeType === 'triangle') {
    return {
      points: buildTrianglePoints(x, y),
      closed: true,
      kind,
      shapeType: 'triangle',
      colorName,
      color,
      fill,
    }
  }

  if (shapeType === 'square') {
    return {
      points: buildSquarePoints(x, y),
      closed: true,
      kind,
      shapeType: 'square',
      colorName,
      color,
      fill,
    }
  }

  return {
    points: buildRectanglePoints(x, y),
    closed: true,
    kind,
    shapeType: 'rectangle',
    colorName,
    color,
    fill,
  }
}

function getCircleGeometry(shape) {
  const fallbackCenter = shape?.points?.[0] ?? { x: 0, y: 0 }
  const center = shape?.center ?? fallbackCenter
  const pointer = shape?.points?.[1] ?? { x: center.x + Number(shape?.radius || 40), y: center.y }
  const radius = clamp(Number(shape?.radius) || distancePx(center, pointer), 10, 2000)
  return { center, radius }
}

function formatDistanceLabel(pxDistance, feetPerPx) {
  if (!Number.isFinite(pxDistance)) return ''
  if (!feetPerPx) return '— ft'
  return `${Math.round(pxDistance * feetPerPx)} ft`
}

function rotatePointAroundCenter(point, center, angleDeg) {
  const radians = (angleDeg * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }
}

function rotateShapePayload(shape, deltaDeg) {
  if (!shape || !shape.shapeType || !Number.isFinite(deltaDeg)) return null

  if (shape.shapeType === 'circle') {
    const { center, radius } = getCircleGeometry(shape)
    const pointer = rotatePointAroundCenter({ x: center.x + radius, y: center.y }, center, deltaDeg)
    return {
      center,
      radius,
      points: [center, pointer],
    }
  }

  const points = shape.points ?? []
  if (!points.length) return null
  const center = getPointsCenter(points)
  return {
    points: points.map((point) => rotatePointAroundCenter(point, center, deltaDeg)),
  }
}

function getShapeScaleHandle(shape) {
  if (!shape || !shape.shapeType) return null
  if (shape.shapeType === 'circle') {
    const { center, radius } = getCircleGeometry(shape)
    return { x: center.x + radius, y: center.y }
  }
  const points = shape.points ?? []
  if (!points.length) return null
  if (shape.shapeType === 'triangle') {
    return points.reduce((maxPoint, point) => (point.x > maxPoint.x ? point : maxPoint), points[0])
  }
  if (shape.shapeType === 'rectangle' || shape.shapeType === 'square') {
    return points[2] ?? points[points.length - 1]
  }
  const bounds = getBounds(points)
  if (!bounds) return null
  return { x: bounds.maxX, y: bounds.maxY }
}

function moveShapePayload(shape, dx, dy) {
  if (!shape) return null
  if (shape.shapeType === 'circle') {
    const { center, radius } = getCircleGeometry(shape)
    const movedCenter = { x: center.x + dx, y: center.y + dy }
    return {
      center: movedCenter,
      radius,
      points: [movedCenter, { x: movedCenter.x + radius, y: movedCenter.y }],
    }
  }
  return {
    points: (shape.points ?? []).map((point) => ({ x: point.x + dx, y: point.y + dy })),
  }
}

function scaleShapePayload(shape, targetPoint) {
  if (!shape || !shape.shapeType || !targetPoint) return null

  if (shape.shapeType === 'circle') {
    const { center } = getCircleGeometry(shape)
    const radius = clamp(distancePx(center, targetPoint), 10, 2000)
    return {
      center,
      radius,
      points: [center, { x: center.x + radius, y: center.y }],
    }
  }

  const center = getPointsCenter(shape.points ?? [])
  const points = shape.points ?? []
  const axisU = points[0] && points[1]
    ? (() => {
        const dx = points[1].x - points[0].x
        const dy = points[1].y - points[0].y
        const len = Math.hypot(dx, dy) || 1
        return { x: dx / len, y: dy / len }
      })()
    : { x: 1, y: 0 }
  const axisV = points[1] && points[2]
    ? (() => {
        const dx = points[2].x - points[1].x
        const dy = points[2].y - points[1].y
        const len = Math.hypot(dx, dy) || 1
        return { x: dx / len, y: dy / len }
      })()
    : { x: -axisU.y, y: axisU.x }
  const targetVec = { x: targetPoint.x - center.x, y: targetPoint.y - center.y }
  const projU = Math.abs((targetVec.x * axisU.x) + (targetVec.y * axisU.y))
  const projV = Math.abs((targetVec.x * axisV.x) + (targetVec.y * axisV.y))

  if (shape.shapeType === 'rectangle') {
    const halfW = clamp(projU, 10, 1500)
    const halfH = clamp(projV, 10, 1500)
    return {
      points: [
        { x: center.x - axisU.x * halfW - axisV.x * halfH, y: center.y - axisU.y * halfW - axisV.y * halfH },
        { x: center.x + axisU.x * halfW - axisV.x * halfH, y: center.y + axisU.y * halfW - axisV.y * halfH },
        { x: center.x + axisU.x * halfW + axisV.x * halfH, y: center.y + axisU.y * halfW + axisV.y * halfH },
        { x: center.x - axisU.x * halfW + axisV.x * halfH, y: center.y - axisU.y * halfW + axisV.y * halfH },
      ],
    }
  }

  if (shape.shapeType === 'square') {
    const half = clamp(Math.max(projU, projV), 10, 1500)
    return {
      points: [
        { x: center.x - axisU.x * half - axisV.x * half, y: center.y - axisU.y * half - axisV.y * half },
        { x: center.x + axisU.x * half - axisV.x * half, y: center.y + axisU.y * half - axisV.y * half },
        { x: center.x + axisU.x * half + axisV.x * half, y: center.y + axisU.y * half + axisV.y * half },
        { x: center.x - axisU.x * half + axisV.x * half, y: center.y - axisU.y * half + axisV.y * half },
      ],
    }
  }

  if (shape.shapeType === 'triangle') {
    const handle = getShapeScaleHandle(shape)
    const currentRadius = handle ? Math.max(1, distancePx(center, handle)) : 1
    const nextRadius = clamp(distancePx(center, targetPoint), 10, 2000)
    const ratio = nextRadius / currentRadius
    return {
      points: points.map((point) => ({
        x: center.x + (point.x - center.x) * ratio,
        y: center.y + (point.y - center.y) * ratio,
      })),
    }
  }

  return null
}

function shapeMeasurements(shape, feetPerPx) {
  if (!shape || !shape.shapeType) return []

  if (shape.shapeType === 'circle') {
    const { center, radius } = getCircleGeometry(shape)
    const handle = { x: center.x + radius, y: center.y }
    return [
      {
        id: `${shape.id}:radius-line`,
        line: [center.x, center.y, handle.x, handle.y],
        text: `r ${formatDistanceLabel(radius, feetPerPx)}`,
        textX: center.x + radius / 2 - 24,
        textY: center.y - 20,
      },
    ]
  }

  if (shape.shapeType === 'rectangle' || shape.shapeType === 'square') {
    const points = shape.points ?? []
    if (points.length < 4) return []
    const width = distancePx(points[0], points[1])
    const height = distancePx(points[1], points[2])
    const widthMid = {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    }
    const heightMid = {
      x: (points[1].x + points[2].x) / 2,
      y: (points[1].y + points[2].y) / 2,
    }
    const labels = [
      {
        id: `${shape.id}:w-line`,
        line: [points[0].x, points[0].y, points[1].x, points[1].y],
        text: formatDistanceLabel(width, feetPerPx),
        textX: widthMid.x + 6,
        textY: widthMid.y - 16,
      },
    ]
    if (shape.shapeType === 'rectangle') {
      labels.push({
        id: `${shape.id}:h-line`,
        line: [points[1].x, points[1].y, points[2].x, points[2].y],
        text: formatDistanceLabel(height, feetPerPx),
        textX: heightMid.x + 6,
        textY: heightMid.y - 16,
      })
    } else {
      labels.push({
        id: `${shape.id}:s-line`,
        line: [points[1].x, points[1].y, points[2].x, points[2].y],
        text: `h ${formatDistanceLabel(height, feetPerPx)}`,
        textX: heightMid.x + 6,
        textY: heightMid.y - 16,
      })
    }
    return labels
  }

  if (shape.shapeType === 'triangle') {
    const points = shape.points ?? []
    if (points.length < 3) return []
    const apex = points[0]
    const baseA = points[1]
    const baseB = points[2]
    const baseDx = baseB.x - baseA.x
    const baseDy = baseB.y - baseA.y
    const denom = (baseDx * baseDx) + (baseDy * baseDy)
    if (!denom) return []
    const projectionT = clamp(
      (((apex.x - baseA.x) * baseDx) + ((apex.y - baseA.y) * baseDy)) / denom,
      0,
      1,
    )
    const foot = {
      x: baseA.x + (baseDx * projectionT),
      y: baseA.y + (baseDy * projectionT),
    }
    const height = distancePx(apex, foot)
    return [
      {
        id: `${shape.id}:tri-h`,
        line: [apex.x, apex.y, foot.x, foot.y],
        text: `h ${formatDistanceLabel(height, feetPerPx)}`,
        textX: (apex.x + foot.x) / 2 + 8,
        textY: (apex.y + foot.y) / 2 - 8,
      },
    ]
  }

  return []
}

function getShapeRotateHandle(shape) {
  if (!shape || !shape.shapeType) return null
  const center = shape.shapeType === 'circle'
    ? getCircleGeometry(shape).center
    : getPointsCenter(shape.points ?? [])

  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return null

  let anchor = null
  if (shape.shapeType === 'circle') {
    const { radius } = getCircleGeometry(shape)
    anchor = { x: center.x, y: center.y - radius }
  } else {
    const points = shape.points ?? []
    if (!points.length) return null
    anchor = points.reduce((top, point) => (point.y < top.y ? point : top), points[0])
  }

  const dx = anchor.x - center.x
  const dy = anchor.y - center.y
  const magnitude = Math.hypot(dx, dy) || 1
  const ux = dx / magnitude
  const uy = dy / magnitude
  const handle = {
    x: anchor.x + ux * 24,
    y: anchor.y + uy * 24,
  }
  return { center, anchor, handle }
}

function findSnapPoint(points, pointer, threshold = SNAP_THRESHOLD_PX) {
  if (!pointer || !points.length) return null
  let closest = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const point of points) {
    const dist = distancePx(point, pointer)
    if (dist <= threshold && dist < bestDistance) {
      closest = point
      bestDistance = dist
    }
  }
  return closest
}

function endpointKey(point, precision = 2) {
  const factor = 10 ** precision
  const x = Math.round(point.x * factor) / factor
  const y = Math.round(point.y * factor) / factor
  return `${x}:${y}`
}

function wallComponentFromId(walls, startId) {
  if (!startId) return []
  const wallById = new Map((walls ?? []).map((wall) => [wall.id, wall]))
  const endpointToWalls = new Map()

  for (const wall of walls ?? []) {
    const keys = [endpointKey(wall.a), endpointKey(wall.b)]
    for (const key of keys) {
      if (!endpointToWalls.has(key)) endpointToWalls.set(key, new Set())
      endpointToWalls.get(key).add(wall.id)
    }
  }

  const visited = new Set()
  const queue = [startId]

  while (queue.length) {
    const nextId = queue.shift()
    if (!nextId || visited.has(nextId)) continue
    visited.add(nextId)
    const wall = wallById.get(nextId)
    if (!wall) continue
    const keys = [endpointKey(wall.a), endpointKey(wall.b)]
    for (const key of keys) {
      const neighbors = endpointToWalls.get(key)
      for (const neighborId of neighbors ?? []) {
        if (!visited.has(neighborId)) queue.push(neighborId)
      }
    }
  }

  return Array.from(visited)
}

function barrierComponentFromId(barriers, startId) {
  if (!startId) return []
  const barrierById = new Map((barriers ?? []).map((barrier) => [barrier.id, barrier]))
  const pointToBarriers = new Map()

  for (const barrier of barriers ?? []) {
    for (const point of barrier.points ?? []) {
      const key = endpointKey(point)
      if (!pointToBarriers.has(key)) pointToBarriers.set(key, new Set())
      pointToBarriers.get(key).add(barrier.id)
    }
  }

  const visited = new Set()
  const queue = [startId]
  while (queue.length) {
    const nextId = queue.shift()
    if (!nextId || visited.has(nextId)) continue
    visited.add(nextId)
    const barrier = barrierById.get(nextId)
    if (!barrier) continue
    for (const point of barrier.points ?? []) {
      const neighbors = pointToBarriers.get(endpointKey(point))
      for (const neighborId of neighbors ?? []) {
        if (!visited.has(neighborId)) queue.push(neighborId)
      }
    }
  }
  return Array.from(visited)
}

function darknessComponentFromId(darknessZones, startId) {
  if (!startId) return []
  const exists = (darknessZones ?? []).some((zone) => zone.id === startId)
  return exists ? [startId] : []
}

function getMapPointerFromEvent(event, zoom = 1) {
  const pointer = event.target.getStage()?.getPointerPosition()
  if (!pointer) return null
  return {
    x: pointer.x / zoom,
    y: pointer.y / zoom,
  }
}

function getClientId() {
  if (typeof window === 'undefined') return 'server'

  const cached = localStorage.getItem('vtt-client-id')
  if (cached) return cached

  const next = crypto.randomUUID()
  localStorage.setItem('vtt-client-id', next)
  return next
}

export default function VttClient({ mode = 'dm', initialMapId = '' }) {
  const isDm = mode === 'dm'
  const isPlayer = !isDm
  const [bundle, setBundle] = useState(null)
  const [results, setResults] = useState([])
  const [tool, setTool] = useState(isDm ? 'select' : 'move')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [draftPoints, setDraftPoints] = useState([])
  const [measureDrag, setMeasureDrag] = useState(null)
  const [pathPoints, setPathPoints] = useState([])
  const [calibrationFeet, setCalibrationFeet] = useState('5')
  const [mapName, setMapName] = useState('')
  const [startMapId, setStartMapId] = useState('')
  const [linkResultId, setLinkResultId] = useState('')
  const [pointerPosition, setPointerPosition] = useState(null)
  const [mapZoom, setMapZoom] = useState(1)
  const [mapUndoStack, setMapUndoStack] = useState([])
  const [selectedStructure, setSelectedStructure] = useState({ kind: null, ids: [] })
  const [structureDragOffset, setStructureDragOffset] = useState(null)
  const [selectedShapeId, setSelectedShapeId] = useState('')
  const [shapeDraftType, setShapeDraftType] = useState('rectangle')
  const [selectedShapeColor, setSelectedShapeColor] = useState('blue')
  const [selectedTokenId, setSelectedTokenId] = useState('')
  const [focusedPlayerTokenId, setFocusedPlayerTokenId] = useState(isDm ? 'dm' : '')
  const [selectedNpcTokenId, setSelectedNpcTokenId] = useState('')
  const [tokenDraft, setTokenDraft] = useState({ name: 'Token', size: 'medium', ringColor: 'clear', darkvision: false })
  const [npcTokenDraft, setNpcTokenDraft] = useState({ name: 'NPC', size: 'medium', ringColor: 'red', darkvision: false, hidden: false })
  const [character, setCharacter] = useState({ moveSpeed: 30, darkvision: false })
  const [viewMode, setViewMode] = useState(isDm ? 'dm' : 'player')
  const [clientId, setClientId] = useState('')
  const [mapRenderError, setMapRenderError] = useState('')
  const [pingClock, setPingClock] = useState(Date.now())
  const [shapePreview, setShapePreview] = useState(null)
  const [animatedTokenPositions, setAnimatedTokenPositions] = useState({})
  const [activePrimaryPanel, setActivePrimaryPanel] = useState('measure')
  const [activeDmPanel, setActiveDmPanel] = useState(isDm ? 'mapUpload' : '')

  const containerRef = useRef(null)
  const [stageWidth, setStageWidth] = useState(1100)
  const [stageHeight, setStageHeight] = useState(720)
  const exploredSyncRef = useRef('')
  const rotateDragRef = useRef(null)
  const pathAnimationRef = useRef({ rafId: null, tokenId: '' })

  const refresh = useCallback(async (customClientId = clientId) => {
    const query = new URLSearchParams()
    query.set('role', isDm ? 'dm' : 'player')
    if (customClientId) {
      query.set('clientId', customClientId)
    }
    const liveUrl = `/api/vtt/live?${query.toString()}`

    const [liveRes, resultsRes] = await Promise.all([
      fetch(liveUrl, { cache: 'no-store' }),
      fetch('/api/results', { cache: 'no-store' }),
    ])

    if (!liveRes.ok) {
      const body = await liveRes.json().catch(() => ({}))
      throw new Error(body.error || 'Failed to load VTT state.')
    }

    const liveJson = await liveRes.json()
    setBundle(liveJson)
    if (liveJson.character) {
      setCharacter({
        moveSpeed: Number(liveJson.character.moveSpeed) || 30,
        darkvision: Boolean(liveJson.character.darkvision),
      })
    }

    if (resultsRes.ok) {
      const resultsJson = await resultsRes.json()
      setResults(Array.isArray(resultsJson) ? resultsJson : (resultsJson.results ?? []))
    }

    return liveJson
  }, [clientId, isDm])

  useEffect(() => {
    setClientId(getClientId())
  }, [])

  useEffect(() => {
    let mounted = true

    async function loadRosters() {
      try {
        const charactersRes = await fetch('/api/characters', { cache: 'no-store' })

        if (!mounted) return

        if (charactersRes.ok) {
          const charactersJson = await charactersRes.json()
          const nextCharacters = Array.isArray(charactersJson) ? charactersJson : []

          if (nextCharacters.length) {
            const firstName = nextCharacters[0].name
            setTokenDraft((prev) => ({
              ...prev,
              name: prev.name === 'Token' ? firstName : prev.name,
            }))
          }
        }
      } catch (err) {
        console.error('Failed to load character/NPC rosters', err)
      }
    }

    loadRosters()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true

    async function init() {
      try {
        const nextBundle = await refresh(clientId)
        if (!mounted) return

        const firstPlayerId = preferredPlayerTokenId(nextBundle?.activeState?.tokens ?? [])
        const firstTokenId = isPlayer
          ? firstPlayerId
          : (firstPlayerId || (nextBundle?.activeState?.tokens?.[0]?.id ?? ''))
        setSelectedTokenId((prev) => prev || firstTokenId)
        setFocusedPlayerTokenId((prev) => {
          if (isPlayer) return prev || firstPlayerId || ''
          return prev === 'dm' ? prev : (prev || firstPlayerId || 'dm')
        })
      } catch (err) {
        if (!mounted) return
        setError(err.message)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    init()
    return () => {
      mounted = false
    }
  }, [refresh, clientId, isPlayer])

  useEffect(() => {
    const tokens = bundle?.activeState?.tokens ?? []
    if (!tokens.length) {
      setSelectedTokenId('')
      setFocusedPlayerTokenId('dm')
      setSelectedNpcTokenId('')
      return
    }

    const firstPlayerId = preferredPlayerTokenId(tokens)
    const firstPlayer = tokens.find((token) => token.id === firstPlayerId)
    setSelectedTokenId((prev) => prev || firstPlayer?.id || (isDm ? tokens[0].id : ''))

    setFocusedPlayerTokenId((prev) => {
      if (isPlayer) {
        if (prev && tokens.some((token) => token.id === prev && token.role === 'player')) return prev
        return firstPlayer?.id || ''
      }
      if (prev === 'dm') return 'dm'
      if (prev && tokens.some((token) => token.id === prev && token.role === 'player')) return prev
      return firstPlayer?.id || (isDm ? 'dm' : '')
    })

    setSelectedNpcTokenId((prev) => {
      if (prev && tokens.some((token) => token.id === prev && token.role === 'npc')) return prev
      return tokens.find((token) => token.role === 'npc')?.id ?? ''
    })
  }, [bundle?.activeState?.tokens, isDm, isPlayer])

  useEffect(() => {
    if (isPlayer && viewMode !== 'player') {
      setViewMode('player')
    }
  }, [isPlayer, viewMode])

  useEffect(() => {
    setDraftPoints([])
    setPathPoints([])
    setMeasureDrag(null)
    setPointerPosition(null)
    setSelectedStructure({ kind: null, ids: [] })
    setStructureDragOffset(null)
    setSelectedShapeId('')
    setMapUndoStack([])
    setMapZoom(1)
  }, [bundle?.activeMap?.id])

  useEffect(() => {
    if (!bundle?.activeMap) return

    setStageWidth(Math.max(800, bundle.activeMap.width + (isDm ? STAGING_AREA_WIDTH : 0)))
    setStageHeight(Math.max(500, bundle.activeMap.height))
  }, [bundle?.activeMap, isDm])

  useEffect(() => {
    if (!bundle) return
    setStartMapId(initialMapId || bundle.live?.activeMapId || bundle.maps?.[0]?.id || '')
  }, [bundle, initialMapId])

  useEffect(() => {
    if (!containerRef.current) return

    const resize = () => {
      const width = containerRef.current.clientWidth
      if (!width) return
      setStageWidth((prev) => Math.max(780, Math.min(prev, width - 24)))
    }

    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER

    if (!key || !cluster || !clientId) return undefined

    let channel = null
    let pusher = null

    async function setup() {
      const { default: Pusher } = await import('pusher-js')
      pusher = new Pusher(key, { cluster })
      channel = pusher.subscribe('vtt-live')

      const events = [
        'session.started',
        'session.stopped',
        'map.updated',
        'token.updated',
        'fog.updated',
        'shape.updated',
        'ping.created',
        'character.updated',
      ]

      for (const eventName of events) {
        channel.bind(eventName, () => {
          refresh(clientId).catch((err) => {
            console.error('Failed to refresh after pusher event', err)
          })
        })
      }
    }

    setup()

    return () => {
      if (channel) {
        channel.unbind_all()
      }
      if (pusher) {
        pusher.unsubscribe('vtt-live')
        pusher.disconnect()
      }
    }
  }, [refresh, clientId])

  const activeMap = bundle?.activeMap ?? null
  const activeState = bundle?.activeState ?? null
  const sessionStatus = bundle?.live?.status ?? (bundle?.live?.active ? 'active' : 'closed')

  const feetPerPx = useMemo(() => feetPerPixelFromCalibration(activeMap?.calibration), [activeMap?.calibration])

  const playerTokens = useMemo(
    () => (activeState?.tokens ?? []).filter((token) => token.role === 'player'),
    [activeState?.tokens],
  )

  const npcTokens = useMemo(
    () => (activeState?.tokens ?? []).filter((token) => token.role === 'npc'),
    [activeState?.tokens],
  )

  const barrierShapes = useMemo(
    () => (activeState?.shapes ?? []).filter((shape) => shape.kind === 'barrier'),
    [activeState?.shapes],
  )

  const selectedToken = useMemo(
    () => activeState?.tokens?.find((token) => token.id === selectedTokenId) ?? null,
    [activeState?.tokens, selectedTokenId],
  )

  const focusedPlayerToken = useMemo(
    () => activeState?.tokens?.find((token) => token.id === focusedPlayerTokenId && token.role === 'player') ?? null,
    [activeState?.tokens, focusedPlayerTokenId],
  )

  const visionToken = useMemo(() => {
    if (viewMode === 'player') return focusedPlayerToken
    return selectedToken
  }, [focusedPlayerToken, selectedToken, viewMode])

  useEffect(() => {
    if (!selectedToken) return
    setTokenDraft({
      name: selectedToken.name || 'Token',
      size: selectedToken.size || 'medium',
      ringColor: selectedToken.ringColor || 'clear',
      darkvision: Boolean(selectedToken.darkvision),
    })
  }, [selectedToken?.id])

  useEffect(() => {
    if (!selectedNpcTokenId) return
    const token = npcTokens.find((entry) => entry.id === selectedNpcTokenId)
    if (!token) return
    setNpcTokenDraft({
      name: token.name || 'NPC',
      size: token.size || 'medium',
      ringColor: token.ringColor || 'red',
      darkvision: Boolean(token.darkvision),
      hidden: Boolean(token.hidden),
    })
  }, [npcTokens, selectedNpcTokenId])

  const selectedShape = useMemo(
    () => activeState?.shapes?.find((shape) => shape.id === selectedShapeId) ?? null,
    [activeState?.shapes, selectedShapeId],
  )

  const selectedWallIds = useMemo(
    () => new Set(selectedStructure.kind === 'wall' ? selectedStructure.ids : []),
    [selectedStructure.ids, selectedStructure.kind],
  )

  const selectedBarrierIds = useMemo(
    () => new Set(selectedStructure.kind === 'barrier' ? selectedStructure.ids : []),
    [selectedStructure.ids, selectedStructure.kind],
  )

  const selectedDarknessIds = useMemo(
    () => new Set(selectedStructure.kind === 'darkness' ? selectedStructure.ids : []),
    [selectedStructure.ids, selectedStructure.kind],
  )

  useEffect(() => {
    if (!selectedShape) return
    setSelectedShapeColor(inferShapeColorId(selectedShape))
  }, [selectedShape?.id, selectedShape?.color, selectedShape?.colorName])

  useEffect(() => {
    if (!selectedStructure.kind || !selectedStructure.ids.length) return
    if (selectedStructure.kind === 'wall') {
      const validIds = new Set((activeState?.walls ?? []).map((wall) => wall.id))
      const nextIds = selectedStructure.ids.filter((id) => validIds.has(id))
      if (nextIds.length !== selectedStructure.ids.length) {
        setSelectedStructure(nextIds.length ? { kind: 'wall', ids: nextIds } : { kind: null, ids: [] })
      }
      return
    }

    if (selectedStructure.kind === 'barrier') {
      const validIds = new Set(barrierShapes.map((shape) => shape.id))
      const nextIds = selectedStructure.ids.filter((id) => validIds.has(id))
      if (nextIds.length !== selectedStructure.ids.length) {
        setSelectedStructure(nextIds.length ? { kind: 'barrier', ids: nextIds } : { kind: null, ids: [] })
      }
      return
    }

    if (selectedStructure.kind === 'darkness') {
      const validIds = new Set((activeState?.darknessZones ?? []).map((zone) => zone.id))
      const nextIds = selectedStructure.ids.filter((id) => validIds.has(id))
      if (nextIds.length !== selectedStructure.ids.length) {
        setSelectedStructure(nextIds.length ? { kind: 'darkness', ids: nextIds } : { kind: null, ids: [] })
      }
    }
  }, [activeState?.darknessZones, activeState?.walls, barrierShapes, selectedStructure.ids, selectedStructure.kind])

  const visibility = useMemo(() => {
    if (!activeMap || !activeState) return null

    // DM view: show areas visible by at least one player token.
    if (isDm && viewMode === 'dm') {
      const playerVisionTokens = (activeState.tokens ?? []).filter((token) => token.role === 'player')
      if (!playerVisionTokens.length) {
        return computeVisibilityGrid({
          state: activeState,
          mapWidth: activeMap.width,
          mapHeight: activeMap.height,
          token: null,
          darkvision: false,
          feetPerPixel: feetPerPx,
        })
      }

      const grids = playerVisionTokens.map((token) => computeVisibilityGrid({
        state: activeState,
        mapWidth: activeMap.width,
        mapHeight: activeMap.height,
        token,
        darkvision: Boolean(token.darkvision),
        feetPerPixel: feetPerPx,
      }))

      const base = grids[0]
      const visibleSet = new Set()
      for (const grid of grids) {
        for (const cell of grid.visible) {
          visibleSet.add(cell)
        }
      }
      return {
        cols: base.cols,
        rows: base.rows,
        gridSize: base.gridSize,
        visible: Array.from(visibleSet),
      }
    }

    if (!visionToken) return null
    const darkvisionEnabled = Boolean(visionToken.darkvision)
    return computeVisibilityGrid({
      state: activeState,
      mapWidth: activeMap.width,
      mapHeight: activeMap.height,
      token: visionToken,
      darkvision: darkvisionEnabled,
      feetPerPixel: feetPerPx,
    })
  }, [activeMap, activeState, feetPerPx, isDm, viewMode, visionToken])

  const pathFeet = useMemo(() => computePathDistanceFeet(pathPoints, feetPerPx), [pathPoints, feetPerPx])
  const movementRemaining = Number(character.moveSpeed) - pathFeet

  const visiblePings = useMemo(() => {
    return (activeState?.pings ?? [])
      .map((ping) => {
        const createdAt = Number(new Date(ping.createdAt).getTime())
        const ageMs = Number.isFinite(createdAt) ? pingClock - createdAt : 0
        if (ageMs < 0 || ageMs > PING_FADE_MS) return null
        const progress = ageMs / PING_FADE_MS
        return {
          ...ping,
          radius: 12 + progress * 20,
          opacity: 0.7 * (1 - progress),
          strokeWidth: 3 - progress * 1.2,
        }
      })
      .filter(Boolean)
  }, [activeState?.pings, pingClock])

  const latestPingTimestamp = useMemo(() => {
    const timestamps = (activeState?.pings ?? [])
      .map((ping) => Number(new Date(ping.createdAt).getTime()))
      .filter(Number.isFinite)
    if (!timestamps.length) return 0
    return Math.max(...timestamps)
  }, [activeState?.pings])

  useEffect(() => {
    if (!latestPingTimestamp) return undefined
    if (Date.now() - latestPingTimestamp > PING_FADE_MS) return undefined

    const interval = window.setInterval(() => setPingClock(Date.now()), 60)
    const timeout = window.setTimeout(() => {
      window.clearInterval(interval)
      setPingClock(Date.now())
    }, PING_FADE_MS + 120)

    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [latestPingTimestamp])

  useEffect(() => {
    setPointerPosition(null)
  }, [tool])

  useEffect(() => {
    setShapePreview(null)
  }, [selectedShapeId])

  useEffect(() => {
    return () => {
      if (pathAnimationRef.current.rafId) {
        window.cancelAnimationFrame(pathAnimationRef.current.rafId)
      }
    }
  }, [])

  useEffect(() => {
    const tokenIds = new Set((bundle?.activeState?.tokens ?? []).map((token) => token.id))
    setAnimatedTokenPositions((prev) => {
      const next = {}
      for (const [tokenId, position] of Object.entries(prev)) {
        if (tokenIds.has(tokenId)) next[tokenId] = position
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [bundle?.activeState?.tokens])

  useEffect(() => {
    if (!activeMap || !activeState?.fog?.enabled || !visibility) return
    if (isDm || viewMode !== 'player' || visionToken?.role !== 'player') return
    if (!visibility.visible.length) return

    const payload = {
      mapId: activeMap.id,
      op: 'mergeFogExplored',
      actorId: clientId,
      payload: {
        tokenId: visionToken.id,
        exploredCells: visibility.visible,
        cols: visibility.cols,
        rows: visibility.rows,
        gridSize: visibility.gridSize,
      },
    }

    const hash = JSON.stringify(payload.payload)
    if (exploredSyncRef.current === hash) return
    exploredSyncRef.current = hash

    fetch('/api/vtt/mutate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((err) => {
      console.error('Failed to merge explored cells', err)
    })
  }, [activeMap, activeState?.fog?.enabled, clientId, isDm, viewMode, visibility, visionToken?.id, visionToken?.role])

  const callMutation = useCallback(async (op, payload) => {
    if (!activeMap) return null

    const res = await fetch('/api/vtt/mutate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mapId: activeMap.id,
        op,
        payload,
        actorId: clientId,
        actorRole: isDm ? 'dm' : 'player',
      }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error || `Failed operation: ${op}`)
    }

    if (data.state) {
      setBundle((prev) => {
        if (!prev) return prev
        return { ...prev, activeState: data.state }
      })
    }

    if (data.map) {
      setBundle((prev) => {
        if (!prev) return prev
        const maps = (prev.maps ?? []).map((map) => (map.id === data.map.id ? data.map : map))
        return { ...prev, maps, activeMap: data.map }
      })
    }

    return data
  }, [activeMap, clientId, isDm])

  const setSessionState = useCallback(async ({ mapId, status }) => {
    const res = await fetch('/api/vtt/live/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapId, status, actorId: clientId, actorRole: isDm ? 'dm' : 'player' }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Failed to update game state.')
    }

    await refresh()
  }, [clientId, isDm, refresh])

  const stopSession = useCallback(async () => {
    const res = await fetch('/api/vtt/live/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorId: clientId, actorRole: isDm ? 'dm' : 'player' }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Failed to stop session.')
    }

    await refresh()
  }, [clientId, isDm, refresh])

  useEffect(() => {
    if (!isDm || !initialMapId || !bundle) return
    if (bundle.live?.activeMapId === initialMapId) return
    setSessionState({ mapId: initialMapId, status: 'preparing' }).catch((err) => setError(err.message))
  }, [bundle, initialMapId, isDm, setSessionState])

  const uploadPdfMap = useCallback(async (file) => {
    if (!file) return

    if (file.type !== 'application/pdf') {
      setError('Only PDF files are allowed for map uploads.')
      return
    }

    if (file.size > 50 * 1024 * 1024) {
      setError('PDF exceeds 50MB upload limit.')
      return
    }

    setUploading(true)
    setError('')

    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      pdfjs.GlobalWorkerOptions.workerSrc = resolvePdfWorkerSrc(pdfjs.version)

      const raw = await file.arrayBuffer()
      const loadingTask = pdfjs.getDocument({ data: raw })
      const pdf = await loadingTask.promise
      const page = await pdf.getPage(1)
      const viewport = page.getViewport({ scale: 2 })

      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)

      const context = canvas.getContext('2d', { alpha: false })
      if (!context) {
        throw new Error('Unable to create a canvas context for PDF rendering.')
      }
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: context, viewport }).promise

      const imageBlob = await new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), 'image/png', 1)
      })

      if (!imageBlob) {
        throw new Error('Unable to render PDF map image.')
      }

      const formData = new FormData()
      formData.append('image', imageBlob, `${file.name.replace(/\.pdf$/i, '') || 'map'}.png`)
      formData.append('sourceType', 'pdf')
      formData.append('sourcePage', '1')
      formData.append('sourcePdfSize', String(file.size))
      formData.append('width', String(canvas.width))
      formData.append('height', String(canvas.height))
      formData.append('sourceFileName', file.name)
      formData.append('mapName', mapName || file.name.replace(/\.pdf$/i, ''))

      const res = await fetch('/api/vtt/maps/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Map upload failed.')
      }

      if (data?.map?.id) {
        setStartMapId(data.map.id)
      }
      await refresh()
      setMapName('')
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }, [mapName, refresh])

  const commitDraftPoints = useCallback(async (points, draftTool = tool) => {
    if (!points?.length) return

    try {
      if (draftTool === 'wall') {
        await callMutation('addWall', { points })
      } else if (draftTool === 'darkness') {
        await callMutation('addDarknessZone', {
          points,
          closed: true,
          kind: 'darkness',
        })
      } else if (draftTool === 'barrier') {
        await callMutation('addShape', {
          points,
          closed: true,
          kind: 'barrier',
          color: '#f5a623',
          fill: 'rgba(245,166,35,0.2)',
        })
      } else if (draftTool === 'calibrate') {
        if (points.length !== 2) {
          setError('Calibration requires exactly two points.')
          return
        }
        const feetDistance = Number(calibrationFeet)
        if (!feetDistance || feetDistance <= 0) {
          setError('Enter a valid feet distance for calibration.')
          return
        }
        const pxDistance = distancePx(points[0], points[1])
        await callMutation('setCalibration', {
          feetDistance,
          pxDistance,
        })
      }
      setDraftPoints([])
      setPointerPosition(null)
    } catch (err) {
      setError(err.message)
    }
  }, [calibrationFeet, callMutation, tool])

  const finalizeDraft = useCallback(async () => {
    if (!draftPoints.length) return
    await commitDraftPoints(draftPoints, tool)
  }, [commitDraftPoints, draftPoints, tool])

  const placeToken = useCallback(async (point) => {
    const playerName = tokenDraft.name || 'Player'
    const existingPlayer = (activeState?.tokens ?? []).find((token) => token.role === 'player' && token.name === playerName)

    try {
      if (existingPlayer?.id) {
        await callMutation('updateToken', {
          id: existingPlayer.id,
          x: point.x,
          y: point.y,
          ringColor: tokenDraft.ringColor,
          darkvision: Boolean(tokenDraft.darkvision),
          role: 'player',
        })
      } else {
        await callMutation('addToken', {
          x: point.x,
          y: point.y,
          name: playerName,
          size: 'medium',
          ringColor: tokenDraft.ringColor,
          darkvision: Boolean(tokenDraft.darkvision),
          role: 'player',
        })
      }
    } catch (err) {
      setError(err.message)
    }
  }, [activeState?.tokens, callMutation, tokenDraft.darkvision, tokenDraft.name, tokenDraft.ringColor])

  const placeNpcToken = useCallback(async (point) => {
    if (!isDm) return
    try {
      await callMutation('addToken', {
        x: point.x,
        y: point.y,
        name: npcTokenDraft.name || 'NPC',
        size: npcTokenDraft.size,
        ringColor: npcTokenDraft.ringColor,
        darkvision: Boolean(npcTokenDraft.darkvision),
        hidden: Boolean(npcTokenDraft.hidden),
        role: 'npc',
      })
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, isDm, npcTokenDraft])

  const onStageClick = useCallback(async (event) => {
    if (!activeMap) return
    if (isPlayer && sessionStatus !== 'active') return
    const pointer = getMapPointerFromEvent(event, mapZoom)
    if (!pointer) return

    if (!isDm && (tool === 'wall' || tool === 'darkness' || tool === 'calibrate' || tool === 'token' || tool === 'npcToken')) {
      return
    }

    if (tool === 'wall' || tool === 'darkness' || tool === 'calibrate') {
      if ((tool === 'wall' || tool === 'darkness') && draftPoints.length >= 2) {
        const snapPoint = findSnapPoint(draftPoints, pointer)
        if (snapPoint) {
          await commitDraftPoints([...draftPoints, snapPoint], tool)
          return
        }
      }
      if (tool === 'calibrate') {
        setDraftPoints((prev) => (prev.length >= 2 ? [{ x: pointer.x, y: pointer.y }] : [...prev, { x: pointer.x, y: pointer.y }]))
      } else {
        setDraftPoints((prev) => [...prev, { x: pointer.x, y: pointer.y }])
      }
      return
    }

    if (tool === 'ping') {
      try {
        await callMutation('ping', { x: pointer.x, y: pointer.y })
      } catch (err) {
        setError(err.message)
      }
      return
    }

    if (tool === 'select') {
      setSelectedStructure({ kind: null, ids: [] })
      setSelectedShapeId('')
      return
    }

    if (tool === 'token') {
      if (!isDm) return
      await placeToken(pointer)
      return
    }

    if (tool === 'npcToken') {
      if (!isDm) return
      await placeNpcToken(pointer)
      return
    }

    if (tool === 'path') {
      if (isPlayer && selectedToken?.role !== 'player') return
      setPathPoints((prev) => {
        if (!prev.length && selectedToken) {
          return [{ x: selectedToken.x, y: selectedToken.y }, { x: pointer.x, y: pointer.y }]
        }
        return [...prev, { x: pointer.x, y: pointer.y }]
      })
      return
    }

    if (tool === 'shape') {
      try {
        const payload = createMapShapePayload(shapeDraftType, pointer.x, pointer.y, 'blue')
        const data = await callMutation('addShape', payload)
        const created = data?.state?.shapes?.[data.state.shapes.length - 1]
        if (created?.id) {
          setSelectedShapeId(created.id)
        }
      } catch (err) {
        setError(err.message)
      }
    }
  }, [activeMap, callMutation, commitDraftPoints, draftPoints, isDm, isPlayer, mapZoom, placeNpcToken, placeToken, selectedToken, sessionStatus, shapeDraftType, tool])

  const onStagePointerDown = useCallback((event) => {
    if (tool !== 'measure' || !activeMap || (isPlayer && sessionStatus !== 'active')) return
    const pointer = getMapPointerFromEvent(event, mapZoom)
    if (!pointer) return
    setMeasureDrag({ start: { x: pointer.x, y: pointer.y }, end: { x: pointer.x, y: pointer.y } })
  }, [activeMap, isPlayer, mapZoom, sessionStatus, tool])

  const onStagePointerMove = useCallback((event) => {
    const pointer = getMapPointerFromEvent(event, mapZoom)
    if (!pointer) return

    if (tool === 'wall' || tool === 'darkness' || tool === 'calibrate') {
      setPointerPosition({ x: pointer.x, y: pointer.y })
    }

    setMeasureDrag((prev) => (prev ? { ...prev, end: { x: pointer.x, y: pointer.y } } : prev))
  }, [mapZoom, tool])

  const onStagePointerUp = useCallback(() => {
    if (tool !== 'measure') return
    setMeasureDrag(null)
  }, [tool])

  const onTokenDragEnd = useCallback(async (tokenId, event) => {
    const token = (activeState?.tokens ?? []).find((entry) => entry.id === tokenId)
    if (!token) return
    if (isPlayer && token.role !== 'player') return

    const { x, y } = event.target.position()

    try {
      setAnimatedTokenPositions((prev) => {
        if (!prev[tokenId]) return prev
        const next = { ...prev }
        delete next[tokenId]
        return next
      })
      await callMutation('updateToken', { id: tokenId, x, y })
    } catch (err) {
      setError(err.message)
    }
  }, [activeState?.tokens, callMutation, isPlayer])

  const finalizePathMove = useCallback(async () => {
    if (!selectedToken || pathPoints.length < 2) return
    if (isPlayer && selectedToken.role !== 'player') return

    const tokenId = selectedToken.id
    const route = pathPoints.map((point) => ({ x: point.x, y: point.y }))
    const totalLength = polylineTotalLength(route)
    const destination = pathPoints[pathPoints.length - 1]
    if (!destination || totalLength <= 0.001) return

    if (pathAnimationRef.current.rafId) {
      window.cancelAnimationFrame(pathAnimationRef.current.rafId)
    }

    const msPerPixel = 3.6
    const durationMs = clamp(totalLength * msPerPixel, 220, 5200)
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    pathAnimationRef.current = { rafId: null, tokenId }

    const animateStep = (timestamp) => {
      const elapsed = Math.max(0, timestamp - startedAt)
      const progress = clamp(elapsed / durationMs, 0, 1)
      const point = pointAlongPath(route, totalLength * progress) || destination
      setAnimatedTokenPositions((prev) => ({ ...prev, [tokenId]: point }))
      if (progress >= 1) return
      pathAnimationRef.current.rafId = window.requestAnimationFrame(animateStep)
    }

    pathAnimationRef.current.rafId = window.requestAnimationFrame(animateStep)

    try {
      await callMutation('updateToken', {
        id: tokenId,
        x: destination.x,
        y: destination.y,
      })
      if (pathAnimationRef.current.rafId) {
        window.cancelAnimationFrame(pathAnimationRef.current.rafId)
      }
      pathAnimationRef.current = { rafId: null, tokenId: '' }
      setAnimatedTokenPositions((prev) => {
        const next = { ...prev }
        delete next[tokenId]
        return next
      })
      setPathPoints([])
    } catch (err) {
      if (pathAnimationRef.current.rafId) {
        window.cancelAnimationFrame(pathAnimationRef.current.rafId)
      }
      pathAnimationRef.current = { rafId: null, tokenId: '' }
      setAnimatedTokenPositions((prev) => {
        const next = { ...prev }
        delete next[tokenId]
        return next
      })
      setError(err.message)
    }
  }, [callMutation, isPlayer, pathPoints, selectedToken])

  const updateShapeColor = useCallback(async (shape, colorName) => {
    if (!shape?.id) return
    const nextKind = colorName === 'darkness'
      ? 'darkness'
      : (shape.shapeType || shape.kind || 'shape')
    try {
      await callMutation('updateShape', {
        id: shape.id,
        kind: nextKind,
        colorName,
        color: shapeStrokeFromColorId(colorName),
        fill: shapeFillFromColorId(colorName),
      })
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation])

  const removeShape = useCallback(async () => {
    if (!selectedShapeId) return

    try {
      if (selectedShape?.kind === 'barrier') {
        setMapUndoStack((prev) => [{ op: 'addShape', payload: { ...selectedShape } }, ...prev].slice(0, 20))
      }
      await callMutation('removeShape', { id: selectedShapeId })
      setSelectedShapeId('')
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, selectedShape, selectedShapeId])

  const selectWallStructure = useCallback((wallId) => {
    const ids = wallComponentFromId(activeState?.walls ?? [], wallId)
    setSelectedStructure({ kind: 'wall', ids })
    setSelectedShapeId('')
    setStructureDragOffset(null)
  }, [activeState?.walls])

  const selectBarrierStructure = useCallback((barrierId) => {
    const ids = barrierComponentFromId(barrierShapes, barrierId)
    setSelectedStructure({ kind: 'barrier', ids })
    setSelectedShapeId('')
    setStructureDragOffset(null)
  }, [barrierShapes])

  const selectDarknessStructure = useCallback((zoneId) => {
    const ids = darknessComponentFromId(activeState?.darknessZones ?? [], zoneId)
    setSelectedStructure({ kind: 'darkness', ids })
    setSelectedShapeId('')
    setStructureDragOffset(null)
  }, [activeState?.darknessZones])

  const removeSelectedStructure = useCallback(async () => {
    if (!selectedStructure.kind || !selectedStructure.ids.length) return
    try {
      if (selectedStructure.kind === 'wall') {
        const wallsById = new Map((activeState?.walls ?? []).map((wall) => [wall.id, wall]))
        const wallsToRemove = selectedStructure.ids.map((id) => wallsById.get(id)).filter(Boolean)
        if (!wallsToRemove.length) return
        setMapUndoStack((prev) => [
          { op: 'batchRestoreWalls', payload: { walls: wallsToRemove.map((wall) => ({ ...wall })) } },
          ...prev,
        ].slice(0, 20))
        await Promise.all(wallsToRemove.map((wall) => callMutation('removeWall', { id: wall.id })))
      } else if (selectedStructure.kind === 'barrier') {
        const barriersById = new Map(barrierShapes.map((shape) => [shape.id, shape]))
        const barriersToRemove = selectedStructure.ids.map((id) => barriersById.get(id)).filter(Boolean)
        if (!barriersToRemove.length) return
        setMapUndoStack((prev) => [
          { op: 'batchAddShapes', payload: { shapes: barriersToRemove.map((shape) => ({ ...shape })) } },
          ...prev,
        ].slice(0, 20))
        await Promise.all(barriersToRemove.map((shape) => callMutation('removeShape', { id: shape.id })))
      } else if (selectedStructure.kind === 'darkness') {
        const darknessById = new Map((activeState?.darknessZones ?? []).map((zone) => [zone.id, zone]))
        const zonesToRemove = selectedStructure.ids.map((id) => darknessById.get(id)).filter(Boolean)
        if (!zonesToRemove.length) return
        setMapUndoStack((prev) => [
          { op: 'batchRestoreDarkness', payload: { zones: zonesToRemove.map((zone) => ({ ...zone })) } },
          ...prev,
        ].slice(0, 20))
        await Promise.all(zonesToRemove.map((zone) => callMutation('removeDarknessZone', { id: zone.id })))
      }
      setSelectedStructure({ kind: null, ids: [] })
      setStructureDragOffset(null)
    } catch (err) {
      setError(err.message)
    }
  }, [activeState?.darknessZones, activeState?.walls, barrierShapes, callMutation, selectedStructure.ids, selectedStructure.kind])

  const resetMap = useCallback(async () => {
    if (!activeMap) return
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Reset this map? This clears walls, shapes, darkness zones, tokens, fog memory, and pings for this map.')
      if (!confirmed) return
    }

    try {
      await callMutation('resetMapState', {})
      setSelectedStructure({ kind: null, ids: [] })
      setStructureDragOffset(null)
      setSelectedShapeId('')
      setSelectedTokenId('')
      setSelectedNpcTokenId('')
      setMapUndoStack([])
      setDraftPoints([])
      setPointerPosition(null)
      setPathPoints([])
      setMeasureDrag(null)
      setShapePreview(null)
      setFocusedPlayerTokenId(isDm ? 'dm' : '')
      setViewMode(isDm ? 'dm' : 'player')
    } catch (err) {
      setError(err.message)
    }
  }, [activeMap, callMutation, isDm])

  const undoMapEdit = useCallback(async () => {
    const action = mapUndoStack[0]
    if (!action) return
    setMapUndoStack((prev) => prev.slice(1))

    try {
      if (action.op === 'batchRestoreWalls') {
        await Promise.all((action.payload?.walls ?? []).map((wall) => callMutation('restoreWall', { wall })))
      } else if (action.op === 'batchAddShapes') {
        await Promise.all((action.payload?.shapes ?? []).map((shape) => callMutation('addShape', shape)))
      } else if (action.op === 'batchRestoreDarkness') {
        await Promise.all((action.payload?.zones ?? []).map((zone) => callMutation('restoreDarknessZone', { zone })))
      } else {
        await callMutation(action.op, action.payload)
      }
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, mapUndoStack])

  useEffect(() => {
    if (!isDm || !selectedNpcTokenId) return
    const token = npcTokens.find((entry) => entry.id === selectedNpcTokenId)
    if (!token) return

    const trimmedDraftName = String(npcTokenDraft.name || '').trim()
    const draftName = trimmedDraftName || token.name || 'NPC'
    const changed = (
      draftName !== (token.name || 'NPC')
      || npcTokenDraft.size !== (token.size || 'medium')
      || npcTokenDraft.ringColor !== (token.ringColor || 'red')
      || Boolean(npcTokenDraft.darkvision) !== Boolean(token.darkvision)
      || Boolean(npcTokenDraft.hidden) !== Boolean(token.hidden)
    )
    if (!changed) return

    const timer = window.setTimeout(() => {
      callMutation('updateToken', {
        id: selectedNpcTokenId,
        name: draftName,
        size: npcTokenDraft.size,
        ringColor: npcTokenDraft.ringColor,
        darkvision: Boolean(npcTokenDraft.darkvision),
        hidden: Boolean(npcTokenDraft.hidden),
        role: 'npc',
      }).catch((err) => setError(err.message))
    }, 160)

    return () => window.clearTimeout(timer)
  }, [callMutation, isDm, npcTokenDraft.darkvision, npcTokenDraft.hidden, npcTokenDraft.name, npcTokenDraft.ringColor, npcTokenDraft.size, npcTokens, selectedNpcTokenId])

  const deleteNpcToken = useCallback(async () => {
    if (!selectedNpcTokenId) return
    if (!isDm) return
    try {
      await callMutation('removeToken', { id: selectedNpcTokenId })
      setSelectedNpcTokenId('')
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, isDm, selectedNpcTokenId])

  const linkMap = useCallback(async () => {
    if (!activeMap || !linkResultId) return

    const res = await fetch('/api/vtt/maps/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapId: activeMap.id, resultId: linkResultId, actorId: clientId }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || 'Failed to link map.')
      return
    }

    await refresh()
  }, [activeMap, clientId, linkResultId, refresh])

  useEffect(() => {
    if (!isDm && activeDmPanel) setActiveDmPanel('')
  }, [activeDmPanel, isDm])

  const nextNpcStagingPoint = useMemo(() => {
    if (!isDm || !activeMap) return null
    const index = npcTokens.length
    const cols = 3
    const spacing = 56
    const col = index % cols
    const row = Math.floor(index / cols)
    return {
      x: activeMap.width + 30 + (col * spacing),
      y: 68 + (row * spacing),
    }
  }, [activeMap, isDm, npcTokens.length])

  const togglePrimaryPanel = useCallback((panelId) => {
    setActivePrimaryPanel((prev) => (prev === panelId ? '' : panelId))
    setActiveDmPanel('')
    if (panelId === 'measure' || panelId === 'shape' || panelId === 'ping') {
      setTool(panelId)
      setStructureDragOffset(null)
    }
    if (panelId === 'movementPath') {
      setTool('path')
      setStructureDragOffset(null)
    }
  }, [])

  const toggleDmPanel = useCallback((panelId) => {
    setActiveDmPanel((prev) => (prev === panelId ? '' : panelId))
    setActivePrimaryPanel('')
  }, [])

  const selectTool = useCallback((toolId) => {
    if (!isDm && (MAP_SETUP_TOOL_IDS.includes(toolId) || DM_TOOL_IDS.includes(toolId) || toolId === 'token' || toolId === 'npcToken')) {
      return
    }
    setTool((prev) => (prev === toolId ? '' : toolId))
    if (toolId !== 'select') {
      setStructureDragOffset(null)
    }
  }, [isDm])

  const zoomIn = useCallback(() => {
    setMapZoom((prev) => clamp(prev + 0.2, 0.6, 3))
  }, [])

  const zoomOut = useCallback(() => {
    setMapZoom((prev) => clamp(prev - 0.2, 0.6, 3))
  }, [])

  const resetZoom = useCallback(() => {
    setMapZoom(1)
  }, [])

  const selectFocusedPlayer = useCallback((value) => {
    if (isPlayer && value === 'dm') return
    setFocusedPlayerTokenId(value)
    if (value === 'dm') {
      setViewMode('dm')
      setSelectedTokenId('')
      setSelectedNpcTokenId('')
      return
    }

    setViewMode('player')
    setSelectedTokenId(value)
    setSelectedNpcTokenId('')
  }, [isPlayer])

  const selectNpcToken = useCallback((tokenId) => {
    setSelectedNpcTokenId(tokenId)
    if (!tokenId) return
    const token = npcTokens.find((entry) => entry.id === tokenId)
    if (!token) return
    setNpcTokenDraft({
      name: token.name || 'NPC',
      size: token.size || 'medium',
      ringColor: token.ringColor || 'red',
      darkvision: Boolean(token.darkvision),
      hidden: Boolean(token.hidden),
    })
  }, [npcTokens])

  const measurementDistance = useMemo(() => {
    if (!measureDrag?.start || !measureDrag?.end) return null
    const distance = distancePx(measureDrag.start, measureDrag.end)
    return {
      px: distance,
      feet: feetPerPx ? distance * feetPerPx : null,
      mid: {
        x: (measureDrag.start.x + measureDrag.end.x) / 2,
        y: (measureDrag.start.y + measureDrag.end.y) / 2,
      },
    }
  }, [feetPerPx, measureDrag])

  const fogRenderData = useMemo(() => {
    if (!activeState?.fog?.enabled || !visibility) return null

    const visibleSet = new Set(visibility.visible ?? [])
    const exploredByToken = activeState.fog?.exploredByToken ?? {}
    const tokenExplored = visionToken?.id ? exploredByToken[visionToken.id] : null
    const fallbackExplored = activeState.fog?.exploredCells ?? []
    const exploredSet = new Set(Array.isArray(tokenExplored) ? tokenExplored : fallbackExplored)
    const fogRects = []
    const gridSize = visibility.gridSize

    for (let row = 0; row < visibility.rows; row += 1) {
      let col = 0
      while (col < visibility.cols) {
        const index = row * visibility.cols + col
        if (visibleSet.has(index)) {
          col += 1
          continue
        }
        const seen = exploredSet.has(index)
        const startCol = col
        col += 1
        while (col < visibility.cols) {
          const nextIndex = row * visibility.cols + col
          if (visibleSet.has(nextIndex)) break
          if (exploredSet.has(nextIndex) !== seen) break
          col += 1
        }
        fogRects.push({
          x: startCol * gridSize,
          y: row * gridSize,
          width: (col - startCol) * gridSize,
          height: gridSize,
          seen,
        })
      }
    }

    if (isDm && viewMode === 'dm') {
      return {
        fogRects,
        unseenFill: 'rgba(0,0,0,0.24)',
        exploredFill: 'rgba(0,0,0,0.24)',
        unseenBlur: 12,
        exploredBlur: 10,
      }
    }

    return {
      fogRects,
      unseenFill: 'rgba(0,0,0,0.74)',
      exploredFill: 'rgba(0,0,0,0.38)',
      unseenBlur: 74,
      exploredBlur: 26,
    }
  }, [activeState?.fog, isDm, viewMode, visibility, visionToken?.id])

  const visibleTokenIds = useMemo(() => {
    if (!activeState?.tokens?.length) return new Set()
    if (!activeState?.fog?.enabled || viewMode !== 'player' || !visibility) {
      return new Set(activeState.tokens.map((token) => token.id))
    }

    const visibleCells = new Set(visibility.visible)
    const rows = visibility.rows
    const cols = visibility.cols
    const gridSize = visibility.gridSize
    const ids = new Set()

    for (const token of activeState.tokens) {
      const col = Math.min(cols - 1, Math.max(0, Math.floor(token.x / gridSize)))
      const row = Math.min(rows - 1, Math.max(0, Math.floor(token.y / gridSize)))
      const cellIndex = row * cols + col
      if (visibleCells.has(cellIndex)) {
        ids.add(token.id)
      }
    }

    if (visionToken?.id) {
      ids.add(visionToken.id)
    }

    return ids
  }, [activeState?.fog?.enabled, activeState?.tokens, viewMode, visibility, visionToken?.id])

  const renderTokenIds = useMemo(() => {
    if (!activeState?.tokens?.length) return new Set()
    const ids = new Set(visibleTokenIds)
    if (!isPlayer) return ids

    for (const token of activeState.tokens) {
      if (token.role === 'npc' && token.hidden) {
        ids.delete(token.id)
      }
    }
    return ids
  }, [activeState?.tokens, isPlayer, visibleTokenIds])

  const draftSnapPoint = useMemo(() => {
    if ((tool !== 'wall' && tool !== 'darkness') || !pointerPosition || draftPoints.length < 2) return null
    return findSnapPoint(draftPoints, pointerPosition)
  }, [draftPoints, pointerPosition, tool])

  const selectedShapeHandle = useMemo(() => {
    if (!selectedShape) return null
    const effectiveShape = shapePreview?.shapeId === selectedShape.id
      ? { ...selectedShape, ...shapePreview.payload }
      : selectedShape
    return getShapeScaleHandle(effectiveShape)
  }, [selectedShape, shapePreview])

  const selectedShapeRotateHandle = useMemo(() => {
    if (!selectedShape) return null
    const effectiveShape = shapePreview?.shapeId === selectedShape.id
      ? { ...selectedShape, ...shapePreview.payload }
      : selectedShape
    return getShapeRotateHandle(effectiveShape)
  }, [selectedShape, shapePreview])

  const shapeMeasurementEntries = useMemo(() => {
    if (!selectedShape) return []
    const effectiveShape = shapePreview?.shapeId === selectedShape.id
      ? { ...selectedShape, ...shapePreview.payload }
      : selectedShape
    return shapeMeasurements(effectiveShape, feetPerPx)
  }, [feetPerPx, selectedShape, shapePreview])

  const pathDraftLabel = useMemo(() => {
    if (pathPoints.length < 2) return null
    const last = pathPoints[pathPoints.length - 1]
    if (!last) return null
    const text = feetPerPx ? `${Math.round(pathFeet)} ft` : '— ft'
    return {
      x: last.x + 8,
      y: last.y - 18,
      text,
      width: Math.max(44, (text.length * 7) + 10),
    }
  }, [feetPerPx, pathFeet, pathPoints])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setTool('')
        setDraftPoints([])
        setPointerPosition(null)
        setMeasureDrag(null)
        setPathPoints([])
        setStructureDragOffset(null)
        return
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const activeTag = document.activeElement?.tagName?.toLowerCase()
      const isTyping = activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.isContentEditable
      if (isTyping) return

      if (selectedShapeId) {
        event.preventDefault()
        removeShape()
        return
      }
      if (selectedStructure.kind && selectedStructure.ids.length) {
        event.preventDefault()
        removeSelectedStructure()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [removeSelectedStructure, removeShape, selectedShapeId, selectedStructure.ids.length, selectedStructure.kind])

  useEffect(() => {
    setMapRenderError('')
  }, [activeMap?.assetUrl])

  if (loading) {
    return <p style={{ color: '#888' }}>Loading VTT...</p>
  }

  const zoomedStageWidth = Math.round(stageWidth * mapZoom)
  const zoomedStageHeight = Math.round(stageHeight * mapZoom)
  const canRenderBoard = Boolean(activeMap) && (isDm ? sessionStatus !== 'closed' : sessionStatus === 'active')
  const primaryRailOptions = [
    { id: 'measure', icon: '📏', label: 'Measure Tool' },
    { id: 'shape', icon: '🔷', label: 'Add Shape Tool' },
    { id: 'ping', icon: '📡', label: 'Ping Tool' },
    { id: 'focus', icon: '👥', label: 'Choose Player' },
    { id: 'movementPath', icon: '👣', label: 'Movement Path' },
  ]
  const dmRailOptions = [
    { id: 'mapUpload', icon: '🗺️', label: 'Upload/Change Map' },
    { id: 'mapStatus', icon: '🎬', label: 'Map Status' },
    { id: 'mapSetup', icon: '🧱', label: 'Map Setup' },
    { id: 'addNpc', icon: '👤', label: 'Add NPC' },
    { id: 'visionOptions', icon: '🌫️', label: 'Vision Options' },
    { id: 'dmVision', icon: '🎯', label: 'DM Vision' },
  ]
  const activePanelType = activeDmPanel ? 'dm' : (activePrimaryPanel ? 'primary' : '')
  const activePanelId = activeDmPanel || activePrimaryPanel
  const activePanelOptions = activePanelType === 'dm' ? dmRailOptions : primaryRailOptions
  const activePanelLabel = activePanelOptions.find((option) => option.id === activePanelId)?.label || ''
  const movementLockedForDm = isDm && viewMode !== 'player'
  const canAnimatePath = pathPoints.length >= 2

  function renderFocusControls() {
    if (isDm) {
      return (
        <div style={{ display: 'grid', gap: '0.4rem', marginTop: '0.2rem' }}>
          <button
            type="button"
            onClick={() => selectFocusedPlayer('dm')}
            style={{
              ...focusPillStyle,
              width: '100%',
              minHeight: '44px',
              fontSize: '0.82rem',
              fontWeight: 700,
              background: (focusedPlayerTokenId === 'dm' || viewMode === 'dm') ? '#2a4f82' : '#1a1a1a',
              borderColor: (focusedPlayerTokenId === 'dm' || viewMode === 'dm') ? '#7caeff' : '#3a3a3a',
            }}
          >
            DM View
          </button>
          {playerTokens.map((token) => (
            <button
              key={token.id}
              type="button"
              onClick={() => selectFocusedPlayer(token.id)}
              style={{
                ...focusPillStyle,
                width: '100%',
                minHeight: '40px',
                background: (focusedPlayerTokenId === token.id && viewMode === 'player') ? '#2a4f82' : '#1a1a1a',
                borderColor: (focusedPlayerTokenId === token.id && viewMode === 'player') ? '#7caeff' : '#3a3a3a',
              }}
            >
              {token.name}
            </button>
          ))}
        </div>
      )
    }

    if (!playerTokens.length) {
      return <p style={{ margin: 0, color: '#888', fontSize: '0.75rem' }}>No player tokens available yet.</p>
    }

    return (
      <div style={{ display: 'grid', gap: '0.4rem' }}>
        {playerTokens.map((token) => (
          <button
            key={token.id}
            type="button"
            onClick={() => selectFocusedPlayer(token.id)}
            style={{
              ...focusPillStyle,
              width: '100%',
              minHeight: '40px',
              background: (focusedPlayerTokenId === token.id) ? '#2a4f82' : '#1a1a1a',
              borderColor: (focusedPlayerTokenId === token.id) ? '#7caeff' : '#3a3a3a',
            }}
          >
            {token.name}
          </button>
        ))}
      </div>
    )
  }

  function renderMovementPathControls() {
    if (movementLockedForDm) {
      return <p style={{ margin: 0, color: '#777', fontSize: '0.75rem' }}>Switch focus to a player to use movement options.</p>
    }

    return (
      <>
        <div style={{ display: 'grid', gap: '0.3rem' }}>
          <div style={iconTileGridStyle}>
            <IconTileButton
              icon="🏃"
              label="Animate Move"
              onClick={finalizePathMove}
              tone={canAnimatePath ? 'success' : 'muted'}
              disabled={!canAnimatePath}
              active={canAnimatePath}
              size="small"
            />
            <IconTileButton
              icon="🧹"
              label="Clear Path"
              onClick={() => setPathPoints([])}
              tone="muted"
              size="small"
            />
          </div>
          <div style={{ fontSize: '0.78rem', color: '#888' }}>
            Used: {formatFeet(pathFeet)} ft | Remaining: {formatFeet(movementRemaining)} ft
          </div>
        </div>
      </>
    )
  }

  function renderPrimaryPanelContent() {
    if (activePrimaryPanel === 'measure') {
      return (
        <>
          <p style={{ margin: 0, color: '#888', fontSize: '0.75rem' }}>
            Click and drag on map to measure distance.
          </p>
        </>
      )
    }

    if (activePrimaryPanel === 'shape') {
      return (
        <>
          <div style={{ ...subSectionTitleStyle, marginBottom: '0.28rem', textTransform: 'none', letterSpacing: 0, fontSize: '0.75rem' }}>New Shape Type</div>
          <div style={toolGridStyle}>
            {SHAPE_TYPE_OPTIONS.map((shapeType) => (
              <IconTileButton
                key={shapeType.id}
                icon={shapeType.id === 'circle' ? '⚪' : shapeType.id === 'square' ? '⬜' : shapeType.id === 'triangle' ? '🔺' : '▭'}
                label={shapeType.label}
                onClick={() => setShapeDraftType(shapeType.id)}
                active={shapeDraftType === shapeType.id}
                size="small"
              />
            ))}
          </div>
          <select value={selectedShapeId} onChange={(event) => setSelectedShapeId(event.target.value)} style={inputStyle}>
            <option value="">Select shape</option>
            {(activeState?.shapes ?? []).map((shape) => (
              <option key={shape.id} value={shape.id}>
                {(shape.shapeType || shape.kind)} ({shape.id.slice(0, 6)})
              </option>
            ))}
          </select>
          {selectedShape && (
            <>
              {selectedShape.shapeType && (
                <select
                  value={selectedShapeColor}
                  onChange={(event) => {
                    setSelectedShapeColor(event.target.value)
                    updateShapeColor(selectedShape, event.target.value)
                  }}
                  style={inputStyle}
                >
                  {SHAPE_COLOR_OPTIONS.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.label}</option>
                  ))}
                </select>
              )}
              <IconTileButton icon="🗑️" label="Remove Shape" onClick={removeShape} tone="danger" fullWidth />
            </>
          )}
        </>
      )
    }

    if (activePrimaryPanel === 'ping') {
      return (
        <>
          <p style={{ margin: 0, color: '#888', fontSize: '0.75rem' }}>
            Select ping, then click on map to signal location.
          </p>
        </>
      )
    }

    if (activePrimaryPanel === 'focus') {
      return (
        <>
          <div style={subSectionTitleStyle}>Choose Player View</div>
          {renderFocusControls()}
        </>
      )
    }

    if (activePrimaryPanel === 'movementPath') {
      return (
        <>
          <div style={subSectionTitleStyle}>Movement Path Options</div>
          {renderMovementPathControls()}
        </>
      )
    }

    return null
  }

  function renderDmPanelContent() {
    if (activeDmPanel === 'mapUpload') {
      return (
        <>
          <div style={subSectionTitleStyle}>Change Active Map</div>
          <select
            value={startMapId}
            onChange={(event) => {
              const nextMapId = event.target.value
              setStartMapId(nextMapId)
              setSessionState({ mapId: nextMapId, status: 'preparing' }).catch((err) => setError(err.message))
            }}
            style={inputStyle}
          >
            <option value="">Select map</option>
            {(bundle?.maps ?? []).map((map) => (
              <option key={map.id} value={map.id}>
                {map.name} ({map.id.slice(0, 6)})
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Optional map name"
            value={mapName}
            onChange={(event) => setMapName(event.target.value)}
            style={inputStyle}
          />
          <input
            type="file"
            accept="application/pdf"
            disabled={uploading}
            onChange={(event) => uploadPdfMap(event.target.files?.[0])}
            style={{ marginTop: '0.2rem', fontSize: '0.8rem', width: '100%' }}
          />
          <p style={{ margin: 0, color: '#666', fontSize: '0.75rem' }}>
            First page only, max 50MB.
          </p>
        </>
      )
    }

    if (activeDmPanel === 'mapStatus') {
      return (
        <>
          <div style={iconTileGridStyle}>
            <IconTileButton
              icon="🧰"
              label="DM Preparing"
              onClick={() => setSessionState({ mapId: startMapId || activeMap?.id, status: 'preparing' }).catch((err) => setError(err.message))}
              tone="neutral"
              active={sessionStatus === 'preparing'}
            />
            <IconTileButton
              icon="▶️"
              label="Active"
              onClick={() => setSessionState({ mapId: startMapId || activeMap?.id, status: 'active' }).catch((err) => setError(err.message))}
              tone="neutral"
              active={sessionStatus === 'active'}
            />
            <IconTileButton
              icon="⏹️"
              label="Closed"
              onClick={() => stopSession().catch((err) => setError(err.message))}
              tone="neutral"
              active={sessionStatus === 'closed'}
            />
          </div>
          <p style={{ margin: 0, color: sessionStatus === 'active' ? '#89d089' : '#a88', fontSize: '0.78rem' }}>
            Status: {sessionStatus === 'active' ? 'Active' : sessionStatus === 'preparing' ? 'DM Preparing' : 'Closed'}
          </p>
        </>
      )
    }

    if (activeDmPanel === 'mapSetup') {
      return (
        <>
          <div style={subSectionTitleStyle}>Setup Tools</div>
          <div style={toolGridStyle}>
            {MAP_SETUP_TOOL_IDS.map((toolId) => (
              <IconTileButton
                key={toolId}
                icon={TOOL_ICONS[toolId]}
                label={TOOL_OPTIONS[toolId].label}
                onClick={() => selectTool(toolId)}
                active={tool === toolId}
              />
            ))}
          </div>
          {(tool === 'wall' || tool === 'darkness' || tool === 'calibrate') && (
            <>
              <div style={iconTileGridStyle}>
                <IconTileButton icon="✅" label={tool === 'calibrate' ? 'Save Calibration' : 'Commit Draft'} onClick={finalizeDraft} tone="success" size="small" />
                <IconTileButton icon="🧹" label="Clear Draft" onClick={() => { setDraftPoints([]); setPointerPosition(null) }} tone="muted" size="small" />
              </div>
              <p style={{ margin: 0, color: '#777', fontSize: '0.75rem' }}>
                {tool === 'calibrate' ? 'Calibration uses two points max.' : 'Click an existing point to snap-close the loop.'}
              </p>
            </>
          )}
          {tool === 'calibrate' && (
            <input
              type="number"
              min="1"
              value={calibrationFeet}
              onChange={(event) => setCalibrationFeet(event.target.value)}
              style={inputStyle}
              placeholder="Feet between 2 points (default 5)"
            />
          )}
          <p style={{ margin: 0, color: '#8c8c8c', fontSize: '0.75rem' }}>
            Selected: {selectedStructure.kind ? `${selectedStructure.kind} (${selectedStructure.ids.length})` : 'none'}
          </p>
          <IconTileButton icon="↩️" label="Undo Last Map Edit" onClick={undoMapEdit} disabled={!mapUndoStack.length} tone="primary" fullWidth />
          <IconTileButton icon="🗺️" label="Reset Map" onClick={resetMap} disabled={!activeMap} tone="danger" fullWidth />
        </>
      )
    }

    if (activeDmPanel === 'addNpc') {
      return (
        <>
          <IconTileButton
            icon={TOOL_ICONS.npcToken}
            label="Add NPC To Staging"
            onClick={() => {
              if (!nextNpcStagingPoint) return
              placeNpcToken(nextNpcStagingPoint)
            }}
            fullWidth
          />
          <input
            type="text"
            value={npcTokenDraft.name}
            onChange={(event) => setNpcTokenDraft((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="NPC token name"
            style={inputStyle}
          />
          <select value={npcTokenDraft.size} onChange={(event) => setNpcTokenDraft((prev) => ({ ...prev, size: event.target.value }))} style={inputStyle}>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
          <select value={npcTokenDraft.ringColor} onChange={(event) => setNpcTokenDraft((prev) => ({ ...prev, ringColor: event.target.value }))} style={inputStyle}>
            <option value="clear">Ring: Clear</option>
            <option value="white">Ring: White</option>
            <option value="black">Ring: Black</option>
            <option value="red">Ring: Red</option>
            <option value="blue">Ring: Blue</option>
          </select>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={Boolean(npcTokenDraft.darkvision)}
              onChange={(event) => setNpcTokenDraft((prev) => ({ ...prev, darkvision: event.target.checked }))}
            />
            NPC has dark vision
          </label>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={Boolean(npcTokenDraft.hidden)}
              onChange={(event) => setNpcTokenDraft((prev) => ({ ...prev, hidden: event.target.checked }))}
            />
            Hidden from players
          </label>
          <select value={selectedNpcTokenId} onChange={(event) => selectNpcToken(event.target.value)} style={inputStyle}>
            <option value="">Select NPC token</option>
            {npcTokens.map((token) => (
              <option key={token.id} value={token.id}>{token.name}</option>
            ))}
          </select>
          <IconTileButton icon="🗑️" label="Delete NPC" onClick={deleteNpcToken} disabled={!selectedNpcTokenId} tone="danger" />
        </>
      )
    }

    if (activeDmPanel === 'visionOptions') {
      return (
        <>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={Boolean(activeState?.fog?.enabled)}
              disabled={!activeMap}
              onChange={(event) => {
                callMutation('setFogEnabled', { enabled: event.target.checked }).catch((err) => setError(err.message))
              }}
            />
            Enable fog of war
          </label>
          <IconTileButton
            icon="👁️"
            label="Reset Player Vision"
            onClick={() => {
              callMutation('resetFogExplored', {})
                .catch((err) => setError(err.message))
            }}
            disabled={!activeMap}
            tone="muted"
            fullWidth
          />
        </>
      )
    }

    if (activeDmPanel === 'dmVision') {
      return (
        <>
          <div style={subSectionTitleStyle}>Change DM Vision</div>
          {renderFocusControls()}
        </>
      )
    }

    return null
  }

  return (
    <main style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.8rem' }}>
      <section ref={containerRef} style={{ border: '1px solid #2d2d2d', borderRadius: '10px', background: '#111', padding: '0.6rem' }}>
        <div style={topStatusBarStyle}>
          <span>Virtual Tabletop</span>
          <span>Active tool: {TOOL_OPTIONS[tool]?.label || 'None'}</span>
        </div>
        {error && (
          <div style={{ marginBottom: '0.8rem', color: '#ff8b8b', background: '#2b1414', border: '1px solid #5a2323', borderRadius: '6px', padding: '0.45rem 0.6rem', fontSize: '0.8rem' }}>
            {error}
          </div>
        )}
        {!error && mapRenderError && (
          <div style={{ marginBottom: '0.8rem', color: '#ffb6b6', background: '#2b1414', border: '1px solid #5a2323', borderRadius: '6px', padding: '0.45rem 0.6rem', fontSize: '0.8rem' }}>
            {mapRenderError}
          </div>
        )}
        {sessionStatus === 'closed' && (
          <div style={{ marginBottom: '0.6rem', padding: '0.55rem 0.8rem', borderRadius: '6px', background: '#231818', border: '1px solid #4b2222', color: '#db9f9f', fontSize: '0.85rem' }}>
            {isDm ? 'Game is closed. Select a map and switch to DM Preparing to set up.' : 'Game is currently closed.'}
          </div>
        )}
        {isPlayer && sessionStatus === 'preparing' && (
          <div style={{ marginBottom: '0.6rem', padding: '0.55rem 0.8rem', borderRadius: '6px', background: '#1d1f2b', border: '1px solid #313a5a', color: '#bfc8f7', fontSize: '0.85rem' }}>
            DM is setting up the game.
          </div>
        )}

        {!activeMap && (
          <div style={{ color: '#777', padding: '1.2rem', textAlign: 'center' }}>
            Upload a PDF map to begin.
          </div>
        )}

        {canRenderBoard && (
          <>
          <div style={{ position: 'relative', width: stageWidth, height: stageHeight, border: '1px solid #222', borderRadius: '8px', background: '#0a0a0a', overflow: 'auto' }}>
            <div style={menuCascadeContainerStyle}>
              <div style={railStackStyle}>
                <div style={railStyle}>
                  {primaryRailOptions.map((option) => (
                    <RailIconButton
                      key={option.id}
                      icon={option.icon}
                      label={option.label}
                      active={activePrimaryPanel === option.id}
                      onClick={() => togglePrimaryPanel(option.id)}
                    />
                  ))}
                </div>
                {isDm && (
                  <div style={railStyle}>
                    {dmRailOptions.map((option) => (
                      <RailIconButton
                        key={option.id}
                        icon={option.icon}
                        label={option.label}
                        active={activeDmPanel === option.id}
                        onClick={() => toggleDmPanel(option.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
              {activePanelId && (
                <div style={menuFlyoutStyle}>
                  <div style={menuFlyoutHeaderStyle}>
                    <span>{activePanelType === 'dm' ? 'DM Controls' : 'Main Controls'}</span>
                    <span>{activePanelLabel}</span>
                  </div>
                  <div style={menuFlyoutBodyStyle}>
                    {activePanelType === 'dm' ? renderDmPanelContent() : renderPrimaryPanelContent()}
                  </div>
                </div>
              )}
            </div>
            <div style={zoomOverlayStyle}>
              <button type="button" onClick={zoomOut} style={zoomOverlayButtonStyle} title="Zoom Out">−</button>
              <button type="button" onClick={zoomIn} style={zoomOverlayButtonStyle} title="Zoom In">+</button>
              <button type="button" onClick={resetZoom} style={zoomOverlayButtonStyle} title="Reset Zoom">↺</button>
              <span style={zoomOverlayPercentStyle}>{Math.round(mapZoom * 100)}%</span>
            </div>
            <img
              src={activeMap.assetUrl}
              alt={`Map ${activeMap.name}`}
              draggable={false}
              onError={() => setMapRenderError('Map image could not be loaded. Confirm the Blob URL is publicly readable.')}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: activeMap.width * mapZoom,
                height: activeMap.height * mapZoom,
                maxWidth: 'none',
                maxHeight: 'none',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
            <Stage
              width={zoomedStageWidth}
              height={zoomedStageHeight}
              scaleX={mapZoom}
              scaleY={mapZoom}
              onClick={onStageClick}
              onMouseDown={onStagePointerDown}
              onMouseMove={onStagePointerMove}
              onMouseUp={onStagePointerUp}
              onMouseLeave={() => {
                setPointerPosition(null)
                if (tool === 'measure') setMeasureDrag(null)
              }}
              style={{ position: 'absolute', left: 0, top: 0, background: 'transparent' }}
            >
            <Layer>
              <Rect x={0} y={0} width={activeMap.width} height={activeMap.height} fill="rgba(0,0,0,0)" />
              {isDm && (
                <>
                  <Rect
                    x={activeMap.width}
                    y={0}
                    width={STAGING_AREA_WIDTH}
                    height={activeMap.height}
                    fill="rgba(26, 22, 14, 0.85)"
                    stroke="#5a4a2b"
                    strokeWidth={2}
                  />
                  <Text
                    x={activeMap.width + 16}
                    y={14}
                    text="DM Staging Area"
                    fontSize={14}
                    fill="#e5c98a"
                    listening={false}
                  />
                </>
              )}
            </Layer>

            <Layer>
              {(activeState?.walls ?? []).map((wall) => (
                (() => {
                  const isSelectedWall = selectedWallIds.has(wall.id)
                  const offset = isSelectedWall && structureDragOffset ? structureDragOffset : { dx: 0, dy: 0 }
                  return (
                    <Line
                      key={wall.id}
                      points={[wall.a.x + offset.dx, wall.a.y + offset.dy, wall.b.x + offset.dx, wall.b.y + offset.dy]}
                      stroke={isSelectedWall ? '#ffd978' : '#f5a623'}
                      strokeWidth={isSelectedWall ? 4 : 3}
                      draggable={tool === 'select' && isSelectedWall}
                      onClick={(event) => {
                        event.cancelBubble = true
                        if (tool !== 'select') return
                        selectWallStructure(wall.id)
                      }}
                      onDragMove={(event) => {
                        if (!(tool === 'select' && isSelectedWall)) return
                        const node = event.target
                        const dx = node.x()
                        const dy = node.y()
                        node.position({ x: 0, y: 0 })
                        setStructureDragOffset({ dx, dy })
                      }}
                      onDragEnd={async (event) => {
                        if (!(tool === 'select' && isSelectedWall)) return
                        const node = event.target
                        const dx = structureDragOffset?.dx ?? node.x()
                        const dy = structureDragOffset?.dy ?? node.y()
                        node.position({ x: 0, y: 0 })
                        setStructureDragOffset(null)
                        if (!dx && !dy) return

                        const wallsToMove = (activeState?.walls ?? []).filter((entry) => selectedWallIds.has(entry.id))
                        if (!wallsToMove.length) return
                        setMapUndoStack((prev) => [
                          { op: 'batchRestoreWalls', payload: { walls: wallsToMove.map((entry) => ({ ...entry })) } },
                          ...prev,
                        ].slice(0, 20))

                        try {
                          await Promise.all(wallsToMove.map((entry) => callMutation('updateWall', {
                            id: entry.id,
                            a: { x: entry.a.x + dx, y: entry.a.y + dy },
                            b: { x: entry.b.x + dx, y: entry.b.y + dy },
                          })))
                        } catch (err) {
                          setError(err.message)
                        }
                      }}
                    />
                  )
                })()
              ))}

              {(activeState?.darknessZones ?? []).map((zone) => (
                <Line
                  key={zone.id}
                  points={flattenPoints(zone.points)}
                  closed
                  stroke={selectedDarknessIds.has(zone.id) ? '#ffd978' : '#222'}
                  fill="rgba(0,0,0,0.34)"
                  strokeWidth={selectedDarknessIds.has(zone.id) ? 3 : 2}
                  onClick={(event) => {
                    event.cancelBubble = true
                    if (tool !== 'select') return
                    selectDarknessStructure(zone.id)
                  }}
                />
              ))}

              {(activeState?.shapes ?? []).map((shape) => {
                const preview = shapePreview?.shapeId === shape.id ? shapePreview.payload : null
                const isBarrierSelected = shape.kind === 'barrier' && selectedBarrierIds.has(shape.id)
                const canManipulateShape = true
                const barrierOffset = isBarrierSelected && structureDragOffset ? structureDragOffset : { dx: 0, dy: 0 }
                const mergedShape = preview
                  ? { ...shape, ...preview }
                  : (isBarrierSelected && (barrierOffset.dx || barrierOffset.dy))
                    ? (moveShapePayload(shape, barrierOffset.dx, barrierOffset.dy) ? { ...shape, ...moveShapePayload(shape, barrierOffset.dx, barrierOffset.dy) } : shape)
                    : shape
                const colorName = inferShapeColorId(shape)
                const stroke = shape.color || shapeStrokeFromColorId(colorName)
                const fill = shape.fill || shapeFillFromColorId(colorName)

                if (mergedShape.shapeType === 'circle') {
                  const { center, radius } = getCircleGeometry(mergedShape)
                  return (
                    <Circle
                      key={shape.id}
                      x={center.x}
                      y={center.y}
                      radius={radius}
                      stroke={stroke}
                      fill={fill}
                      strokeWidth={isBarrierSelected ? 3 : 2}
                      draggable={shape.kind === 'barrier' ? tool === 'select' && isBarrierSelected : canManipulateShape}
                      onClick={(event) => {
                        event.cancelBubble = true
                        if (tool === 'select' && shape.kind === 'barrier') {
                          selectBarrierStructure(shape.id)
                        } else {
                          setSelectedShapeId(shape.id)
                        }
                      }}
                      onDragMove={(event) => {
                        const node = event.target
                        const dx = node.x() - center.x
                        const dy = node.y() - center.y
                        if (shape.kind === 'barrier' && tool === 'select' && isBarrierSelected) {
                          node.position({ x: center.x, y: center.y })
                          setStructureDragOffset({ dx, dy })
                          return
                        }
                      }}
                      onDragEnd={async (event) => {
                        const node = event.target
                        const dx = (shape.kind === 'barrier' && tool === 'select' && isBarrierSelected)
                          ? (structureDragOffset?.dx ?? (node.x() - center.x))
                          : (node.x() - center.x)
                        const dy = (shape.kind === 'barrier' && tool === 'select' && isBarrierSelected)
                          ? (structureDragOffset?.dy ?? (node.y() - center.y))
                          : (node.y() - center.y)
                        node.position({ x: center.x, y: center.y })
                        const payload = moveShapePayload(shape, dx, dy)
                        if (!payload) return
                        if (shape.kind === 'barrier' && tool === 'select' && isBarrierSelected) {
                          setStructureDragOffset(null)
                          const barriersToMove = barrierShapes.filter((entry) => selectedBarrierIds.has(entry.id))
                          if (!barriersToMove.length) return
                          setMapUndoStack((prev) => [
                            { op: 'batchAddShapes', payload: { shapes: barriersToMove.map((entry) => ({ ...entry })) } },
                            ...prev,
                          ].slice(0, 20))
                          Promise.all(barriersToMove.map((entry) => {
                            const nextPayload = moveShapePayload(entry, dx, dy)
                            return callMutation('updateShape', { id: entry.id, ...nextPayload })
                          })).catch((err) => {
                            setError(err.message)
                          })
                          return
                        }
                        if (shape.kind === 'barrier') {
                          setMapUndoStack((prev) => [{ op: 'updateShape', payload: { id: shape.id, points: shape.points } }, ...prev].slice(0, 20))
                        }
                        callMutation('updateShape', { id: shape.id, ...payload }).catch((err) => {
                          setError(err.message)
                        })
                        setShapePreview(null)
                      }}
                    />
                  )
                }

                return (
                  <Line
                    key={shape.id}
                    points={flattenPoints(mergedShape.points)}
                    closed={mergedShape.closed !== false}
                    stroke={stroke}
                    fill={fill}
                    strokeWidth={isBarrierSelected ? 3 : 2}
                    draggable={shape.kind === 'barrier' ? tool === 'select' && isBarrierSelected : canManipulateShape}
                    onClick={(event) => {
                      event.cancelBubble = true
                      if (tool === 'select' && shape.kind === 'barrier') {
                        selectBarrierStructure(shape.id)
                      } else {
                        setSelectedShapeId(shape.id)
                      }
                    }}
                    onDragMove={(event) => {
                        const node = event.target
                        const dx = node.x()
                        const dy = node.y()
                      if (shape.kind === 'barrier' && tool === 'select' && isBarrierSelected) {
                        node.position({ x: 0, y: 0 })
                        setStructureDragOffset({ dx, dy })
                        return
                      }
                    }}
                    onDragEnd={(event) => {
                        const node = event.target
                      const dx = (shape.kind === 'barrier' && tool === 'select' && isBarrierSelected)
                        ? (structureDragOffset?.dx ?? node.x())
                        : node.x()
                        const dy = (shape.kind === 'barrier' && tool === 'select' && isBarrierSelected)
                          ? (structureDragOffset?.dy ?? node.y())
                          : node.y()
                        node.position({ x: 0, y: 0 })
                      const payload = moveShapePayload(shape, dx, dy)
                      if (!payload) return
                      if (shape.kind === 'barrier' && tool === 'select' && isBarrierSelected) {
                        setStructureDragOffset(null)
                        const barriersToMove = barrierShapes.filter((entry) => selectedBarrierIds.has(entry.id))
                        if (!barriersToMove.length) return
                        setMapUndoStack((prev) => [
                          { op: 'batchAddShapes', payload: { shapes: barriersToMove.map((entry) => ({ ...entry })) } },
                          ...prev,
                        ].slice(0, 20))
                        Promise.all(barriersToMove.map((entry) => {
                          const nextPayload = moveShapePayload(entry, dx, dy)
                          return callMutation('updateShape', { id: entry.id, ...nextPayload })
                        })).catch((err) => {
                          setError(err.message)
                        })
                        return
                      }
                      if (shape.kind === 'barrier') {
                        setMapUndoStack((prev) => [{ op: 'updateShape', payload: { id: shape.id, points: shape.points } }, ...prev].slice(0, 20))
                      }
                      callMutation('updateShape', { id: shape.id, ...payload }).catch((err) => {
                        setError(err.message)
                      })
                      setShapePreview(null)
                    }}
                  />
                )
              })}

              {selectedShape && selectedShapeHandle && selectedShape.shapeType && (
                <Circle
                  key={`${selectedShape.id}:handle:scale`}
                  x={selectedShapeHandle.x}
                  y={selectedShapeHandle.y}
                  radius={6}
                  fill="#f5f5f5"
                  stroke="#111"
                  strokeWidth={1}
                  draggable
                  onDragMove={(event) => {
                    const nextPoint = event.target.position()
                    const payload = scaleShapePayload(selectedShape, nextPoint)
                    if (!payload) return
                    setShapePreview({ shapeId: selectedShape.id, payload })
                  }}
                  onDragEnd={(event) => {
                    const nextPoint = event.target.position()
                    const payload = scaleShapePayload(selectedShape, nextPoint) ?? shapePreview?.payload
                    if (!payload) return
                    callMutation('updateShape', {
                      id: selectedShape.id,
                      ...payload,
                    }).catch((err) => {
                      setError(err.message)
                    })
                    setShapePreview(null)
                  }}
                />
              )}

              {selectedShape && selectedShapeRotateHandle && selectedShape.shapeType && (
                <>
                  <Line
                    points={flattenPoints([selectedShapeRotateHandle.anchor, selectedShapeRotateHandle.handle])}
                    stroke="#f0f0f0"
                    strokeWidth={1}
                    dash={[4, 3]}
                  />
                  <Text
                    key={`${selectedShape.id}:handle:rotate`}
                    x={selectedShapeRotateHandle.handle.x - 8}
                    y={selectedShapeRotateHandle.handle.y - 8}
                    text="↻"
                    fontSize={16}
                    fontStyle="bold"
                    fill="#f3f5ff"
                    stroke="#0b0b0b"
                    strokeWidth={0.8}
                    draggable
                    onDragStart={(event) => {
                      const node = event.target.position()
                      const pointer = { x: node.x + 8, y: node.y + 8 }
                      const center = selectedShapeRotateHandle.center
                      rotateDragRef.current = {
                        shapeId: selectedShape.id,
                        baseShape: selectedShape,
                        lastAngle: Math.atan2(pointer.y - center.y, pointer.x - center.x),
                        accumulatedRadians: 0,
                      }
                    }}
                    onDragMove={(event) => {
                      if (!rotateDragRef.current) return
                      const node = event.target.position()
                      const pointer = { x: node.x + 8, y: node.y + 8 }
                      const center = selectedShapeRotateHandle.center
                      const angle = Math.atan2(pointer.y - center.y, pointer.x - center.x)
                      let delta = angle - rotateDragRef.current.lastAngle
                      if (delta > Math.PI) delta -= Math.PI * 2
                      if (delta < -Math.PI) delta += Math.PI * 2
                      rotateDragRef.current.lastAngle = angle
                      rotateDragRef.current.accumulatedRadians += delta
                      const deltaDegrees = (rotateDragRef.current.accumulatedRadians * 180) / Math.PI
                      const payload = rotateShapePayload(rotateDragRef.current.baseShape, deltaDegrees)
                      if (!payload) return
                      setShapePreview({ shapeId: rotateDragRef.current.shapeId, payload })
                    }}
                    onDragEnd={() => {
                      const payload = shapePreview?.shapeId === selectedShape.id ? shapePreview.payload : null
                      rotateDragRef.current = null
                      if (!payload) return
                      callMutation('updateShape', {
                        id: selectedShape.id,
                        ...payload,
                      }).catch((err) => {
                        setError(err.message)
                      })
                      setShapePreview(null)
                    }}
                  />
                </>
              )}

              {draftPoints.length > 1 && (
                <Line
                  points={flattenPoints(draftPoints)}
                  stroke={tool === 'darkness' ? '#3a3a3a' : '#d0b36d'}
                  strokeWidth={2}
                  dash={[8, 6]}
                />
              )}

              {(tool === 'wall' || tool === 'darkness' || tool === 'calibrate') && draftPoints.map((point, index) => (
                <Circle
                  key={`draft:${index}`}
                  x={point.x}
                  y={point.y}
                  radius={5.5}
                  fill="#f5f5f5"
                  stroke="#111"
                  strokeWidth={1}
                  listening={false}
                />
              ))}

              {(tool === 'wall' || tool === 'darkness' || tool === 'calibrate') && draftPoints.length > 0 && pointerPosition && (
                <Line
                  points={flattenPoints([draftPoints[draftPoints.length - 1], draftSnapPoint || pointerPosition])}
                  stroke={draftSnapPoint ? '#8cea76' : '#ffd56f'}
                  strokeWidth={2}
                  dash={[6, 5]}
                  listening={false}
                />
              )}

              {draftSnapPoint && (
                <Circle
                  x={draftSnapPoint.x}
                  y={draftSnapPoint.y}
                  radius={8}
                  fill="rgba(141,243,117,0.3)"
                  stroke="#8df375"
                  strokeWidth={2}
                  listening={false}
                />
              )}

              {measureDrag?.start && measureDrag?.end && (
                <Line points={flattenPoints([measureDrag.start, measureDrag.end])} stroke="#4ecdc4" strokeWidth={2} dash={[6, 4]} />
              )}

              {pathPoints.length > 1 && (
                <Line points={flattenPoints(pathPoints)} stroke="#6aa9ff" strokeWidth={3} dash={[10, 7]} />
              )}

              {pathDraftLabel && (
                <>
                  <Rect
                    x={pathDraftLabel.x - 4}
                    y={pathDraftLabel.y - 2}
                    width={pathDraftLabel.width}
                    height={18}
                    fill="rgba(8,8,10,0.82)"
                    stroke="rgba(245,245,245,0.22)"
                    strokeWidth={1}
                    cornerRadius={4}
                    listening={false}
                  />
                  <Text
                    x={pathDraftLabel.x}
                    y={pathDraftLabel.y}
                    text={pathDraftLabel.text}
                    fontSize={12}
                    fontStyle="bold"
                    fill="#f5f7ff"
                    listening={false}
                  />
                </>
              )}

              {shapeMeasurementEntries.map((entry) => (
                <Line
                  key={entry.id}
                  points={entry.line}
                  stroke="rgba(235,235,235,0.85)"
                  strokeWidth={1}
                  dash={[4, 4]}
                  listening={false}
                />
              ))}

              {shapeMeasurementEntries.map((entry) => {
                const width = Math.max(48, (String(entry.text).length * 7) + 10)
                return [
                  <Rect
                    key={`${entry.id}:label:bg`}
                    x={entry.textX - 4}
                    y={entry.textY - 2}
                    width={width}
                    height={17}
                    fill="rgba(8,8,10,0.82)"
                    stroke="rgba(245,245,245,0.22)"
                    strokeWidth={1}
                    cornerRadius={4}
                    listening={false}
                  />,
                  <Text
                    key={`${entry.id}:label`}
                    x={entry.textX}
                    y={entry.textY}
                    text={entry.text}
                    fontSize={11}
                    fontStyle="bold"
                    fill="#f5f7ff"
                    listening={false}
                  />,
                ]
              })}

              {measurementDistance && (
                <>
                  <Rect
                    x={measurementDistance.mid.x + 2}
                    y={measurementDistance.mid.y - 18}
                    width={Math.max(48, (`${formatFeet(measurementDistance.feet || 0)} ft`.length * 7) + 10)}
                    height={18}
                    fill="rgba(8,8,10,0.82)"
                    stroke="rgba(245,245,245,0.22)"
                    strokeWidth={1}
                    cornerRadius={4}
                    listening={false}
                  />
                  <Text
                    x={measurementDistance.mid.x + 6}
                    y={measurementDistance.mid.y - 16}
                    text={`${formatFeet(measurementDistance.feet || 0)} ft`}
                    fontSize={12}
                    fontStyle="bold"
                    fill="#f5f7ff"
                    listening={false}
                  />
                </>
              )}
            </Layer>

            <Layer>
              {(activeState?.tokens ?? []).filter((token) => renderTokenIds.has(token.id)).map((token) => {
                const animatedPosition = animatedTokenPositions[token.id]
                const tokenX = animatedPosition?.x ?? token.x
                const tokenY = animatedPosition?.y ?? token.y
                return (
                <Circle
                  key={token.id}
                  x={tokenX}
                  y={tokenY}
                  radius={TOKEN_RADIUS[token.size] ?? TOKEN_RADIUS.medium}
                  fill={token.id === selectedTokenId ? '#3b82f6' : '#888'}
                  stroke={RING_COLORS[token.ringColor] ?? 'transparent'}
                  strokeWidth={4}
                  draggable={isDm || token.role === 'player'}
                  onClick={(event) => {
                    event.cancelBubble = true
                    if (isPlayer && token.role !== 'player') return
                    setSelectedTokenId(token.id)
                    if (token.role === 'player' && (isDm || isPlayer)) {
                      selectFocusedPlayer(token.id)
                    }
                    if (token.role === 'npc' && isDm) {
                      setSelectedNpcTokenId(token.id)
                    }
                    setTokenDraft({
                      name: token.name,
                      size: token.size,
                      ringColor: token.ringColor,
                      darkvision: Boolean(token.darkvision),
                    })
                  }}
                  onDragEnd={(event) => onTokenDragEnd(token.id, event)}
                />
              )})}

              {(activeState?.tokens ?? []).filter((token) => isDm && token.role === 'npc' && token.hidden && renderTokenIds.has(token.id)).map((token) => {
                const animatedPosition = animatedTokenPositions[token.id]
                const tokenX = animatedPosition?.x ?? token.x
                const tokenY = animatedPosition?.y ?? token.y
                return (
                <Text
                  key={`${token.id}:hidden-eye`}
                  x={tokenX + 12}
                  y={tokenY - 8}
                  text="👁️"
                  fontSize={12}
                  listening={false}
                />
              )})}

              {(activeState?.tokens ?? []).filter((token) => renderTokenIds.has(token.id)).map((token) => (
                (() => {
                  const animatedPosition = animatedTokenPositions[token.id]
                  const tokenX = animatedPosition?.x ?? token.x
                  const tokenY = animatedPosition?.y ?? token.y
                  const label = token.name || 'Token'
                  const width = Math.max(54, (label.length * 7) + 10)
                  const x = tokenX - (width / 2)
                  const y = tokenY - 35
                  const renameNpc = () => {
                    if (!isDm || token.role !== 'npc') return
                    const nextName = window.prompt('Rename NPC token', token.name || 'NPC')
                    if (!nextName || !nextName.trim() || nextName.trim() === token.name) return
                    callMutation('updateToken', { id: token.id, name: nextName.trim(), role: 'npc' }).catch((err) => setError(err.message))
                  }
                  return (
                    <>
                      <Rect
                        key={`${token.id}:label:bg`}
                        x={x}
                        y={y}
                        width={width}
                        height={18}
                        fill="rgba(8,8,10,0.82)"
                        stroke="rgba(245,245,245,0.22)"
                        strokeWidth={1}
                        cornerRadius={4}
                        onDblClick={renameNpc}
                      />
                      <Text
                        key={`${token.id}:label`}
                        x={x + 5}
                        y={y + 2}
                        width={width - 10}
                        align="center"
                        text={label}
                        fontSize={11}
                        fontStyle="bold"
                        fill="#f5f7ff"
                        onDblClick={renameNpc}
                      />
                    </>
                  )
                })()
              ))}

            </Layer>

            <Layer listening={false}>
              {fogRenderData && (
                <>
                  {fogRenderData.fogRects.map((rect, index) => (
                    <Rect
                      key={`fog:${rect.x}:${rect.y}:${index}`}
                      x={rect.x}
                      y={rect.y}
                      width={rect.width}
                      height={rect.height}
                      fill={rect.seen ? fogRenderData.exploredFill : fogRenderData.unseenFill}
                      shadowColor={rect.seen ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.95)'}
                      shadowBlur={rect.seen ? (fogRenderData.exploredBlur || 0) : (fogRenderData.unseenBlur || 0)}
                    />
                  ))}
                </>
              )}
            </Layer>

            <Layer listening={false}>
              {visiblePings.map((ping) => (
                <Circle
                  key={ping.id}
                  x={ping.x}
                  y={ping.y}
                  radius={ping.radius}
                  stroke="#ff4f72"
                  strokeWidth={ping.strokeWidth}
                  opacity={ping.opacity}
                />
              ))}
            </Layer>
            </Stage>
          </div>
          </>
        )}

        <div style={{ marginTop: '0.55rem', display: 'flex', justifyContent: 'space-between', color: '#777', fontSize: '0.78rem' }}>
          <span>Map: {activeMap?.name ?? 'none'}</span>
          <span>
            Scale: {feetPerPx ? `${formatFeet(feetPerPx * 100)} ft / 100px` : 'not calibrated'}
            {measurementDistance?.feet ? ` | Measure: ${formatFeet(measurementDistance.feet)} ft` : ''}
          </span>
        </div>
      </section>
    </main>
  )
}

function IconTileButton({
  icon,
  label,
  onClick,
  disabled = false,
  active = false,
  tone = 'neutral',
  size = 'normal',
  fullWidth = false,
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={iconTileButtonStyle({ active, disabled, tone, size, fullWidth })}
    >
      <span style={iconTileIconStyle(size)}>{icon}</span>
      <span style={iconTileLabelStyle(size)}>{label}</span>
    </button>
  )
}

function RailIconButton({
  icon,
  label,
  onClick,
  active = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      style={{
        ...railButtonStyle,
        background: active ? '#9f1717' : railButtonStyle.background,
        borderColor: active ? '#d84949' : railButtonStyle.borderColor,
        color: active ? '#fff' : railButtonStyle.color,
      }}
    >
      <span style={railButtonIconStyle}>{icon}</span>
    </button>
  )
}

function iconTileButtonStyle({ active, disabled, tone, size, fullWidth }) {
  const tones = {
    neutral: {
      bg: '#171717',
      border: '#323232',
      text: '#d4d4d4',
      activeBg: '#263b67',
      activeBorder: '#6fa3ff',
      activeText: '#f2f7ff',
    },
    primary: {
      bg: '#16243f',
      border: '#315287',
      text: '#d8e6ff',
      activeBg: '#2e4f86',
      activeBorder: '#7caeff',
      activeText: '#f4f8ff',
    },
    success: {
      bg: '#152b1f',
      border: '#2c6c4a',
      text: '#d8f5e3',
      activeBg: '#2d5f44',
      activeBorder: '#73c796',
      activeText: '#eefff3',
    },
    danger: {
      bg: '#2a1717',
      border: '#6c3232',
      text: '#ffd5d5',
      activeBg: '#6b2f2f',
      activeBorder: '#ff9f9f',
      activeText: '#fff3f3',
    },
    muted: {
      bg: '#1a1a1a',
      border: '#3a3a3a',
      text: '#c8c8c8',
      activeBg: '#2b2b2b',
      activeBorder: '#8a8a8a',
      activeText: '#f2f2f2',
    },
  }
  const palette = tones[tone] ?? tones.neutral
  const isXSmall = size === 'xsmall'
  const isSmall = size === 'small'
  const isLarge = size === 'large'

  return {
    width: '100%',
    minHeight: fullWidth
      ? (isLarge ? '46px' : isXSmall ? '24px' : '38px')
      : (isXSmall ? '22px' : isSmall ? '36px' : isLarge ? '52px' : '44px'),
    // Keep primary tiles square, but make nested/small controls compact rectangles.
    aspectRatio: fullWidth ? 'auto' : (isXSmall || isSmall ? 'auto' : '1 / 1'),
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: isXSmall ? '0.02rem' : isSmall ? '0.1rem' : '0.14rem',
    borderRadius: isXSmall ? '6px' : isSmall ? '8px' : '9px',
    border: `1px solid ${active ? palette.activeBorder : palette.border}`,
    background: active ? palette.activeBg : palette.bg,
    color: active ? palette.activeText : palette.text,
    opacity: disabled ? 0.48 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    padding: isXSmall ? '0.08rem 0.08rem' : isSmall ? '0.16rem 0.16rem' : '0.22rem 0.2rem',
    lineHeight: 1.12,
    textAlign: 'center',
    transition: 'background 120ms ease, border-color 120ms ease, opacity 120ms ease, transform 120ms ease',
    boxShadow: active ? '0 0 0 1px rgba(255,255,255,0.08) inset' : 'none',
  }
}

const inputStyle = {
  width: '100%',
  background: '#101010',
  border: '1px solid #2f2f2f',
  borderRadius: '6px',
  color: '#ddd',
  padding: '0.4rem 0.5rem',
  fontSize: '0.8rem',
}

const labelStyle = {
  display: 'grid',
  gap: '0.2rem',
  fontSize: '0.8rem',
  color: '#aaa',
  marginBottom: '0.45rem',
}

const subSectionTitleStyle = {
  marginBottom: '0.35rem',
  fontSize: '0.74rem',
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  color: '#8f8f8f',
}

function iconTileIconStyle(size = 'normal') {
  if (size === 'xsmall') {
    return {
      fontSize: '0.52rem',
      lineHeight: 1,
    }
  }
  return {
    fontSize: '0.66rem',
    lineHeight: 1,
  }
}

function iconTileLabelStyle(size = 'normal') {
  if (size === 'xsmall') {
    return {
      fontSize: '0.44rem',
      fontWeight: 600,
      color: 'inherit',
    }
  }
  return {
    fontSize: '0.48rem',
    fontWeight: 600,
    color: 'inherit',
  }
}

const iconTileGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '0.35rem',
}

const toolGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '0.35rem',
}

const topStatusBarStyle = {
  marginBottom: '0.55rem',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  color: '#8a8a8a',
  fontSize: '0.75rem',
}

const menuCascadeContainerStyle = {
  position: 'absolute',
  top: '52px',
  left: '10px',
  zIndex: 14,
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.35rem',
}

const railStyle = {
  display: 'grid',
  gap: '0.28rem',
  padding: '0.32rem',
  borderRadius: '14px',
  background: 'rgba(12,12,12,0.7)',
  border: '1px solid rgba(190,190,190,0.25)',
  backdropFilter: 'blur(6px)',
}

const railStackStyle = {
  display: 'grid',
  gap: '0.45rem',
}

const railButtonStyle = {
  width: '28px',
  height: '28px',
  borderRadius: '8px',
  border: '1px solid #4d4d4d',
  background: '#1a1a1a',
  color: '#e5e5e5',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  lineHeight: 1,
}

const railButtonIconStyle = {
  fontSize: '0.78rem',
  lineHeight: 1,
}

const menuFlyoutStyle = {
  width: '320px',
  maxHeight: 'calc(100vh - 260px)',
  display: 'grid',
  gridTemplateRows: 'auto 1fr',
  borderRadius: '14px',
  background: 'rgba(12,12,12,0.78)',
  border: '1px solid rgba(190,190,190,0.25)',
  backdropFilter: 'blur(6px)',
  overflow: 'hidden',
}

const menuFlyoutHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '0.6rem',
  padding: '0.45rem 0.55rem',
  background: 'rgba(27,27,27,0.95)',
  color: '#dedede',
  fontSize: '0.74rem',
  fontWeight: 600,
}

const menuFlyoutBodyStyle = {
  display: 'grid',
  gap: '0.45rem',
  padding: '0.55rem',
  overflowY: 'auto',
}

const focusPillStyle = {
  padding: '0.35rem 0.58rem',
  borderRadius: '999px',
  border: '1px solid #3a3a3a',
  background: '#1a1a1a',
  color: '#e5e5e5',
  fontSize: '0.72rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

function ringButtonStyle(active, color, disabled = false) {
  return {
    width: '18px',
    height: '18px',
    borderRadius: '999px',
    border: active ? '2px solid #d8d8d8' : '1px solid #4a4a4a',
    background: color === 'transparent' ? 'repeating-conic-gradient(#999 0 25%, #222 0 50%) 50% / 8px 8px' : color,
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

const zoomOverlayStyle = {
  position: 'absolute',
  top: '10px',
  left: '10px',
  zIndex: 12,
  display: 'flex',
  alignItems: 'center',
  gap: '0.35rem',
  padding: '0.25rem 0.35rem',
  borderRadius: '999px',
  background: 'rgba(12,12,12,0.68)',
  border: '1px solid rgba(190,190,190,0.25)',
}

const zoomOverlayButtonStyle = {
  width: '24px',
  height: '24px',
  borderRadius: '999px',
  border: '1px solid #4d4d4d',
  background: '#1a1a1a',
  color: '#e5e5e5',
  fontSize: '0.86rem',
  lineHeight: 1,
  cursor: 'pointer',
}

const zoomOverlayPercentStyle = {
  color: '#bcbcbc',
  fontSize: '0.68rem',
  minWidth: '34px',
  textAlign: 'center',
}

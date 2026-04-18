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

const MAP_SETUP_TOOL_IDS = ['wall', 'barrier', 'calibrate']
const DM_TOOL_IDS = ['darkness', 'npcToken']
const GENERAL_TOOL_IDS = ['measure', 'shape', 'ping']
const PLAYER_TOOL_IDS = ['move', 'path', 'token']

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
]

const SNAP_THRESHOLD_PX = 14
const PING_FADE_MS = 3000

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
  const alpha = colorId === 'black' ? 0.22 : 0.2
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

  if (shapeType === 'circle') {
    const radius = 56
    const center = { x, y }
    return {
      points: [center, { x: x + radius, y }],
      closed: true,
      kind: 'circle',
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
      kind: 'triangle',
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
      kind: 'square',
      shapeType: 'square',
      colorName,
      color,
      fill,
    }
  }

  return {
    points: buildRectanglePoints(x, y),
    closed: true,
    kind: 'rectangle',
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
  if (feetPerPx) return `${Math.round(pxDistance * feetPerPx)} ft`
  return `${Math.round(pxDistance)} px`
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

  if (shape.shapeType === 'rectangle') {
    const width = clamp(Math.abs(targetPoint.x - center.x) * 2, 20, 3000)
    const height = clamp(Math.abs(targetPoint.y - center.y) * 2, 20, 3000)
    return {
      points: buildRectanglePoints(center.x, center.y, width, height),
    }
  }

  if (shape.shapeType === 'square') {
    const side = clamp(Math.max(Math.abs(targetPoint.x - center.x), Math.abs(targetPoint.y - center.y)) * 2, 20, 3000)
    return {
      points: buildSquarePoints(center.x, center.y, side),
    }
  }

  if (shape.shapeType === 'triangle') {
    const side = clamp(Math.max(Math.abs(targetPoint.x - center.x), Math.abs(targetPoint.y - center.y)) * 2, 20, 3000)
    return {
      points: buildTrianglePoints(center.x, center.y, side),
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

function interpolatePointAlongPath(points, progress) {
  if (!points?.length) return null
  if (points.length === 1) return points[0]
  const clamped = clamp(progress, 0, 1)

  const segments = []
  let total = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i]
    const end = points[i + 1]
    const length = distancePx(start, end)
    segments.push({ start, end, length })
    total += length
  }
  if (total <= 0) return points.at(-1)

  let target = total * clamped
  for (const segment of segments) {
    if (target <= segment.length) {
      const t = segment.length <= 0 ? 1 : target / segment.length
      return {
        x: segment.start.x + (segment.end.x - segment.start.x) * t,
        y: segment.start.y + (segment.end.y - segment.start.y) * t,
      }
    }
    target -= segment.length
  }

  return points.at(-1)
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

export default function VttClient() {
  const [bundle, setBundle] = useState(null)
  const [results, setResults] = useState([])
  const [tool, setTool] = useState('move')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [draftPoints, setDraftPoints] = useState([])
  const [measureDrag, setMeasureDrag] = useState(null)
  const [pathPoints, setPathPoints] = useState([])
  const [calibrationPoints, setCalibrationPoints] = useState([])
  const [calibrationFeet, setCalibrationFeet] = useState('30')
  const [mapName, setMapName] = useState('')
  const [startMapId, setStartMapId] = useState('')
  const [linkResultId, setLinkResultId] = useState('')
  const [pointerPosition, setPointerPosition] = useState(null)
  const [mapZoom, setMapZoom] = useState(1)
  const [showDarknessZones, setShowDarknessZones] = useState(true)
  const [showBarriers, setShowBarriers] = useState(true)
  const [mapUndoStack, setMapUndoStack] = useState([])
  const [selectedWallId, setSelectedWallId] = useState('')
  const [selectedShapeId, setSelectedShapeId] = useState('')
  const [shapeDraftType, setShapeDraftType] = useState('rectangle')
  const [shapeDraftColor, setShapeDraftColor] = useState('blue')
  const [selectedShapeColor, setSelectedShapeColor] = useState('blue')
  const [selectedTokenId, setSelectedTokenId] = useState('')
  const [focusedPlayerTokenId, setFocusedPlayerTokenId] = useState('dm')
  const [partyCharacters, setPartyCharacters] = useState([])
  const [selectedPartyCharacter, setSelectedPartyCharacter] = useState('')
  const [selectedNpcTokenId, setSelectedNpcTokenId] = useState('')
  const [tokenDraft, setTokenDraft] = useState({ name: 'Token', size: 'medium', ringColor: 'clear', darkvision: false })
  const [npcTokenDraft, setNpcTokenDraft] = useState({ name: 'NPC', size: 'medium', ringColor: 'red', darkvision: false })
  const [character, setCharacter] = useState({ moveSpeed: 30, darkvision: false })
  const [viewMode, setViewMode] = useState('player')
  const [clientId, setClientId] = useState('')
  const [mapRenderError, setMapRenderError] = useState('')
  const [pingClock, setPingClock] = useState(Date.now())
  const [shapePreview, setShapePreview] = useState(null)
  const [lastKnownNpcByViewer, setLastKnownNpcByViewer] = useState({})
  const [expandedMenus, setExpandedMenus] = useState({
    mapSetup: true,
    dungeonMaster: true,
    generalMapTools: true,
    player: true,
  })

  const containerRef = useRef(null)
  const [stageWidth, setStageWidth] = useState(1100)
  const [stageHeight, setStageHeight] = useState(720)
  const exploredSyncRef = useRef('')

  const refresh = useCallback(async (customClientId = clientId) => {
    const liveUrl = customClientId
      ? `/api/vtt/live?clientId=${encodeURIComponent(customClientId)}`
      : '/api/vtt/live'

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
  }, [clientId])

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
          setPartyCharacters(nextCharacters)

          if (nextCharacters.length) {
            const firstName = nextCharacters[0].name
            setSelectedPartyCharacter((prev) => prev || firstName)
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

        const firstPlayerId = nextBundle?.activeState?.tokens?.find((token) => token.role === 'player')?.id ?? ''
        const firstTokenId = firstPlayerId || (nextBundle?.activeState?.tokens?.[0]?.id ?? '')
        setSelectedTokenId((prev) => prev || firstTokenId)
        setFocusedPlayerTokenId((prev) => (prev === 'dm' ? prev : (prev || firstPlayerId || 'dm')))
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
  }, [refresh, clientId])

  useEffect(() => {
    const tokens = bundle?.activeState?.tokens ?? []
    if (!tokens.length) {
      setSelectedTokenId('')
      setFocusedPlayerTokenId('dm')
      setSelectedNpcTokenId('')
      return
    }

    const firstPlayer = tokens.find((token) => token.role === 'player')
    setSelectedTokenId((prev) => prev || firstPlayer?.id || tokens[0].id)

    setFocusedPlayerTokenId((prev) => {
      if (prev === 'dm') return 'dm'
      if (prev && tokens.some((token) => token.id === prev && token.role === 'player')) return prev
      return firstPlayer?.id || 'dm'
    })

    setSelectedNpcTokenId((prev) => {
      if (prev && tokens.some((token) => token.id === prev && token.role === 'npc')) return prev
      return tokens.find((token) => token.role === 'npc')?.id ?? ''
    })
  }, [bundle?.activeState?.tokens])

  useEffect(() => {
    setDraftPoints([])
    setPathPoints([])
    setMeasureDrag(null)
    setPointerPosition(null)
    setSelectedWallId('')
    setSelectedShapeId('')
    setMapUndoStack([])
    setMapZoom(1)
    setLastKnownNpcByViewer({})
  }, [bundle?.activeMap?.id])

  useEffect(() => {
    if (!bundle?.activeMap) return

    setStageWidth(Math.max(800, bundle.activeMap.width))
    setStageHeight(Math.max(500, bundle.activeMap.height))
  }, [bundle?.activeMap])

  useEffect(() => {
    if (!bundle) return
    setStartMapId(bundle.live?.activeMapId ?? bundle.maps?.[0]?.id ?? '')
  }, [bundle])

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

  const visionToken = useMemo(() => {
    if (viewMode !== 'player') return selectedToken
    const tokenId = focusedPlayerTokenId === 'dm' ? selectedTokenId : focusedPlayerTokenId
    return activeState?.tokens?.find((token) => token.id === tokenId) ?? selectedToken ?? null
  }, [activeState?.tokens, focusedPlayerTokenId, selectedToken, selectedTokenId, viewMode])

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
    })
  }, [npcTokens, selectedNpcTokenId])

  const selectedShape = useMemo(
    () => activeState?.shapes?.find((shape) => shape.id === selectedShapeId) ?? null,
    [activeState?.shapes, selectedShapeId],
  )

  const selectedWall = useMemo(
    () => activeState?.walls?.find((wall) => wall.id === selectedWallId) ?? null,
    [activeState?.walls, selectedWallId],
  )

  useEffect(() => {
    if (!selectedShape) return
    setSelectedShapeColor(inferShapeColorId(selectedShape))
  }, [selectedShape?.id, selectedShape?.color, selectedShape?.colorName])

  const visibility = useMemo(() => {
    if (!activeMap || !activeState || !visionToken) return null

    const darkvisionEnabled = viewMode === 'player'
      ? Boolean(visionToken.darkvision)
      : Boolean(character.darkvision)

    return computeVisibilityGrid({
      state: activeState,
      mapWidth: activeMap.width,
      mapHeight: activeMap.height,
      token: visionToken,
      darkvision: darkvisionEnabled,
      feetPerPixel: feetPerPx,
    })
  }, [activeMap, activeState, character.darkvision, feetPerPx, viewMode, visionToken])

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
    if (!activeMap || !activeState?.fog?.enabled || !visibility) return
    if (!visibility.visible.length) return

    const payload = {
      mapId: activeMap.id,
      op: 'mergeFogExplored',
      actorId: clientId,
      payload: {
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
  }, [activeMap, activeState?.fog?.enabled, clientId, visibility])

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
  }, [activeMap, clientId])

  const startSession = useCallback(async (mapId) => {
    const res = await fetch('/api/vtt/live/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapId, actorId: clientId }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Failed to start session.')
    }

    await refresh()
  }, [refresh, clientId])

  const stopSession = useCallback(async () => {
    const res = await fetch('/api/vtt/live/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorId: clientId }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || 'Failed to stop session.')
    }

    await refresh()
  }, [refresh, clientId])

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
      }
      setDraftPoints([])
      setPointerPosition(null)
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, tool])

  const finalizeDraft = useCallback(async () => {
    if (!draftPoints.length) return
    await commitDraftPoints(draftPoints, tool)
  }, [commitDraftPoints, draftPoints, tool])

  const saveCalibration = useCallback(async () => {
    if (calibrationPoints.length !== 2) {
      setError('Calibration requires exactly two points.')
      return
    }

    const feetDistance = Number(calibrationFeet)
    if (!feetDistance || feetDistance <= 0) {
      setError('Enter a valid feet distance for calibration.')
      return
    }

    const pxDistance = distancePx(calibrationPoints[0], calibrationPoints[1])

    try {
      await callMutation('setCalibration', {
        feetDistance,
        pxDistance,
      })
      setCalibrationPoints([])
    } catch (err) {
      setError(err.message)
    }
  }, [calibrationFeet, calibrationPoints, callMutation])

  const saveCharacter = useCallback(async () => {
    if (!activeMap || !clientId) return

    try {
      const data = await callMutation('setCharacter', {
        clientId,
        moveSpeed: Number(character.moveSpeed) || 30,
        darkvision: Boolean(character.darkvision),
      })
      if (data?.character) {
        setCharacter({
          moveSpeed: Number(data.character.moveSpeed) || 30,
          darkvision: Boolean(data.character.darkvision),
        })
      }
    } catch (err) {
      setError(err.message)
    }
  }, [activeMap, callMutation, character.darkvision, character.moveSpeed, clientId])

  const placeToken = useCallback(async (point) => {
    try {
      await callMutation('addToken', {
        x: point.x,
        y: point.y,
        name: tokenDraft.name || 'Token',
        size: tokenDraft.size,
        ringColor: tokenDraft.ringColor,
        darkvision: Boolean(tokenDraft.darkvision),
        role: 'player',
      })
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, tokenDraft])

  const placeNpcToken = useCallback(async (point) => {
    try {
      await callMutation('addToken', {
        x: point.x,
        y: point.y,
        name: npcTokenDraft.name || 'NPC',
        size: npcTokenDraft.size,
        ringColor: npcTokenDraft.ringColor,
        darkvision: Boolean(npcTokenDraft.darkvision),
        role: 'npc',
      })
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, npcTokenDraft])

  const onStageClick = useCallback(async (event) => {
    if (!activeMap || !bundle?.live?.active) return
    const pointer = getMapPointerFromEvent(event, mapZoom)
    if (!pointer) return

    if (tool === 'wall' || tool === 'darkness' || tool === 'barrier') {
      if ((tool === 'wall' || tool === 'barrier') && draftPoints.length >= 2) {
        const snapPoint = findSnapPoint(draftPoints, pointer)
        if (snapPoint) {
          await commitDraftPoints([...draftPoints, snapPoint], tool)
          return
        }
      }
      setDraftPoints((prev) => [...prev, { x: pointer.x, y: pointer.y }])
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

    if (tool === 'calibrate') {
      setCalibrationPoints((prev) => (prev.length >= 2 ? [{ x: pointer.x, y: pointer.y }] : [...prev, { x: pointer.x, y: pointer.y }]))
      return
    }

    if (tool === 'token') {
      await placeToken(pointer)
      return
    }

    if (tool === 'npcToken') {
      await placeNpcToken(pointer)
      return
    }

    if (tool === 'path') {
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
        const payload = createMapShapePayload(shapeDraftType, pointer.x, pointer.y, shapeDraftColor)
        const data = await callMutation('addShape', payload)
        const created = data?.state?.shapes?.[data.state.shapes.length - 1]
        if (created?.id) {
          setSelectedShapeId(created.id)
        }
      } catch (err) {
        setError(err.message)
      }
    }
  }, [activeMap, bundle?.live?.active, callMutation, commitDraftPoints, draftPoints, mapZoom, placeNpcToken, placeToken, selectedToken, shapeDraftColor, shapeDraftType, tool])

  const onStagePointerDown = useCallback((event) => {
    if (tool !== 'measure' || !activeMap || !bundle?.live?.active) return
    const pointer = getMapPointerFromEvent(event, mapZoom)
    if (!pointer) return
    setMeasureDrag({ start: { x: pointer.x, y: pointer.y }, end: { x: pointer.x, y: pointer.y } })
  }, [activeMap, bundle?.live?.active, mapZoom, tool])

  const onStagePointerMove = useCallback((event) => {
    const pointer = getMapPointerFromEvent(event, mapZoom)
    if (!pointer) return

    if (tool === 'wall' || tool === 'barrier') {
      setPointerPosition({ x: pointer.x, y: pointer.y })
    }

    setMeasureDrag((prev) => (prev ? { ...prev, end: { x: pointer.x, y: pointer.y } } : prev))
  }, [mapZoom, tool])

  const onStagePointerUp = useCallback(() => {
    if (tool !== 'measure') return
    setMeasureDrag(null)
  }, [tool])

  const onTokenDragEnd = useCallback(async (tokenId, event) => {
    const { x, y } = event.target.position()

    try {
      await callMutation('updateToken', { id: tokenId, x, y })
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation])

  const finalizePathMove = useCallback(async () => {
    if (!selectedToken || pathPoints.length < 2) return

    const tokenId = selectedToken.id
    const route = pathPoints.map((point) => ({ x: point.x, y: point.y }))
    const destination = pathPoints[pathPoints.length - 1]

    try {
      const totalPx = route.slice(1).reduce((sum, point, index) => (
        sum + distancePx(route[index], point)
      ), 0)
      const durationMs = clamp(Math.round(totalPx * 7), 350, 3000)
      const startTime = performance.now()

      await new Promise((resolve) => {
        const tick = (now) => {
          const elapsed = now - startTime
          const progress = clamp(elapsed / durationMs, 0, 1)
          const nextPoint = interpolatePointAlongPath(route, progress)
          if (nextPoint) {
            setBundle((prev) => {
              if (!prev?.activeState) return prev
              return {
                ...prev,
                activeState: {
                  ...prev.activeState,
                  tokens: (prev.activeState.tokens ?? []).map((token) => (
                    token.id === tokenId
                      ? { ...token, x: nextPoint.x, y: nextPoint.y }
                      : token
                  )),
                },
              }
            })
          }

          if (progress < 1) {
            requestAnimationFrame(tick)
            return
          }
          resolve()
        }

        requestAnimationFrame(tick)
      })

      await callMutation('updateToken', {
        id: tokenId,
        x: destination.x,
        y: destination.y,
      })
      setPathPoints([])
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, pathPoints, selectedToken])

  const updateShapeColor = useCallback(async (shapeId, colorName) => {
    try {
      await callMutation('updateShape', {
        id: shapeId,
        colorName,
        color: shapeStrokeFromColorId(colorName),
        fill: shapeFillFromColorId(colorName),
      })
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation])

  const rotateSelectedShape = useCallback(async (deltaDegrees) => {
    if (!selectedShapeId || !selectedShape?.shapeType) return
    const payload = rotateShapePayload(selectedShape, deltaDegrees)
    if (!payload) return

    try {
      await callMutation('updateShape', {
        id: selectedShapeId,
        ...payload,
      })
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, selectedShape, selectedShapeId])

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

  const removeSelectedWall = useCallback(async () => {
    if (!selectedWall) return
    try {
      setMapUndoStack((prev) => [{ op: 'restoreWall', payload: { wall: { ...selectedWall } } }, ...prev].slice(0, 20))
      await callMutation('removeWall', { id: selectedWall.id })
      setSelectedWallId('')
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, selectedWall])

  const removeSelectedBarrier = useCallback(async () => {
    if (!selectedShape || selectedShape.kind !== 'barrier') return
    try {
      setMapUndoStack((prev) => [{ op: 'addShape', payload: { ...selectedShape } }, ...prev].slice(0, 20))
      await callMutation('removeShape', { id: selectedShape.id })
      setSelectedShapeId('')
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, selectedShape])

  const resetMap = useCallback(async () => {
    if (!activeMap) return
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Reset this map? This clears walls, barriers, shapes, darkness zones, tokens, fog memory, and pings for this map.')
      if (!confirmed) return
    }

    try {
      await callMutation('resetMapState', {})
      setSelectedWallId('')
      setSelectedShapeId('')
      setSelectedTokenId('')
      setSelectedNpcTokenId('')
      setMapUndoStack([])
      setDraftPoints([])
      setPointerPosition(null)
      setPathPoints([])
      setMeasureDrag(null)
      setCalibrationPoints([])
      setShapePreview(null)
      setFocusedPlayerTokenId('dm')
      setViewMode('dm')
      setLastKnownNpcByViewer({})
    } catch (err) {
      setError(err.message)
    }
  }, [activeMap, callMutation])

  const undoMapEdit = useCallback(async () => {
    const action = mapUndoStack[0]
    if (!action) return
    setMapUndoStack((prev) => prev.slice(1))

    try {
      await callMutation(action.op, action.payload)
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, mapUndoStack])

  const removeToken = useCallback(async () => {
    if (!selectedTokenId) return

    try {
      await callMutation('removeToken', { id: selectedTokenId })
      setSelectedTokenId('')
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, selectedTokenId])

  const updateNpcToken = useCallback(async () => {
    if (!selectedNpcTokenId) return
    try {
      await callMutation('updateToken', {
        id: selectedNpcTokenId,
        name: npcTokenDraft.name,
        size: npcTokenDraft.size,
        ringColor: npcTokenDraft.ringColor,
        darkvision: Boolean(npcTokenDraft.darkvision),
        role: 'npc',
      })
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, npcTokenDraft.darkvision, npcTokenDraft.name, npcTokenDraft.ringColor, npcTokenDraft.size, selectedNpcTokenId])

  const deleteNpcToken = useCallback(async () => {
    if (!selectedNpcTokenId) return
    try {
      await callMutation('removeToken', { id: selectedNpcTokenId })
      setSelectedNpcTokenId('')
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, selectedNpcTokenId])

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

  const toggleMenu = useCallback((menuName) => {
    setExpandedMenus((prev) => ({ ...prev, [menuName]: !prev[menuName] }))
  }, [])

  const selectTool = useCallback((toolId) => {
    setTool(toolId)
  }, [])

  const zoomIn = useCallback(() => {
    setMapZoom((prev) => clamp(prev + 0.2, 0.6, 3))
  }, [])

  const zoomOut = useCallback(() => {
    setMapZoom((prev) => clamp(prev - 0.2, 0.6, 3))
  }, [])

  const resetZoom = useCallback(() => {
    setMapZoom(1)
  }, [])

  const selectPartyCharacter = useCallback((name) => {
    setSelectedPartyCharacter(name)
    if (!name) return
    setTokenDraft((prev) => ({ ...prev, name }))
  }, [])

  const selectFocusedPlayer = useCallback((value) => {
    setFocusedPlayerTokenId(value)
    if (value === 'dm') {
      setViewMode('dm')
      return
    }

    setViewMode('player')
    setSelectedTokenId(value)
  }, [])

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

  const fogRects = useMemo(() => {
    if (!activeState?.fog?.enabled || !visibility) return []

    const visibleSet = new Set(visibility.visible)
    const exploredSet = new Set(activeState.fog?.exploredCells ?? [])
    const rects = []

    for (let row = 0; row < visibility.rows; row += 1) {
      for (let col = 0; col < visibility.cols; col += 1) {
        const index = row * visibility.cols + col
        if (visibleSet.has(index)) continue

        const seen = exploredSet.has(index)
        const fill = seen
          ? (viewMode === 'dm' ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.52)')
          : (viewMode === 'dm' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.66)')

        rects.push({
          x: col * visibility.gridSize,
          y: row * visibility.gridSize,
          width: visibility.gridSize,
          height: visibility.gridSize,
          fill,
          blur: viewMode === 'player' ? (seen ? 0 : 26) : 0,
        })
      }
    }

    return rects
  }, [activeState?.fog, viewMode, visibility])

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

  useEffect(() => {
    if (viewMode !== 'player' || focusedPlayerTokenId === 'dm' || !visionToken?.id) return
    const visibleNpcs = npcTokens.filter((token) => visibleTokenIds.has(token.id))
    if (!visibleNpcs.length) return

    setLastKnownNpcByViewer((prev) => {
      const existing = prev[visionToken.id] ?? {}
      let changed = false
      const nextViewerState = { ...existing }

      for (const token of visibleNpcs) {
        const current = existing[token.id]
        if (!current || current.x !== token.x || current.y !== token.y || current.name !== token.name || current.size !== token.size || current.ringColor !== token.ringColor) {
          nextViewerState[token.id] = {
            id: token.id,
            x: token.x,
            y: token.y,
            name: token.name,
            size: token.size,
            ringColor: token.ringColor,
          }
          changed = true
        }
      }

      if (!changed) return prev
      return { ...prev, [visionToken.id]: nextViewerState }
    })
  }, [focusedPlayerTokenId, npcTokens, viewMode, visionToken?.id, visibleTokenIds])

  const ghostNpcTokens = useMemo(() => {
    if (viewMode !== 'player' || focusedPlayerTokenId === 'dm' || !visionToken?.id) return []
    const viewerMemory = lastKnownNpcByViewer[visionToken.id] ?? {}
    return Object.values(viewerMemory).filter((token) => !visibleTokenIds.has(token.id))
  }, [focusedPlayerTokenId, lastKnownNpcByViewer, viewMode, visionToken?.id, visibleTokenIds])

  const draftSnapPoint = useMemo(() => {
    if ((tool !== 'wall' && tool !== 'barrier') || !pointerPosition || draftPoints.length < 2) return null
    return findSnapPoint(draftPoints, pointerPosition)
  }, [draftPoints, pointerPosition, tool])

  const selectedShapeHandle = useMemo(() => {
    if (!selectedShape) return null
    const effectiveShape = shapePreview?.shapeId === selectedShape.id
      ? { ...selectedShape, ...shapePreview.payload }
      : selectedShape
    return getShapeScaleHandle(effectiveShape)
  }, [selectedShape, shapePreview])

  const shapeMeasurementEntries = useMemo(() => {
    return (activeState?.shapes ?? []).flatMap((shape) => {
      const effectiveShape = shapePreview?.shapeId === shape.id
        ? { ...shape, ...shapePreview.payload }
        : shape
      return shapeMeasurements(effectiveShape, feetPerPx)
    })
  }, [activeState?.shapes, feetPerPx, shapePreview])

  useEffect(() => {
    setMapRenderError('')
  }, [activeMap?.assetUrl])

  if (loading) {
    return <p style={{ color: '#888' }}>Loading VTT...</p>
  }

  const sessionActive = Boolean(bundle?.live?.active)
  const zoomedStageWidth = Math.round(stageWidth * mapZoom)
  const zoomedStageHeight = Math.round(stageHeight * mapZoom)

  return (
    <main style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '1rem' }}>
      <aside style={{ border: '1px solid #2d2d2d', borderRadius: '10px', padding: '0.9rem', height: 'fit-content', background: '#141414' }}>
        <h2 style={{ marginTop: 0, marginBottom: '0.4rem', fontSize: '1.1rem', color: '#c8a96e' }}>Virtual Tabletop</h2>
        <p style={{ marginTop: 0, color: '#777', fontSize: '0.8rem' }}>
          Live map controls, token movement, fog of war, and synced drawing tools.
        </p>
        <div style={{ marginBottom: '0.8rem', color: '#999', fontSize: '0.78rem' }}>
          Active tool: <span style={{ color: '#d6d6d6' }}>{TOOL_OPTIONS[tool]?.label || 'None'}</span>
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

        <section style={menuSectionStyle}>
          <button type="button" onClick={() => toggleMenu('mapSetup')} style={menuToggleStyle}>
            <span>Map Setup</span>
            <span>{expandedMenus.mapSetup ? '▾' : '▸'}</span>
          </button>
          {expandedMenus.mapSetup && (
            <div style={menuBodyStyle}>
              <select
                value={startMapId}
                onChange={(event) => setStartMapId(event.target.value)}
                style={inputStyle}
              >
                <option value="">Select map</option>
                {(bundle?.maps ?? []).map((map) => (
                  <option key={map.id} value={map.id}>
                    {map.name} ({map.id.slice(0, 6)})
                  </option>
                ))}
              </select>
              <div style={iconTileGridStyle}>
                <IconTileButton
                  icon="▶️"
                  label="Start Session"
                  onClick={() => startSession(startMapId || activeMap?.id)}
                  tone="success"
                />
                <IconTileButton
                  icon="⏹️"
                  label="Stop Session"
                  onClick={stopSession}
                  tone="danger"
                />
              </div>
              <p style={{ margin: 0, color: sessionActive ? '#89d089' : '#a88', fontSize: '0.78rem' }}>
                {sessionActive ? 'Session is live for everyone on this page.' : 'Session is currently inactive.'}
              </p>

              <div style={subSectionStyle}>
                <div style={subSectionTitleStyle}>Map Upload (PDF)</div>
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
                  style={{ marginTop: '0.5rem', fontSize: '0.8rem', width: '100%' }}
                />
                <p style={{ margin: '0.4rem 0 0', color: '#666', fontSize: '0.75rem' }}>
                  First page only, max 50MB.
                </p>
              </div>

              <div style={subSectionStyle}>
                <div style={subSectionTitleStyle}>Link Map To Session</div>
                <select value={linkResultId} onChange={(event) => setLinkResultId(event.target.value)} style={inputStyle}>
                  <option value="">Select session result</option>
                  {results.map((result) => (
                    <option key={result.id} value={result.id}>{result.fileName} ({new Date(result.createdAt).toLocaleDateString()})</option>
                  ))}
                </select>
                <div style={{ marginTop: '0.45rem' }}>
                  <IconTileButton
                    icon="🔗"
                    label="Link Active Map"
                    onClick={linkMap}
                    disabled={!linkResultId || !activeMap}
                    tone="primary"
                    fullWidth
                  />
                </div>
              </div>

              <div style={subSectionStyle}>
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
                {(tool === 'wall' || tool === 'barrier') && (
                  <>
                    <div style={{ ...iconTileGridStyle, marginTop: '0.45rem' }}>
                      <IconTileButton icon="✅" label="Commit Draft" onClick={finalizeDraft} tone="success" size="small" />
                      <IconTileButton icon="🧹" label="Clear Draft" onClick={() => { setDraftPoints([]); setPointerPosition(null) }} tone="muted" size="small" />
                    </div>
                    <p style={{ margin: '0.35rem 0 0', color: '#777', fontSize: '0.75rem' }}>
                      Click an existing point to snap-close the loop.
                    </p>
                  </>
                )}
                {tool === 'calibrate' && (
                  <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.35rem' }}>
                    <input
                      type="number"
                      min="1"
                      value={calibrationFeet}
                      onChange={(event) => setCalibrationFeet(event.target.value)}
                      style={inputStyle}
                      placeholder="Feet between 2 points"
                    />
                    <IconTileButton icon="🎯" label="Save Calibration" onClick={saveCalibration} tone="success" fullWidth />
                  </div>
                )}
              </div>

              <div style={subSectionStyle}>
                <div style={subSectionTitleStyle}>Walls + Barriers</div>
                <select value={selectedWallId} onChange={(event) => setSelectedWallId(event.target.value)} style={inputStyle}>
                  <option value="">Select wall</option>
                  {(activeState?.walls ?? []).map((wall, index) => (
                    <option key={wall.id} value={wall.id}>Wall {index + 1}</option>
                  ))}
                </select>
                <select value={selectedShape?.kind === 'barrier' ? selectedShape.id : ''} onChange={(event) => setSelectedShapeId(event.target.value)} style={{ ...inputStyle, marginTop: '0.35rem' }}>
                  <option value="">Select barrier</option>
                  {barrierShapes.map((barrier, index) => (
                    <option key={barrier.id} value={barrier.id}>Barrier {index + 1}</option>
                  ))}
                </select>
                <div style={{ ...iconTileGridStyle, marginTop: '0.45rem' }}>
                  <IconTileButton icon="🗑️" label="Delete Wall" onClick={removeSelectedWall} disabled={!selectedWallId} tone="danger" size="small" />
                  <IconTileButton icon="🗑️" label="Delete Barrier" onClick={removeSelectedBarrier} disabled={selectedShape?.kind !== 'barrier'} tone="danger" size="small" />
                </div>
                <div style={{ marginTop: '0.4rem' }}>
                  <IconTileButton icon="↩️" label="Undo Last Map Edit" onClick={undoMapEdit} disabled={!mapUndoStack.length} tone="primary" fullWidth />
                </div>
                <div style={{ marginTop: '0.35rem' }}>
                  <IconTileButton icon="🗺️" label="Reset Map" onClick={resetMap} disabled={!activeMap} tone="danger" fullWidth />
                </div>
                <p style={{ margin: '0.35rem 0 0', color: '#777', fontSize: '0.75rem' }}>
                  Click and drag selected walls/barriers on the map to reposition them.
                </p>
              </div>
            </div>
          )}
        </section>

        <section style={menuSectionStyle}>
          <button type="button" onClick={() => toggleMenu('dungeonMaster')} style={menuToggleStyle}>
            <span>Dungeon Master</span>
            <span>{expandedMenus.dungeonMaster ? '▾' : '▸'}</span>
          </button>
          {expandedMenus.dungeonMaster && (
            <div style={menuBodyStyle}>
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

              <div style={subSectionStyle}>
                <div style={subSectionTitleStyle}>DM Tools</div>
                <div style={toolGridStyle}>
                  {DM_TOOL_IDS.map((toolId) => (
                    <IconTileButton
                      key={toolId}
                      icon={TOOL_ICONS[toolId]}
                      label={TOOL_OPTIONS[toolId].label}
                      onClick={() => selectTool(toolId)}
                      active={tool === toolId}
                    />
                  ))}
                </div>
                {tool === 'darkness' && (
                  <div style={{ ...iconTileGridStyle, marginTop: '0.45rem' }}>
                    <IconTileButton icon="✅" label="Commit Draft" onClick={finalizeDraft} tone="success" size="small" />
                    <IconTileButton icon="🧹" label="Clear Draft" onClick={() => { setDraftPoints([]); setPointerPosition(null) }} tone="muted" size="small" />
                  </div>
                )}
              </div>

              <div style={subSectionStyle}>
                <div style={subSectionTitleStyle}>NPC Token Setup</div>
                <p style={{ margin: '0 0 0.35rem', color: '#777', fontSize: '0.75rem' }}>
                  Use Add NPC Token tool, then click the map to place a generic NPC.
                </p>
                <div style={{ marginTop: '0.2rem', display: 'grid', gap: '0.35rem' }}>
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
                </div>
              </div>

              <div style={subSectionStyle}>
                <div style={subSectionTitleStyle}>Manage NPC Tokens</div>
                <select value={selectedNpcTokenId} onChange={(event) => selectNpcToken(event.target.value)} style={inputStyle}>
                  <option value="">Select NPC token</option>
                  {npcTokens.map((token) => (
                    <option key={token.id} value={token.id}>{token.name}</option>
                  ))}
                </select>
                <div style={{ ...iconTileGridStyle, marginTop: '0.45rem' }}>
                  <IconTileButton icon="💾" label="Update NPC" onClick={updateNpcToken} disabled={!selectedNpcTokenId} tone="primary" />
                  <IconTileButton icon="🗑️" label="Delete NPC" onClick={deleteNpcToken} disabled={!selectedNpcTokenId} tone="danger" />
                </div>
              </div>
            </div>
          )}
        </section>

        <section style={menuSectionStyle}>
          <button type="button" onClick={() => toggleMenu('generalMapTools')} style={menuToggleStyle}>
            <span>General Map Tools</span>
            <span>{expandedMenus.generalMapTools ? '▾' : '▸'}</span>
          </button>
          {expandedMenus.generalMapTools && (
            <div style={menuBodyStyle}>
              <div style={toolGridStyle}>
                {GENERAL_TOOL_IDS.map((toolId) => (
                  <IconTileButton
                    key={toolId}
                    icon={TOOL_ICONS[toolId]}
                    label={TOOL_OPTIONS[toolId].label}
                    onClick={() => selectTool(toolId)}
                    active={tool === toolId}
                  />
                ))}
              </div>
              {tool === 'shape' && (
                <>
                  <div style={subSectionStyle}>
                    <div style={subSectionTitleStyle}>Shape Creation</div>
                    <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.2rem' }}>
                      <input
                        type="checkbox"
                        checked={showDarknessZones}
                        onChange={(event) => setShowDarknessZones(event.target.checked)}
                      />
                      Show darkness zones
                    </label>
                    <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.35rem' }}>
                      <input
                        type="checkbox"
                        checked={showBarriers}
                        onChange={(event) => setShowBarriers(event.target.checked)}
                      />
                      Show barriers
                    </label>
                    <div style={{ marginBottom: '0.35rem' }}>
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
                    </div>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      New shape color
                      <select value={shapeDraftColor} onChange={(event) => setShapeDraftColor(event.target.value)} style={inputStyle}>
                        {SHAPE_COLOR_OPTIONS.map((entry) => (
                          <option key={entry.id} value={entry.id}>{entry.label}</option>
                        ))}
                      </select>
                    </label>
                    <p style={{ margin: '0.4rem 0 0', color: '#777', fontSize: '0.75rem' }}>
                      Select Shape Tool, then click the map to place.
                    </p>
                  </div>
                  <select value={selectedShapeId} onChange={(event) => setSelectedShapeId(event.target.value)} style={{ ...inputStyle, marginTop: '0.45rem' }}>
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
                        <>
                          <select
                            value={selectedShapeColor}
                            onChange={(event) => {
                              setSelectedShapeColor(event.target.value)
                              updateShapeColor(selectedShape.id, event.target.value)
                            }}
                            style={{ ...inputStyle, marginTop: '0.4rem' }}
                          >
                            {SHAPE_COLOR_OPTIONS.map((entry) => (
                              <option key={entry.id} value={entry.id}>{entry.label}</option>
                            ))}
                          </select>
                          <div style={{ ...iconTileGridStyle, marginTop: '0.4rem' }}>
                            <IconTileButton icon="↺" label="Rotate -15°" onClick={() => rotateSelectedShape(-15)} tone="muted" size="small" />
                            <IconTileButton icon="↻" label="Rotate +15°" onClick={() => rotateSelectedShape(15)} tone="muted" size="small" />
                          </div>
                        </>
                      )}
                      <div style={{ marginTop: '0.4rem' }}>
                        <IconTileButton icon="🗑️" label="Remove Shape" onClick={removeShape} tone="danger" fullWidth />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        <section style={menuSectionStyle}>
          <button type="button" onClick={() => toggleMenu('player')} style={menuToggleStyle}>
            <span>Player</span>
            <span>{expandedMenus.player ? '▾' : '▸'}</span>
          </button>
          {expandedMenus.player && (
            <div style={menuBodyStyle}>
              <div style={toolGridStyle}>
                {PLAYER_TOOL_IDS.map((toolId) => (
                  <IconTileButton
                    key={toolId}
                    icon={TOOL_ICONS[toolId]}
                    label={TOOL_OPTIONS[toolId].label}
                    onClick={() => selectTool(toolId)}
                    active={tool === toolId}
                  />
                ))}
              </div>

              <div style={subSectionStyle}>
                <div style={subSectionTitleStyle}>Focused View</div>
                <IconTileButton
                  icon="🛡️"
                  label="Dungeon Master View"
                  onClick={() => selectFocusedPlayer('dm')}
                  active={focusedPlayerTokenId === 'dm' || viewMode === 'dm'}
                  size="large"
                  fullWidth
                />
                <div style={{ ...toolGridStyle, marginTop: '0.35rem' }}>
                  {playerTokens.map((token) => (
                    <IconTileButton
                      key={token.id}
                      icon="🧙"
                      label={token.name}
                      onClick={() => selectFocusedPlayer(token.id)}
                      active={focusedPlayerTokenId === token.id && viewMode === 'player'}
                      size="small"
                    />
                  ))}
                </div>
              </div>

              {tool === 'path' && (
                <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.3rem' }}>
                  <div style={iconTileGridStyle}>
                    <IconTileButton
                      icon="📍"
                      label="Start Path"
                      onClick={() => setPathPoints(selectedToken ? [{ x: selectedToken.x, y: selectedToken.y }] : [])}
                      tone="muted"
                      size="small"
                    />
                    <IconTileButton
                      icon="🏃"
                      label="Animate Move"
                      onClick={finalizePathMove}
                      tone="success"
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
              )}

              <div style={subSectionStyle}>
                <div style={subSectionTitleStyle}>Player Token Setup</div>
                <select value={selectedPartyCharacter} onChange={(event) => selectPartyCharacter(event.target.value)} style={inputStyle}>
                  <option value="">Select party character</option>
                  {partyCharacters.map((entry) => (
                    <option key={entry.slug || entry.name} value={entry.name}>{entry.name}</option>
                  ))}
                </select>
                <div style={{ marginTop: '0.4rem', display: 'grid', gap: '0.35rem' }}>
                  <input
                    type="text"
                    value={tokenDraft.name}
                    onChange={(event) => setTokenDraft((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="Player token name"
                    style={inputStyle}
                  />
                  <select value={tokenDraft.size} onChange={(event) => setTokenDraft((prev) => ({ ...prev, size: event.target.value }))} style={inputStyle}>
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                  <select value={tokenDraft.ringColor} onChange={(event) => setTokenDraft((prev) => ({ ...prev, ringColor: event.target.value }))} style={inputStyle}>
                    <option value="clear">Ring: Clear</option>
                    <option value="white">Ring: White</option>
                    <option value="black">Ring: Black</option>
                    <option value="red">Ring: Red</option>
                    <option value="blue">Ring: Blue</option>
                  </select>
                </div>
                <p style={{ margin: '0.4rem 0 0', color: '#777', fontSize: '0.75rem' }}>
                  Select Add Player Token, then click the map to place.
                </p>
              </div>

              <div style={subSectionStyle}>
                <div style={subSectionTitleStyle}>Update Existing Player Token</div>
                <select
                  value={selectedTokenId}
                  onChange={(event) => {
                    setSelectedTokenId(event.target.value)
                    if (event.target.value) {
                      selectFocusedPlayer(event.target.value)
                    }
                  }}
                  style={inputStyle}
                >
                  <option value="">Select token</option>
                  {playerTokens.map((tokenEntry) => (
                    <option key={tokenEntry.id} value={tokenEntry.id}>{tokenEntry.name}</option>
                  ))}
                </select>
                <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.35rem', marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(tokenDraft.darkvision)}
                    onChange={(event) => setTokenDraft((prev) => ({ ...prev, darkvision: event.target.checked }))}
                  />
                  Player has dark vision
                </label>
                <div style={{ ...iconTileGridStyle, marginTop: '0.45rem' }}>
                  <IconTileButton
                    icon="💾"
                    label="Update Player"
                    onClick={() => {
                      if (!selectedTokenId) return
                      callMutation('updateToken', {
                        id: selectedTokenId,
                        ringColor: tokenDraft.ringColor,
                        size: tokenDraft.size,
                        name: tokenDraft.name,
                        darkvision: Boolean(tokenDraft.darkvision),
                        role: 'player',
                      }).catch((err) => setError(err.message))
                    }}
                    tone="primary"
                  />
                  <IconTileButton icon="🗑️" label="Delete Player" onClick={removeToken} tone="danger" />
                </div>
              </div>

              <div style={subSectionStyle}>
                <div style={subSectionTitleStyle}>Path + Movement</div>
                <label style={labelStyle}>
                  Move speed (ft)
                  <input
                    type="number"
                    min="1"
                    value={character.moveSpeed}
                    onChange={(event) => setCharacter((prev) => ({ ...prev, moveSpeed: Number(event.target.value) || 30 }))}
                    style={inputStyle}
                  />
                </label>
                <IconTileButton icon="⚙️" label="Save Move Speed" onClick={saveCharacter} disabled={!activeMap} tone="primary" fullWidth />
              </div>
            </div>
          )}
        </section>
      </aside>

      <section ref={containerRef} style={{ border: '1px solid #2d2d2d', borderRadius: '10px', background: '#111', padding: '0.6rem' }}>
        {!sessionActive && (
          <div style={{ marginBottom: '0.6rem', padding: '0.55rem 0.8rem', borderRadius: '6px', background: '#231818', border: '1px solid #4b2222', color: '#db9f9f', fontSize: '0.85rem' }}>
            Session is not active. Start a session to broadcast the live virtual tabletop.
          </div>
        )}

        {!activeMap && (
          <div style={{ color: '#777', padding: '1.2rem', textAlign: 'center' }}>
            Upload a PDF map to begin.
          </div>
        )}

        {activeMap && sessionActive && (
          <>
          <div style={{ marginBottom: '0.45rem' }}>
            <div style={iconTileGridStyle}>
              <IconTileButton icon="➖" label="Zoom Out" onClick={zoomOut} tone="primary" size="xsmall" />
              <IconTileButton icon="➕" label="Zoom In" onClick={zoomIn} tone="primary" size="xsmall" />
              <IconTileButton icon="🔁" label="Reset Zoom" onClick={resetZoom} tone="muted" size="xsmall" />
            </div>
            <span style={{ color: '#8f8f8f', fontSize: '0.76rem' }}>{Math.round(mapZoom * 100)}%</span>
          </div>
          <div style={{ position: 'relative', width: stageWidth, height: stageHeight, border: '1px solid #222', borderRadius: '8px', background: '#0a0a0a', overflow: 'auto' }}>
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
            </Layer>

            <Layer>
              {(activeState?.walls ?? []).map((wall) => (
                <Line
                  key={wall.id}
                  points={[wall.a.x, wall.a.y, wall.b.x, wall.b.y]}
                  stroke={wall.id === selectedWallId ? '#ffd978' : '#f5a623'}
                  strokeWidth={wall.id === selectedWallId ? 4 : 3}
                  draggable={wall.id === selectedWallId}
                  onClick={(event) => {
                    event.cancelBubble = true
                    setSelectedWallId(wall.id)
                    setSelectedShapeId('')
                  }}
                  onDragEnd={(event) => {
                    const node = event.target
                    const dx = node.x()
                    const dy = node.y()
                    node.position({ x: 0, y: 0 })

                    const previous = { a: { ...wall.a }, b: { ...wall.b } }
                    setMapUndoStack((prev) => [
                      { op: 'updateWall', payload: { id: wall.id, ...previous } },
                      ...prev,
                    ].slice(0, 20))

                    callMutation('updateWall', {
                      id: wall.id,
                      a: { x: wall.a.x + dx, y: wall.a.y + dy },
                      b: { x: wall.b.x + dx, y: wall.b.y + dy },
                    }).catch((err) => {
                      setError(err.message)
                    })
                  }}
                />
              ))}

              {showDarknessZones && (activeState?.darknessZones ?? []).map((zone) => (
                <Line
                  key={zone.id}
                  points={flattenPoints(zone.points)}
                  closed
                  stroke="#222"
                  fill="rgba(0,0,0,0.34)"
                  strokeWidth={2}
                  listening={false}
                />
              ))}

              {(activeState?.shapes ?? []).map((shape) => {
                if (shape.kind === 'barrier' && !showBarriers) return null
                if (shape.kind === 'darkness' && !showDarknessZones) return null
                const preview = shapePreview?.shapeId === shape.id ? shapePreview.payload : null
                const mergedShape = preview ? { ...shape, ...preview } : shape
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
                      strokeWidth={2}
                      draggable
                      onClick={(event) => {
                        event.cancelBubble = true
                        setSelectedShapeId(shape.id)
                      }}
                      onDragEnd={(event) => {
                        const node = event.target
                        const dx = node.x() - center.x
                        const dy = node.y() - center.y
                        node.position({ x: center.x, y: center.y })
                        const payload = moveShapePayload(mergedShape, dx, dy)
                        if (!payload) return
                        if (shape.kind === 'barrier') {
                          setMapUndoStack((prev) => [{ op: 'updateShape', payload: { id: shape.id, points: shape.points } }, ...prev].slice(0, 20))
                        }
                        callMutation('updateShape', { id: shape.id, ...payload }).catch((err) => {
                          setError(err.message)
                        })
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
                    strokeWidth={2}
                    draggable
                    onClick={(event) => {
                      event.cancelBubble = true
                      setSelectedShapeId(shape.id)
                    }}
                    onDragEnd={(event) => {
                      const node = event.target
                      const dx = node.x()
                      const dy = node.y()
                      node.position({ x: 0, y: 0 })
                      const payload = moveShapePayload(mergedShape, dx, dy)
                      if (!payload) return
                      if (shape.kind === 'barrier') {
                        setMapUndoStack((prev) => [{ op: 'updateShape', payload: { id: shape.id, points: shape.points } }, ...prev].slice(0, 20))
                      }
                      callMutation('updateShape', { id: shape.id, ...payload }).catch((err) => {
                        setError(err.message)
                      })
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

              {draftPoints.length > 1 && (
                <Line
                  points={flattenPoints(draftPoints)}
                  stroke={tool === 'darkness' ? '#3a3a3a' : '#d0b36d'}
                  strokeWidth={2}
                  dash={[8, 6]}
                />
              )}

              {(tool === 'wall' || tool === 'barrier') && draftPoints.map((point, index) => (
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

              {(tool === 'wall' || tool === 'barrier') && draftPoints.length > 0 && pointerPosition && (
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

              {calibrationPoints.length > 1 && (
                <Line points={flattenPoints(calibrationPoints)} stroke="#b5e853" strokeWidth={2} dash={[5, 5]} />
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

              {shapeMeasurementEntries.map((entry) => (
                <Text
                  key={`${entry.id}:label`}
                  x={entry.textX}
                  y={entry.textY}
                  text={entry.text}
                  fontSize={11}
                  fill="#f0f0f0"
                  listening={false}
                />
              ))}

              {measurementDistance && (
                <Text
                  x={measurementDistance.mid.x + 6}
                  y={measurementDistance.mid.y - 16}
                  text={measurementDistance.feet ? `${formatFeet(measurementDistance.feet)} ft` : `${Math.round(measurementDistance.px)} px`}
                  fontSize={12}
                  fill="#c9f6f4"
                  listening={false}
                />
              )}
            </Layer>

            <Layer>
              {ghostNpcTokens.map((token) => (
                <Circle
                  key={`ghost:${token.id}`}
                  x={token.x}
                  y={token.y}
                  radius={TOKEN_RADIUS[token.size] ?? TOKEN_RADIUS.medium}
                  fill="rgba(166,166,166,0.35)"
                  stroke={RING_COLORS[token.ringColor] ?? 'rgba(255,255,255,0.25)'}
                  strokeWidth={3}
                  listening={false}
                />
              ))}

              {ghostNpcTokens.map((token) => (
                <Text
                  key={`ghost-label:${token.id}`}
                  x={token.x - 40}
                  y={token.y - 31}
                  width={80}
                  align="center"
                  text={token.name}
                  fontSize={10}
                  fill="rgba(230,230,230,0.45)"
                  listening={false}
                />
              ))}

              {(activeState?.tokens ?? []).filter((token) => visibleTokenIds.has(token.id)).map((token) => (
                <Circle
                  key={token.id}
                  x={token.x}
                  y={token.y}
                  radius={TOKEN_RADIUS[token.size] ?? TOKEN_RADIUS.medium}
                  fill={token.id === selectedTokenId ? '#3b82f6' : '#888'}
                  stroke={RING_COLORS[token.ringColor] ?? 'transparent'}
                  strokeWidth={4}
                  draggable
                  onClick={(event) => {
                    event.cancelBubble = true
                    setSelectedTokenId(token.id)
                    if (token.role === 'player') {
                      selectFocusedPlayer(token.id)
                    }
                    if (token.role === 'npc') {
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
              ))}

              {(activeState?.tokens ?? []).filter((token) => visibleTokenIds.has(token.id)).map((token) => (
                <Text
                  key={`${token.id}:label`}
                  x={token.x - 30}
                  y={token.y - 33}
                  width={60}
                  align="center"
                  text={token.name}
                  fontSize={11}
                  fill="#e7e7e7"
                  listening={false}
                />
              ))}

            </Layer>

            <Layer listening={false}>
              {fogRects.map((rect, index) => (
                <Rect
                  key={`${rect.x}:${rect.y}:${index}`}
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  fill={rect.fill}
                  shadowColor="rgba(0,0,0,0.95)"
                  shadowBlur={rect.blur}
                />
              ))}
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
      ? (isLarge ? '88px' : isXSmall ? '46px' : '74px')
      : (isXSmall ? '42px' : isSmall ? '72px' : isLarge ? '102px' : '86px'),
    aspectRatio: fullWidth ? 'auto' : '1 / 1',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: isXSmall ? '0.08rem' : isSmall ? '0.24rem' : '0.32rem',
    borderRadius: isXSmall ? '11px' : isSmall ? '14px' : '16px',
    border: `1px solid ${active ? palette.activeBorder : palette.border}`,
    background: active ? palette.activeBg : palette.bg,
    color: active ? palette.activeText : palette.text,
    opacity: disabled ? 0.48 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    padding: isXSmall ? '0.2rem 0.2rem' : isSmall ? '0.34rem 0.3rem' : '0.48rem 0.42rem',
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

const menuSectionStyle = {
  marginBottom: '0.65rem',
  border: '1px solid #262626',
  borderRadius: '8px',
  overflow: 'hidden',
}

const menuToggleStyle = {
  width: '100%',
  background: '#191919',
  border: 'none',
  color: '#d6d6d6',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '0.52rem 0.65rem',
  fontSize: '0.79rem',
  fontWeight: 600,
  cursor: 'pointer',
}

const menuBodyStyle = {
  padding: '0.55rem',
  display: 'grid',
  gap: '0.5rem',
  background: '#131313',
}

const subSectionStyle = {
  borderTop: '1px solid #252525',
  paddingTop: '0.5rem',
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
      fontSize: '0.86rem',
      lineHeight: 1,
    }
  }
  return {
    fontSize: '1.06rem',
    lineHeight: 1,
  }
}

function iconTileLabelStyle(size = 'normal') {
  if (size === 'xsmall') {
    return {
      fontSize: '0.54rem',
      fontWeight: 600,
      color: 'inherit',
    }
  }
  return {
    fontSize: '0.67rem',
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

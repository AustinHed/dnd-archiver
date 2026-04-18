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

function createAnnotationShapePayload(shapeType, x, y, colorId) {
  const colorName = colorId || 'blue'
  const color = shapeStrokeFromColorId(colorName)
  const fill = shapeFillFromColorId(colorName)

  if (shapeType === 'circle') {
    const radius = 56
    const center = { x, y }
    return {
      points: [center, { x: x + radius, y }],
      closed: true,
      kind: 'annotation',
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
      kind: 'annotation',
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
      kind: 'annotation',
      shapeType: 'square',
      colorName,
      color,
      fill,
    }
  }

  return {
    points: buildRectanglePoints(x, y),
    closed: true,
    kind: 'annotation',
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
  if (feetPerPx) return `${formatFeet(pxDistance * feetPerPx)} ft`
  return `${Math.round(pxDistance)} px`
}

function getShapeScaleHandle(shape) {
  if (!shape || shape.kind !== 'annotation') return null
  if (shape.shapeType === 'circle') {
    const { center, radius } = getCircleGeometry(shape)
    return { x: center.x + radius, y: center.y }
  }
  const points = shape.points ?? []
  if (!points.length) return null
  if (shape.shapeType === 'triangle') {
    return points.reduce((maxPoint, point) => (point.x > maxPoint.x ? point : maxPoint), points[0])
  }
  const bounds = getBounds(points)
  if (!bounds) return null
  return { x: bounds.maxX, y: bounds.maxY }
}

function moveShapePayload(shape, dx, dy) {
  if (!shape) return null
  if (shape.shapeType === 'circle' && shape.kind === 'annotation') {
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
  if (!shape || shape.kind !== 'annotation' || !targetPoint) return null

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
  if (!shape || shape.kind !== 'annotation') return []

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
    const bounds = getBounds(shape.points ?? [])
    if (!bounds) return []
    const width = bounds.maxX - bounds.minX
    const height = bounds.maxY - bounds.minY
    const labels = [
      {
        id: `${shape.id}:w-line`,
        line: [bounds.minX, bounds.minY - 8, bounds.maxX, bounds.minY - 8],
        text: formatDistanceLabel(width, feetPerPx),
        textX: (bounds.minX + bounds.maxX) / 2 - 24,
        textY: bounds.minY - 24,
      },
    ]
    if (shape.shapeType === 'rectangle') {
      labels.push({
        id: `${shape.id}:h-line`,
        line: [bounds.maxX + 8, bounds.minY, bounds.maxX + 8, bounds.maxY],
        text: formatDistanceLabel(height, feetPerPx),
        textX: bounds.maxX + 14,
        textY: (bounds.minY + bounds.maxY) / 2 - 8,
      })
    } else {
      labels.push({
        id: `${shape.id}:s-line`,
        line: [bounds.maxX + 8, bounds.minY, bounds.maxX + 8, bounds.maxY],
        text: `h ${formatDistanceLabel(height, feetPerPx)}`,
        textX: bounds.maxX + 14,
        textY: (bounds.minY + bounds.maxY) / 2 - 8,
      })
    }
    return labels
  }

  if (shape.shapeType === 'triangle') {
    const points = shape.points ?? []
    if (points.length < 3) return []
    const top = points.reduce((minPoint, point) => (point.y < minPoint.y ? point : minPoint), points[0])
    const basePoints = [...points].sort((a, b) => b.y - a.y).slice(0, 2).sort((a, b) => a.x - b.x)
    if (basePoints.length < 2) return []
    const baseMid = {
      x: (basePoints[0].x + basePoints[1].x) / 2,
      y: (basePoints[0].y + basePoints[1].y) / 2,
    }
    const height = distancePx(top, baseMid)
    return [
      {
        id: `${shape.id}:tri-h`,
        line: [top.x, top.y, baseMid.x, baseMid.y],
        text: `h ${formatDistanceLabel(height, feetPerPx)}`,
        textX: (top.x + baseMid.x) / 2 + 8,
        textY: (top.y + baseMid.y) / 2 - 8,
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
  const [measurePoints, setMeasurePoints] = useState([])
  const [pathPoints, setPathPoints] = useState([])
  const [calibrationPoints, setCalibrationPoints] = useState([])
  const [calibrationFeet, setCalibrationFeet] = useState('30')
  const [mapName, setMapName] = useState('')
  const [startMapId, setStartMapId] = useState('')
  const [linkResultId, setLinkResultId] = useState('')
  const [pointerPosition, setPointerPosition] = useState(null)
  const [selectedShapeId, setSelectedShapeId] = useState('')
  const [shapeDraftType, setShapeDraftType] = useState('rectangle')
  const [shapeDraftColor, setShapeDraftColor] = useState('blue')
  const [selectedShapeColor, setSelectedShapeColor] = useState('blue')
  const [selectedTokenId, setSelectedTokenId] = useState('')
  const [partyCharacters, setPartyCharacters] = useState([])
  const [npcRoster, setNpcRoster] = useState([])
  const [selectedPartyCharacter, setSelectedPartyCharacter] = useState('')
  const [selectedNpcName, setSelectedNpcName] = useState('')
  const [tokenDraft, setTokenDraft] = useState({ name: 'Token', size: 'medium', ringColor: 'clear' })
  const [npcTokenDraft, setNpcTokenDraft] = useState({ name: 'NPC', size: 'medium', ringColor: 'red' })
  const [character, setCharacter] = useState({ moveSpeed: 30, darkvision: false })
  const [viewMode, setViewMode] = useState('player')
  const [clientId, setClientId] = useState('')
  const [mapRenderError, setMapRenderError] = useState('')
  const [pingClock, setPingClock] = useState(Date.now())
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
        const [charactersRes, npcsRes] = await Promise.all([
          fetch('/api/characters', { cache: 'no-store' }),
          fetch('/api/npcs', { cache: 'no-store' }),
        ])

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

        if (npcsRes.ok) {
          const npcsJson = await npcsRes.json()
          const nextNpcs = Array.isArray(npcsJson) ? npcsJson : []
          setNpcRoster(nextNpcs)

          if (nextNpcs.length) {
            const firstName = nextNpcs[0].name
            setSelectedNpcName((prev) => prev || firstName)
            setNpcTokenDraft((prev) => ({
              ...prev,
              name: prev.name === 'NPC' ? firstName : prev.name,
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

        const firstTokenId = nextBundle?.activeState?.tokens?.[0]?.id ?? ''
        setSelectedTokenId((prev) => prev || firstTokenId)
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
    if (!bundle?.activeState?.tokens?.length) return
    setSelectedTokenId((prev) => prev || bundle.activeState.tokens[0].id)
  }, [bundle?.activeState?.tokens])

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

  const selectedToken = useMemo(
    () => activeState?.tokens?.find((token) => token.id === selectedTokenId) ?? null,
    [activeState?.tokens, selectedTokenId],
  )

  useEffect(() => {
    if (!selectedToken) return
    setTokenDraft({
      name: selectedToken.name || 'Token',
      size: selectedToken.size || 'medium',
      ringColor: selectedToken.ringColor || 'clear',
    })
  }, [selectedToken?.id])

  const selectedShape = useMemo(
    () => activeState?.shapes?.find((shape) => shape.id === selectedShapeId) ?? null,
    [activeState?.shapes, selectedShapeId],
  )

  useEffect(() => {
    if (!selectedShape) return
    setSelectedShapeColor(inferShapeColorId(selectedShape))
  }, [selectedShape?.id, selectedShape?.color, selectedShape?.colorName])

  const visibility = useMemo(() => {
    if (!activeMap || !activeState || !selectedToken) return null

    return computeVisibilityGrid({
      state: activeState,
      mapWidth: activeMap.width,
      mapHeight: activeMap.height,
      token: selectedToken,
      darkvision: character.darkvision,
      feetPerPixel: feetPerPx,
    })
  }, [activeMap, activeState, selectedToken, character.darkvision, feetPerPx])

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
        name: npcTokenDraft.name || selectedNpcName || 'NPC',
        size: npcTokenDraft.size,
        ringColor: npcTokenDraft.ringColor,
      })
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, npcTokenDraft, selectedNpcName])

  const onStageClick = useCallback(async (event) => {
    if (!activeMap || !bundle?.live?.active) return
    const pointer = event.target.getStage()?.getPointerPosition()
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

    if (tool === 'measure') {
      setMeasurePoints((prev) => (prev.length >= 2 ? [{ x: pointer.x, y: pointer.y }] : [...prev, { x: pointer.x, y: pointer.y }]))
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
        const payload = createAnnotationShapePayload(shapeDraftType, pointer.x, pointer.y, shapeDraftColor)
        const data = await callMutation('addShape', payload)
        const created = data?.state?.shapes?.[data.state.shapes.length - 1]
        if (created?.id) {
          setSelectedShapeId(created.id)
        }
      } catch (err) {
        setError(err.message)
      }
    }
  }, [activeMap, bundle?.live?.active, callMutation, commitDraftPoints, draftPoints, placeNpcToken, placeToken, selectedToken, shapeDraftColor, shapeDraftType, tool])

  const onStagePointerMove = useCallback((event) => {
    if (tool !== 'wall' && tool !== 'barrier') return
    const pointer = event.target.getStage()?.getPointerPosition()
    if (!pointer) return
    setPointerPosition({ x: pointer.x, y: pointer.y })
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

    const destination = pathPoints[pathPoints.length - 1]

    try {
      await callMutation('updateToken', {
        id: selectedToken.id,
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

  const removeShape = useCallback(async () => {
    if (!selectedShapeId) return

    try {
      await callMutation('removeShape', { id: selectedShapeId })
      setSelectedShapeId('')
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, selectedShapeId])

  const removeToken = useCallback(async () => {
    if (!selectedTokenId) return

    try {
      await callMutation('removeToken', { id: selectedTokenId })
      setSelectedTokenId('')
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, selectedTokenId])

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

  const selectPartyCharacter = useCallback((name) => {
    setSelectedPartyCharacter(name)
    if (!name) return
    setTokenDraft((prev) => ({ ...prev, name }))
  }, [])

  const selectNpc = useCallback((name) => {
    setSelectedNpcName(name)
    if (!name) return
    setNpcTokenDraft((prev) => ({ ...prev, name }))
  }, [])

  const measurementFeet = useMemo(() => {
    if (measurePoints.length !== 2 || !feetPerPx) return null
    return distancePx(measurePoints[0], measurePoints[1]) * feetPerPx
  }, [measurePoints, feetPerPx])

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
          ? (viewMode === 'dm' ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.78)')
          : (viewMode === 'dm' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.96)')

        rects.push({
          x: col * visibility.gridSize,
          y: row * visibility.gridSize,
          width: visibility.gridSize,
          height: visibility.gridSize,
          fill,
          blur: viewMode === 'player' ? (seen ? 8 : 16) : 0,
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

    if (selectedTokenId) {
      ids.add(selectedTokenId)
    }

    return ids
  }, [activeState?.fog?.enabled, activeState?.tokens, selectedTokenId, viewMode, visibility])

  const draftSnapPoint = useMemo(() => {
    if ((tool !== 'wall' && tool !== 'barrier') || !pointerPosition || draftPoints.length < 2) return null
    return findSnapPoint(draftPoints, pointerPosition)
  }, [draftPoints, pointerPosition, tool])

  const selectedShapeHandle = useMemo(() => getShapeScaleHandle(selectedShape), [selectedShape])

  const shapeMeasurementEntries = useMemo(() => {
    return (activeState?.shapes ?? []).flatMap((shape) => shapeMeasurements(shape, feetPerPx))
  }, [activeState?.shapes, feetPerPx])

  useEffect(() => {
    setMapRenderError('')
  }, [activeMap?.assetUrl])

  if (loading) {
    return <p style={{ color: '#888' }}>Loading VTT...</p>
  }

  const sessionActive = Boolean(bundle?.live?.active)

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
              <div style={rowButtonStyle}>
                <button
                  onClick={() => startSession(startMapId || activeMap?.id)}
                  style={buttonStyle('#1a351a', '#2b7a2b')}
                >
                  Start Session
                </button>
                <button
                  onClick={stopSession}
                  style={buttonStyle('#351a1a', '#7a2b2b')}
                >
                  Stop Session
                </button>
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
                <button onClick={linkMap} disabled={!linkResultId || !activeMap} style={{ ...buttonStyle('#1f2736', '#3d5f95'), marginTop: '0.45rem', width: '100%' }}>
                  Link Active Map
                </button>
              </div>

              <div style={subSectionStyle}>
                <div style={subSectionTitleStyle}>Setup Tools</div>
                <div style={toolGridStyle}>
                  {MAP_SETUP_TOOL_IDS.map((toolId) => (
                    <button
                      key={toolId}
                      type="button"
                      onClick={() => selectTool(toolId)}
                      style={toolButtonStyle(tool === toolId)}
                    >
                      {TOOL_OPTIONS[toolId].label}
                    </button>
                  ))}
                </div>
                {(tool === 'wall' || tool === 'barrier') && (
                  <>
                    <div style={{ ...rowButtonStyle, marginTop: '0.45rem' }}>
                      <button onClick={finalizeDraft} style={buttonStyle('#233622', '#3d8b3a')}>Commit Draft</button>
                      <button onClick={() => { setDraftPoints([]); setPointerPosition(null) }} style={buttonStyle('#2b2b2b', '#4b4b4b')}>Clear</button>
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
                    <button onClick={saveCalibration} style={buttonStyle('#233622', '#3d8b3a')}>Save Calibration</button>
                  </div>
                )}
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
              <label style={{ marginTop: '0.5rem', display: 'block', fontSize: '0.8rem', color: '#aaa' }}>
                View mode
                <select value={viewMode} onChange={(event) => setViewMode(event.target.value)} style={{ ...inputStyle, marginTop: '0.2rem' }}>
                  <option value="player">Player</option>
                  <option value="dm">Dungeon Master</option>
                </select>
              </label>

              <div style={subSectionStyle}>
                <div style={subSectionTitleStyle}>DM Tools</div>
                <div style={toolGridStyle}>
                  {DM_TOOL_IDS.map((toolId) => (
                    <button
                      key={toolId}
                      type="button"
                      onClick={() => selectTool(toolId)}
                      style={toolButtonStyle(tool === toolId)}
                    >
                      {TOOL_OPTIONS[toolId].label}
                    </button>
                  ))}
                </div>
                {tool === 'darkness' && (
                  <div style={{ ...rowButtonStyle, marginTop: '0.45rem' }}>
                    <button onClick={finalizeDraft} style={buttonStyle('#233622', '#3d8b3a')}>Commit Draft</button>
                    <button onClick={() => { setDraftPoints([]); setPointerPosition(null) }} style={buttonStyle('#2b2b2b', '#4b4b4b')}>Clear</button>
                  </div>
                )}
              </div>

              <div style={subSectionStyle}>
                <div style={subSectionTitleStyle}>NPC Token Setup</div>
                <select value={selectedNpcName} onChange={(event) => selectNpc(event.target.value)} style={inputStyle}>
                  <option value="">Select NPC</option>
                  {npcRoster.map((npc) => (
                    <option key={npc.slug || npc.name} value={npc.name}>{npc.name}</option>
                  ))}
                </select>
                <div style={{ marginTop: '0.4rem', display: 'grid', gap: '0.35rem' }}>
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
                </div>
                <p style={{ margin: '0.4rem 0 0', color: '#777', fontSize: '0.75rem' }}>
                  Select Add NPC Token, then click the map to place.
                </p>
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
                  <button
                    key={toolId}
                    type="button"
                    onClick={() => selectTool(toolId)}
                    style={toolButtonStyle(tool === toolId)}
                  >
                    {TOOL_OPTIONS[toolId].label}
                  </button>
                ))}
              </div>
              <div style={subSectionStyle}>
                <div style={subSectionTitleStyle}>Shape Creation</div>
                <label style={labelStyle}>
                  New shape type
                  <select value={shapeDraftType} onChange={(event) => setShapeDraftType(event.target.value)} style={inputStyle}>
                    {SHAPE_TYPE_OPTIONS.map((shapeType) => (
                      <option key={shapeType.id} value={shapeType.id}>{shapeType.label}</option>
                    ))}
                  </select>
                </label>
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
                  {selectedShape.kind === 'annotation' && (
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
                  )}
                  <button onClick={removeShape} style={{ ...buttonStyle('#351a1a', '#7a2b2b'), width: '100%', marginTop: '0.4rem' }}>Remove Shape</button>
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
                  <button
                    key={toolId}
                    type="button"
                    onClick={() => selectTool(toolId)}
                    style={toolButtonStyle(tool === toolId)}
                  >
                    {TOOL_OPTIONS[toolId].label}
                  </button>
                ))}
              </div>

              {tool === 'path' && (
                <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.3rem' }}>
                  <button onClick={() => setPathPoints(selectedToken ? [{ x: selectedToken.x, y: selectedToken.y }] : [])} style={buttonStyle('#2b2b2b', '#4b4b4b')}>
                    Start Path From Token
                  </button>
                  <button onClick={finalizePathMove} style={buttonStyle('#233622', '#3d8b3a')}>Commit Path Move</button>
                  <button onClick={() => setPathPoints([])} style={buttonStyle('#2b2b2b', '#4b4b4b')}>Clear Path</button>
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
                <select value={selectedTokenId} onChange={(event) => setSelectedTokenId(event.target.value)} style={inputStyle}>
                  <option value="">Select token</option>
                  {(activeState?.tokens ?? []).map((tokenEntry) => (
                    <option key={tokenEntry.id} value={tokenEntry.id}>{tokenEntry.name}</option>
                  ))}
                </select>
                <div style={{ ...rowButtonStyle, marginTop: '0.45rem' }}>
                  <button
                    onClick={() => {
                      if (!selectedTokenId) return
                      callMutation('updateToken', {
                        id: selectedTokenId,
                        ringColor: tokenDraft.ringColor,
                        size: tokenDraft.size,
                        name: tokenDraft.name,
                      }).catch((err) => setError(err.message))
                    }}
                    style={buttonStyle('#1f2736', '#3d5f95')}
                  >
                    Update
                  </button>
                  <button onClick={removeToken} style={buttonStyle('#351a1a', '#7a2b2b')}>Delete</button>
                </div>
              </div>

              <div style={subSectionStyle}>
                <div style={subSectionTitleStyle}>Player Vision + Movement</div>
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
                <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={character.darkvision}
                    onChange={(event) => setCharacter((prev) => ({ ...prev, darkvision: event.target.checked }))}
                  />
                  Dark vision enabled
                </label>
                <button onClick={saveCharacter} disabled={!activeMap} style={{ ...buttonStyle('#1f2736', '#3d5f95'), width: '100%' }}>
                  Save Player Settings
                </button>
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
          <div style={{ position: 'relative', width: stageWidth, height: stageHeight, border: '1px solid #222', borderRadius: '8px', background: '#0a0a0a', overflow: 'hidden' }}>
            <img
              src={activeMap.assetUrl}
              alt={`Map ${activeMap.name}`}
              draggable={false}
              onError={() => setMapRenderError('Map image could not be loaded. Confirm the Blob URL is publicly readable.')}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: activeMap.width,
                height: activeMap.height,
                maxWidth: 'none',
                maxHeight: 'none',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
            <Stage
              width={stageWidth}
              height={stageHeight}
              onClick={onStageClick}
              onMouseMove={onStagePointerMove}
              onMouseLeave={() => setPointerPosition(null)}
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
                  stroke="#f5a623"
                  strokeWidth={3}
                  listening={false}
                />
              ))}

              {(activeState?.darknessZones ?? []).map((zone) => (
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
                const colorName = inferShapeColorId(shape)
                const stroke = shape.color || shapeStrokeFromColorId(colorName)
                const fill = shape.fill || shapeFillFromColorId(colorName)

                if (shape.kind === 'annotation' && shape.shapeType === 'circle') {
                  const { center, radius } = getCircleGeometry(shape)
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
                        const payload = moveShapePayload(shape, dx, dy)
                        if (!payload) return
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
                    points={flattenPoints(shape.points)}
                    closed={shape.closed !== false}
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
                      const payload = moveShapePayload(shape, dx, dy)
                      if (!payload) return
                      callMutation('updateShape', { id: shape.id, ...payload }).catch((err) => {
                        setError(err.message)
                      })
                    }}
                  />
                )
              })}

              {selectedShape && selectedShapeHandle && selectedShape.kind === 'annotation' && (
                <Circle
                  key={`${selectedShape.id}:handle:scale`}
                  x={selectedShapeHandle.x}
                  y={selectedShapeHandle.y}
                  radius={6}
                  fill="#f5f5f5"
                  stroke="#111"
                  strokeWidth={1}
                  draggable
                  onDragEnd={(event) => {
                    const nextPoint = event.target.position()
                    const payload = scaleShapePayload(selectedShape, nextPoint)
                    if (!payload) return
                    callMutation('updateShape', {
                      id: selectedShape.id,
                      ...payload,
                    }).catch((err) => {
                      setError(err.message)
                    })
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

              {measurePoints.length > 1 && (
                <Line points={flattenPoints(measurePoints)} stroke="#4ecdc4" strokeWidth={2} dash={[6, 4]} />
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
            </Layer>

            <Layer>
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
                    setTokenDraft({
                      name: token.name,
                      size: token.size,
                      ringColor: token.ringColor,
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

              {visiblePings.map((ping) => (
                <Circle
                  key={ping.id}
                  x={ping.x}
                  y={ping.y}
                  radius={ping.radius}
                  stroke="#ff4f72"
                  strokeWidth={ping.strokeWidth}
                  opacity={ping.opacity}
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
            </Stage>
          </div>
        )}

        <div style={{ marginTop: '0.55rem', display: 'flex', justifyContent: 'space-between', color: '#777', fontSize: '0.78rem' }}>
          <span>Map: {activeMap?.name ?? 'none'}</span>
          <span>
            Scale: {feetPerPx ? `${formatFeet(feetPerPx * 100)} ft / 100px` : 'not calibrated'}
            {measurementFeet ? ` | Measure: ${formatFeet(measurementFeet)} ft` : ''}
          </span>
        </div>
      </section>
    </main>
  )
}

function buttonStyle(bg, borderColor) {
  return {
    background: bg,
    border: `1px solid ${borderColor}`,
    color: '#ddd',
    borderRadius: '6px',
    padding: '0.45rem 0.65rem',
    fontSize: '0.8rem',
    cursor: 'pointer',
  }
}

function toolButtonStyle(active) {
  return {
    background: active ? '#2f4f89' : '#1a1a1a',
    border: active ? '1px solid #6fa3ff' : '1px solid #303030',
    color: active ? '#f2f7ff' : '#bbb',
    borderRadius: '6px',
    padding: '0.4rem 0.5rem',
    fontSize: '0.76rem',
    cursor: 'pointer',
    width: '100%',
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

const rowButtonStyle = {
  display: 'flex',
  gap: '0.4rem',
}

const toolGridStyle = {
  display: 'grid',
  gap: '0.35rem',
}

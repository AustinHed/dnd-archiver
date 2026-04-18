'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  computePathDistanceFeet,
  computeVisibilityGrid,
  distancePx,
  feetPerPixelFromCalibration,
} from '@/lib/vttGeometry.mjs'

const Stage = dynamic(() => import('react-konva').then((mod) => mod.Stage), { ssr: false })
const Layer = dynamic(() => import('react-konva').then((mod) => mod.Layer), { ssr: false })
const Rect = dynamic(() => import('react-konva').then((mod) => mod.Rect), { ssr: false })
const Line = dynamic(() => import('react-konva').then((mod) => mod.Line), { ssr: false })
const Circle = dynamic(() => import('react-konva').then((mod) => mod.Circle), { ssr: false })
const Text = dynamic(() => import('react-konva').then((mod) => mod.Text), { ssr: false })
const KImage = dynamic(() => import('react-konva').then((mod) => mod.Image), { ssr: false })

const TOOL_OPTIONS = [
  { id: 'move', label: 'Move Token' },
  { id: 'path', label: 'Path Move' },
  { id: 'wall', label: 'Draw Walls' },
  { id: 'darkness', label: 'Draw Darkness' },
  { id: 'barrier', label: 'Draw Barrier' },
  { id: 'shape', label: 'Shape Tool' },
  { id: 'measure', label: 'Measure' },
  { id: 'ping', label: 'Ping' },
  { id: 'calibrate', label: 'Calibrate' },
  { id: 'token', label: 'Add Token' },
]

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

function useMapImage(url) {
  const [image, setImage] = useState(null)
  const [imageError, setImageError] = useState('')

  useEffect(() => {
    let cancelled = false

    if (!url) {
      setImage(null)
      setImageError('')
      return
    }

    const tryLoad = (attempt) => {
      const img = new window.Image()
      img.decoding = 'async'
      if (attempt > 0) {
        // Secondary attempt keeps CORS mode for hosts that require it.
        img.crossOrigin = 'anonymous'
      }

      img.onload = () => {
        if (cancelled) return
        setImage(img)
        setImageError('')
      }

      img.onerror = () => {
        if (cancelled) return
        if (attempt === 0) {
          const separator = url.includes('?') ? '&' : '?'
          tryLoad(1, `${url}${separator}retry=${Date.now()}`)
          return
        }
        setImage(null)
        setImageError('Map image could not be loaded. Check Blob access/store settings.')
      }

      img.src = attempt > 0
        ? `${url}${url.includes('?') ? '&' : '?'}retry=${Date.now()}`
        : url
    }

    tryLoad(0)

    return () => {
      cancelled = true
    }
  }, [url])

  return { image, imageError }
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
  const [selectedShapeId, setSelectedShapeId] = useState('')
  const [selectedTokenId, setSelectedTokenId] = useState('')
  const [tokenDraft, setTokenDraft] = useState({ name: 'Token', size: 'medium', ringColor: 'clear' })
  const [character, setCharacter] = useState({ moveSpeed: 30, darkvision: false })
  const [viewMode, setViewMode] = useState('player')
  const [clientId, setClientId] = useState('')

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
  const { image: mapImage, imageError } = useMapImage(activeMap?.assetUrl)

  const feetPerPx = useMemo(() => feetPerPixelFromCalibration(activeMap?.calibration), [activeMap?.calibration])

  const selectedToken = useMemo(
    () => activeState?.tokens?.find((token) => token.id === selectedTokenId) ?? null,
    [activeState?.tokens, selectedTokenId],
  )

  const selectedShape = useMemo(
    () => activeState?.shapes?.find((shape) => shape.id === selectedShapeId) ?? null,
    [activeState?.shapes, selectedShapeId],
  )

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

  const finalizeDraft = useCallback(async () => {
    if (!draftPoints.length) return

    try {
      if (tool === 'wall') {
        await callMutation('addWall', { points: draftPoints })
      } else if (tool === 'darkness') {
        await callMutation('addDarknessZone', {
          points: draftPoints,
          closed: true,
          kind: 'darkness',
        })
      } else if (tool === 'barrier') {
        await callMutation('addShape', {
          points: draftPoints,
          closed: true,
          kind: 'barrier',
          color: '#f5a623',
          fill: 'rgba(245,166,35,0.2)',
        })
      }

      setDraftPoints([])
    } catch (err) {
      setError(err.message)
    }
  }, [callMutation, draftPoints, tool])

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

  const onStageClick = useCallback(async (event) => {
    if (!activeMap || !bundle?.live?.active) return
    const pointer = event.target.getStage()?.getPointerPosition()
    if (!pointer) return

    if (tool === 'wall' || tool === 'darkness' || tool === 'barrier') {
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
      if (!selectedShapeId) {
        try {
          await callMutation('addShape', {
            points: buildRectanglePoints(pointer.x, pointer.y),
            closed: true,
            kind: 'annotation',
            color: '#4ecdc4',
            fill: 'rgba(78,205,196,0.22)',
          })
        } catch (err) {
          setError(err.message)
        }
      }
    }
  }, [activeMap, bundle?.live?.active, callMutation, placeToken, selectedShapeId, selectedToken, tool])

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

  const addRectangleShape = useCallback(async () => {
    if (!activeMap) return

    try {
      await callMutation('addShape', {
        points: buildRectanglePoints(activeMap.width / 2, activeMap.height / 2),
        closed: true,
        kind: 'annotation',
        color: '#4ecdc4',
        fill: 'rgba(78,205,196,0.22)',
      })
    } catch (err) {
      setError(err.message)
    }
  }, [activeMap, callMutation])

  const updateShapeKind = useCallback(async (shapeId, kind) => {
    try {
      let color = '#4ecdc4'
      let fill = 'rgba(78,205,196,0.22)'
      if (kind === 'darkness') {
        color = '#222'
        fill = 'rgba(20,20,20,0.45)'
      }
      if (kind === 'barrier') {
        color = '#f5a623'
        fill = 'rgba(245,166,35,0.22)'
      }

      await callMutation('updateShape', { id: shapeId, kind, color, fill })
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

  const toggleFog = useCallback(async () => {
    if (!activeState) return
    try {
      await callMutation('setFogEnabled', { enabled: !activeState.fog?.enabled })
    } catch (err) {
      setError(err.message)
    }
  }, [activeState, callMutation])

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
          ? (viewMode === 'dm' ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.5)')
          : (viewMode === 'dm' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.9)')

        rects.push({
          x: col * visibility.gridSize,
          y: row * visibility.gridSize,
          width: visibility.gridSize,
          height: visibility.gridSize,
          fill,
        })
      }
    }

    return rects
  }, [activeState?.fog, viewMode, visibility])

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

        {error && (
          <div style={{ marginBottom: '0.8rem', color: '#ff8b8b', background: '#2b1414', border: '1px solid #5a2323', borderRadius: '6px', padding: '0.45rem 0.6rem', fontSize: '0.8rem' }}>
            {error}
          </div>
        )}
        {!error && imageError && (
          <div style={{ marginBottom: '0.8rem', color: '#ffb6b6', background: '#2b1414', border: '1px solid #5a2323', borderRadius: '6px', padding: '0.45rem 0.6rem', fontSize: '0.8rem' }}>
            {imageError}
          </div>
        )}

        <section style={{ marginBottom: '1rem' }}>
          <select
            value={startMapId}
            onChange={(event) => setStartMapId(event.target.value)}
            style={{ ...inputStyle, marginBottom: '0.55rem' }}
          >
            <option value="">Select map</option>
            {(bundle?.maps ?? []).map((map) => (
              <option key={map.id} value={map.id}>
                {map.name} ({map.id.slice(0, 6)})
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.6rem' }}>
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
          <p style={{ margin: 0, color: sessionActive ? '#89d089' : '#a88', fontSize: '0.8rem' }}>
            {sessionActive ? 'Session is live for everyone on this page.' : 'Session is currently inactive.'}
          </p>
        </section>

        <section style={{ marginBottom: '1rem' }}>
          <h3 style={sectionTitleStyle}>Map Upload (PDF)</h3>
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
        </section>

        <section style={{ marginBottom: '1rem' }}>
          <h3 style={sectionTitleStyle}>Map Link To Archived Session</h3>
          <select value={linkResultId} onChange={(event) => setLinkResultId(event.target.value)} style={inputStyle}>
            <option value="">Select session result</option>
            {results.map((result) => (
              <option key={result.id} value={result.id}>{result.fileName} ({new Date(result.createdAt).toLocaleDateString()})</option>
            ))}
          </select>
          <button onClick={linkMap} disabled={!linkResultId || !activeMap} style={{ ...buttonStyle('#1f2736', '#3d5f95'), marginTop: '0.5rem', width: '100%' }}>
            Link Active Map
          </button>
        </section>

        <section style={{ marginBottom: '1rem' }}>
          <h3 style={sectionTitleStyle}>Tool</h3>
          <select value={tool} onChange={(event) => setTool(event.target.value)} style={inputStyle}>
            {TOOL_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          {(tool === 'wall' || tool === 'darkness' || tool === 'barrier') && (
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
              <button onClick={finalizeDraft} style={buttonStyle('#233622', '#3d8b3a')}>Commit Draft</button>
              <button onClick={() => setDraftPoints([])} style={buttonStyle('#2b2b2b', '#4b4b4b')}>Clear</button>
            </div>
          )}
          {tool === 'calibrate' && (
            <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.4rem' }}>
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
        </section>

        <section style={{ marginBottom: '1rem' }}>
          <h3 style={sectionTitleStyle}>Fog + Vision</h3>
          <button onClick={toggleFog} disabled={!activeMap} style={{ ...buttonStyle('#1f2736', '#3d5f95'), width: '100%' }}>
            {activeState?.fog?.enabled ? 'Disable Fog of War' : 'Enable Fog of War'}
          </button>
          <label style={{ marginTop: '0.5rem', display: 'block', fontSize: '0.8rem', color: '#aaa' }}>
            View mode
            <select value={viewMode} onChange={(event) => setViewMode(event.target.value)} style={{ ...inputStyle, marginTop: '0.2rem' }}>
              <option value="player">Player</option>
              <option value="dm">Dungeon Master</option>
            </select>
          </label>
        </section>

        <section style={{ marginBottom: '1rem' }}>
          <h3 style={sectionTitleStyle}>Character</h3>
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
            Has darkvision
          </label>
          <button onClick={saveCharacter} disabled={!activeMap} style={{ ...buttonStyle('#1f2736', '#3d5f95'), width: '100%' }}>
            Save Character Settings
          </button>
        </section>

        <section style={{ marginBottom: '1rem' }}>
          <h3 style={sectionTitleStyle}>Tokens</h3>
          <select value={selectedTokenId} onChange={(event) => setSelectedTokenId(event.target.value)} style={inputStyle}>
            <option value="">Select token</option>
            {(activeState?.tokens ?? []).map((token) => (
              <option key={token.id} value={token.id}>{token.name}</option>
            ))}
          </select>
          <div style={{ display: 'grid', gap: '0.35rem', marginTop: '0.5rem' }}>
            <input
              type="text"
              value={tokenDraft.name}
              onChange={(event) => setTokenDraft((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Token name"
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
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
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
        </section>

        <section>
          <h3 style={sectionTitleStyle}>Shapes</h3>
          <button onClick={addRectangleShape} disabled={!activeMap} style={{ ...buttonStyle('#1f2736', '#3d5f95'), width: '100%', marginBottom: '0.4rem' }}>
            Add Rectangle
          </button>
          <select value={selectedShapeId} onChange={(event) => setSelectedShapeId(event.target.value)} style={inputStyle}>
            <option value="">Select shape</option>
            {(activeState?.shapes ?? []).map((shape) => (
              <option key={shape.id} value={shape.id}>{shape.kind} ({shape.id.slice(0, 6)})</option>
            ))}
          </select>
          {selectedShape && (
            <>
              <select
                value={selectedShape.kind}
                onChange={(event) => updateShapeKind(selectedShape.id, event.target.value)}
                style={{ ...inputStyle, marginTop: '0.4rem' }}
              >
                <option value="annotation">Annotation</option>
                <option value="darkness">Darkness</option>
                <option value="barrier">Barrier</option>
              </select>
              <button onClick={removeShape} style={{ ...buttonStyle('#351a1a', '#7a2b2b'), width: '100%', marginTop: '0.4rem' }}>Remove Shape</button>
            </>
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
          <Stage width={stageWidth} height={stageHeight} onClick={onStageClick} style={{ border: '1px solid #222', borderRadius: '8px', background: '#0a0a0a' }}>
            <Layer>
              <Rect x={0} y={0} width={activeMap.width} height={activeMap.height} fill="#0a0a0a" />
              {mapImage && <KImage image={mapImage} x={0} y={0} width={activeMap.width} height={activeMap.height} />}
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

              {(activeState?.shapes ?? []).map((shape) => (
                <Line
                  key={shape.id}
                  points={flattenPoints(shape.points)}
                  closed={shape.closed !== false}
                  stroke={shape.color || '#4ecdc4'}
                  fill={shape.fill || 'rgba(78,205,196,0.22)'}
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

                    const nextPoints = shape.points.map((point) => ({
                      x: point.x + dx,
                      y: point.y + dy,
                    }))

                    callMutation('updateShape', { id: shape.id, points: nextPoints }).catch((err) => {
                      setError(err.message)
                    })
                  }}
                />
              ))}

              {selectedShape && selectedShape.points?.map((point, index) => (
                <Circle
                  key={`${selectedShape.id}:handle:${index}`}
                  x={point.x}
                  y={point.y}
                  radius={6}
                  fill="#f5f5f5"
                  stroke="#111"
                  strokeWidth={1}
                  draggable
                  onDragEnd={(event) => {
                    const nextPoint = event.target.position()
                    const nextPoints = selectedShape.points.map((existing, pointIndex) => (
                      pointIndex === index ? { x: nextPoint.x, y: nextPoint.y } : existing
                    ))

                    callMutation('updateShape', {
                      id: selectedShape.id,
                      points: nextPoints,
                    }).catch((err) => {
                      setError(err.message)
                    })
                  }}
                />
              ))}

              {draftPoints.length > 1 && (
                <Line
                  points={flattenPoints(draftPoints)}
                  stroke={tool === 'darkness' ? '#3a3a3a' : '#d0b36d'}
                  strokeWidth={2}
                  dash={[8, 6]}
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
            </Layer>

            <Layer>
              {(activeState?.tokens ?? []).map((token) => (
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

              {(activeState?.tokens ?? []).map((token) => (
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

              {(activeState?.pings ?? []).map((ping) => (
                <Circle
                  key={ping.id}
                  x={ping.x}
                  y={ping.y}
                  radius={12}
                  stroke="#ff4f72"
                  strokeWidth={3}
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
                />
              ))}
            </Layer>
          </Stage>
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

const sectionTitleStyle = {
  margin: '0 0 0.35rem',
  fontSize: '0.82rem',
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  color: '#b8b8b8',
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

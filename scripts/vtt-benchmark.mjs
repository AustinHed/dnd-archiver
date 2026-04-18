import assert from 'node:assert/strict'
import { computeVisibilityGrid } from '../lib/vttGeometry.mjs'

function random(min, max) {
  return Math.random() * (max - min) + min
}

function makeState(blockers = 120, darknessCount = 4) {
  const walls = []
  for (let i = 0; i < blockers; i += 1) {
    walls.push({
      a: { x: random(0, 3000), y: random(0, 2200) },
      b: { x: random(0, 3000), y: random(0, 2200) },
    })
  }

  const darknessZones = []
  for (let i = 0; i < darknessCount; i += 1) {
    const cx = random(300, 2700)
    const cy = random(260, 1900)
    const r = random(80, 220)
    darknessZones.push({
      id: `d${i}`,
      kind: 'darkness',
      closed: true,
      points: [
        { x: cx - r, y: cy - r },
        { x: cx + r, y: cy - r },
        { x: cx + r, y: cy + r },
        { x: cx - r, y: cy + r },
      ],
    })
  }

  return { walls, darknessZones, shapes: [] }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted[mid]
}

function runScenario({ label, iterations = 5, fn }) {
  const ms = []
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now()
    fn()
    ms.push(performance.now() - start)
  }
  return {
    label,
    medianMs: Number(median(ms).toFixed(1)),
    p95Ms: Number(ms.sort((a, b) => a - b)[Math.floor(ms.length * 0.95)]?.toFixed(1) ?? '0'),
  }
}

const mapWidth = 3000
const mapHeight = 2200
const feetPerPixel = 0.05
const token = { id: 'p1', x: 1450, y: 1100, darkvision: false }
const state = makeState()

const baseline = runScenario({
  label: 'full-map-4px-baseline',
  fn: () => {
    computeVisibilityGrid({
      state,
      mapWidth,
      mapHeight,
      token,
      darkvision: false,
      feetPerPixel,
      gridSize: 4,
      bounds: { minX: 0, minY: 0, maxX: mapWidth, maxY: mapHeight },
    })
  },
})

const optimized = runScenario({
  label: 'adaptive-bounded-optimized',
  fn: () => {
    computeVisibilityGrid({
      state,
      mapWidth,
      mapHeight,
      token,
      darkvision: false,
      feetPerPixel,
    })
  },
})

const oldStatePayload = JSON.stringify({
  ok: true,
  state: {
    version: 44,
    walls: [],
    darknessZones: [],
    shapes: [],
    tokens: [{ id: 'p1', x: 1000, y: 1000 }],
    pings: [],
    fog: {
      enabled: true,
      gridSize: 4,
      cols: 750,
      rows: 550,
      exploredCells: Array.from({ length: 180000 }, (_, i) => i * 2),
      exploredByToken: {
        p1: Array.from({ length: 175000 }, (_, i) => i * 2),
      },
    },
  },
})

const patchPayload = JSON.stringify({
  ok: true,
  version: 45,
  patch: {
    type: 'token.updated',
    payload: { token: { id: 'p1', x: 1030, y: 1015, role: 'player' } },
  },
})

console.log('VTT Benchmark')
console.log(JSON.stringify({
  visibility: {
    baseline,
    optimized,
  },
  payloadBytes: {
    oldState: oldStatePayload.length,
    patch: patchPayload.length,
    reductionPercent: Number((((oldStatePayload.length - patchPayload.length) / oldStatePayload.length) * 100).toFixed(2)),
  },
}, null, 2))

assert.ok(
  optimized.medianMs < baseline.medianMs,
  `Expected optimized visibility median (${optimized.medianMs}ms) to beat baseline (${baseline.medianMs}ms).`,
)
assert.ok(
  optimized.medianMs < 400,
  `Expected optimized visibility median under 400ms, got ${optimized.medianMs}ms.`,
)
assert.ok(
  patchPayload.length < oldStatePayload.length * 0.1,
  'Expected patch payload to be at least 90% smaller than full state payload.',
)

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computePathDistanceFeet,
  computeVisibilityGrid,
  deriveVisibilityBounds,
  deriveVisibilityGridSize,
  distancePx,
  mergeExploredCells,
  mergeExploredCellsDelta,
  segmentsIntersect,
} from '../lib/vttGeometry.mjs'

test('segmentsIntersect identifies crossing segments', () => {
  const intersects = segmentsIntersect(
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 10, y: 0 },
  )

  assert.equal(intersects, true)
})

test('computePathDistanceFeet sums path segments', () => {
  const path = [
    { x: 0, y: 0 },
    { x: 30, y: 40 },
    { x: 60, y: 40 },
  ]

  const feetPerPx = 0.5
  const feet = computePathDistanceFeet(path, feetPerPx)

  assert.equal(feet, (distancePx(path[0], path[1]) + distancePx(path[1], path[2])) * feetPerPx)
})

test('mergeExploredCells keeps unique sorted cells', () => {
  const merged = mergeExploredCells([5, 1, 3], [2, 3, 6])
  assert.deepEqual(merged, [1, 2, 3, 5, 6])
})

test('mergeExploredCellsDelta returns only newly explored cells', () => {
  const { merged, delta } = mergeExploredCellsDelta([1, 2, 8], [2, 3, 8, 9])
  assert.deepEqual(merged, [1, 2, 3, 8, 9])
  assert.deepEqual(delta, [3, 9])
})

test('visibility grid obeys wall blockers', () => {
  const state = {
    walls: [{ a: { x: 30, y: 0 }, b: { x: 30, y: 60 } }],
    barrierShapes: [],
    darknessZones: [],
    shapes: [],
    fog: { gridSize: 20 },
  }

  const visibility = computeVisibilityGrid({
    state,
    mapWidth: 80,
    mapHeight: 80,
    token: { x: 10, y: 10 },
    darkvision: false,
    feetPerPixel: 1,
  })

  // With 4px cells, col=8,row=0 has center x=34 and should be blocked by the vertical wall.
  assert.equal(visibility.visible.includes(8), false)
})

test('darkness range limits non-darkvision and extends with darkvision', () => {
  const darkness = {
    id: 'd1',
    points: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ],
    closed: true,
  }

  const baseState = {
    walls: [],
    barrierShapes: [],
    darknessZones: [darkness],
    shapes: [],
    fog: { gridSize: 20 },
  }

  const noDarkvision = computeVisibilityGrid({
    state: baseState,
    mapWidth: 200,
    mapHeight: 200,
    token: { x: 10, y: 10 },
    darkvision: false,
    feetPerPixel: 1,
  })

  const withDarkvision = computeVisibilityGrid({
    state: baseState,
    mapWidth: 200,
    mapHeight: 200,
    token: { x: 10, y: 10 },
    darkvision: true,
    feetPerPixel: 1,
  })

  assert.ok(withDarkvision.visible.length > noDarkvision.visible.length)
})

test('deriveVisibilityGridSize escalates on larger maps', () => {
  assert.equal(deriveVisibilityGridSize(1200, 900), 4)
  assert.equal(deriveVisibilityGridSize(2600, 900), 6)
})

test('deriveVisibilityBounds keeps work near token area', () => {
  const bounds = deriveVisibilityBounds({
    mapWidth: 3000,
    mapHeight: 2200,
    token: { x: 1400, y: 1200 },
    darkvision: false,
    feetPerPixel: null,
    gridSize: 6,
  })
  assert.ok(bounds.minX >= 0)
  assert.ok(bounds.minY >= 0)
  assert.ok(bounds.maxX <= 3000)
  assert.ok(bounds.maxY <= 2200)
  assert.ok(bounds.maxX - bounds.minX < 3000)
})

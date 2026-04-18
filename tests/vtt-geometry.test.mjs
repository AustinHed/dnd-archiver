import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computePathDistanceFeet,
  computeVisibilityGrid,
  distancePx,
  mergeExploredCells,
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

  // Cell at col=2,row=0 has center x=50 which should be blocked by vertical wall.
  assert.equal(visibility.visible.includes(2), false)
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

import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultVttState } from '../lib/vttDefaults.js'
import { applyVttPatch } from '../lib/vttPatch.mjs'

test('mutation response contract applies token.updated patch', () => {
  const response = {
    ok: true,
    version: 9,
    patch: {
      type: 'token.updated',
      payload: {
        token: { id: 'p1', role: 'player', name: 'Aren', x: 88, y: 120 },
      },
    },
  }

  const state = {
    ...createDefaultVttState(),
    tokens: [{ id: 'p1', role: 'player', name: 'Aren', x: 1, y: 2 }],
  }

  const next = applyVttPatch(state, response.patch)
  assert.equal(next.tokens[0].x, 88)
  assert.equal(next.tokens[0].y, 120)
})

test('mutation response contract applies shape.updated patch', () => {
  const response = {
    ok: true,
    version: 10,
    patch: {
      type: 'shape.updated',
      payload: {
        shape: {
          id: 's1',
          kind: 'rectangle',
          shapeType: 'rectangle',
          points: [{ x: 5, y: 5 }, { x: 25, y: 5 }, { x: 25, y: 25 }, { x: 5, y: 25 }],
          closed: true,
        },
      },
    },
  }

  const state = {
    ...createDefaultVttState(),
    shapes: [{
      id: 's1',
      kind: 'rectangle',
      shapeType: 'rectangle',
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      closed: true,
    }],
  }

  const next = applyVttPatch(state, response.patch)
  assert.equal(next.shapes[0].points[0].x, 5)
})

test('mutation response contract applies fog.merged delta patch', () => {
  const response = {
    ok: true,
    version: 11,
    patch: {
      type: 'fog.merged',
      payload: {
        tokenId: 'p1',
        delta: [3, 4],
        cols: 20,
        rows: 20,
        gridSize: 4,
      },
    },
  }

  const state = {
    ...createDefaultVttState(),
    fog: {
      ...createDefaultVttState().fog,
      exploredCells: [1, 2],
      exploredByToken: { p1: [1, 2] },
    },
  }

  const next = applyVttPatch(state, response.patch)
  assert.deepEqual(next.fog.exploredCells, [1, 2, 3, 4])
  assert.deepEqual(next.fog.exploredByToken.p1, [1, 2, 3, 4])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultVttState } from '../lib/vttDefaults.js'
import { applyVttPatch } from '../lib/vttPatch.mjs'

test('applyVttPatch updates token fields from token.updated patch', () => {
  const base = {
    ...createDefaultVttState(),
    tokens: [{ id: 'p1', name: 'Aren', role: 'player', x: 10, y: 12 }],
  }
  const next = applyVttPatch(base, {
    type: 'token.updated',
    payload: { token: { id: 'p1', name: 'Aren', role: 'player', x: 100, y: 220 } },
  })
  assert.equal(next.tokens[0].x, 100)
  assert.equal(next.tokens[0].y, 220)
})

test('applyVttPatch merges fog deltas and keeps token-scoped memory', () => {
  const base = {
    ...createDefaultVttState(),
    fog: {
      ...createDefaultVttState().fog,
      exploredCells: [1, 2],
      exploredByToken: { p1: [1, 2] },
    },
  }
  const next = applyVttPatch(base, {
    type: 'fog.merged',
    payload: {
      tokenId: 'p1',
      delta: [2, 3, 4],
      cols: 10,
      rows: 10,
      gridSize: 4,
    },
  })
  assert.deepEqual(next.fog.exploredByToken.p1, [1, 2, 3, 4])
  assert.deepEqual(next.fog.exploredCells, [1, 2, 3, 4])
  assert.equal(next.fog.cols, 10)
  assert.equal(next.fog.rows, 10)
})

test('applyVttPatch replaces full state for reset patches', () => {
  const base = {
    ...createDefaultVttState(),
    tokens: [{ id: 'x', name: 'old' }],
  }
  const replacement = {
    ...createDefaultVttState(),
    tokens: [],
  }
  const next = applyVttPatch(base, {
    type: 'state.replace',
    payload: { state: replacement },
  })
  assert.deepEqual(next.tokens, [])
})

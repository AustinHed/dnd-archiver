import { computeVisibilityGrid } from '../../lib/vttGeometry.mjs'

self.onmessage = (event) => {
  try {
    const payload = event.data ?? {}
    const mode = payload.mode === 'dm' ? 'dm' : 'player'

    if (mode === 'dm') {
      const tokens = Array.isArray(payload.playerTokens) ? payload.playerTokens : []
      if (!tokens.length) {
        const visibility = computeVisibilityGrid({
          state: payload.state,
          mapWidth: payload.mapWidth,
          mapHeight: payload.mapHeight,
          token: null,
          darkvision: false,
          feetPerPixel: payload.feetPerPixel,
        })
        self.postMessage({ requestId: payload.requestId, visibility })
        return
      }

      const grids = tokens.map((token) => computeVisibilityGrid({
        state: payload.state,
        mapWidth: payload.mapWidth,
        mapHeight: payload.mapHeight,
        token,
        darkvision: Boolean(token.darkvision),
        feetPerPixel: payload.feetPerPixel,
      }))
      const base = grids[0]
      const visibleSet = new Set()
      for (const grid of grids) {
        for (const cell of grid.visible) visibleSet.add(cell)
      }

      self.postMessage({
        requestId: payload.requestId,
        visibility: {
          cols: base.cols,
          rows: base.rows,
          gridSize: base.gridSize,
          visible: Array.from(visibleSet),
        },
      })
      return
    }

    const visibility = computeVisibilityGrid({
      state: payload.state,
      mapWidth: payload.mapWidth,
      mapHeight: payload.mapHeight,
      token: payload.token,
      darkvision: Boolean(payload.darkvision),
      feetPerPixel: payload.feetPerPixel,
    })
    self.postMessage({ requestId: payload.requestId, visibility })
  } catch (err) {
    self.postMessage({
      requestId: event.data?.requestId ?? null,
      error: err?.message || 'visibility worker failed',
    })
  }
}

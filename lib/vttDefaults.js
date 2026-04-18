export const TOKEN_SIZE_FEET = {
  small: 5,
  medium: 5,
  large: 10,
}

export function createDefaultLiveSession() {
  return {
    active: false,
    startedAt: null,
    stoppedAt: null,
    activeMapId: null,
    linkedResultIds: [],
  }
}

export function createDefaultVttState() {
  return {
    version: 1,
    walls: [],
    darknessZones: [],
    barrierShapes: [],
    tokens: [],
    annotations: [],
    shapes: [],
    pings: [],
    fog: {
      enabled: false,
      gridSize: 24,
      cols: 0,
      rows: 0,
      exploredCells: [],
    },
    updatedAt: new Date().toISOString(),
  }
}

export function createDefaultCharacterProfile(clientId) {
  return {
    clientId,
    moveSpeed: 30,
    darkvision: false,
    updatedAt: new Date().toISOString(),
  }
}

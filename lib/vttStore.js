import { v4 as uuidv4 } from 'uuid'
import { getKv } from './redis'
import {
  createDefaultCharacterProfile,
  createDefaultLiveSession,
  createDefaultVttState,
} from './vttDefaults'

const LIVE_KEY = 'vtt:live'
const MAP_INDEX_KEY = 'vtt:map:index'
const RESULT_INDEX_KEY = 'result:index'

function mapKey(mapId) {
  return `vtt:map:${mapId}`
}

function stateKey(mapId) {
  return `vtt:state:${mapId}`
}

function characterKey(clientId) {
  return `vtt:character:${clientId}`
}

function mapLinksKey(mapId) {
  return `vtt:links:map:${mapId}`
}

function resultLinksKey(resultId) {
  return `vtt:links:result:${resultId}`
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

async function readJson(key, fallback = null) {
  const kv = getKv()
  const value = await kv.get(key)
  return value ?? fallback
}

async function writeJson(key, value) {
  const kv = getKv()
  await kv.set(key, value)
  return value
}

export async function getLiveSession() {
  const live = await readJson(LIVE_KEY)
  if (live) return live

  const created = createDefaultLiveSession()
  await writeJson(LIVE_KEY, created)
  return created
}

export async function saveLiveSession(nextSession) {
  return writeJson(LIVE_KEY, {
    ...nextSession,
    linkedResultIds: asArray(nextSession.linkedResultIds),
  })
}

export async function listMapIds() {
  return asArray(await readJson(MAP_INDEX_KEY, []))
}

export async function listMaps() {
  const ids = await listMapIds()
  if (!ids.length) return []

  const kv = getKv()
  const maps = await Promise.all(ids.map((id) => kv.get(mapKey(id))))
  return maps.filter(Boolean)
}

export async function getMap(mapId) {
  return readJson(mapKey(mapId))
}

export async function getOrCreateState(mapId) {
  const existing = await readJson(stateKey(mapId))
  if (existing) return existing

  const created = createDefaultVttState()
  await writeJson(stateKey(mapId), created)
  return created
}

export async function saveState(mapId, nextState) {
  return writeJson(stateKey(mapId), {
    ...createDefaultVttState(),
    ...nextState,
    version: Number(nextState.version ?? 1),
    updatedAt: new Date().toISOString(),
  })
}

export async function createMapRecord({
  name,
  assetUrl,
  width,
  height,
  sourceFileName,
  sourceType = 'pdf',
}) {
  const mapId = uuidv4()
  const now = new Date().toISOString()

  const map = {
    id: mapId,
    name: name || sourceFileName || `Map ${mapId.slice(0, 6)}`,
    assetUrl,
    width,
    height,
    sourceFileName: sourceFileName ?? null,
    sourceType,
    calibration: null,
    createdAt: now,
    updatedAt: now,
  }

  await writeJson(mapKey(mapId), map)

  const ids = await listMapIds()
  if (!ids.includes(mapId)) {
    await writeJson(MAP_INDEX_KEY, [mapId, ...ids])
  }

  await writeJson(mapLinksKey(mapId), [])
  await writeJson(stateKey(mapId), createDefaultVttState())

  return map
}

export async function updateMapRecord(mapId, updater) {
  const current = await getMap(mapId)
  if (!current) return null

  const next = {
    ...current,
    ...updater(current),
    updatedAt: new Date().toISOString(),
  }

  await writeJson(mapKey(mapId), next)
  return next
}

export async function mutateVttState(mapId, mutator) {
  const current = await getOrCreateState(mapId)
  const next = mutator({ ...current })

  const normalized = {
    ...current,
    ...next,
    version: Number(current.version ?? 1) + 1,
    updatedAt: new Date().toISOString(),
  }

  await writeJson(stateKey(mapId), normalized)
  return normalized
}

export async function getCharacterProfile(clientId) {
  const existing = await readJson(characterKey(clientId))
  if (existing) return existing

  const created = createDefaultCharacterProfile(clientId)
  await writeJson(characterKey(clientId), created)
  return created
}

export async function saveCharacterProfile(clientId, patch) {
  const current = await getCharacterProfile(clientId)
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }

  await writeJson(characterKey(clientId), next)
  return next
}

export async function addResultToIndex(resultId) {
  const ids = asArray(await readJson(RESULT_INDEX_KEY, []))
  if (ids.includes(resultId)) return ids
  const next = [resultId, ...ids]
  await writeJson(RESULT_INDEX_KEY, next)
  return next
}

export async function listResultIds() {
  const indexed = asArray(await readJson(RESULT_INDEX_KEY, []))
  if (indexed.length) return indexed

  // Fallback for older data: best-effort scan of Redis keys.
  try {
    const kv = getKv()
    const all = []
    let cursor = 0

    // Upstash scan returns [cursor, keys].
    do {
      const response = await kv.scan(cursor, { match: 'result:*', count: 200 })
      cursor = Number(response?.[0] ?? 0)
      const keys = response?.[1] ?? []
      for (const key of keys) {
        if (key.startsWith('result:')) {
          all.push(key.replace('result:', ''))
        }
      }
    } while (cursor !== 0)

    if (all.length) {
      await writeJson(RESULT_INDEX_KEY, all)
      return all
    }
  } catch (err) {
    console.warn('Unable to scan result keys, falling back to empty list.', err)
  }

  return []
}

export async function getResultById(resultId) {
  return readJson(`result:${resultId}`)
}

export async function listResults() {
  const ids = await listResultIds()
  const kv = getKv()
  const results = await Promise.all(ids.map((id) => kv.get(`result:${id}`)))

  return results
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export async function listCharacters() {
  const kv = getKv()
  const slugs = await kv.smembers('characters:index')
  if (!slugs?.length) return []

  const characters = await Promise.all(slugs.map((slug) => kv.get(`character:${slug}`)))
  return characters.filter(Boolean).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
}

export async function linkMapToResult(mapId, resultId) {
  const map = await getMap(mapId)
  const result = await getResultById(resultId)

  if (!map || !result) {
    return { ok: false, map: !!map, result: !!result }
  }

  const mapLinks = asArray(await readJson(mapLinksKey(mapId), []))
  const resultLinks = asArray(await readJson(resultLinksKey(resultId), []))

  const nextMapLinks = mapLinks.includes(resultId) ? mapLinks : [...mapLinks, resultId]
  const nextResultLinks = resultLinks.includes(mapId) ? resultLinks : [...resultLinks, mapId]

  await writeJson(mapLinksKey(mapId), nextMapLinks)
  await writeJson(resultLinksKey(resultId), nextResultLinks)

  const resultMapIds = asArray(result.mapIds)
  if (!resultMapIds.includes(mapId)) {
    await writeJson(`result:${resultId}`, { ...result, mapIds: [...resultMapIds, mapId] })
  }

  const live = await getLiveSession()
  const linkedResultIds = asArray(live.linkedResultIds)
  if (!linkedResultIds.includes(resultId)) {
    await saveLiveSession({ ...live, linkedResultIds: [...linkedResultIds, resultId] })
  }

  return {
    ok: true,
    map,
    result,
    mapLinks: nextMapLinks,
    resultLinks: nextResultLinks,
  }
}

export async function listLinkedResultIdsForMap(mapId) {
  return asArray(await readJson(mapLinksKey(mapId), []))
}

export async function listLinkedMapIdsForResult(resultId) {
  return asArray(await readJson(resultLinksKey(resultId), []))
}

export async function hydrateLiveBundle() {
  const live = await getLiveSession()
  const maps = await listMaps()

  const activeMap = live.activeMapId ? maps.find((m) => m.id === live.activeMapId) ?? null : null
  const activeState = live.activeMapId ? await getOrCreateState(live.activeMapId) : null

  const linkedResults = await Promise.all(
    asArray(live.linkedResultIds).map((resultId) => getResultById(resultId)),
  )

  return {
    live,
    maps,
    activeMap,
    activeState,
    linkedResults: linkedResults.filter(Boolean),
  }
}

import { listLinkedResultIdsForMap, listMaps } from '@/lib/vttStore'

export const runtime = 'nodejs'

export async function GET() {
  const maps = await listMaps()
  const withLinks = await Promise.all(maps.map(async (map) => ({
    ...map,
    linkedResultIds: await listLinkedResultIdsForMap(map.id),
  })))

  return Response.json({ maps: withLinks })
}

import { listLinkedMapIdsForResult, listResults } from '@/lib/vttStore'

export const runtime = 'nodejs'

export async function GET() {
  const results = await listResults()

  const withLinks = await Promise.all(results.map(async (result) => {
    const linkedMapIds = await listLinkedMapIdsForResult(result.id)
    return {
      ...result,
      mapIds: Array.from(new Set([...(result.mapIds ?? []), ...linkedMapIds])),
    }
  }))

  return Response.json(withLinks)
}

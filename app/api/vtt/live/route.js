import { getCharacterProfile, hydrateLiveBundle } from '@/lib/vttStore'

export const runtime = 'nodejs'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')

  const bundle = await hydrateLiveBundle()
  const character = clientId ? await getCharacterProfile(clientId) : null
  return Response.json({ ...bundle, character })
}

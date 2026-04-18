import { getCharacterProfile, hydrateLiveBundle } from '@/lib/vttStore'

export const runtime = 'nodejs'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  const role = searchParams.get('role') === 'dm' ? 'dm' : 'player'

  const bundle = await hydrateLiveBundle()
  const normalizedLive = {
    ...bundle.live,
    status: bundle.live?.status ?? (bundle.live?.active ? 'active' : 'closed'),
  }
  const character = clientId ? await getCharacterProfile(clientId) : null
  return Response.json({ ...bundle, live: normalizedLive, role, character })
}

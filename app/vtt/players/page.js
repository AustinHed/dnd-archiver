import VttClient from '../VttClient'

export const metadata = {
  title: 'VTT (Players) | D&D Session Archiver',
}

export default async function VttPlayersPage({ searchParams }) {
  const params = await searchParams
  const mapId = typeof params?.map === 'string' ? params.map : ''
  return <VttClient mode="player" initialMapId={mapId} />
}

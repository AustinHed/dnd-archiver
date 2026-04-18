import VttClient from '../VttClient'

export const metadata = {
  title: 'VTT (Dungeon Master) | D&D Session Archiver',
}

export default async function VttDmPage({ searchParams }) {
  const params = await searchParams
  const mapId = typeof params?.map === 'string' ? params.map : ''
  return <VttClient mode="dm" initialMapId={mapId} />
}

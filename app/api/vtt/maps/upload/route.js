import { put } from '@vercel/blob'
import { v4 as uuidv4 } from 'uuid'
import { emitVttEvent } from '@/lib/pusher'
import { createMapRecord, getLiveSession, saveLiveSession } from '@/lib/vttStore'

export const runtime = 'nodejs'

const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024

export async function POST(request) {
  const formData = await request.formData()
  const image = formData.get('image')
  const sourceType = String(formData.get('sourceType') ?? '').toLowerCase()
  const sourcePage = Number(formData.get('sourcePage') ?? 1)
  const sourcePdfSize = Number(formData.get('sourcePdfSize') ?? 0)

  if (!image || typeof image === 'string') {
    return Response.json({ error: 'Missing rendered map image.' }, { status: 400 })
  }

  if (sourceType !== 'pdf') {
    return Response.json({ error: 'Only PDF maps are supported.' }, { status: 400 })
  }

  if (sourcePage !== 1) {
    return Response.json({ error: 'Only the first PDF page can be used.' }, { status: 400 })
  }

  if (sourcePdfSize > MAX_PDF_SIZE_BYTES) {
    return Response.json({ error: 'PDF exceeds 50MB limit.' }, { status: 400 })
  }

  if (!image.type.startsWith('image/')) {
    return Response.json({ error: 'Rendered page must be an image.' }, { status: 400 })
  }

  const width = Number(formData.get('width') ?? 0)
  const height = Number(formData.get('height') ?? 0)

  if (!width || !height) {
    return Response.json({ error: 'Missing rendered map dimensions.' }, { status: 400 })
  }

  const blob = await put(`vtt-maps/${uuidv4()}.png`, image, {
    access: 'public',
    addRandomSuffix: false,
    contentType: image.type,
  })

  const map = await createMapRecord({
    name: formData.get('mapName')?.toString() || formData.get('sourceFileName')?.toString() || 'Uploaded Map',
    sourceFileName: formData.get('sourceFileName')?.toString() ?? null,
    sourceType: 'pdf',
    assetUrl: blob.url,
    width,
    height,
  })

  const live = await getLiveSession()
  await saveLiveSession({
    ...live,
    activeMapId: map.id,
    active: false,
    status: 'preparing',
  })

  await emitVttEvent('map.updated', {
    mapId: map.id,
    timestamp: new Date().toISOString(),
    version: 1,
    actorId: 'system',
    patch: { type: 'map.uploaded', map },
  })

  return Response.json({ map })
}

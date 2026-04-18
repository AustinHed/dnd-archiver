import Pusher from 'pusher'

let pusherServer = null

export function getPusherServer() {
  if (!pusherServer) {
    const appId = process.env.PUSHER_APP_ID
    const key = process.env.PUSHER_KEY
    const secret = process.env.PUSHER_SECRET
    const cluster = process.env.PUSHER_CLUSTER

    if (!appId || !key || !secret || !cluster) {
      throw new Error('Missing Pusher credentials. Set PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER.')
    }

    pusherServer = new Pusher({
      appId,
      key,
      secret,
      cluster,
      useTLS: true,
    })
  }

  return pusherServer
}

export const VTT_CHANNEL = 'vtt-live'

export async function emitVttEvent(eventName, payload) {
  try {
    await getPusherServer().trigger(VTT_CHANNEL, eventName, payload)
  } catch (err) {
    console.error('Failed to emit pusher event', err)
  }
}

import { io, type Socket } from 'socket.io-client'
import type { SimulatorConfig } from '../config.js'
import type { LiveCommandPayload } from './types.js'

/**
 * Client WS pur : connexion au namespace /ws/robots, réception des commandes
 * live. Ne connaît rien du mouvement/aboiement/saut — ça, c'est
 * LiveCommandHandler.
 */
export class SocketIoClient {
  private socket: Socket | undefined

  constructor(private readonly config: SimulatorConfig) {}

  connect(onCommand: (payload: LiveCommandPayload) => void): void {
    const { dogId, robotDogKey, backendWsUrl } = this.config

    const socket = io(`${backendWsUrl}/ws/robots`, {
      auth: { dogId, deviceKey: robotDogKey },
    })
    this.socket = socket

    socket.on('connect', () => {
      console.log(`[simulator] WS connected to ${backendWsUrl}/ws/robots`)
    })

    socket.on('connect_error', (err) => {
      console.error('[simulator] WS connect_error:', err.message)
    })

    socket.on('disconnect', () => {
      console.log('[simulator] WS disconnected')
    })

    socket.on('command', (payload: LiveCommandPayload) => {
      onCommand(payload)
    })
  }

  disconnect(): void {
    this.socket?.close()
    this.socket = undefined
  }
}

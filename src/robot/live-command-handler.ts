import type { RobotState } from '../state.js'
import type { LiveCommandPayload } from '../socketio/types.js'

const MOVE_STEP = 30
const TURN_DEGREES = 15
const GESTURE_DURATION_MS = 1500

/**
 * Traduit une commande live (mouvement/aboiement/saut) en mise à jour de
 * l'état partagé — c'est ce que la page de visualisation lit ensuite.
 */
export class LiveCommandHandler {
  constructor(private readonly state: RobotState) {}

  handle(payload: LiveCommandPayload): void {
    console.log(`[simulator] live command received: ${payload.actionCode}`)

    switch (payload.actionCode) {
      case 'MOVE_FORWARD':
        this.translate(1)
        break
      case 'MOVE_BACKWARD':
        this.translate(-1)
        break
      case 'MOVE_LEFT':
        this.state.position.heading = (this.state.position.heading - TURN_DEGREES + 360) % 360
        break
      case 'MOVE_RIGHT':
        this.state.position.heading = (this.state.position.heading + TURN_DEGREES) % 360
        break
      case 'STOP':
        break
      case 'BARK':
        this.trigger('barking')
        break
      case 'JUMP':
        this.trigger('jumping')
        break
      default:
        console.warn(`[simulator] unknown actionCode: ${payload.actionCode}`)
    }
  }

  private translate(direction: 1 | -1): void {
    const radians = (this.state.position.heading * Math.PI) / 180
    this.state.position.x += Math.cos(radians) * MOVE_STEP * direction
    this.state.position.y += Math.sin(radians) * MOVE_STEP * direction
  }

  private trigger(flag: 'barking' | 'jumping'): void {
    this.state[flag] = true
    setTimeout(() => {
      this.state[flag] = false
    }, GESTURE_DURATION_MS)
  }
}

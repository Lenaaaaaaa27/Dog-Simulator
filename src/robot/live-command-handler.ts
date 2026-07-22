import type { RobotState } from '../state.js'
import type { LiveCommandPayload } from '../socketio/types.js'

const MOVE_STEP = 30
const TURN_DEGREES = 15
const GESTURE_DURATION_MS = 1500
// Fenêtre après un avancer/reculer pendant laquelle tourner reste possible —
// façon voiture, impossible de tourner à l'arrêt. Le frontend renvoie un
// avancer/reculer toutes les MOVEMENT_TICK_MS (100ms) tant que la touche est
// tenue, donc cette fenêtre reste largement au-dessus de ce rythme sans
// pour autant laisser tourner plus d'un instant après avoir relâché.
const STEERING_GRACE_MS = 400
// Zone visible de la page de visualisation (arène 500x500, centrée) — le
// chien s'arrête aux bords au lieu d'en sortir et devenir invisible.
const ARENA_BOUND = 220

/**
 * Traduit une commande live (mouvement/aboiement/saut) en mise à jour de
 * l'état partagé — c'est ce que la page de visualisation lit ensuite.
 */
export class LiveCommandHandler {
  private lastMoveAt = 0

  constructor(private readonly state: RobotState) {}

  handle(payload: LiveCommandPayload): void {
    console.log(`[simulator] live command received: ${payload.actionCode}`)

    switch (payload.actionCode) {
      case 'MOVE_FORWARD':
        this.translate(1)
        this.lastMoveAt = Date.now()
        break
      case 'MOVE_BACKWARD':
        this.translate(-1)
        this.lastMoveAt = Date.now()
        break
      case 'MOVE_LEFT':
        this.steer(-TURN_DEGREES)
        break
      case 'MOVE_RIGHT':
        this.steer(TURN_DEGREES)
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
    const nextX = this.state.position.x + Math.cos(radians) * MOVE_STEP * direction
    const nextY = this.state.position.y + Math.sin(radians) * MOVE_STEP * direction
    this.state.position.x = clamp(nextX, -ARENA_BOUND, ARENA_BOUND)
    this.state.position.y = clamp(nextY, -ARENA_BOUND, ARENA_BOUND)
  }

  private steer(deltaDegrees: number): void {
    if (Date.now() - this.lastMoveAt > STEERING_GRACE_MS) {
      console.log('[simulator] turn ignored — robot must be moving to steer')
      return
    }
    this.state.position.heading = (this.state.position.heading + deltaDegrees + 360) % 360
  }

  private trigger(flag: 'barking' | 'jumping'): void {
    this.state[flag] = true
    setTimeout(() => {
      this.state[flag] = false
    }, GESTURE_DURATION_MS)
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

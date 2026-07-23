import type { RobotState } from '../state.js'

// Zone visible de la page de visualisation (arène 500x500, centrée) — le
// chien s'arrête aux bords au lieu d'en sortir et devenir invisible. Mêmes
// bornes que LiveCommandHandler (contrôle live), pour une cohérence visuelle.
const ARENA_BOUND = 220
// Vitesse purement visuelle (px/s à 100% de vitesse) : la simulation n'a pas
// de rapport d'échelle réel avec les cm déclarés dans les steps de mission,
// elle sert juste à faire bouger le chien de façon crédible à l'écran.
const VISUAL_SPEED_PX_PER_SEC = 200
const MOVE_TICK_MS = 100

/**
 * Traduit un step de mission (actionCode + parameters, catalogue admin en
 * base : MOVE_DISTANCE/MOVE_DURATION (avancer), MOVE_BACKWARD_DISTANCE/
 * MOVE_BACKWARD_DURATION (reculer), TURN_RIGHT_90/TURN_LEFT_90/
 * TURN_RIGHT_180/TURN_LEFT_180/TURN (virage en marche), BARK, WAIT) en mise
 * à jour visible de l'état partagé, le temps réellement déclaré par le step
 * — c'est ce que la page de visualisation lit ensuite. Indépendant de
 * LiveCommandHandler : le pilotage live réagit à des frappes de touche
 * tenues, une mission joue une commande unique avec une durée propre — les
 * deux modèles ne se recoupent pas assez pour partager du code sans les
 * coupler inutilement.
 */
export class MissionActionSimulator {
  constructor(private readonly state: RobotState) {}

  // `signal` permet à un stop_mission/emergency_stop d'interrompre l'animation
  // en cours immédiatement (durations pouvant aller jusqu'à 300s côté mission,
  // hors de question d'attendre la fin naturelle du step pour réagir).
  async run(actionCode: string, parameters: Record<string, unknown>, signal: AbortSignal): Promise<void> {
    switch (actionCode) {
      case 'MOVE_DURATION':
        await this.travel(toNumber(parameters.speed_pct, 50), toNumber(parameters.duration_sec, 1) * 1000, 0, 1, signal)
        break
      case 'MOVE_DISTANCE':
        await this.travelByDistance(toNumber(parameters.speed_pct, 50), toNumber(parameters.distance_cm, 100), 0, 1, signal)
        break
      case 'MOVE_BACKWARD_DURATION':
        await this.travel(toNumber(parameters.speed_pct, 50), toNumber(parameters.duration_sec, 1) * 1000, 0, -1, signal)
        break
      case 'MOVE_BACKWARD_DISTANCE':
        await this.travelByDistance(toNumber(parameters.speed_pct, 50), toNumber(parameters.distance_cm, 100), 0, -1, signal)
        break
      case 'TURN_RIGHT_90':
        await this.travelByDistance(toNumber(parameters.speed_pct, 50), toNumber(parameters.distance_cm, 80), 90, 1, signal)
        break
      case 'TURN_LEFT_90':
        await this.travelByDistance(toNumber(parameters.speed_pct, 50), toNumber(parameters.distance_cm, 80), -90, 1, signal)
        break
      case 'TURN_RIGHT_180':
        await this.travelByDistance(toNumber(parameters.speed_pct, 50), toNumber(parameters.distance_cm, 160), 180, 1, signal)
        break
      case 'TURN_LEFT_180':
        await this.travelByDistance(toNumber(parameters.speed_pct, 50), toNumber(parameters.distance_cm, 160), -180, 1, signal)
        break
      case 'TURN':
        await this.travelByDistance(
          toNumber(parameters.speed_pct, 50),
          toNumber(parameters.distance_cm, 100),
          toNumber(parameters.angle_deg, 90),
          1,
          signal
        )
        break
      case 'BARK':
        await this.gesture(toNumber(parameters.duration_sec, 2) * 1000, signal)
        break
      case 'WAIT':
        await sleep(toNumber(parameters.duration_sec, 5) * 1000, signal)
        break
      default:
        console.warn(`[simulator] action de mission non simulée visuellement : ${actionCode}`)
    }
  }

  /** Convertit distance (cm) + vitesse en durée, puis délègue à `travel`. */
  private async travelByDistance(
    speedPct: number,
    distanceCm: number,
    headingDeltaDeg: number,
    direction: 1 | -1,
    signal: AbortSignal
  ): Promise<void> {
    const speedPxPerSec = (VISUAL_SPEED_PX_PER_SEC * speedPct) / 100
    const durationMs = speedPxPerSec > 0 ? (distanceCm / speedPxPerSec) * 1000 : 0
    await this.travel(speedPct, durationMs, headingDeltaDeg, direction, signal)
  }

  /**
   * Déplacement générique : ligne droite (headingDeltaDeg=0, direction=1),
   * marche arrière (headingDeltaDeg=0, direction=-1) ou virage en arc
   * (headingDeltaDeg≠0, direction=1 — un virage se prend toujours en
   * avançant). Le cap tourne à chaque tick avant la translation : la somme
   * des increments vaut exactement headingDeltaDeg (angle final exact, pas
   * d'approximation) et la trajectoire dessine une vraie courbe plutôt qu'un
   * angle brusque en fin de mouvement.
   */
  private async travel(
    speedPct: number,
    durationMs: number,
    headingDeltaDeg: number,
    direction: 1 | -1,
    signal: AbortSignal
  ): Promise<void> {
    const speedPxPerSec = (VISUAL_SPEED_PX_PER_SEC * speedPct) / 100
    const ticks = Math.max(1, Math.round(durationMs / MOVE_TICK_MS))
    const headingStepDeg = headingDeltaDeg / ticks
    const distanceStepPx = speedPxPerSec * (MOVE_TICK_MS / 1000)

    for (let i = 0; i < ticks && !signal.aborted; i++) {
      this.state.position.heading = (this.state.position.heading + headingStepDeg + 360) % 360
      const radians = (this.state.position.heading * Math.PI) / 180
      this.state.position.x = clamp(
        this.state.position.x + Math.cos(radians) * distanceStepPx * direction,
        -ARENA_BOUND,
        ARENA_BOUND
      )
      this.state.position.y = clamp(
        this.state.position.y + Math.sin(radians) * distanceStepPx * direction,
        -ARENA_BOUND,
        ARENA_BOUND
      )
      await sleep(MOVE_TICK_MS, signal)
    }
  }

  private async gesture(durationMs: number, signal: AbortSignal): Promise<void> {
    this.state.barking = true
    await sleep(durationMs, signal)
    this.state.barking = false
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

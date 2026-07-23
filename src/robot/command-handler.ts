import type { RobotState } from '../state.js'
import type { RobotCommandPayload } from '../mqtt/types.js'
import type { MqttTransport } from '../mqtt/mqtt-transport.js'

const MISSION_STEP_INTERVAL_MS = 2000

export interface SessionSocketHooks {
  onSessionStart: () => void
  onSessionEnd: () => void
}

/**
 * Logique métier du robot simulé : que faire d'une commande reçue. Ne parle
 * jamais MQTT ni WebSocket directement — pour le WS, il ne fait qu'appeler les
 * hooks fournis (le socket n'est ouvert que le temps d'une session, à grande
 * échelle on ne peut pas se permettre une connexion WS permanente par robot).
 */
export class CommandHandler {
  private missionInterval: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly state: RobotState,
    private readonly transport: MqttTransport,
    private readonly sessionSocket: SessionSocketHooks
  ) {}

  handle(payload: RobotCommandPayload): void {
    console.log(`[simulator] command received: ${payload.type}`)

    switch (payload.type) {
      case 'start_session':
        this.state.inSession = true
        this.callSessionHook('onSessionStart', () => this.sessionSocket.onSessionStart())
        break
      case 'end_session':
        this.state.inSession = false
        this.callSessionHook('onSessionEnd', () => this.sessionSocket.onSessionEnd())
        break
      case 'start_mission':
        this.simulateMission(payload)
        break
      case 'stop_mission':
      case 'emergency_stop':
        this.stopMissionSimulation()
        break
    }
  }

  // Isolé de la catch générique "parse payload" de MqttTransport : sans ça, un
  // échec de connexion WS synchrone serait diagnostiqué à tort comme un payload
  // MQTT invalide.
  private callSessionHook(name: keyof SessionSocketHooks, hook: () => void): void {
    try {
      hook()
    } catch (error) {
      console.error(`[simulator] session socket hook "${name}" failed:`, error)
    }
  }

  stopMissionSimulation(): void {
    if (this.missionInterval) {
      clearInterval(this.missionInterval)
      this.missionInterval = undefined
    }
  }

  private simulateMission(payload: RobotCommandPayload): void {
    this.stopMissionSimulation()

    const steps = payload.steps ?? []
    let stepIndex = 0

    this.missionInterval = setInterval(async () => {
      if (stepIndex >= steps.length) {
        this.stopMissionSimulation()
        return
      }

      const step = steps[stepIndex]
      await this.transport.publishMissionStep(payload.missionId, step.stepId, 'COMPLETED')
      console.log(`[simulator] mission step ${step.stepId} (${step.actionCode}) → COMPLETED`)
      stepIndex++
    }, MISSION_STEP_INTERVAL_MS)
  }
}

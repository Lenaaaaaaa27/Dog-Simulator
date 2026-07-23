import type { RobotState } from '../state.js'
import type { RobotCommandPayload } from '../mqtt/types.js'
import type { MqttTransport } from '../mqtt/mqtt-transport.js'
import { MissionActionSimulator } from './mission-action-simulator.js'

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
  private missionAbort: AbortController | undefined
  private readonly actionSimulator: MissionActionSimulator

  constructor(
    private readonly state: RobotState,
    private readonly transport: MqttTransport,
    private readonly sessionSocket: SessionSocketHooks
  ) {
    this.actionSimulator = new MissionActionSimulator(state)
  }

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
        void this.simulateMission(payload)
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
    this.missionAbort?.abort()
    this.missionAbort = undefined
  }

  private async simulateMission(payload: RobotCommandPayload): Promise<void> {
    this.stopMissionSimulation()

    if (this.state.scenario.skipNextMissionAck) {
      this.state.scenario.skipNextMissionAck = false
      this.state.scenario.failNextStep = false
      console.log(
        '[simulator] scénario actif : démarrage de mission NON confirmé (le backend va timeout après 60s)'
      )
      return
    }

    // Sans cet ACK, le backend reste bloqué en PENDING et ignore tous les
    // steps qu'on publie ensuite (voir handle-robot-mission-update.use-case.ts
    // côté backend) — le run finit par timeout après 60s pour rien.
    await this.transport.publishState('IN_MISSION')
    console.log('[simulator] mission ACK envoyé : state=IN_MISSION')

    const abort = new AbortController()
    this.missionAbort = abort
    const steps = payload.steps ?? []

    for (const step of steps) {
      if (abort.signal.aborted) return

      // Traduit le step en mouvement/aboiement visible sur la page de
      // visualisation, pendant la durée réellement déclarée par la mission
      // (pas un tick fixe) — sans ça le chien ne bouge jamais à l'écran.
      await this.actionSimulator.run(step.actionCode, step.parameters, abort.signal)

      if (abort.signal.aborted) return

      if (this.state.scenario.failNextStep) {
        this.state.scenario.failNextStep = false
        await this.transport.publishMissionStep(payload.missionId, step.stepId, 'FAILED')
        console.log(`[simulator] mission step ${step.stepId} (${step.actionCode}) → FAILED (scénario)`)
        this.stopMissionSimulation()
        return
      }

      await this.transport.publishMissionStep(payload.missionId, step.stepId, 'COMPLETED')
      console.log(`[simulator] mission step ${step.stepId} (${step.actionCode}) → COMPLETED`)
    }

    this.state.scenario.failNextStep = false
    this.missionAbort = undefined
  }
}

import type { RobotState } from '../state.js'
import type { RobotCommandPayload } from '../mqtt/types.js'
import type { MqttTransport } from '../mqtt/mqtt-transport.js'

const MISSION_STEP_INTERVAL_MS = 2000

/**
 * Logique métier du robot simulé : que faire d'une commande reçue. Ne parle
 * jamais MQTT directement, seulement via les méthodes de publication du transport.
 */
export class CommandHandler {
  private missionInterval: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly state: RobotState,
    private readonly transport: MqttTransport
  ) {}

  handle(payload: RobotCommandPayload): void {
    console.log(`[simulator] command received: ${payload.type}`)

    switch (payload.type) {
      case 'start_session':
        this.state.inSession = true
        break
      case 'end_session':
        this.state.inSession = false
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

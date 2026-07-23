import mqtt, { type MqttClient } from 'mqtt'
import type { ResolvedSimulatorConfig } from '../config.js'
import type { RobotCommandPayload } from './types.js'

/**
 * Transport MQTT pur : connexion, publication, abonnement. Ne connaît rien des
 * notions de session/mission — ça, c'est la responsabilité du CommandHandler.
 */
export class MqttTransport {
  private client: MqttClient | undefined

  constructor(private readonly config: ResolvedSimulatorConfig) {}

  async connect(onCommand: (payload: RobotCommandPayload) => void): Promise<void> {
    const { dogId, mqttUrl, mqttPassword } = this.config

    this.client = await mqtt.connectAsync(mqttUrl, {
      clientId: `dog-simulator-${dogId}`,
      username: dogId,
      password: mqttPassword,
      will: {
        topic: `robot/${dogId}/connected`,
        payload: JSON.stringify({ status: 'disconnected', reason: 'lwt_timeout' }),
        qos: 1,
        retain: true,
      },
    })

    console.log(`[simulator] connected to ${mqttUrl} as dog ${dogId}`)

    await this.client.publishAsync(
      `robot/${dogId}/connected`,
      JSON.stringify({ status: 'connected' }),
      { qos: 1, retain: true }
    )
    await this.client.subscribeAsync(`robot/${dogId}/command`)

    this.client.on('message', (topic, message) => {
      if (topic !== `robot/${dogId}/command`) return

      try {
        const payload = JSON.parse(message.toString()) as RobotCommandPayload
        onCommand(payload)
      } catch (error) {
        console.error('[simulator] failed to parse command payload', error)
      }
    })
  }

  async publishTelemetry(battery: number): Promise<void> {
    if (!this.client) return

    await this.client.publishAsync(
      `robot/${this.config.dogId}/telemetry`,
      JSON.stringify({ battery }),
      { qos: 0 }
    )
  }

  async publishMissionStep(
    missionId: string | undefined,
    stepId: string,
    status: string
  ): Promise<void> {
    if (!this.client) return

    await this.client.publishAsync(
      `robot/${this.config.dogId}/mission/step`,
      JSON.stringify({ missionId, stepId, status }),
      { qos: 1 }
    )
  }

  async publishState(state: string): Promise<void> {
    if (!this.client) return

    await this.client.publishAsync(`robot/${this.config.dogId}/state`, JSON.stringify({ state }), {
      qos: 1,
    })
  }

  async publishReboot(): Promise<void> {
    if (!this.client) return

    await this.client.publishAsync(
      `robot/${this.config.dogId}/system`,
      JSON.stringify({
        firmwareVersion: '1.4.2',
        bootReason: 'watchdog_reset',
        uptimeBeforeRebootSec: 3600,
      }),
      { qos: 1 }
    )
  }

  async publishError(): Promise<void> {
    if (!this.client) return

    await this.client.publishAsync(
      `robot/${this.config.dogId}/error`,
      JSON.stringify({
        code: 'MOTOR_STALL',
        component: 'locomotion',
        message: 'Moteur bloqué, arrêt de sécurité déclenché',
        severity: 'critical',
      }),
      { qos: 1 }
    )
  }

  async disconnect(): Promise<void> {
    if (!this.client) return

    await this.client.publishAsync(
      `robot/${this.config.dogId}/connected`,
      JSON.stringify({ status: 'disconnected', reason: 'clean' }),
      { qos: 1, retain: true }
    )
    await this.client.endAsync()
    this.client = undefined
  }
}

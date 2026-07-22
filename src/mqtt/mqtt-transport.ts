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
        payload: 'offline',
        qos: 1,
        retain: true,
      },
    })

    console.log(`[simulator] connected to ${mqttUrl} as dog ${dogId}`)

    await this.client.publishAsync(`robot/${dogId}/connected`, 'online', { qos: 1, retain: true })
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

  async disconnect(): Promise<void> {
    if (!this.client) return

    await this.client.publishAsync(`robot/${this.config.dogId}/connected`, 'offline', {
      qos: 1,
      retain: true,
    })
    await this.client.endAsync()
    this.client = undefined
  }
}

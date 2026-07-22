export interface SimulatorConfig {
  dogId: string
  mqttUrl: string
  mqttPassword?: string
}

export function loadConfig(): SimulatorConfig {
  const dogId = process.env.DOG_ID
  if (!dogId) {
    throw new Error('DOG_ID env var is required (see .env.example)')
  }

  return {
    dogId,
    mqttUrl: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
    mqttPassword: process.env.MQTT_PASSWORD,
  }
}

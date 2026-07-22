export interface SimulatorConfig {
  dogId: string
  mqttUrl: string
  mqttPassword?: string
  backendWsUrl: string
  robotDogKey?: string
  visualizationPort: number
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
    backendWsUrl: process.env.BACKEND_WS_URL ?? 'http://localhost:3333',
    robotDogKey: process.env.ROBOT_DOG_KEY,
    visualizationPort: Number(process.env.VISUALIZATION_PORT ?? 4000),
  }
}

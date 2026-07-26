export interface SimulatorConfig {
  serialNumber: string
  mqttUrl: string
  mqttPassword?: string
  mqttCaPath?: string
  backendUrl: string
  robotDogKey?: string
  visualizationPort: number
  firmwareVersion: string
}

/** Config une fois le numéro de série résolu en id auprès du backend. */
export interface ResolvedSimulatorConfig extends SimulatorConfig {
  dogId: string
}

export function loadConfig(): SimulatorConfig {
  const serialNumber = process.env.SERIAL_NUMBER
  if (!serialNumber) {
    throw new Error('SERIAL_NUMBER env var is required (see .env.example)')
  }

  return {
    serialNumber,
    mqttUrl: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
    mqttPassword: process.env.MQTT_PASSWORD,
    mqttCaPath: process.env.MQTT_CA_PATH,
    backendUrl: (process.env.BACKEND_URL ?? 'http://localhost:3333').replace(/\/+$/, ''),
    robotDogKey: process.env.ROBOT_DOG_KEY,
    visualizationPort: Number(process.env.VISUALIZATION_PORT ?? 4000),
    firmwareVersion: process.env.FIRMWARE_VERSION ?? '1.0.0',
  }
}

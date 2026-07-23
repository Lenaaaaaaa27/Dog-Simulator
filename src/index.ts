import 'dotenv/config'
import { loadConfig, type ResolvedSimulatorConfig } from './config.js'
import { resolveDogId } from './resolve-dog-id.js'
import { state } from './state.js'
import { MqttTransport } from './mqtt/mqtt-transport.js'
import { CommandHandler } from './robot/command-handler.js'
import { SocketIoClient } from './socketio/socketio-client.js'
import { LiveCommandHandler } from './robot/live-command-handler.js'
import { startWebServer } from './web-server.js'

const TELEMETRY_INTERVAL_MS = 3000

async function main(): Promise<void> {
  const baseConfig = loadConfig()
  const dogId = await resolveDogId(baseConfig.backendUrl, baseConfig.serialNumber)
  console.log(`[simulator] numéro de série ${baseConfig.serialNumber} -> dogId ${dogId}`)

  const config: ResolvedSimulatorConfig = { ...baseConfig, dogId }
  const transport = new MqttTransport(config)

  const liveCommandHandler = new LiveCommandHandler(state)
  const socketIoClient = new SocketIoClient(config)

  const commandHandler = new CommandHandler(state, transport, {
    // Le WS n'est ouvert que le temps d'une session : à grande échelle, des
    // dizaines de milliers de robots connectés en permanence pour rien n'a
    // aucun sens alors que le reste (télémétrie, missions) passe déjà par MQTT.
    onSessionStart: () => socketIoClient.connect((payload) => liveCommandHandler.handle(payload)),
    onSessionEnd: () => socketIoClient.disconnect(),
  })

  await transport.connect((payload) => commandHandler.handle(payload))
  state.connected = true

  const telemetryInterval = setInterval(async () => {
    if (!state.online) return
    state.battery = Math.max(0, state.battery - 1)
    await transport.publishTelemetry(state.battery)
  }, TELEMETRY_INTERVAL_MS)

  startWebServer(state, config.visualizationPort)

  process.on('SIGINT', async () => {
    console.log('\n[simulator] shutting down...')
    clearInterval(telemetryInterval)
    commandHandler.stopMissionSimulation()
    socketIoClient.disconnect()
    await transport.disconnect()
    state.connected = false
    process.exit(0)
  })
}

main().catch((error) => {
  console.error('[simulator] fatal error', error)
  process.exit(1)
})

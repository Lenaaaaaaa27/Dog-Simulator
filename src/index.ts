import 'dotenv/config'
import { loadConfig } from './config.js'
import { state } from './state.js'
import { MqttTransport } from './mqtt/mqtt-transport.js'
import { CommandHandler } from './robot/command-handler.js'

const TELEMETRY_INTERVAL_MS = 3000

async function main(): Promise<void> {
  const config = loadConfig()
  const transport = new MqttTransport(config)
  const commandHandler = new CommandHandler(state, transport)

  await transport.connect((payload) => commandHandler.handle(payload))
  state.connected = true

  const telemetryInterval = setInterval(async () => {
    state.battery = Math.max(0, state.battery - 1)
    await transport.publishTelemetry(state.battery)
  }, TELEMETRY_INTERVAL_MS)

  process.on('SIGINT', async () => {
    console.log('\n[simulator] shutting down...')
    clearInterval(telemetryInterval)
    commandHandler.stopMissionSimulation()
    await transport.disconnect()
    state.connected = false
    process.exit(0)
  })
}

main().catch((error) => {
  console.error('[simulator] fatal error', error)
  process.exit(1)
})

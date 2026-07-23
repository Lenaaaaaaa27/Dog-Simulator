import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { RobotState } from './state.js'
import type { MqttTransport } from './mqtt/mqtt-transport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const INDEX_HTML_PATH = join(__dirname, '..', 'public', 'index.html')
const MAX_BATTERY = 100

export function startWebServer(state: RobotState, transport: MqttTransport, port: number): void {
  const html = readFileSync(INDEX_HTML_PATH, 'utf-8')

  const server = createServer((req, res) => {
    if (req.url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(state))
      return
    }

    if (req.url === '/recharge' && req.method === 'POST') {
      state.battery = MAX_BATTERY
      console.log('[simulator] batterie rechargée à 100% — sera publiée au prochain envoi de télémétrie')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ battery: state.battery }))
      return
    }

    if (req.url === '/scenario/drain-battery' && req.method === 'POST') {
      state.battery = 5
      console.log('[simulator] scénario : batterie vidée à 5%')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ battery: state.battery }))
      return
    }

    if (req.url === '/scenario/skip-next-mission-ack' && req.method === 'POST') {
      state.scenario.skipNextMissionAck = true
      console.log('[simulator] scénario armé : le prochain démarrage de mission ne sera pas confirmé')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ skipNextMissionAck: true }))
      return
    }

    if (req.url === '/scenario/fail-next-step' && req.method === 'POST') {
      state.scenario.failNextStep = true
      console.log('[simulator] scénario armé : le step en cours de simulation échouera')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ failNextStep: true }))
      return
    }

    if (req.url === '/scenario/toggle-online' && req.method === 'POST') {
      state.online = !state.online
      console.log(`[simulator] scénario : télémétrie ${state.online ? 'reprise' : 'coupée'}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ online: state.online }))
      return
    }

    if (req.url === '/scenario/reboot' && req.method === 'POST') {
      void transport.publishReboot('watchdog_reset', 3600)
      console.log('[simulator] scénario : reboot simulé (watchdog_reset)')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (req.url === '/scenario/error' && req.method === 'POST') {
      void transport.publishError()
      console.log('[simulator] scénario : erreur robot simulée (MOTOR_STALL)')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (req.url === '/scenario/phantom-mission' && req.method === 'POST') {
      void transport.publishState('IN_MISSION')
      console.log('[simulator] scénario : state=IN_MISSION publié sans mission en cours (mission fantôme)')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  })

  server.listen(port, () => {
    console.log(`[simulator] visualisation disponible sur http://localhost:${port}`)
  })
}

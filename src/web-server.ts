import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { RobotState } from './state.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const INDEX_HTML_PATH = join(__dirname, '..', 'public', 'index.html')
const MAX_BATTERY = 100

export function startWebServer(state: RobotState, port: number): void {
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

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  })

  server.listen(port, () => {
    console.log(`[simulator] visualisation disponible sur http://localhost:${port}`)
  })
}

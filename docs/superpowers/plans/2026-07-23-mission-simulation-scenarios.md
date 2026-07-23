# Simulation complète des missions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire fonctionner correctement les missions dans le simulateur (le robot confirme le démarrage, exécute les steps, peut échouer), et ajouter un panneau de contrôle web pour déclencher en direct les scénarios de démo (succès, échec, timeout, offline, batterie, reboot, erreur, mission fantôme).

**Architecture:** Extension de l'infrastructure existante — `MqttTransport` gagne de nouvelles méthodes de publication, `CommandHandler` orchestre les scénarios via un nouvel objet `state.scenario`, et le serveur de debug déjà en place (`web-server.ts` + `public/index.html`) gagne des endpoints/boutons.

**Tech Stack:** Node.js/TypeScript (`tsx`), MQTT (`mqtt` package), HTTP natif Node (`node:http`), pas de framework de test.

## Global Constraints

- Pas de tests automatisés sur ce projet (décision utilisateur explicite) — chaque tâche se termine par une vérification manuelle (lancer le simulateur, déclencher l'action, observer le résultat côté backend).
- Le serial number du robot simulé seedé en base est `SN-SIMULATOR-NOVA` (nom "Nova") — utilisé dans les requêtes de vérification.
- `npm run dev` (déjà lancé en tâche de fond typiquement, `tsx watch`) recharge automatiquement le process à chaque sauvegarde de fichier — pas besoin de relancer manuellement entre les tâches.
- `npm run typecheck` (`tsc --noEmit`) doit rester propre après chaque tâche.
- Base de données de vérification : `psql -h 127.0.0.1 -p 5432 -U robot -d robot_dog` (mot de passe `robot_password`, via `PGPASSWORD=robot_password`).

---

### Task 1: Champs d'état + scénario "vider la batterie"

**Files:**
- Modify: `src/state.ts`
- Modify: `src/web-server.ts`
- Modify: `public/index.html`

**Interfaces:**
- Produces: `RobotState.online: boolean` (par défaut `true`), `RobotState.scenario: { skipNextMissionAck: boolean; failNextStep: boolean }` (tous `false` par défaut) — consommés par les tâches suivantes.

- [ ] **Step 1: Ajouter les nouveaux champs à `RobotState`**

Remplacer le contenu de `src/state.ts` par :

```ts
export interface RobotPosition {
  x: number
  y: number
  heading: number
}

export interface RobotScenarioFlags {
  skipNextMissionAck: boolean
  failNextStep: boolean
}

export interface RobotState {
  position: RobotPosition
  battery: number
  connected: boolean
  inSession: boolean
  barking: boolean
  jumping: boolean
  online: boolean
  scenario: RobotScenarioFlags
}

export const state: RobotState = {
  position: { x: 0, y: 0, heading: 0 },
  battery: 100,
  connected: false,
  inSession: false,
  barking: false,
  jumping: false,
  online: true,
  scenario: {
    skipNextMissionAck: false,
    failNextStep: false,
  },
}
```

- [ ] **Step 2: Ajouter l'endpoint de debug "vider la batterie"**

Dans `src/web-server.ts`, ajouter un bloc juste après celui de `/recharge` (avant le `res.writeHead(200, { 'Content-Type': 'text/html...' })` final) :

```ts
    if (req.url === '/scenario/drain-battery' && req.method === 'POST') {
      state.battery = 5
      console.log('[simulator] scénario : batterie vidée à 5%')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ battery: state.battery }))
      return
    }
```

- [ ] **Step 3: Ajouter le bouton correspondant**

Dans `public/index.html`, remplacer :

```html
    <button id="recharge-btn" type="button">Recharger</button>
  </div>
```

par :

```html
    <button id="recharge-btn" type="button">Recharger</button>
    <button id="drain-battery-btn" type="button">Vider la batterie</button>
  </div>
```

Puis, juste après le bloc `rechargeBtn.addEventListener(...)` existant, ajouter :

```js
    const drainBatteryBtn = document.getElementById('drain-battery-btn')

    drainBatteryBtn.addEventListener('click', async () => {
      drainBatteryBtn.disabled = true
      try {
        await fetch('/scenario/drain-battery', { method: 'POST' })
        await poll()
      } finally {
        drainBatteryBtn.disabled = false
      }
    })
```

- [ ] **Step 4: Vérifier le typecheck**

Run: `npm run typecheck`
Expected: aucune erreur.

- [ ] **Step 5: Vérification manuelle**

Ouvrir `http://localhost:4000` (ou le port de `VISUALIZATION_PORT`), cliquer sur "Vider la batterie", vérifier que l'affichage "Batterie" passe à `5%`.

- [ ] **Step 6: Commit**

```bash
git add src/state.ts src/web-server.ts public/index.html
git commit -m "feat(simulator): scénario vider la batterie + champs d'état pour les prochains scénarios"
```

---

### Task 2: Corriger le format du topic `connected` (bug bloquant)

**Files:**
- Modify: `src/mqtt/mqtt-transport.ts`

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: rien consommé par une tâche suivante — correctif isolé.

- [ ] **Step 1: Corriger `connect()`, le `will` LWT, et `disconnect()`**

Dans `src/mqtt/mqtt-transport.ts`, remplacer :

```ts
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
```

par :

```ts
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
```

Puis remplacer, dans `disconnect()` :

```ts
  async disconnect(): Promise<void> {
    if (!this.client) return

    await this.client.publishAsync(`robot/${this.config.dogId}/connected`, 'offline', {
      qos: 1,
      retain: true,
    })
    await this.client.endAsync()
    this.client = undefined
  }
```

par :

```ts
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
```

- [ ] **Step 2: Vérifier le typecheck**

Run: `npm run typecheck`
Expected: aucune erreur.

- [ ] **Step 3: Vérification manuelle**

Le simulateur tourne déjà en `tsx watch` — il redémarre automatiquement et republie sur `connected`. Vérifier dans les logs du **backend** (celui lancé via `npm run dev` dans `backend/`) qu'il n'y a plus de ligne `MqttService: invalid connectivity payload` après le redémarrage du simulateur (avant ce fix, cette erreur apparaissait à chaque connexion/déconnexion).

- [ ] **Step 4: Commit**

```bash
git add src/mqtt/mqtt-transport.ts
git commit -m "fix(simulator): publie un JSON valide sur robot/{id}/connected au lieu d'une string brute"
```

---

### Task 3: ACK de démarrage de mission (fix critique)

**Files:**
- Modify: `src/mqtt/mqtt-transport.ts`
- Modify: `src/robot/command-handler.ts`

**Interfaces:**
- Produces: `MqttTransport.publishState(state: string): Promise<void>` — utilisé par `CommandHandler` et, plus tard (Task 8), directement par un endpoint de debug.

- [ ] **Step 1: Ajouter `publishState` au transport**

Dans `src/mqtt/mqtt-transport.ts`, ajouter cette méthode juste après `publishMissionStep` :

```ts
  async publishState(state: string): Promise<void> {
    if (!this.client) return

    await this.client.publishAsync(`robot/${this.config.dogId}/state`, JSON.stringify({ state }), {
      qos: 1,
    })
  }
```

- [ ] **Step 2: Publier l'ACK au démarrage d'une mission**

Dans `src/robot/command-handler.ts`, remplacer `simulateMission` :

```ts
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
```

par :

```ts
  private simulateMission(payload: RobotCommandPayload): void {
    this.stopMissionSimulation()

    // Sans cet ACK, le backend reste bloqué en PENDING et ignore tous les
    // steps qu'on publie ensuite (voir handle-robot-mission-update.use-case.ts
    // côté backend) — le run finit par timeout après 60s pour rien.
    void this.transport.publishState('IN_MISSION')
    console.log('[simulator] mission ACK envoyé : state=IN_MISSION')

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
```

- [ ] **Step 3: Vérifier le typecheck**

Run: `npm run typecheck`
Expected: aucune erreur.

- [ ] **Step 4: Vérification manuelle (le scénario succès complet)**

Depuis le frontend (ou l'API), lancer une mission ayant au moins un step sur le robot "Nova" (`SN-SIMULATOR-NOVA`). Attendre quelques secondes (2s par step), puis vérifier en base :

```bash
PGPASSWORD=robot_password psql -h 127.0.0.1 -p 5432 -U robot -d robot_dog -c "
  SELECT mr.status, mr.started_at, mr.ended_at
  FROM mission_runs mr
  JOIN robot_dogs rd ON rd.id = mr.robot_dog_id
  WHERE rd.serial_number = 'SN-SIMULATOR-NOVA'
  ORDER BY mr.created_at DESC LIMIT 1;
"
```

Expected: `status` = `SUCCESS` (et non plus `INTERRUPTED`/`PENDING` comme avant ce fix).

- [ ] **Step 5: Commit**

```bash
git add src/mqtt/mqtt-transport.ts src/robot/command-handler.ts
git commit -m "fix(simulator): confirme le démarrage de mission (state=IN_MISSION) avant de jouer les steps"
```

---

### Task 4: Scénario "ne pas confirmer le démarrage" (timeout PENDING)

**Files:**
- Modify: `src/robot/command-handler.ts`
- Modify: `src/web-server.ts`
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `RobotState.scenario.skipNextMissionAck` (Task 1).

- [ ] **Step 1: Consommer le flag dans `simulateMission`**

Dans `src/robot/command-handler.ts`, remplacer `simulateMission` par :

```ts
  private simulateMission(payload: RobotCommandPayload): void {
    this.stopMissionSimulation()

    if (this.state.scenario.skipNextMissionAck) {
      this.state.scenario.skipNextMissionAck = false
      console.log(
        '[simulator] scénario actif : démarrage de mission NON confirmé (le backend va timeout après 60s)'
      )
      return
    }

    // Sans cet ACK, le backend reste bloqué en PENDING et ignore tous les
    // steps qu'on publie ensuite (voir handle-robot-mission-update.use-case.ts
    // côté backend) — le run finit par timeout après 60s pour rien.
    void this.transport.publishState('IN_MISSION')
    console.log('[simulator] mission ACK envoyé : state=IN_MISSION')

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
```

- [ ] **Step 2: Ajouter l'endpoint de debug**

Dans `src/web-server.ts`, ajouter (à côté du bloc `/scenario/drain-battery` de la Task 1) :

```ts
    if (req.url === '/scenario/skip-next-mission-ack' && req.method === 'POST') {
      state.scenario.skipNextMissionAck = true
      console.log('[simulator] scénario armé : le prochain démarrage de mission ne sera pas confirmé')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ skipNextMissionAck: true }))
      return
    }
```

- [ ] **Step 3: Ajouter le bouton**

Dans `public/index.html`, remplacer :

```html
    <button id="recharge-btn" type="button">Recharger</button>
    <button id="drain-battery-btn" type="button">Vider la batterie</button>
  </div>
```

par :

```html
    <button id="recharge-btn" type="button">Recharger</button>
    <button id="drain-battery-btn" type="button">Vider la batterie</button>
    <button id="skip-ack-btn" type="button">Ne pas confirmer le prochain démarrage</button>
  </div>
```

Puis ajouter, après le bloc `drainBatteryBtn.addEventListener(...)` :

```js
    const skipAckBtn = document.getElementById('skip-ack-btn')

    skipAckBtn.addEventListener('click', async () => {
      skipAckBtn.disabled = true
      try {
        await fetch('/scenario/skip-next-mission-ack', { method: 'POST' })
      } finally {
        skipAckBtn.disabled = false
      }
    })
```

- [ ] **Step 4: Vérifier le typecheck**

Run: `npm run typecheck`
Expected: aucune erreur.

- [ ] **Step 5: Vérification manuelle**

Cliquer sur "Ne pas confirmer le prochain démarrage", puis lancer une mission sur "Nova" depuis le frontend. Attendre 65 secondes, puis :

```bash
PGPASSWORD=robot_password psql -h 127.0.0.1 -p 5432 -U robot -d robot_dog -c "
  SELECT mr.status FROM mission_runs mr
  JOIN robot_dogs rd ON rd.id = mr.robot_dog_id
  WHERE rd.serial_number = 'SN-SIMULATOR-NOVA'
  ORDER BY mr.created_at DESC LIMIT 1;
"
```

Expected: `status` = `INTERRUPTED`.

- [ ] **Step 6: Commit**

```bash
git add src/robot/command-handler.ts src/web-server.ts public/index.html
git commit -m "feat(simulator): scénario ne pas confirmer le démarrage de mission (timeout PENDING)"
```

---

### Task 5: Scénario "faire échouer le step en cours"

**Files:**
- Modify: `src/robot/command-handler.ts`
- Modify: `src/web-server.ts`
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `RobotState.scenario.failNextStep` (Task 1).

- [ ] **Step 1: Consommer le flag dans la boucle de simulation**

Dans `src/robot/command-handler.ts`, remplacer le corps du `setInterval` dans `simulateMission` :

```ts
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
```

par :

```ts
    this.missionInterval = setInterval(async () => {
      if (stepIndex >= steps.length) {
        this.stopMissionSimulation()
        return
      }

      const step = steps[stepIndex]

      if (this.state.scenario.failNextStep) {
        this.state.scenario.failNextStep = false
        await this.transport.publishMissionStep(payload.missionId, step.stepId, 'FAILED')
        console.log(`[simulator] mission step ${step.stepId} (${step.actionCode}) → FAILED (scénario)`)
        this.stopMissionSimulation()
        return
      }

      await this.transport.publishMissionStep(payload.missionId, step.stepId, 'COMPLETED')
      console.log(`[simulator] mission step ${step.stepId} (${step.actionCode}) → COMPLETED`)
      stepIndex++
    }, MISSION_STEP_INTERVAL_MS)
```

- [ ] **Step 2: Ajouter l'endpoint de debug**

Dans `src/web-server.ts`, ajouter :

```ts
    if (req.url === '/scenario/fail-next-step' && req.method === 'POST') {
      state.scenario.failNextStep = true
      console.log('[simulator] scénario armé : le step en cours de simulation échouera')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ failNextStep: true }))
      return
    }
```

- [ ] **Step 3: Ajouter le bouton**

Dans `public/index.html`, remplacer :

```html
    <button id="skip-ack-btn" type="button">Ne pas confirmer le prochain démarrage</button>
  </div>
```

par :

```html
    <button id="skip-ack-btn" type="button">Ne pas confirmer le prochain démarrage</button>
    <button id="fail-step-btn" type="button">Faire échouer le step en cours</button>
  </div>
```

Puis ajouter, après le bloc `skipAckBtn.addEventListener(...)` :

```js
    const failStepBtn = document.getElementById('fail-step-btn')

    failStepBtn.addEventListener('click', async () => {
      failStepBtn.disabled = true
      try {
        await fetch('/scenario/fail-next-step', { method: 'POST' })
      } finally {
        failStepBtn.disabled = false
      }
    })
```

- [ ] **Step 4: Vérifier le typecheck**

Run: `npm run typecheck`
Expected: aucune erreur.

- [ ] **Step 5: Vérification manuelle**

Lancer une mission sur "Nova" avec au moins 2 steps. Une fois qu'elle est `RUNNING` (voir Task 3), cliquer sur "Faire échouer le step en cours" avant que le step en cours ne soit traité (toutes les 2s). Vérifier :

```bash
PGPASSWORD=robot_password psql -h 127.0.0.1 -p 5432 -U robot -d robot_dog -c "
  SELECT mr.status FROM mission_runs mr
  JOIN robot_dogs rd ON rd.id = mr.robot_dog_id
  WHERE rd.serial_number = 'SN-SIMULATOR-NOVA'
  ORDER BY mr.created_at DESC LIMIT 1;
"
```

Expected: `status` = `FAILED`.

- [ ] **Step 6: Commit**

```bash
git add src/robot/command-handler.ts src/web-server.ts public/index.html
git commit -m "feat(simulator): scénario faire échouer un step de mission"
```

---

### Task 6: Scénario "passer offline / revenir online"

**Files:**
- Modify: `src/index.ts`
- Modify: `src/web-server.ts`
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `RobotState.online` (Task 1).

- [ ] **Step 1: Gater la télémétrie sur `state.online`**

Dans `src/index.ts`, remplacer :

```ts
  const telemetryInterval = setInterval(async () => {
    state.battery = Math.max(0, state.battery - 1)
    await transport.publishTelemetry(state.battery)
  }, TELEMETRY_INTERVAL_MS)
```

par :

```ts
  const telemetryInterval = setInterval(async () => {
    if (!state.online) return
    state.battery = Math.max(0, state.battery - 1)
    await transport.publishTelemetry(state.battery)
  }, TELEMETRY_INTERVAL_MS)
```

- [ ] **Step 2: Ajouter l'endpoint de debug**

Dans `src/web-server.ts`, ajouter :

```ts
    if (req.url === '/scenario/toggle-online' && req.method === 'POST') {
      state.online = !state.online
      console.log(`[simulator] scénario : télémétrie ${state.online ? 'reprise' : 'coupée'}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ online: state.online }))
      return
    }
```

- [ ] **Step 3: Ajouter le bouton (libellé dynamique selon l'état)**

Dans `public/index.html`, remplacer :

```html
    <button id="fail-step-btn" type="button">Faire échouer le step en cours</button>
  </div>
```

par :

```html
    <button id="fail-step-btn" type="button">Faire échouer le step en cours</button>
    <button id="toggle-online-btn" type="button">Passer offline</button>
  </div>
```

Puis ajouter, après le bloc `failStepBtn.addEventListener(...)` :

```js
    const toggleOnlineBtn = document.getElementById('toggle-online-btn')

    toggleOnlineBtn.addEventListener('click', async () => {
      toggleOnlineBtn.disabled = true
      try {
        const res = await fetch('/scenario/toggle-online', { method: 'POST' })
        const { online } = await res.json()
        toggleOnlineBtn.textContent = online ? 'Passer offline' : 'Revenir online'
      } finally {
        toggleOnlineBtn.disabled = false
      }
    })
```

- [ ] **Step 4: Vérifier le typecheck**

Run: `npm run typecheck`
Expected: aucune erreur.

- [ ] **Step 5: Vérification manuelle**

Lancer une mission sur "Nova" pour qu'elle soit `RUNNING` (Task 3), puis cliquer sur "Passer offline". Vérifier dans les logs du simulateur qu'aucune ligne de télémétrie n'est plus publiée (le simulateur ne logue pas explicitement chaque télémétrie, donc vérifier plutôt côté backend : `SELECT last_heartbeat FROM robot_dogs WHERE serial_number = 'SN-SIMULATOR-NOVA';` ne doit plus avancer). Après ~90 secondes, vérifier que le run a été interrompu :

```bash
PGPASSWORD=robot_password psql -h 127.0.0.1 -p 5432 -U robot -d robot_dog -c "
  SELECT mr.status FROM mission_runs mr
  JOIN robot_dogs rd ON rd.id = mr.robot_dog_id
  WHERE rd.serial_number = 'SN-SIMULATOR-NOVA'
  ORDER BY mr.created_at DESC LIMIT 1;
"
```

Expected: `status` = `INTERRUPTED`. Cliquer ensuite sur "Revenir online" pour reprendre la télémétrie normale.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/web-server.ts public/index.html
git commit -m "feat(simulator): scénario passer offline/online (coupure de télémétrie)"
```

---

### Task 7: Scénarios "reboot" et "erreur robot"

**Files:**
- Modify: `src/mqtt/mqtt-transport.ts`
- Modify: `src/web-server.ts`
- Modify: `src/index.ts`
- Modify: `public/index.html`

**Interfaces:**
- Produces: `MqttTransport.publishReboot(): Promise<void>`, `MqttTransport.publishError(): Promise<void>`.
- Produces: `startWebServer(state: RobotState, transport: MqttTransport, port: number): void` (nouvelle signature, `transport` en plus) — la Task 8 réutilise ce paramètre.

- [ ] **Step 1: Ajouter `publishReboot` et `publishError` au transport**

Dans `src/mqtt/mqtt-transport.ts`, ajouter ces deux méthodes après `publishState` :

```ts
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
```

- [ ] **Step 2: Passer `transport` à `startWebServer`**

Dans `src/web-server.ts`, remplacer la signature et l'import :

```ts
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { RobotState } from './state.js'
```

par :

```ts
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { RobotState } from './state.js'
import type { MqttTransport } from './mqtt/mqtt-transport.js'
```

et remplacer :

```ts
export function startWebServer(state: RobotState, port: number): void {
```

par :

```ts
export function startWebServer(state: RobotState, transport: MqttTransport, port: number): void {
```

- [ ] **Step 3: Ajouter les deux endpoints de debug**

Dans `src/web-server.ts`, ajouter :

```ts
    if (req.url === '/scenario/reboot' && req.method === 'POST') {
      void transport.publishReboot()
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
```

- [ ] **Step 4: Mettre à jour l'appel dans `index.ts`**

Dans `src/index.ts`, remplacer :

```ts
  startWebServer(state, config.visualizationPort)
```

par :

```ts
  startWebServer(state, transport, config.visualizationPort)
```

- [ ] **Step 5: Ajouter les boutons**

Dans `public/index.html`, remplacer :

```html
    <button id="toggle-online-btn" type="button">Passer offline</button>
  </div>
```

par :

```html
    <button id="toggle-online-btn" type="button">Passer offline</button>
    <button id="reboot-btn" type="button">Simuler un reboot</button>
    <button id="error-btn" type="button">Simuler une erreur</button>
  </div>
```

Puis ajouter, après le bloc `toggleOnlineBtn.addEventListener(...)` :

```js
    const rebootBtn = document.getElementById('reboot-btn')
    const errorBtn = document.getElementById('error-btn')

    rebootBtn.addEventListener('click', async () => {
      rebootBtn.disabled = true
      try {
        await fetch('/scenario/reboot', { method: 'POST' })
      } finally {
        rebootBtn.disabled = false
      }
    })

    errorBtn.addEventListener('click', async () => {
      errorBtn.disabled = true
      try {
        await fetch('/scenario/error', { method: 'POST' })
      } finally {
        errorBtn.disabled = false
      }
    })
```

- [ ] **Step 6: Vérifier le typecheck**

Run: `npm run typecheck`
Expected: aucune erreur.

- [ ] **Step 7: Vérification manuelle**

Cliquer sur "Simuler un reboot" puis "Simuler une erreur", puis :

```bash
PGPASSWORD=robot_password psql -h 127.0.0.1 -p 5432 -U robot -d robot_dog -c "
  SELECT type, severity, payload FROM robot_diagnostic_events rde
  JOIN robot_dogs rd ON rd.id = rde.dog_id
  WHERE rd.serial_number = 'SN-SIMULATOR-NOVA'
  ORDER BY rde.occurred_at DESC LIMIT 2;
"
```

Expected: deux lignes, une avec les infos de reboot, une avec `MOTOR_STALL`/`critical`.

- [ ] **Step 8: Commit**

```bash
git add src/mqtt/mqtt-transport.ts src/web-server.ts src/index.ts public/index.html
git commit -m "feat(simulator): scénarios reboot et erreur robot (topics system/error)"
```

---

### Task 8: Scénario "mission fantôme"

**Files:**
- Modify: `src/web-server.ts`
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `MqttTransport.publishState` (Task 3), `transport` déjà disponible dans `startWebServer` (Task 7).

- [ ] **Step 1: Ajouter l'endpoint de debug**

Dans `src/web-server.ts`, ajouter :

```ts
    if (req.url === '/scenario/phantom-mission' && req.method === 'POST') {
      void transport.publishState('IN_MISSION')
      console.log('[simulator] scénario : state=IN_MISSION publié sans mission en cours (mission fantôme)')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
```

- [ ] **Step 2: Ajouter le bouton**

Dans `public/index.html`, remplacer :

```html
    <button id="error-btn" type="button">Simuler une erreur</button>
  </div>
```

par :

```html
    <button id="error-btn" type="button">Simuler une erreur</button>
    <button id="phantom-mission-btn" type="button">Mission fantôme</button>
  </div>
```

Puis ajouter, après le bloc `errorBtn.addEventListener(...)` :

```js
    const phantomMissionBtn = document.getElementById('phantom-mission-btn')

    phantomMissionBtn.addEventListener('click', async () => {
      phantomMissionBtn.disabled = true
      try {
        await fetch('/scenario/phantom-mission', { method: 'POST' })
      } finally {
        phantomMissionBtn.disabled = false
      }
    })
```

- [ ] **Step 3: Vérifier le typecheck**

Run: `npm run typecheck`
Expected: aucune erreur.

- [ ] **Step 4: Vérification manuelle**

S'assurer qu'aucune mission n'est en cours sur "Nova" (vérifier `mission_runs` — aucune ligne `PENDING`/`RUNNING`), puis cliquer sur "Mission fantôme". Vérifier dans les logs du **backend** une ligne provenant de `HandleRobotStateChangedUseCase` indiquant que le dog a été forcé à `IDLE` et qu'un `STOP_MISSION` correctif a été renvoyé (log contenant "mission fantôme" ou équivalent — voir le code de ce use case pour le message exact loggé). Vérifier aussi que l'état du dog reste bien `IDLE` :

```bash
PGPASSWORD=robot_password psql -h 127.0.0.1 -p 5432 -U robot -d robot_dog -c "
  SELECT state FROM robot_dogs WHERE serial_number = 'SN-SIMULATOR-NOVA';
"
```

Expected: `state` = `IDLE`.

- [ ] **Step 5: Commit**

```bash
git add src/web-server.ts public/index.html
git commit -m "feat(simulator): scénario mission fantôme (state=IN_MISSION sans run actif)"
```

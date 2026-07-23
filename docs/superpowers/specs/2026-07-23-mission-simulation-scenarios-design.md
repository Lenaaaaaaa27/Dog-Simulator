# Simulation complète des missions dans Dog-Simulator

Date : 2026-07-23

## Contexte et problème

Le simulateur de robot (`Dog-Simulator`) gère déjà correctement le pilotage live (WebSocket, D-pad/aboyer/sauter). Il ne gère en revanche pas correctement le cycle de vie des missions, ce qui empêche de tester le fonctionnement des missions et du scheduler de missions — pourtant nécessaire pour la démonstration.

**Bug critique découvert pendant l'analyse** : le simulateur ne publie jamais `state=IN_MISSION` sur le topic MQTT `robot/{dogId}/state` après avoir reçu une commande `START_MISSION`. Or c'est précisément ce message qui, côté backend (`HandleRobotStateChangedUseCase`), fait passer un `MissionRun` de `PENDING` à `RUNNING`. Tant que le run reste `PENDING`, le backend ignore silencieusement tous les messages `robot/{dogId}/mission/step` qu'il reçoit (`HandleRobotMissionUpdateUseCase` retourne `null` si `run.status === PENDING`). Résultat : **toutes les missions lancées via le simulateur actuel échouent aujourd'hui**, quel que soit ce que le simulateur "joue" localement — après 60 secondes, le backend interrompt automatiquement le run (`INTERRUPTED`, raison `TIMEOUT`).

Un second bug bloque en plus tout diagnostic de connectivité : le simulateur publie une chaîne brute (`'online'`/`'offline'`) sur `robot/{dogId}/connected`, alors que le validateur backend attend un objet JSON (`{ status, reason?, rssi? }`). Le parsing échoue côté backend et l'événement est silencieusement ignoré.

## Contrat backend ↔ robot (rappel, non modifié par ce travail)

**Un seul topic de commande** : `robot/{dogId}/command`, portant `START_MISSION` (avec `runId`, `missionId`, `steps` dénormalisés), `STOP_MISSION`, `EMERGENCY_STOP` (existe côté backend mais n'est envoyée par aucun use case actuellement — rien à faire côté simulateur au-delà de la traiter comme aujourd'hui, en alias de `STOP_MISSION`), `START_SESSION`, `END_SESSION`.

**Six topics robot → backend** :
- `robot/{id}/telemetry` — `{ battery: number }`
- `robot/{id}/mission/step` — `{ missionId, stepId, status: 'PENDING'|'COMPLETED'|'FAILED' }`
- `robot/{id}/connected` — `{ status: 'connected'|'disconnected', reason?, rssi? }` (JSON, pas une string)
- `robot/{id}/state` — `{ state: 'IDLE'|'IN_SESSION'|'IN_MISSION'|'OFFLINE'|'ERROR'|'CHARGING' }` — **confirme le démarrage de mission**
- `robot/{id}/system` — reboot (`{ firmwareVersion, bootReason, uptimeBeforeRebootSec? }`)
- `robot/{id}/error` — erreur robot (`{ code, component, message, severity, context? }`)

**Règles métier backend pertinentes** (non modifiables ici, à respecter) :
- Un step `FAILED` fait passer tout le run à `MissionRunStatus.FAILED` (pas seulement ce step).
- Timeout PENDING : 60s sans confirmation → `INTERRUPTED`/`TIMEOUT`.
- Sweep périodique (toutes les minutes) : robot silencieux >90s pendant un run `RUNNING` → `INTERRUPTED`/`ROBOT_OFFLINE`. Run actif depuis >30min → `INTERRUPTED`/`MAX_DURATION` (+ `STOP_MISSION` correctif envoyé par le backend).
- Batterie insuffisante (<10) : vérifiée uniquement **au démarrage** d'une mission (`BatteryTooLowError`), jamais en cours d'exécution.
- Aucun ACK n'est attendu après `STOP_MISSION`/`EMERGENCY_STOP` — le backend applique la transition dès l'envoi réussi de la commande.
- "Mission fantôme" : si le robot publie `state=IN_MISSION` sans qu'aucun run actif n'existe côté backend, celui-ci force le dog à `IDLE` et renvoie un `STOP_MISSION` correctif.

## Décision : pas de tests automatisés

Comme pour le précédent changement sur ce dépôt (connexion WS à la demande), l'utilisateur a choisi de ne pas ajouter de framework de test à `Dog-Simulator`. Vérification par test manuel du simulateur + observation des logs/état backend.

## Architecture retenue

On étend l'infrastructure de debug existante (`web-server.ts`, déjà utilisée pour le bouton "Recharger") plutôt que d'introduire un nouveau canal de contrôle. Chaque scénario est déclenché par un bouton sur la page de visualisation (`public/index.html`), qui appelle un nouvel endpoint POST du serveur de debug local.

### Fichiers modifiés

**`src/state.ts`** — ajoute :
```ts
online: boolean            // par défaut true ; false = la télémétrie n'est plus publiée (simule un heartbeat perdu)
scenario: {
  skipNextMissionAck: boolean   // one-shot : consommé au prochain START_MISSION reçu
  failNextStep: boolean         // one-shot : consommé au prochain step simulé
}
```

**`src/mqtt/mqtt-transport.ts`** — ajoute :
- `publishState(state: string): Promise<void>` — publie `{ state }` sur `robot/{id}/state`. Utilisé avec `'IN_MISSION'` pour l'ACK.
- `publishReboot(): Promise<void>` — publie sur `robot/{id}/system` avec des valeurs fixes plausibles : `{ firmwareVersion: '1.4.2', bootReason: 'watchdog_reset', uptimeBeforeRebootSec: 3600 }`. `bootReason` doit être une des valeurs de l'enum backend `RobotBootReason` (`power_on`, `watchdog_reset`, `crash`, `ota_update`, `manual_reset`) — `watchdog_reset` illustre bien un scénario de plantage/reboot inattendu pour la démo.
- `publishError(): Promise<void>` — publie sur `robot/{id}/error` avec des valeurs fixes plausibles : `{ code: 'MOTOR_STALL', component: 'locomotion', message: 'Moteur bloqué, arrêt de sécurité déclenché', severity: 'critical' }`. `severity` doit être une valeur de l'enum backend `RobotErrorSeverity` (`warning`, `critical`).
- **Corrige** la publication existante sur `robot/{id}/connected` (`connect()`, `disconnect()`, et le `will` LWT) pour envoyer du JSON au lieu d'une string brute : `{ status: 'connected' }` à la connexion, `{ status: 'disconnected', reason: 'clean' }` à la déconnexion volontaire (`disconnect()`), `{ status: 'disconnected', reason: 'lwt_timeout' }` pour le `will` LWT (coupure non propre). `status`/`reason` doivent correspondre aux enums backend `RobotConnectivityStatus` (`connected`, `disconnected`) et `RobotConnectivityReason` (`clean`, `lwt_timeout`, `unknown`).

**`src/robot/command-handler.ts`** — `simulateMission()` :
1. Publie l'ACK `state=IN_MISSION` immédiatement (fix critique), sauf si `state.scenario.skipNextMissionAck` est vrai — auquel cas on consomme le flag (le remet à `false`), log un message explicite, et **ne démarre pas** la boucle de simulation (puisque le backend ignorera de toute façon tout ce qui suit tant qu'il n'a pas reçu cet ACK).
2. Dans la boucle d'intervalle existante : si `state.scenario.failNextStep` est vrai au moment de traiter un step, publie ce step en `FAILED` (au lieu de `COMPLETED`), consomme le flag, et arrête la simulation (`stopMissionSimulation()`) puisque le run est désormais terminal côté backend.

**`src/index.ts`** — la boucle de télémétrie (`setInterval` existant) ne publie la télémétrie que si `state.online` est vrai.

**`src/web-server.ts`** — nouveaux endpoints POST, tous synchrones et idempotents à l'usage (un clic = un effet) :
- `/scenario/drain-battery` — `state.battery = 5`
- `/scenario/skip-next-mission-ack` — `state.scenario.skipNextMissionAck = true`
- `/scenario/fail-next-step` — `state.scenario.failNextStep = true`
- `/scenario/toggle-online` — inverse `state.online`, retourne le nouvel état
- `/scenario/reboot` — appelle `transport.publishReboot(...)` avec des valeurs plausibles fixes
- `/scenario/error` — appelle `transport.publishError(...)` avec des valeurs plausibles fixes
- `/scenario/phantom-mission` — appelle `transport.publishState('IN_MISSION')` directement, sans passer par `CommandHandler` (simule un robot qui prétend être en mission sans y avoir été invité)

Ces endpoints ont besoin d'une référence au `MqttTransport` (déjà instancié dans `index.ts`) — `startWebServer()` reçoit un paramètre supplémentaire pour y accéder, suivant le même principe que `state` aujourd'hui.

**`public/index.html`** — un bouton par endpoint ci-dessus, dans une nouvelle section "Scénarios de démo" à côté du bouton "Recharger" existant. Le bouton "Passer offline / Revenir online" change de libellé selon l'état courant (lu via le polling `/state` déjà en place, `state.online`).

## Hors scope

- **Mission trop longue (30 min)** : pas de bouton dédié, impossible à démontrer en direct sans attendre 30 minutes réelles. Pour une démo, il faudrait temporairement abaisser `MISSION_RUN_MAX_DURATION_MS` côté backend — c'est un réglage de configuration au moment de la démo, pas une fonctionnalité du simulateur.
- **`EMERGENCY_STOP`** : le backend n'envoie cette commande via aucun use case actuellement. Le simulateur continue de la traiter comme aujourd'hui (alias de `STOP_MISSION`) ; rien à ajouter.
- **Distinction `ROBOT_BUSY`** au niveau du scheduler : ce cas se déclenche naturellement dès qu'une mission est lancée alors qu'une autre est déjà active pour le même robot — pas besoin d'un scénario dédié, c'est un enchaînement naturel des boutons existants (lancer une mission, puis en lancer une seconde depuis le frontend pendant que la première tourne).

## Vérification

Test manuel : pour chaque scénario du tableau ci-dessous, déclencher le bouton correspondant au bon moment et vérifier côté backend (logs + état en base via l'API) que le `MissionRun` atteint bien le statut attendu.

| Scénario | Déclencheur | Statut `MissionRun` attendu |
|---|---|---|
| Succès | (comportement par défaut, aucun bouton) | `SUCCESS` |
| Échec métier | "Faire échouer le step en cours" avant de lancer, puis lancer une mission | `FAILED` |
| Timeout démarrage | "Ne pas confirmer le prochain démarrage", puis lancer une mission | `INTERRUPTED` (`TIMEOUT`) après 60s |
| Robot offline pendant la mission | Lancer une mission, puis "Passer offline" | `INTERRUPTED` (`ROBOT_OFFLINE`) après ~90s |
| Batterie insuffisante au démarrage | "Vider la batterie", puis tenter de lancer une mission | Le démarrage est refusé (`BatteryTooLowError`), aucun run créé |
| Mission fantôme | "Mission fantôme" sans mission en cours | Le dog est forcé à `IDLE`, un `STOP_MISSION` correctif est renvoyé (visible dans les logs backend) |
| Reboot / Erreur | Boutons dédiés | Événements diagnostics visibles (`RobotDiagnosticEvent` / page diagnostics du backoffice) |
| Connectivité | Connexion/déconnexion normale du simulateur | L'événement `connected`/`disconnected` est désormais accepté par le backend (plus d'erreur de parsing dans les logs) |

# Dog-Simulator

Simulateur de robot dog : se comporte comme le vrai robot pour tester [doggo](https://github.com/Lenaaaaaaa27/doggo) (missions MQTT + contrôle direct WebSocket) sans matériel physique.

## Prérequis

- Le backend `doggo` qui tourne (Postgres, Mosquitto, Redis démarrés — `docker compose up -d`).
- Un robot dog existant en base (son `id`).
- **Un compte MQTT provisionné pour ce robot** — le broker refuse les connexions anonymes. Depuis `doggo/`, suivre `docs/mqtt-broker-activation-runbook.md` section 1 :
  ```bash
  docker run --rm -v "$PWD/mosquitto:/m" eclipse-mosquitto:2 \
    mosquitto_passwd -b /m/passwordfile '<DOG_ID>' '<MOT_DE_PASSE>'
  docker compose up -d --force-recreate mosquitto
  ```
- **La clé du robot (`ROBOT_DOG_KEY`)** — nécessaire pour s'authentifier sur le contrôle direct (namespace `/ws/robots`). Récupérable via `GET /api/v1/dogs/:id` en tant qu'admin (le champ `key` n'est renvoyé qu'aux admins).

## Installation

```bash
npm install
cp .env.example .env
# renseigner DOG_ID, MQTT_PASSWORD (celui provisionné ci-dessus), ROBOT_DOG_KEY, et le reste si besoin
```

## Lancer

```bash
npm start        # une fois
npm run dev       # avec rechargement automatique
```

Le simulateur se connecte au broker MQTT (publie `connected`/`telemetry`, réagit aux sessions/missions reçues sur `robot/{DOG_ID}/command`) et au backend en WebSocket (`/ws/robots`, réagit aux commandes de contrôle direct : mouvement, aboyer, sauter).

**Page de visualisation** : http://localhost:4000 (port configurable via `VISUALIZATION_PORT`) — affiche la position/orientation du robot en direct, et une bulle "Woof!"/animation de saut quand une commande arrive. Se met à jour automatiquement, pas besoin de la recharger.

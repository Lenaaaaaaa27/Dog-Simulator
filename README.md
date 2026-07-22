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

## Installation

```bash
npm install
cp .env.example .env
# renseigner DOG_ID, MQTT_PASSWORD (celui provisionné ci-dessus), et le reste si besoin
```

## Lancer

```bash
npm start        # une fois
npm run dev       # avec rechargement automatique
```

Le simulateur se connecte au broker MQTT, publie `connected`/`telemetry`, et réagit aux commandes reçues sur `robot/{DOG_ID}/command` (sessions, missions). Le contrôle direct WebSocket sera ajouté dans une phase ultérieure.

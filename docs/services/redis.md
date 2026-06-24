# Redis

![Redis pub/sub panel](../img/monitoring.png)

## Purpose

Pub/sub broker between the streamer and the inference service. Redis carries two channels
(`transactions`, `control`) and one STRING key (`streamer:heartbeat`). It holds no persistent data
and stores no model artifacts.

## Responsibilities

- Route `transactions` messages from streamer to inference.
- Route `control` commands from inference to streamer.
- Store the `streamer:heartbeat` key so the `/monitoring` endpoint can report streamer liveness.

## Inputs / Outputs

| Direction | Publisher | Subscribers | Channel / Key |
|---|---|---|---|
| streamer → inference | streamer | inference | `transactions` (pub/sub) |
| inference → streamer | inference | streamer | `control` (pub/sub) |
| streamer → inference | streamer (SET) | inference (GET) | `streamer:heartbeat` (STRING, TTL=6 s) |

## Message contracts

### `transactions` channel

Published by the streamer once per CSV row. Consumed by inference to run a prediction.

```json
{
  "dataset": "fraud",
  "features": { "v1": -1.36, "v2": 0.13, "amount": 149.62, "hour": 14 },
  "actual": 0
}
```

- `dataset`: one of `fraud` | `iot` | `intrusion`
- `features`: key-value map matching the model's feature list in `registry.json`
- `actual`: 0 or 1, the ground-truth label for the row

### `control` channel

Published by inference when the dashboard sends `POST /control`. The streamer reads this to update
its streaming rate, pause state, or active dataset.

```json
{
  "interval_ms": 500,
  "paused": false,
  "dataset": "iot",
  "model": "rotormind-v1"
}
```

All fields are optional. The streamer applies only the keys present in the message. The `model` key
is consumed by inference only; the streamer ignores it.

### `streamer:heartbeat` key

Set by the streamer every ~2 seconds with a 6-second TTL. Read by inference at `GET /monitoring`.

```json
{
  "dataset": "fraud",
  "paused": false,
  "interval_ms": 500,
  "messages_sent": 12450,
  "rate": 1.98,
  "uptime_s": 6225.3,
  "ts": "2026-06-24T10:30:00.000Z"
}
```

Inference considers the streamer `down` if:
- the key is absent (TTL expired and streamer is not running), or
- the `ts` field is more than 6 seconds old.

## Configuration (env vars)

| Variable | Default in `.env.example` | Notes |
|---|---|---|
| `REDIS_URL` | `redis://redis:6379/0` | Used by streamer and inference |
| `REDIS_PORT` | `6379` | Host-side port mapping |

The trainer does not connect to Redis.

## Port

`6379` (mapped from host `REDIS_PORT`).

## Key files

- `streamer/streamer.py` — `connect_redis()`, `publish_loop()`, `heartbeat_writer()`,
  `control_subscriber()`
- `inference/app/main.py` — `_redis_subscriber()` (transactions consumer), `_redis_client.publish()`
  (control publisher), `_mon_redis()` (monitoring probe), `_mon_streamer()` (heartbeat reader)

## How it fits the pipeline

Redis sits between the two Python services and decouples their lifecycles. The streamer can start
before inference is ready; messages accumulate in the channel buffer until inference subscribes.
Inference reconnects to Redis with exponential backoff (1 s → 30 s) after a connection loss, so
short Redis restarts do not permanently halt the stream.

```
streamer → PUBLISH transactions → Redis → inference subscriber
dashboard → POST /control → inference → PUBLISH control → Redis → streamer subscriber
```

## Healthcheck

```
redis-cli ping
```

Interval: 5 s, timeout: 3 s, retries: 10, start period: 5 s.
Both streamer and inference wait for `redis: service_healthy` before starting.

## Gotchas / operational notes

- **No persistence configured** — the `redis:7` image defaults to no AOF and no RDB snapshots. All
  pub/sub messages and the heartbeat key are ephemeral. Restarting Redis clears everything; the
  streamer and inference reconnect automatically.
- **Pub/sub message loss on restart** — messages published while inference is reconnecting are
  dropped. This is acceptable for a streaming replay scenario; the streamer loops continuously and
  sends the next row on the next tick.
- **Single database** — `REDIS_URL` uses database index 0. The heartbeat key and pub/sub channels
  share this index. If you add more Redis consumers, use separate database indexes or namespaced
  keys to avoid collisions.
- The `/monitoring` endpoint reports `pubsub.transactions` and `pubsub.control` subscriber counts
  via `PUBSUB NUMSUB`. A count of 0 on `transactions` means inference is not subscribed and
  predictions will not run.

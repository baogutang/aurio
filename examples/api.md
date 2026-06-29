# API Examples

Base URL: `http://localhost:8080` (configurable via `PORT`).

## Health Check

```bash
curl http://localhost:8080/api/status
```

## Chat with the DJ

```bash
curl -X POST http://localhost:8080/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"text": "来点轻松的爵士"}'
```

## Manual Trigger

```bash
# Morning-style open
curl -X POST http://localhost:8080/api/trigger \
  -H 'Content-Type: application/json' \
  -d '{"kind": "morning"}'

# Mood check
curl -X POST http://localhost:8080/api/trigger \
  -H 'Content-Type: application/json' \
  -d '{"kind": "mood"}'
```

## Search Music

```bash
curl 'http://localhost:8080/api/search?q=周杰伦'
```

## Get Queue

```bash
curl http://localhost:8080/api/queue
```

## WebSocket

```javascript
const ws = new WebSocket('ws://localhost:8080/stream');

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  // msg.type: 'hello' | 'broadcast' | 'tts' | 'profile'
  console.log(msg);
};

// Heartbeat (drives radio refill)
ws.send(JSON.stringify({
  type: 'state',
  playingIndex: 0,
  paused: false,
  queueLen: 4,
}));
```

## Settings (non-secret status)

```bash
curl http://localhost:8080/api/settings
```

## Test AI Provider

```bash
curl -X POST http://localhost:8080/api/ai/test \
  -H 'Content-Type: application/json' \
  -d '{"AI_PROVIDER": "claude"}'
```

See `server/index.js` for the full route list.

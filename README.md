# Tyxter Webhook Listener

Local sandbox webhook companion for Tyxter Messaging. It polls Tyxter with a
sandbox API key and forwards each event payload to a local URL with the same
`tyxter-webhook-id`, `tyxter-webhook-timestamp`, and
`tyxter-webhook-signature` headers as normal webhook delivery.

You do not need to register a normal dashboard webhook endpoint for local
sandbox testing. The listener reads sandbox events through
`GET /v1/webhook-events/listen` and forwards them to your app.

## Quick Start

```bash
cp .env.example .env
# Edit TYXTER_API_KEY and TYXTER_WEBHOOK_FORWARD_URL.
docker compose up -d
docker compose run --rm tyxter-listener doctor
docker compose run --rm tyxter-listener status
```

The compose file pulls `ghcr.io/tyxter-dev/tyxter-webhook-listener:latest` by
default. State is stored in the `tyxter-listener-data` Docker volume so the
local signing secret and cursor survive restarts.

## Build From Source

```bash
cp .env.example .env
# Edit TYXTER_API_KEY and TYXTER_WEBHOOK_FORWARD_URL.
docker compose -f compose.yaml -f compose.build.yaml up -d --build
docker compose -f compose.yaml -f compose.build.yaml run --rm tyxter-listener doctor
```

Or build and run manually:

```bash
docker build -t tyxter-webhook-listener .
docker run --rm \
  -e TYXTER_API_URL=https://api.tyxter.com \
  -e TYXTER_API_KEY=tx_sandbox_... \
  -e TYXTER_WEBHOOK_FORWARD_URL=http://host.docker.internal:3000/webhooks/tyxter \
  -v tyxter-listener-data:/data \
  tyxter-webhook-listener listen
```

On Linux, use `--network=host` or an explicit host gateway if
`host.docker.internal` is not available.

## Commands

```bash
tyxter-webhook-listener listen
tyxter-webhook-listener doctor
tyxter-webhook-listener status
tyxter-webhook-listener simulate inbound --from +15551230000 --to +15557650000 --body "hello"
tyxter-webhook-listener tour --from +15551230000 --to +15557650000
```

`doctor` checks that state is writable, the sandbox listen endpoint accepts the
API key, and the forward URL accepts a signed diagnostic webhook. `status`
prints the persisted local signing secret and cursor.

## Agent-Driven App Tests

This repo includes a Codex skill at `.agents/skills/test-sandbox-webhooks`.
Use it when asking Codex or Claude Code to test a customer app with the listener
container. The skill tells the agent how to discover the app webhook route, run
the listener, execute `doctor`/`status`, simulate a sandbox inbound event, and
report evidence from both the listener and the app.

## Run Locally Without Docker

```bash
pnpm install
pnpm dev -- listen \
  --api-url https://api.tyxter.com \
  --api-key tx_sandbox_... \
  --forward-to http://localhost:3000/webhooks/tyxter
```

The default local state directory is `.tyxter-listener`. Override it with
`--state-dir` or `TYXTER_LISTENER_STATE_DIR`.

## Tour Receiver Demo

The demo script starts a localhost webhook receiver, runs the tour command
against it, and verifies the forwarded signature.

```bash
TYXTER_API_KEY=tx_sandbox_... pnpm tour:demo
```

Optional environment variables: `TYXTER_API_URL`, `TYXTER_TOUR_PORT`,
`TYXTER_WEBHOOK_SECRET`, `TYXTER_SIMULATE_FROM`, `TYXTER_SIMULATE_TO`, and
`TYXTER_SIMULATE_BODY`.

## Security Notes

- Use sandbox keys only. The listen endpoint rejects live keys.
- Do not paste `status` output into public issues; it includes the local signing secret.
- The listener persists only its signing secret and cursor, not webhook payloads.
- Verify signatures against the raw request body in your app.

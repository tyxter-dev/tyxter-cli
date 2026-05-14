# Tyxter CLI

Local developer CLI for Tyxter Messaging sandbox workflows. Today it long-polls
Tyxter with a sandbox API key and forwards each event payload to a local URL
with the same `tyxter-webhook-id`, `tyxter-webhook-timestamp`, and
`tyxter-webhook-signature` headers as normal webhook delivery.

You do not need to register a normal dashboard webhook endpoint for local
sandbox testing. The listener reads sandbox events through
`GET /v1/webhook-events/listen` and forwards them to your app.

## Quick Start

Build from the cloned repo:

```bash
cp .env.example .env
# Edit TYXTER_API_KEY and TYXTER_WEBHOOK_FORWARD_URL.
docker compose build
docker compose run --rm tyxter-cli checkpoint
docker compose up -d
docker compose run --rm tyxter-cli doctor
docker compose run --rm tyxter-cli status
```

State is stored in the `tyxter-cli-data` Docker volume so the local signing
secret and cursor survive restarts.

`checkpoint` advances the stored cursor to the end of the current sandbox event
stream without forwarding those existing events. Run it before the first
listener start when you are testing with an existing sandbox and do not want old
events replayed. Skip it when you intentionally want to replay pending sandbox
events.

## Use The Published Image

Run the image directly:

```bash
docker run --rm \
  -e TYXTER_API_URL=https://api.tyxter.com \
  -e TYXTER_API_KEY=tx_sandbox_... \
  -e TYXTER_WEBHOOK_FORWARD_URL=http://host.docker.internal:3000/webhooks/tyxter \
  -v tyxter-cli-data:/data \
  ghcr.io/tyxter-dev/tyxter-cli:latest listen
```

Or use the image-only Compose file:

```bash
cp .env.example .env
# Edit TYXTER_API_KEY and TYXTER_WEBHOOK_FORWARD_URL.
docker compose -f compose.image.yaml run --rm tyxter-cli checkpoint
docker compose -f compose.image.yaml up -d
docker compose -f compose.image.yaml run --rm tyxter-cli doctor
```

The GHCR image must be visible to your GitHub account or public Docker pulls.
If Docker returns `unauthorized`, either authenticate with `docker login ghcr.io`
using an account that can read the package, or use the source-build Compose path
above.

On Linux, use `--network=host` or an explicit host gateway if
`host.docker.internal` is not available.

## Commands

```bash
tyxter listen
tyxter listen --from-now
tyxter checkpoint
tyxter doctor
tyxter status
tyxter simulate inbound --from +15551230000 --to +15557650000 --body "hello"
tyxter tour --from +15551230000 --to +15557650000
```

`doctor` checks that state is writable, the sandbox listen endpoint accepts the
API key, and the forward URL accepts a signed diagnostic webhook. `status`
prints the persisted local signing secret and cursor. `listen --from-now`
performs the same checkpoint before starting the listener, which avoids
forwarding historical events in one command.

`listen` uses bounded long polling by default (`TYXTER_WEBHOOK_WAIT_MS=25000`),
backs off idle loops up to `TYXTER_WEBHOOK_MAX_POLL_INTERVAL_MS=30000`, adds
small jitter, and honors server `429 Retry-After` responses. The Tyxter API
still enforces abuse protection server-side; CLI timing settings are for local
developer ergonomics, not security.

`TYXTER_WEBHOOK_POLL_INTERVAL_MS` is the base retry/backoff interval. It is not
a fixed tight polling loop when no events are available.

If your local app verifies webhook signatures, configure it with the same local
secret used by the CLI. Either set `TYXTER_WEBHOOK_SECRET` yourself and pass the
same value to the receiver, or read the generated value from `tyxter status` and
set the receiver's `TYXTER_WEBHOOK_SIGNING_SECRET` to that value.

## Docker Network Forwarding

When the receiver runs as another Compose service, use that service name in
`TYXTER_WEBHOOK_FORWARD_URL` instead of `host.docker.internal`:

```yaml
services:
  receiver:
    image: your-local-receiver
    environment:
      TYXTER_WEBHOOK_SIGNING_SECRET: ${TYXTER_WEBHOOK_SECRET}

  tyxter-cli:
    environment:
      TYXTER_WEBHOOK_FORWARD_URL: http://receiver:3000/webhooks/tyxter
      TYXTER_WEBHOOK_SECRET: ${TYXTER_WEBHOOK_SECRET}
```

For an n8n-style local service, the forward URL can use the Compose service
host, for example
`http://mock-n8n:5678/webhook/tyxter-ai-reply`.

## Agent-Driven App Tests

This repo includes a Codex skill at `.agents/skills/test-sandbox-webhooks`.
Use it when asking Codex or Claude Code to test a customer app with the CLI
container. The skill tells the agent how to discover the app webhook route, run
the listener, execute `doctor`/`status`, simulate a sandbox inbound event, and
report evidence from both the CLI and the app.

## Contributing

Customer bug reports, setup notes, and focused pull requests are welcome. Read
`CONTRIBUTING.md` and `ISSUE_GUIDELINES.md` before opening a public issue or
pull request, especially the redaction rules for API keys, webhook secrets,
phone numbers, and payloads.

## Run Locally Without Docker

```bash
pnpm install
pnpm dev -- listen \
  --api-url https://api.tyxter.com \
  --api-key tx_sandbox_... \
  --forward-to http://localhost:3000/webhooks/tyxter \
  --from-now
```

The default local state directory is `.tyxter-cli`. Override it with
`--state-dir` or `TYXTER_CLI_STATE_DIR`.

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
- The Tyxter API rate-limits sandbox listen calls and returns `Retry-After`
  when clients exceed the server-side budget.
- Do not paste `status` output into public issues; it includes the local signing secret.
- The listener persists only its signing secret and cursor, not webhook payloads.
- Verify signatures against the raw request body in your app.

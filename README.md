# Tyxter CLI

Local developer CLI for Tyxter Messaging webhook testing. The default workflow
long-polls Tyxter with a sandbox API key and forwards each event payload to a
local URL with the same `tyxter-webhook-id`, `tyxter-webhook-timestamp`, and
`tyxter-webhook-signature` headers as normal webhook delivery.

You do not need to register a normal dashboard webhook endpoint for local
sandbox testing. The listener reads sandbox events through
`GET /v1/webhook-events/listen` and forwards them to your app.

Production listen is available only as an explicit finite diagnostic:
`tyxter listen prod`. It creates a short-lived production listen session, polls
with that session id, and disables the session when the command exits. Use it
for cutover validation, not as a durable production transport.

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

For a production diagnostic with the published image, run a one-shot container
instead of starting a long-running service:

```bash
docker run --rm \
  -e TYXTER_API_URL=https://api.tyxter.com \
  -e TYXTER_API_KEY=tx_live_... \
  -e TYXTER_WEBHOOK_FORWARD_URL=http://host.docker.internal:3000/webhooks/tyxter \
  -e TYXTER_WEBHOOK_LISTEN_TTL_SECONDS=300 \
  ghcr.io/tyxter-dev/tyxter-cli:latest listen prod
```

## Commands

```bash
tyxter listen
tyxter listen prod --api-key tx_live_... --forward-to http://localhost:3000/webhooks/tyxter
tyxter listen --from-now
tyxter listen --events "message.received,message.delivered"
tyxter listen --print-secret
tyxter checkpoint
tyxter doctor
tyxter status
tyxter status --print-secret
tyxter events resend evt_<id> --forward-to http://localhost:3000/webhooks/tyxter
tyxter logs tail --events message.received --status failed --last 10
tyxter simulate inbound --from +5511988887777 --to +15557650000 --body "hello"
tyxter simulate inbound --channel instagram --from igsid_123 --to ig_business_1 --body "hello"
tyxter tour --from +5511988887777 --to +15557650000
```

`doctor` checks that state is writable, the sandbox listen endpoint accepts the
API key, and the forward URL accepts a signed diagnostic webhook. `status`
prints the persisted local signing secret and cursor. `listen --from-now`
performs the same checkpoint before starting the listener, which avoids
forwarding historical events in one command.

`simulate inbound` and `tour` default to WhatsApp inbound simulation. Pass
`--channel instagram` or set `TYXTER_SIMULATE_CHANNEL=instagram` to seed an
Instagram DM inbound user for local reply-policy testing.

`listen` uses bounded long polling by default (`TYXTER_WEBHOOK_WAIT_MS=25000`),
backs off idle loops up to `TYXTER_WEBHOOK_MAX_POLL_INTERVAL_MS=30000`, adds
small jitter, and honors server `429 Retry-After` responses. The Tyxter API
still enforces abuse protection server-side; CLI timing settings are for local
developer ergonomics, not security.

Forwarding to the local webhook has a 30-second response deadline and stops
when the listener is interrupted. The cursor is saved only after a complete
batch, so an interrupted event may be replayed when the listener restarts.

`listen prod` requires a `tx_live_...` key and is intentionally finite. By
default it opens a five-minute listen session
(`TYXTER_WEBHOOK_LISTEN_TTL_SECONDS=300`), passes `listen_session_id` to
`GET /v1/webhook-events/listen`, and calls
`DELETE /v1/webhook-events/listen-sessions/:id` during cleanup. It does not
persist production cursors; the local state file is used only for the signing
secret that your local receiver verifies.

`TYXTER_WEBHOOK_POLL_INTERVAL_MS` is the base retry/backoff interval. It is not
a fixed tight polling loop when no events are available.

Use `--events` or `TYXTER_WEBHOOK_EVENTS` to listen for multiple event types.
The older `--event-type` and `TYXTER_WEBHOOK_EVENT_TYPE` options still work for
single-event filters. Quote comma-separated `--events` values in shell examples
so the CLI receives one argument.

`listen --print-secret` and `status --print-secret` print only the local signing
secret and exit, which is useful for wiring a receiver without exposing the
full state file. `listen --json` and `logs tail --json` write JSON Lines for
streaming consumers. With `listen --from-now --json`, the checkpoint is emitted
as a `tyxter_cli_listen_checkpoint` line before the listener starts. Finite
commands use compact JSON when `--json` is set.

`events resend` replays one sandbox listen event to a local `--forward-to`
target using the CLI signing secret. It accepts either the raw listen event id
or the payload id with the `evt_` prefix. This is local replay, not server-side
delivery to registered webhook endpoints.

`logs tail` follows registered webhook delivery events from
`GET /v1/webhook-events`. By default it starts from now; add `--last N` to print
recent historical events before tailing.

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

## Test Real Delivery With A Quick Tunnel

`listen` reads events from the listen stream, so it never exercises Tyxter's
real delivery path. To see real deliveries (signed with the endpoint's own
secret, retried on failure, recorded as delivery attempts), put your local app
behind a Cloudflare Quick Tunnel and register a temporary sandbox webhook
endpoint for it. Quick Tunnels need no Cloudflare account.

1. Start your app, then the tunnel:

   ```bash
   cloudflared tunnel --url http://localhost:3000 --output json
   ```

   With `--output json`, the public URL appears inside a log `message`, not as
   its own field. Extract it with the pattern
   `https://[a-z0-9-]+\.trycloudflare\.com`. The tunnel is ready when a
   `Registered tunnel connection` line appears.

2. Register the endpoint with your sandbox key. Webhook endpoint URLs must be
   HTTPS, which the tunnel provides:

   ```bash
   curl -sS https://api.tyxter.com/v1/webhook-endpoints \
     -H "Authorization: Bearer $TYXTER_API_KEY" \
     -H "Content-Type: application/json" \
     -H "Idempotency-Key: tunnel-$(date +%s)" \
     -d '{"url":"https://<words>.trycloudflare.com/webhooks/tyxter","subscribed_events":["message.received"],"description":"tyxter-cli quick tunnel"}'
   ```

   The response returns `signing_secret` once: a 64-character hex string, used
   as-is. Give it to your app's verifier (restart the app or reload its
   config) before you fire an event: real deliveries are signed with the
   endpoint's secret, not the CLI's local secret.

3. Stop `tyxter listen` while you test delivery. Otherwise your app receives
   each event twice: once forwarded by the listener, once delivered.

4. Fire an event and watch the delivery:

   ```bash
   tyxter simulate inbound --from +5511988887777 --to +15557650000 --body "hello"
   tyxter logs tail --events message.received
   ```

   `logs tail` keeps following until you stop it with Ctrl-C.

   To exercise retries, make your route return a 5xx once. The next attempt
   follows 30 seconds later.

5. Delete the endpoint before you stop the tunnel:

   ```bash
   curl -sS -X DELETE https://api.tyxter.com/v1/webhook-endpoints/<id> \
     -H "Authorization: Bearer $TYXTER_API_KEY"
   ```

   The URL stops working when `cloudflared` exits, and the next run gets a new
   hostname. A forgotten endpoint keeps retrying the dead URL. After 20
   consecutive failed deliveries, Tyxter disables it and notifies your account.

Limits:

- Sandbox keys only. Do not route production payloads (real phone numbers and
  messages) through a Quick Tunnel.
- Quick Tunnels are meant for testing: no uptime guarantee, and at most 200
  requests in flight.
- The URL is public. Verify `tyxter-webhook-signature` before trusting a
  request. Email-protected tunnels (`--allowed-mail`) need a browser sign-in,
  so Tyxter cannot deliver to them.
- Some corporate networks block `trycloudflare.com`. The listener needs only
  outbound HTTPS to the Tyxter API, so it keeps working there.

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

For a one-off production diagnostic, run the finite command directly and let it
exit:

```bash
pnpm dev -- listen prod \
  --api-url https://api.tyxter.com \
  --api-key tx_live_... \
  --forward-to http://localhost:3000/webhooks/tyxter \
  --ttl-seconds 300
```

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

- Use sandbox keys for the default listener, checkpoint, doctor, tour, simulate,
  and local resend commands.
- Use live keys only with `listen prod`, which opens a short-lived session and
  disables it on exit.
- The Tyxter API rate-limits listen calls and returns `Retry-After` when
  clients exceed the server-side budget.
- Do not paste `status` output into public issues; it includes the local signing secret.
- The listener persists only its signing secret and cursor, not webhook payloads.
- Verify signatures against the raw request body in your app.

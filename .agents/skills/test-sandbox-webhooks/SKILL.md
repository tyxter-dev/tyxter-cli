---
name: test-sandbox-webhooks
description: Set up and run Tyxter sandbox webhook tests against a customer app using the tyxter-cli Docker container. Use when a user asks Codex or Claude Code to test a Tyxter webhook integration, validate local sandbox webhooks, run the CLI listener against their app, create reusable sandbox webhook smoke tests, or debug the CLI + app combo.
---

# Test Sandbox Webhooks

Use the Tyxter CLI container as the customer would: a sandbox API key,
a local app webhook URL, and signed forwarded events. Do not ask the user to
register a normal dashboard webhook endpoint for this local sandbox flow.

## Safety Rules

- Use sandbox keys only. Stop if the key starts with `tx_live_`.
- Never commit API keys, webhook secrets, dashboard cookies, or received payloads.
- Prefer env files named like `.env.tyxter-cli`; add only `.example` files to git.
- Treat `TYXTER_WEBHOOK_SECRET` as a local test secret shared by the listener and the app verifier.
- Never point a Quick Tunnel endpoint at production data: create it with a sandbox key only.

## Workflow

1. Identify the app under test.
   - Find the dev command, package manager, port, and webhook route.
   - Find the webhook secret env var, raw-body handling, and event-type dispatch.
   - If any of these cannot be inferred safely, ask one concise question.

2. Choose the listener mode.
   - Pull image: use `ghcr.io/tyxter-dev/tyxter-cli:latest`.
   - Build source: use `compose.yaml` from the Tyxter CLI repo.
   - If the customer app repo has no compose file and the user wants reusable setup, run the
     bundled script from this skill's `scripts/` directory:

     ```bash
     python /path/to/test-sandbox-webhooks/scripts/write_listener_compose.py \
       --app-port 3000 \
       --webhook-path /webhooks/tyxter
     ```

     Then copy `.env.tyxter-cli.example` to `.env.tyxter-cli` and set the sandbox key.
   - Real delivery, only when the user wants Tyxter's delivery path tested (the
     endpoint's own signing secret, retries, delivery attempts) rather than
     only their handler: follow the CLI README section "Test Real Delivery With
     A Quick Tunnel".
     - Run `cloudflared tunnel --url http://localhost:<port> --output json` and
       take the URL matching `https://[a-z0-9-]+\.trycloudflare\.com` from the
       log `message`. Wait for a `Registered tunnel connection` line.
     - Create the endpoint with `POST /v1/webhook-endpoints` and an
       `Idempotency-Key`. Give the app the returned `signing_secret` (64 hex
       characters, used as-is) and restart or reload it before firing an event.
     - Stop the listener for this run so each event arrives once, and skip
       steps 3 to 5: the local secret, the listener, `status` and `doctor` belong
       to listener mode. Fire the event with step 6's `simulate inbound`, then
       read the delivery with `logs tail --events message.received --last 5`
       under a timeout, since it follows until stopped.
     - Delete the endpoint with `DELETE /v1/webhook-endpoints/<id>` before you
       finish, including after a failure: a leftover endpoint retries a dead
       URL until Tyxter disables it and notifies the account.

3. Start the app with a known local signing secret.
   - Prefer `TYXTER_WEBHOOK_SECRET=whsec_local_tyxtest` for repeatable tests.
   - The listener and app must use the same value.
   - For a Docker listener calling a host app, set:
     `TYXTER_WEBHOOK_FORWARD_URL=http://host.docker.internal:<port><path>`.

4. Start the listener.

   ```bash
   docker compose up -d --build
   ```

   For a generated app compose file:

   ```bash
   docker compose -f compose.tyxter-cli.yaml --env-file .env.tyxter-cli up -d
   ```

5. Run preflight checks.

   ```bash
   docker compose run --rm tyxter-cli status
   docker compose run --rm tyxter-cli doctor
   ```

   If `doctor` fails only because the app rejects the diagnostic event type,
   note that clearly and continue with a real sandbox event.

6. Fire a real sandbox webhook.

   ```bash
   docker compose run --rm tyxter-cli simulate inbound \
     --from +5511988887777 \
     --to +15557650000 \
     --body "Tyxter sandbox webhook smoke"
   ```

   Use `tour` instead when you need to checkpoint old events before creating
   the test event.

7. Verify evidence from both sides.
   - CLI listener: `docker compose logs --tail=80 tyxter-cli`.
   - App: route logs, test assertion, database row, queue job, or UI state.
   - Correlate by `message_id`, `trace_id`, and webhook id.
   - Confirm the app returned `2xx` only after signature verification and durable handling.

8. Make it reusable when asked to "set up tests".
   - Add a script such as `scripts/tyxter-sandbox-webhook-smoke`.
   - Add a package script or CI job only if the repo already uses that pattern.
   - Keep required env vars explicit: `TYXTER_API_KEY`, `TYXTER_WEBHOOK_FORWARD_URL`, `TYXTER_WEBHOOK_SECRET`.
   - Do not bake customer-specific phone numbers, API keys, or secrets into committed files.

## Completion Criteria

- The app is running and reachable by the listener container.
- `status` prints a persisted local signing secret and cursor.
- `doctor` passes, or any diagnostic-only failure is explained and a real event succeeds.
- A sandbox event is created and forwarded to the app.
- The final report includes exact commands run, event identifiers, verification evidence, and any files changed.
- In real-delivery mode the `status` and `doctor` criteria do not apply. Instead, the app
  verified a delivery signed with the endpoint's `signing_secret`, and the endpoint is
  deleted; the report gives its id.

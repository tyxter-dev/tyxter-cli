---
name: test-sandbox-webhooks
description: Set up and run Tyxter sandbox webhook tests against a customer app using the tyxter-webhook-listener Docker container. Use when a user asks Codex or Claude Code to test a Tyxter webhook integration, validate local sandbox webhooks, run the listener against their app, create reusable sandbox webhook smoke tests, or debug the listener + app combo.
---

# Test Sandbox Webhooks

Use the Tyxter listener container as the customer would: a sandbox API key,
a local app webhook URL, and signed forwarded events. Do not ask the user to
register a normal dashboard webhook endpoint for this local sandbox flow.

## Safety Rules

- Use sandbox keys only. Stop if the key starts with `tx_live_`.
- Never commit API keys, webhook secrets, dashboard cookies, or received payloads.
- Prefer env files named like `.env.tyxter-listener`; add only `.example` files to git.
- Treat `TYXTER_WEBHOOK_SECRET` as a local test secret shared by the listener and the app verifier.

## Workflow

1. Identify the app under test.
   - Find the dev command, package manager, port, and webhook route.
   - Find the webhook secret env var, raw-body handling, and event-type dispatch.
   - If any of these cannot be inferred safely, ask one concise question.

2. Choose the listener mode.
   - Pull image: use `ghcr.io/tyxter-dev/tyxter-webhook-listener:latest`.
   - Build source: use `compose.yaml` plus `compose.build.yaml` from the listener repo.
   - If the customer app repo has no compose file and the user wants reusable setup, run the
     bundled script from this skill's `scripts/` directory:

     ```bash
     python /path/to/test-sandbox-webhooks/scripts/write_listener_compose.py \
       --app-port 3000 \
       --webhook-path /webhooks/tyxter
     ```

     Then copy `.env.tyxter-listener.example` to `.env.tyxter-listener` and set the sandbox key.

3. Start the app with a known local signing secret.
   - Prefer `TYXTER_WEBHOOK_SECRET=whsec_local_tyxtest` for repeatable tests.
   - The listener and app must use the same value.
   - For a Docker listener calling a host app, set:
     `TYXTER_WEBHOOK_FORWARD_URL=http://host.docker.internal:<port><path>`.

4. Start the listener.

   ```bash
   docker compose up -d
   ```

   For a source build:

   ```bash
   docker compose -f compose.yaml -f compose.build.yaml up -d --build
   ```

5. Run preflight checks.

   ```bash
   docker compose run --rm tyxter-listener status
   docker compose run --rm tyxter-listener doctor
   ```

   If `doctor` fails only because the app rejects the diagnostic event type,
   note that clearly and continue with a real sandbox event.

6. Fire a real sandbox webhook.

   ```bash
   docker compose run --rm tyxter-listener simulate inbound \
     --from +15551230000 \
     --to +15557650000 \
     --body "Tyxter sandbox webhook smoke"
   ```

   Use `tour` instead when you need to checkpoint old events before creating
   the test event.

7. Verify evidence from both sides.
   - Listener: `docker compose logs --tail=80 tyxter-listener`.
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

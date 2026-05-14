# AGENTS.md

Goal: get the Tyxter sandbox webhook listener running.

Assume the user already has a sandbox API key. Do not ask them to register a
normal dashboard webhook endpoint for local sandbox testing; this listener polls
Tyxter and forwards events locally.

If this repo includes `.agents/skills/test-sandbox-webhooks`, use that skill
when the user asks to test a customer app with the listener + app combo.

## Steps

1. If `.env` is missing, copy `.env.example` to `.env` and ask the user for:
   - `TYXTER_API_KEY`
   - `TYXTER_WEBHOOK_FORWARD_URL`
2. Start the listener:

   ```bash
   docker compose up -d --build
   ```

3. If the user wants to use the published image instead of building from source:

   ```bash
   docker compose -f compose.image.yaml up -d
   ```

4. Run health checks:

   ```bash
   docker compose run --rm tyxter-listener doctor
   docker compose run --rm tyxter-listener status
   ```

5. If the user wants an end-to-end sandbox event, run:

   ```bash
   docker compose run --rm tyxter-listener simulate inbound \
     --from +15551230000 \
     --to +15557650000 \
     --body "hello from Tyxter"
   ```

6. Report:
   - whether the listener container is running
   - whether `doctor` passed
   - the local signing secret from `status`
   - the latest forwarded event or error from `docker compose logs --tail=50 tyxter-listener`

# AGENTS.md

Guidance for AI coding agents (Codex, Claude Code, etc.) working in this repo.
`CLAUDE.md` is a symlink to this file — keep edits here.

## What This Repo Is

Tyxter CLI is a local Node.js + TypeScript tool that long-polls Tyxter's sandbox
listen endpoint (`GET /v1/webhook-events/listen`) and forwards each event to a
local URL, re-signing the payload with the same `tyxter-webhook-id`,
`tyxter-webhook-timestamp`, and `tyxter-webhook-signature` headers as real
delivery. Customers use it to test webhook handlers without exposing a public
URL or registering a dashboard endpoint.

State (local signing secret + cursor) lives in the `tyxter-cli-data` Docker
volume, or in `.tyxter-cli/` when running outside Docker.

Normal listener runs send `wait_ms=25000`, back off idle loops up to
`TYXTER_WEBHOOK_MAX_POLL_INTERVAL_MS`, and honor server `429 Retry-After`
responses. `TYXTER_WEBHOOK_POLL_INTERVAL_MS` is the base interval, not a fixed
tight loop. `TYXTER_WEBHOOK_EVENTS` accepts comma-separated event filters. The
API still owns abuse protection server-side.

## Repo Map

- `src/main.ts` — CLI entrypoint and command dispatcher.
- `src/args.ts` — `parseCli` and help text. Adjust here when adding flags.
- `src/checkpoint.ts` — advances the listen cursor without forwarding events.
- `src/events.ts` — local replay for one sandbox listen event.
- `src/logs.ts` — webhook delivery log tailing via `/v1/webhook-events`.
- `src/listener.ts` — long-running poll + forward loop.
- `src/simulate.ts` — `simulate inbound` (creates one sandbox event).
- `src/tour.ts` — checkpoint old events, simulate one, watch it land.
- `src/doctor.ts` / `src/status.ts` — health checks and state read.
- `src/signature.ts` — re-signs forwarded payloads.
- `src/state.ts` — secret + cursor persistence under `--state-dir`.
- `src/schemas.ts` — Zod schemas for API payloads.
- `src/*.test.ts` — Vitest suites colocated with sources.
- `scripts/tour-demo.mjs` — local tour receiver demo used by `pnpm tour:demo`.
- `compose.yaml`, `compose.image.yaml`, `Dockerfile` — container plumbing.
- `.agents/skills/test-sandbox-webhooks/` — bundled Codex/Claude skill for
  driving the CLI against a customer app.

## Default Task: Run The Listener

Assume the user already has a sandbox API key (`tx_sandbox_...`). Do not ask
them to register a dashboard webhook for local sandbox testing — that is what
this listener replaces.

1. If `.env` is missing, copy `.env.example` to `.env` and ask for:
   - `TYXTER_API_KEY` (must start with `tx_sandbox_`)
   - `TYXTER_WEBHOOK_FORWARD_URL` (use `http://host.docker.internal:<port>/<path>`
     when the listener runs in Docker and the app runs on the host)
2. Checkpoint existing sandbox events when this is a first run for an existing
   sandbox and the user does not want historical replay:
   ```bash
   docker compose build
   docker compose run --rm tyxter-cli checkpoint
   ```
3. Start the listener — build from source by default:
   ```bash
   docker compose up -d --build
   ```
   Use the published image when the user asks to skip building:
   ```bash
   docker compose -f compose.image.yaml up -d
   ```
4. Run health checks:
   ```bash
   docker compose run --rm tyxter-cli doctor
   docker compose run --rm tyxter-cli status
   ```
5. Fire a real sandbox event when an end-to-end check is needed:
   ```bash
   docker compose run --rm tyxter-cli simulate inbound \
     --from +15551230000 \
     --to +15557650000 \
     --body "hello from Tyxter"
   ```
   Prefer `tour` when you also want to checkpoint pre-existing events:
   ```bash
   docker compose run --rm tyxter-cli tour \
     --from +15551230000 --to +15557650000
   ```
6. Report back with:
   - whether the container is running
   - whether `doctor` passed (note diagnostic-only failures separately)
   - the local signing secret from `status`
   - the latest forwarded event or error from
     `docker compose logs --tail=50 tyxter-cli`

If the user asks to test a customer app with the listener + app combo, use the
`.agents/skills/test-sandbox-webhooks` skill — it owns the end-to-end flow.

## Local (No Docker) Workflow

```bash
pnpm install
pnpm dev -- listen \
  --api-url https://api.tyxter.dev \
  --api-key tx_sandbox_... \
  --forward-to http://localhost:3000/webhooks/tyxter
```

State defaults to `./.tyxter-cli/`; override with `--state-dir` or
`TYXTER_CLI_STATE_DIR`.

## Coding Rules

- TypeScript strict, ESM (`"type": "module"`), Node `>= 20.11`. Always import
  with explicit `.js` extensions from `.ts` sources (e.g. `./args.js`).
- Validate every external payload with Zod schemas in `src/schemas.ts`. Never
  trust raw JSON from the API or the forwarded request body.
- Re-use `HttpStatusError` from `src/http.ts` for HTTP failures so `main.ts`
  can render them with response bodies attached.
- Keep secrets and cursors flowing through `src/state.ts`. Do not read or
  write the state directory from other modules.
- Add a Vitest file next to any new module (`feature.ts` →
  `feature.test.ts`). Mock network calls; do not hit `api.tyxter.dev` in tests.
- Match existing logging style: single-line, present tense, no emoji, no
  trailing punctuation noise.
- Keep streaming `--json` output as JSON Lines only. Do not mix human status
  text into `listen --json` or `logs tail --json`.

## Quality Gates

Before declaring work done:
```bash
pnpm typecheck
pnpm test
pnpm build
```
Rebuild the container (`docker compose build`) if you changed anything under
`src/`, `package.json`, `pnpm-lock.yaml`, or the `Dockerfile`.

## Safety Rules

- Refuse to run anything against a live key. Stop if `TYXTER_API_KEY` starts
  with `tx_live_`.
- Treat `status` output and `.env` as sensitive — they contain the local
  signing secret and the sandbox API key. Never paste either into issues,
  PRs, commit messages, or logs you share with the user verbatim. Redact
  per `ISSUE_GUIDELINES.md`.
- Do not commit `.env`, captured webhook payloads, phone numbers, or customer
  identifiers. Only `.env.example` belongs in git.
- `TYXTER_WEBHOOK_SECRET` is a *local* test secret shared between the
  listener and the customer app verifier; do not reuse production secrets.

## Before Opening A PR

Read `CONTRIBUTING.md` for the contributor checklist and `ISSUE_GUIDELINES.md`
for the redaction rules. Keep PRs focused; new commands or flags must update
`src/args.ts` help text, the README command list, and this file's repo map.

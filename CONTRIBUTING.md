# Contributing to Tyxter CLI

Tyxter CLI is the public local developer tool for testing Tyxter Messaging
sandbox workflows. Customer contributions are welcome when they improve setup
friction, diagnostics, documentation, or reproducible coverage for real app
integrations.

## What To Contribute

Good contributions usually fit one of these categories:

- Bug fixes with a reproducible failing case.
- Documentation improvements for local setup, Docker, tunnels, webhook
  verification, or agent-driven testing.
- Better diagnostics in `tyxter doctor`, `tyxter status`, or listener logs.
- Small CLI usability improvements that keep the existing commands stable.
- Test coverage for sandbox listen, simulate, tour, status, and signature
  behavior.

For larger features, open a feature request first. The CLI is public, but it is
still part of Tyxter's customer-facing developer experience, so command names,
output shapes, and webhook behavior should stay intentional.

## Safety Rules

Never commit or paste these into issues, pull requests, screenshots, or logs:

- Tyxter API keys, including sandbox keys.
- Webhook signing secrets.
- Dashboard cookies, session tokens, or authorization headers.
- Real customer phone numbers, message bodies, contact names, or payloads.
- Production webhook payloads or production trace data.

Use placeholders such as `tx_sandbox_redacted`, `whsec_redacted`,
`+15551230000`, and `<message body redacted>`. If a bug needs sensitive data to
reproduce, open a sanitized public issue first and say that private evidence is
available through Tyxter support.

## Local Development

Requirements:

- Node.js 22.22.2+ or 24.15+ for development with npm 12. The CLI runtime supports Node 22.12+.
- npm 12.2.0 and pnpm 12.14.0 for build and package validation.
- Install the pinned versions directly: `npm install -g npm@12.2.0` followed by
  `npm install -g --allow-scripts=pnpm pnpm@12.14.0`.
- Docker Desktop or a compatible Docker engine.

Set up the repo:

```bash
pnpm install
pnpm test
pnpm build
```

Run the CLI locally:

```bash
pnpm dev -- status
pnpm dev -- listen \
  --api-url https://api.tyxter.com \
  --api-key tx_sandbox_redacted \
  --forward-to http://localhost:3000/webhooks/tyxter
```

Validate the Docker path:

```bash
docker compose --env-file .env.example config --services
docker build -t tyxter-cli-dev .
docker run --rm tyxter-cli-dev status
```

For end-to-end sandbox testing, use a real sandbox API key in your local
environment only. Do not commit `.env` files.

## Pull Requests

Before opening a pull request:

1. Keep the change focused. Avoid unrelated refactors.
2. Add or update tests when behavior changes.
3. Update `README.md`, `.env.example`, or the agent skill when setup behavior
   changes.
4. Run:

   ```bash
   pnpm test
   pnpm build
   pnpm typecheck
   pnpm check:package
   pnpm audit
   docker compose --env-file .env.example config --services
   ```

5. Include the command output summary in the pull request, not full logs with
   secrets.

Public command output is part of the product. If you change JSON object names,
headers, exit codes, environment variables, or command names, call that out in
the pull request.

Before tagging a release, set `package.json` to the intended version and use an
exact matching `v<version>` tag. CI validates the tag, both supported Node versions,
and amd64/arm64 containers before publishing. Only stable version tags update the
`latest` image; `main` updates `edge`. The final image has no shell or package manager.

## Agent Contributions

It is fine to use Codex, Claude Code, or another coding agent to prepare a
change. The human contributor is still responsible for reviewing the diff,
running the checks, and removing secrets or customer data before publishing.

If an agent generated the issue or pull request, include the exact commands it
ran and the sanitized evidence it collected.

## Issue Guidelines

Use `ISSUE_GUIDELINES.md` before opening a bug report, support question, or
feature request. Public issues should be reproducible, sanitized, and scoped to
the CLI or local sandbox webhook testing experience.

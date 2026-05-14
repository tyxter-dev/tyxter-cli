# Issue Guidelines

Tyxter CLI issues are public. Write them so another customer or maintainer can
understand the problem without seeing private account data.

## What Belongs Here

Open a GitHub issue for:

- Reproducible CLI bugs.
- Docker or Compose setup problems.
- Confusing `doctor`, `status`, `listen`, `simulate`, or `tour` behavior.
- Documentation gaps in this repository.
- Feature requests for local sandbox testing workflows.

Use Tyxter support instead of a public issue for account-specific dashboard
state, billing, production delivery failures, private payloads, or anything
that requires looking up your organization.

## Do Not Post Secrets

Before submitting, remove:

- API keys.
- Webhook signing secrets.
- Authorization headers and cookies.
- Real phone numbers.
- Message bodies and contact names.
- Full webhook payloads from real users.
- Screenshots containing dashboard URLs, organization IDs, or account data.

`tyxter status` prints the local signing secret. Do not paste the full output
without redacting `signing_secret`.

Safe examples:

```text
TYXTER_API_KEY=tx_sandbox_redacted
TYXTER_WEBHOOK_SECRET=whsec_redacted
TYXTER_WEBHOOK_FORWARD_URL=http://host.docker.internal:3000/webhooks/tyxter
from=+15551230000
body=<redacted>
```

## Good Bug Reports

A useful bug report includes:

- CLI version or commit SHA.
- Install path: Docker image, local source build, or pnpm dev command.
- Operating system and Docker version.
- Exact command run, with secrets redacted.
- Expected behavior.
- Actual behavior.
- Sanitized output from `tyxter doctor`, `tyxter status`, or container logs.
- Whether the issue reproduces with `.env.example` plus a sandbox key.

If the bug involves an app webhook route, include the framework and route shape,
for example `Next.js route handler at /api/webhooks/tyxter`, but do not paste
private app code unless it is already safe to publish.

## Good Feature Requests

A useful feature request describes:

- The customer workflow that is hard today.
- The command or output shape you expected.
- Why the workaround is not enough.
- Whether the feature should work in Docker, local source runs, or both.
- Any compatibility risk for existing `tyxter` commands.

## Maintainer Triage

Maintainers may ask for a smaller reproduction before accepting a bug. Issues
without a reproduction, with missing diagnostics, or with unredacted secrets may
be closed until they are corrected.

For security vulnerabilities, do not open a public issue. Use the private
security contact path listed by Tyxter support or your account team.

## Summary

Describe what changed and why.

## Safety

- [ ] I did not commit API keys, webhook secrets, cookies, private payloads, or customer data.
- [ ] Any command output or screenshots are sanitized.

## Checks

- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `docker compose --env-file .env.example config --services`
- [ ] Docker build or runtime check, if Docker behavior changed.

## Compatibility

Call out any changes to command names, flags, environment variables, JSON output,
webhook headers, Docker image names, or Compose service names.

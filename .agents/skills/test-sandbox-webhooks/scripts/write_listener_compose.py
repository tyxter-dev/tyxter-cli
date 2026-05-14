#!/usr/bin/env python3
"""Write a reusable Tyxter listener compose file for a customer app repo."""

from __future__ import annotations

import argparse
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose", default="compose.tyxter-listener.yaml")
    parser.add_argument("--env-example", default=".env.tyxter-listener.example")
    parser.add_argument("--api-url", default="https://api.tyxter.com")
    parser.add_argument("--app-port", default="3000")
    parser.add_argument("--webhook-path", default="/webhooks/tyxter")
    parser.add_argument(
        "--image",
        default="ghcr.io/tyxter-dev/tyxter-webhook-listener:latest",
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    compose_path = Path(args.compose)
    env_path = Path(args.env_example)
    for path in (compose_path, env_path):
        if path.exists() and not args.force:
            raise SystemExit(f"{path} already exists. Pass --force to overwrite.")

    forward_url = f"http://host.docker.internal:{args.app_port}{normalize_path(args.webhook_path)}"
    compose_path.write_text(compose_text(args.image, env_path.name), encoding="utf-8")
    env_path.write_text(env_text(args.api_url, forward_url), encoding="utf-8")
    print(f"Wrote {compose_path}")
    print(f"Wrote {env_path}")
    print(f"Copy {env_path} to {env_path.with_suffix('')} and set TYXTER_API_KEY.")
    return 0


def normalize_path(path: str) -> str:
    return path if path.startswith("/") else f"/{path}"


def compose_text(image: str, env_file: str) -> str:
    return f"""name: tyxter-sandbox-webhook-test

services:
  tyxter-listener:
    image: {image}
    container_name: tyxter-webhook-listener
    restart: unless-stopped
    env_file:
      - {env_file.removesuffix(".example")}
    environment:
      TYXTER_LISTENER_STATE_DIR: /data
    volumes:
      - tyxter-listener-data:/data
    extra_hosts:
      - "host.docker.internal:host-gateway"

volumes:
  tyxter-listener-data:
"""


def env_text(api_url: str, forward_url: str) -> str:
    return f"""TYXTER_API_URL={api_url}
TYXTER_API_KEY=tx_sandbox_replace_me
TYXTER_WEBHOOK_FORWARD_URL={forward_url}

# Use the same local-only secret in your app's webhook verifier.
TYXTER_WEBHOOK_SECRET=whsec_local_tyxtest

TYXTER_WEBHOOK_LIMIT=20
TYXTER_WEBHOOK_POLL_INTERVAL_MS=1000
"""


if __name__ == "__main__":
    raise SystemExit(main())

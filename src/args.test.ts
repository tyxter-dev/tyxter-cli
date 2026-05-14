import { describe, expect, it } from 'vitest';

import { parseCli } from './args.js';

describe('CLI argument parsing', () => {
  it('parses top-level help flags', () => {
    expect(parseCli(['--help'], {})).toEqual({ kind: 'help' });
    expect(parseCli(['-h'], {})).toEqual({ kind: 'help' });
  });

  it('parses listen with persistent state defaults', () => {
    const parsed = parseCli(
      ['listen', '--api-key', 'tx_sandbox_test', '--forward-to', 'http://127.0.0.1:4242/hook'],
      {},
    );

    expect(parsed).toMatchObject({
      kind: 'listen',
      options: {
        apiUrl: 'http://localhost:3001',
        apiKey: 'tx_sandbox_test',
        forwardTo: 'http://127.0.0.1:4242/hook',
        stateDir: '.tyxter-cli',
        limit: 20,
        waitMs: 25000,
        pollIntervalMs: 1000,
        maxPollIntervalMs: 30000,
      },
    });
  });

  it('parses listen wait and max poll interval tuning', () => {
    const parsed = parseCli(
      ['listen', '--api-key', 'tx_sandbox_test', '--forward-to', 'http://127.0.0.1:4242/hook'],
      {
        TYXTER_WEBHOOK_WAIT_MS: '5000',
        TYXTER_WEBHOOK_MAX_POLL_INTERVAL_MS: '20000',
      },
    );

    expect(parsed).toMatchObject({
      kind: 'listen',
      options: {
        waitMs: 5000,
        maxPollIntervalMs: 20000,
      },
    });
  });

  it('parses listen from-now checkpoint mode', () => {
    const parsed = parseCli(
      [
        'listen',
        '--from-now',
        '--api-key',
        'tx_sandbox_test',
        '--forward-to',
        'http://127.0.0.1:4242/hook',
      ],
      {},
    );

    expect(parsed).toMatchObject({
      kind: 'listen',
      options: {
        fromNow: true,
      },
    });
  });

  it('parses checkpoint without a forward URL', () => {
    const parsed = parseCli(['checkpoint', '--api-key', 'tx_sandbox_test'], {
      TYXTER_WEBHOOK_EVENT_TYPE: 'message.received',
      TYXTER_CLI_STATE_DIR: '/data',
    });

    expect(parsed).toEqual({
      kind: 'checkpoint',
      options: {
        apiUrl: 'http://localhost:3001',
        apiKey: 'tx_sandbox_test',
        signingSecret: undefined,
        cursor: undefined,
        eventType: 'message.received',
        limit: 100,
        stateDir: '/data',
      },
    });
  });

  it('parses doctor from env and flags', () => {
    const parsed = parseCli(['doctor', '--state-dir', '/data'], {
      TYXTER_API_URL: 'https://api.tyxter.test',
      TYXTER_API_KEY: 'tx_sandbox_env',
      TYXTER_WEBHOOK_FORWARD_URL: 'http://host.docker.internal:3000/webhooks/tyxter',
    });

    expect(parsed).toMatchObject({
      kind: 'doctor',
      options: {
        apiUrl: 'https://api.tyxter.test',
        apiKey: 'tx_sandbox_env',
        forwardTo: 'http://host.docker.internal:3000/webhooks/tyxter',
        stateDir: '/data',
      },
    });
  });

  it('parses status with state directory from env', () => {
    const parsed = parseCli(['status'], { TYXTER_CLI_STATE_DIR: '/data' });

    expect(parsed).toEqual({
      kind: 'status',
      options: { stateDir: '/data' },
    });
  });

  it('keeps the old listener state env var as a compatibility fallback', () => {
    const parsed = parseCli(['status'], { TYXTER_LISTENER_STATE_DIR: '/old-data' });

    expect(parsed).toEqual({
      kind: 'status',
      options: { stateDir: '/old-data' },
    });
  });
});

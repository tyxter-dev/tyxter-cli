import { describe, expect, it } from 'vitest';

import { DEFAULT_API_URL, helpText, parseCli } from './args.js';

describe('CLI argument parsing', () => {
  it('parses version without credentials and booleans before subcommands', () => {
    expect(parseCli(['--version'], {})).toEqual({ kind: 'version' });
    expect(parseCli(['-V'], {})).toEqual({ kind: 'version' });
    expect(parseCli(['listen', '--once', '--json', 'prod'], {
      TYXTER_API_KEY: 'tx_live_test', TYXTER_WEBHOOK_FORWARD_URL: 'http://localhost/hook',
    })).toMatchObject({ kind: 'listen-production', options: { once: true, json: true } });
  });

  it('rejects unknown commands, unsupported flags, extra arguments and missing flag values', () => {
    expect(() => parseCli(['listen', '--fro-now'], {})).toThrow('Unknown option');
    expect(() => parseCli(['listen', 'prdo'], {})).toThrow('Unknown listen mode');
    expect(() => parseCli(['lissten'], {})).toThrow('Unknown command');
    expect(() => parseCli(['status', 'extra'], {})).toThrow('Unexpected positional');
    expect(() => parseCli(['status', '--events', 'message.received'], {})).toThrow('not supported');
    expect(() => parseCli(['listen', '--api-key', '--once'], { TYXTER_API_KEY: 'tx_sandbox_test' })).toThrow('Missing value');
    expect(() => parseCli(['listen', '--once=maybe'], {})).toThrow('must be a boolean');
  });

  it('uses persisted state options for tour instead of generating a secret during parsing', () => {
    expect(parseCli(['tour', '--state-dir', '/data'], {
      TYXTER_API_KEY: 'tx_sandbox_test', TYXTER_WEBHOOK_FORWARD_URL: 'http://localhost/hook',
      TYXTER_SIMULATE_FROM: 'sender', TYXTER_SIMULATE_TO: 'recipient',
    })).toMatchObject({ kind: 'tour', options: { stateDir: '/data', signingSecret: undefined } });
  });
  it('parses top-level help flags', () => {
    expect(parseCli(['--help'], {})).toEqual({ kind: 'help' });
    expect(parseCli(['-h'], {})).toEqual({ kind: 'help' });
  });

  it('shows the public API URL in help examples', () => {
    expect(DEFAULT_API_URL).toBe('https://api.tyxter.com');
    expect(helpText()).toContain(`TYXTER_API_URL=${DEFAULT_API_URL}`);
    expect(helpText()).toContain('tyxter listen prod --api-key <tx_live_...>');
  });

  it('parses listen with persistent state defaults', () => {
    const parsed = parseCli(
      ['listen', '--api-key', 'tx_sandbox_test', '--forward-to', 'http://127.0.0.1:4242/hook'],
      {},
    );

    expect(parsed).toMatchObject({
      kind: 'listen',
      options: {
        apiUrl: DEFAULT_API_URL,
        apiKey: 'tx_sandbox_test',
        forwardTo: 'http://127.0.0.1:4242/hook',
        stateDir: '.tyxter-cli',
        limit: 20,
        waitMs: 25000,
        pollIntervalMs: 1000,
        maxPollIntervalMs: 30000,
        json: false,
      },
    });
  });

  it('uses the configured API URL for the listener and lets the flag override the env', () => {
    const baseArgs = [
      'listen',
      '--api-key',
      'tx_sandbox_test',
      '--forward-to',
      'http://127.0.0.1:4242/hook',
    ];

    expect(parseCli(baseArgs, { TYXTER_API_URL: 'http://api.env.test' })).toMatchObject({
      kind: 'listen',
      options: { apiUrl: 'http://api.env.test' },
    });
    expect(
      parseCli([...baseArgs, '--api-url', 'http://api.flag.test'], {
        TYXTER_API_URL: 'http://api.env.test',
      }),
    ).toMatchObject({
      kind: 'listen',
      options: { apiUrl: 'http://api.flag.test' },
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

  it('parses production listen sessions as an explicit finite command', () => {
    const parsed = parseCli(
      [
        'listen',
        'prod',
        '--api-key',
        'tx_live_test',
        '--forward-to',
        'http://127.0.0.1:4242/hook',
        '--ttl-seconds',
        '120',
        '--reason',
        'prod smoke test',
        '--json',
      ],
      { TYXTER_WEBHOOK_EVENTS: 'message.received,message.delivered' },
    );

    expect(parsed).toMatchObject({
      kind: 'listen-production',
      options: {
        apiUrl: DEFAULT_API_URL,
        apiKey: 'tx_live_test',
        forwardTo: 'http://127.0.0.1:4242/hook',
        eventTypes: ['message.received', 'message.delivered'],
        ttlSeconds: 120,
        reason: 'prod smoke test',
        waitMs: 25000,
        pollIntervalMs: 1000,
        maxPollIntervalMs: 30000,
        json: true,
      },
    });
  });

  it('bounds production listen session TTLs to the server contract', () => {
    expect(() =>
      parseCli(
        [
          'listen',
          'prod',
          '--api-key',
          'tx_live_test',
          '--forward-to',
          'http://127.0.0.1/hook',
          '--ttl-seconds',
          '301',
        ],
        {},
      ),
    ).toThrow('--ttl-seconds must be an integer from 30 to 300.');
  });

  it('parses multi-event listen filters', () => {
    const parsed = parseCli(
      ['listen', '--api-key', 'tx_sandbox_test', '--forward-to', 'http://127.0.0.1/hook'],
      { TYXTER_WEBHOOK_EVENTS: 'message.received,message.delivered' },
    );

    expect(parsed).toMatchObject({
      kind: 'listen',
      options: {
        eventTypes: ['message.received', 'message.delivered'],
      },
    });
  });

  it('rejects mixed event filter flags', () => {
    expect(() =>
      parseCli(
        [
          'listen',
          '--api-key',
          'tx_sandbox_test',
          '--forward-to',
          'http://127.0.0.1/hook',
          '--event-type',
          'message.received',
          '--events',
          'message.delivered',
        ],
        {},
      ),
    ).toThrow('--event-type and --events cannot be used together.');
  });

  it('parses print-secret without requiring API or forward URL', () => {
    expect(parseCli(['listen', '--print-secret', '--state-dir', '/data'], {})).toEqual({
      kind: 'print-secret',
      options: {
        signingSecret: undefined,
        stateDir: '/data',
      },
    });
    expect(parseCli(['status', '--print-secret'], {})).toMatchObject({
      kind: 'print-secret',
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
        apiUrl: DEFAULT_API_URL,
        apiKey: 'tx_sandbox_test',
        signingSecret: undefined,
        cursor: undefined,
        eventType: 'message.received',
        limit: 100,
        stateDir: '/data',
        json: false,
      },
    });
  });

  it('parses sandbox inbound channel for simulate and tour commands', () => {
    const simulate = parseCli(
      [
        'simulate',
        'inbound',
        '--api-key',
        'tx_sandbox_test',
        '--channel',
        'instagram',
        '--from',
        'igsid_123',
        '--to',
        'ig_business_1',
      ],
      {},
    );
    expect(simulate).toMatchObject({
      kind: 'simulate-inbound',
      options: {
        channel: 'instagram',
        from: 'igsid_123',
        to: 'ig_business_1',
      },
    });

    const tour = parseCli(
      ['tour', '--api-key', 'tx_sandbox_test', '--forward-to', 'http://127.0.0.1/hook'],
      {
        TYXTER_SIMULATE_CHANNEL: 'instagram',
        TYXTER_SIMULATE_FROM: 'igsid_123',
        TYXTER_SIMULATE_TO: 'ig_business_1',
      },
    );
    expect(tour).toMatchObject({
      kind: 'tour',
      options: {
        channel: 'instagram',
        from: 'igsid_123',
        to: 'ig_business_1',
      },
    });
  });

  it('rejects unknown sandbox inbound channels', () => {
    expect(() =>
      parseCli(
        [
          'simulate',
          'inbound',
          '--api-key',
          'tx_sandbox_test',
          '--channel',
          'telegram',
          '--from',
          'u_1',
          '--to',
          'account_1',
        ],
        {},
      ),
    ).toThrow('Invalid --channel');
  });

  it('parses events resend', () => {
    const parsed = parseCli(
      [
        'events',
        'resend',
        'evt_outbox_123',
        '--api-key',
        'tx_sandbox_test',
        '--forward-to',
        'http://127.0.0.1/hook',
        '--json',
      ],
      {},
    );

    expect(parsed).toMatchObject({
      kind: 'events-resend',
      options: {
        eventId: 'evt_outbox_123',
        apiKey: 'tx_sandbox_test',
        forwardTo: 'http://127.0.0.1/hook',
        json: true,
      },
    });
  });

  it('parses logs tail filters', () => {
    const parsed = parseCli(
      [
        'logs',
        'tail',
        '--api-key',
        'tx_sandbox_test',
        '--events',
        'message.sent,message.failed',
        '--status',
        'failed',
        '--last',
        '10',
        '--json',
      ],
      {},
    );

    expect(parsed).toMatchObject({
      kind: 'logs-tail',
      options: {
        apiKey: 'tx_sandbox_test',
        eventTypes: ['message.sent', 'message.failed'],
        status: 'failed',
        last: 10,
        json: true,
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
      options: { stateDir: '/data', json: false },
    });
  });

  it('keeps the old listener state env var as a compatibility fallback', () => {
    const parsed = parseCli(['status'], { TYXTER_LISTENER_STATE_DIR: '/old-data' });

    expect(parsed).toEqual({
      kind: 'status',
      options: { stateDir: '/old-data', json: false },
    });
  });
});

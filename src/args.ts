import type { DoctorOptions } from './doctor.js';
import { createListenSigningSecret, type RunListenerOptions } from './listener.js';
import type { SimulateInboundOptions } from './simulate.js';
import { DEFAULT_STATE_DIR } from './state.js';
import type { StatusOptions } from './status.js';
import type { TourOptions } from './tour.js';

export type CliCommand =
  | { kind: 'help' }
  | { kind: 'listen'; options: CliListenOptions }
  | { kind: 'simulate-inbound'; options: SimulateInboundOptions }
  | { kind: 'tour'; options: TourOptions }
  | { kind: 'doctor'; options: DoctorOptions }
  | { kind: 'status'; options: StatusOptions };

export interface CliListenOptions extends Omit<RunListenerOptions, 'signingSecret'> {
  readonly signingSecret?: string;
  readonly stateDir: string;
}

interface ParsedArgs {
  readonly positionals: string[];
  readonly options: Record<string, string | boolean>;
}

export function parseCli(argv: readonly string[], env: NodeJS.ProcessEnv): CliCommand {
  const parsed = parseArgs(argv);
  const [command = 'listen', subcommand] = parsed.positionals;
  if (
    command === 'help' ||
    command === '-h' ||
    booleanOption(parsed, 'help') ||
    booleanOption(parsed, 'h')
  ) {
    return { kind: 'help' };
  }

  if (command === 'listen') {
    return {
      kind: 'listen',
      options: {
        apiUrl: stringOption(parsed, env, 'api-url', 'TYXTER_API_URL') ?? 'http://localhost:3001',
        apiKey: requiredString(parsed, env, 'api-key', 'TYXTER_API_KEY'),
        forwardTo: requiredString(parsed, env, 'forward-to', 'TYXTER_WEBHOOK_FORWARD_URL'),
        signingSecret: stringOption(parsed, env, 'secret', 'TYXTER_WEBHOOK_SECRET'),
        cursor: stringOption(parsed, env, 'cursor', 'TYXTER_WEBHOOK_CURSOR'),
        eventType: stringOption(parsed, env, 'event-type', 'TYXTER_WEBHOOK_EVENT_TYPE'),
        limit: numberOption(parsed, env, 'limit', 'TYXTER_WEBHOOK_LIMIT', 20),
        pollIntervalMs: numberOption(
          parsed,
          env,
          'poll-interval-ms',
          'TYXTER_WEBHOOK_POLL_INTERVAL_MS',
          1_000,
        ),
        once: booleanOption(parsed, 'once'),
        stateDir: stateDirOption(parsed, env),
      },
    };
  }

  if (command === 'simulate' && subcommand === 'inbound') {
    return {
      kind: 'simulate-inbound',
      options: {
        apiUrl: stringOption(parsed, env, 'api-url', 'TYXTER_API_URL') ?? 'http://localhost:3001',
        apiKey: requiredString(parsed, env, 'api-key', 'TYXTER_API_KEY'),
        from: requiredString(parsed, env, 'from', 'TYXTER_SIMULATE_FROM'),
        to: requiredString(parsed, env, 'to', 'TYXTER_SIMULATE_TO'),
        body: stringOption(parsed, env, 'body', 'TYXTER_SIMULATE_BODY') ?? 'Hello from Tyxter',
        traceId: stringOption(parsed, env, 'trace-id', 'TYXTER_TRACE_ID'),
        idempotencyKey: stringOption(parsed, env, 'idempotency-key', 'TYXTER_IDEMPOTENCY_KEY'),
      },
    };
  }

  if (command === 'tour') {
    return {
      kind: 'tour',
      options: {
        apiUrl: stringOption(parsed, env, 'api-url', 'TYXTER_API_URL') ?? 'http://localhost:3001',
        apiKey: requiredString(parsed, env, 'api-key', 'TYXTER_API_KEY'),
        forwardTo: requiredString(parsed, env, 'forward-to', 'TYXTER_WEBHOOK_FORWARD_URL'),
        signingSecret:
          stringOption(parsed, env, 'secret', 'TYXTER_WEBHOOK_SECRET') ??
          createListenSigningSecret(),
        from: requiredString(parsed, env, 'from', 'TYXTER_SIMULATE_FROM'),
        to: requiredString(parsed, env, 'to', 'TYXTER_SIMULATE_TO'),
        body: stringOption(parsed, env, 'body', 'TYXTER_SIMULATE_BODY') ?? 'Hello from Tyxter',
        cursor: stringOption(parsed, env, 'cursor', 'TYXTER_WEBHOOK_CURSOR'),
        traceId: stringOption(parsed, env, 'trace-id', 'TYXTER_TRACE_ID'),
        idempotencyKey: stringOption(parsed, env, 'idempotency-key', 'TYXTER_IDEMPOTENCY_KEY'),
        pollAttempts: numberOption(parsed, env, 'poll-attempts', 'TYXTER_TOUR_POLL_ATTEMPTS', 5),
        pollIntervalMs: numberOption(
          parsed,
          env,
          'poll-interval-ms',
          'TYXTER_WEBHOOK_POLL_INTERVAL_MS',
          1_000,
        ),
      },
    };
  }

  if (command === 'doctor') {
    return {
      kind: 'doctor',
      options: {
        apiUrl: stringOption(parsed, env, 'api-url', 'TYXTER_API_URL') ?? 'http://localhost:3001',
        apiKey: requiredString(parsed, env, 'api-key', 'TYXTER_API_KEY'),
        forwardTo: requiredString(parsed, env, 'forward-to', 'TYXTER_WEBHOOK_FORWARD_URL'),
        signingSecret: stringOption(parsed, env, 'secret', 'TYXTER_WEBHOOK_SECRET'),
        stateDir: stateDirOption(parsed, env),
      },
    };
  }

  if (command === 'status') {
    return {
      kind: 'status',
      options: {
        stateDir: stateDirOption(parsed, env),
      },
    };
  }

  return { kind: 'help' };
}

export function helpText(): string {
  return [
    'Tyxter CLI',
    '',
    'Usage:',
    '  tyxter listen --api-key <tx_sandbox_...> --forward-to <url>',
    '  tyxter simulate inbound --api-key <tx_sandbox_...> --from <phone> --to <phone>',
    '  tyxter tour --api-key <tx_sandbox_...> --forward-to <url> --from <phone> --to <phone>',
    '  tyxter doctor --api-key <tx_sandbox_...> --forward-to <url>',
    '  tyxter status',
    '',
    'Environment:',
    '  TYXTER_API_URL=http://localhost:3001',
    '  TYXTER_API_KEY=tx_sandbox_...',
    '  TYXTER_WEBHOOK_FORWARD_URL=http://host.docker.internal:4242/webhooks/tyxter',
    '  TYXTER_WEBHOOK_SECRET=whsec_listen_...',
    '  TYXTER_CLI_STATE_DIR=/data',
  ].join('\n');
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    const equals = raw.indexOf('=');
    if (equals >= 0) {
      options[raw.slice(0, equals)] = raw.slice(equals + 1);
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      options[raw] = true;
      continue;
    }
    options[raw] = next;
    i += 1;
  }

  return { positionals, options };
}

function requiredString(
  parsed: ParsedArgs,
  env: NodeJS.ProcessEnv,
  flag: string,
  envKey: string,
): string {
  const value = stringOption(parsed, env, flag, envKey);
  if (!value) throw new Error(`Missing required --${flag} or ${envKey}.`);
  return value;
}

function stringOption(
  parsed: ParsedArgs,
  env: NodeJS.ProcessEnv,
  flag: string,
  envKey: string,
): string | undefined {
  const value = parsed.options[flag];
  if (typeof value === 'string' && value.length > 0) return value;
  const envValue = env[envKey];
  if (envValue && envValue.length > 0) return envValue;
  return undefined;
}

function numberOption(
  parsed: ParsedArgs,
  env: NodeJS.ProcessEnv,
  flag: string,
  envKey: string,
  fallback: number,
): number {
  const raw = stringOption(parsed, env, flag, envKey);
  if (!raw) return fallback;
  const parsedNumber = Number(raw);
  if (!Number.isInteger(parsedNumber) || parsedNumber <= 0) {
    throw new Error(`--${flag} must be a positive integer.`);
  }
  return parsedNumber;
}

function booleanOption(parsed: ParsedArgs, flag: string): boolean {
  const value = parsed.options[flag];
  if (value === undefined) return false;
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function stateDirOption(parsed: ParsedArgs, env: NodeJS.ProcessEnv): string {
  return (
    stringOption(parsed, env, 'state-dir', 'TYXTER_CLI_STATE_DIR') ??
    stringOption(parsed, env, 'state-dir', 'TYXTER_LISTENER_STATE_DIR') ??
    DEFAULT_STATE_DIR
  );
}

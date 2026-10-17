import type { DoctorOptions } from './doctor.js';
import type { ResendListenEventOptions } from './events.js';
import type { RunListenerOptions } from './listener.js';
import type { TailWebhookLogsOptions } from './logs.js';
import type { CheckpointOptions } from './checkpoint.js';
import type { SimulateInboundOptions } from './simulate.js';
import { DEFAULT_STATE_DIR } from './state.js';
import type { StatusOptions } from './status.js';
import type { TourOptions } from './tour.js';

export const DEFAULT_API_URL = 'https://api.tyxter.com';

export type CliCommand =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'listen'; options: CliListenOptions }
  | { kind: 'listen-production'; options: CliProductionListenOptions }
  | { kind: 'print-secret'; options: CliPrintSecretOptions }
  | { kind: 'checkpoint'; options: CliCheckpointOptions }
  | { kind: 'simulate-inbound'; options: CliSimulateInboundOptions }
  | { kind: 'events-resend'; options: CliEventsResendOptions }
  | { kind: 'logs-tail'; options: CliLogsTailOptions }
  | { kind: 'tour'; options: CliTourOptions }
  | { kind: 'doctor'; options: CliDoctorOptions }
  | { kind: 'status'; options: CliStatusOptions };

export interface CliListenOptions extends Omit<RunListenerOptions, 'signingSecret'> {
  readonly signingSecret?: string;
  readonly fromNow: boolean;
  readonly stateDir: string;
  readonly json: boolean;
}

export interface CliProductionListenOptions
  extends Omit<RunListenerOptions, 'listenSessionId' | 'signingSecret'> {
  readonly signingSecret?: string;
  readonly stateDir: string;
  readonly json: boolean;
  readonly ttlSeconds: number;
  readonly reason?: string;
}

export interface CliCheckpointOptions extends CheckpointOptions {
  readonly signingSecret?: string;
  readonly stateDir: string;
  readonly json: boolean;
}

export interface CliPrintSecretOptions {
  readonly signingSecret?: string;
  readonly stateDir: string;
}

export interface CliSimulateInboundOptions extends SimulateInboundOptions {
  readonly json: boolean;
}

export interface CliEventsResendOptions extends Omit<ResendListenEventOptions, 'signingSecret'> {
  readonly signingSecret?: string;
  readonly stateDir: string;
  readonly json: boolean;
}

export interface CliLogsTailOptions extends TailWebhookLogsOptions {
  readonly json: boolean;
}

export interface CliTourOptions extends Omit<TourOptions, 'signingSecret'> {
  readonly signingSecret?: string;
  readonly stateDir: string;
  readonly json: boolean;
}

export interface CliDoctorOptions extends DoctorOptions {
  readonly json: boolean;
}

export interface CliStatusOptions extends StatusOptions {
  readonly json: boolean;
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

  if (booleanOption(parsed, 'version')) return { kind: 'version' };
  validateCommand(parsed);

  if (command === 'listen') {
    if (subcommand === 'prod' || subcommand === 'production') {
      const eventFilter = eventFilterOptions(parsed, env);
      return {
        kind: 'listen-production',
        options: {
          apiUrl: stringOption(parsed, env, 'api-url', 'TYXTER_API_URL') ?? DEFAULT_API_URL,
          apiKey: requiredString(parsed, env, 'api-key', 'TYXTER_API_KEY'),
          forwardTo: requiredString(parsed, env, 'forward-to', 'TYXTER_WEBHOOK_FORWARD_URL'),
          signingSecret: stringOption(parsed, env, 'secret', 'TYXTER_WEBHOOK_SECRET'),
          ...eventFilter,
          waitMs: boundedNumberOption(parsed, env, 'wait-ms', 'TYXTER_WEBHOOK_WAIT_MS', 25_000, {
            min: 0,
            max: 25_000,
          }),
          limit: numberOption(parsed, env, 'limit', 'TYXTER_WEBHOOK_LIMIT', 20),
          pollIntervalMs: numberOption(
            parsed,
            env,
            'poll-interval-ms',
            'TYXTER_WEBHOOK_POLL_INTERVAL_MS',
            1_000,
          ),
          maxPollIntervalMs: numberOption(
            parsed,
            env,
            'max-poll-interval-ms',
            'TYXTER_WEBHOOK_MAX_POLL_INTERVAL_MS',
            30_000,
          ),
          once: booleanOption(parsed, 'once'),
          stateDir: stateDirOption(parsed, env),
          json: booleanOption(parsed, 'json'),
          ttlSeconds: boundedNumberOption(
            parsed,
            env,
            'ttl-seconds',
            'TYXTER_WEBHOOK_LISTEN_TTL_SECONDS',
            300,
            { min: 30, max: 300 },
          ),
          reason:
            stringOption(parsed, env, 'reason', 'TYXTER_WEBHOOK_LISTEN_REASON') ??
            'tyxter-cli production listen',
        },
      };
    }
    if (booleanOption(parsed, 'print-secret')) {
      return {
        kind: 'print-secret',
        options: {
          signingSecret: stringOption(parsed, env, 'secret', 'TYXTER_WEBHOOK_SECRET'),
          stateDir: stateDirOption(parsed, env),
        },
      };
    }
    const eventFilter = eventFilterOptions(parsed, env);
    return {
      kind: 'listen',
      options: {
        apiUrl: stringOption(parsed, env, 'api-url', 'TYXTER_API_URL') ?? DEFAULT_API_URL,
        apiKey: requiredString(parsed, env, 'api-key', 'TYXTER_API_KEY'),
        forwardTo: requiredString(parsed, env, 'forward-to', 'TYXTER_WEBHOOK_FORWARD_URL'),
        signingSecret: stringOption(parsed, env, 'secret', 'TYXTER_WEBHOOK_SECRET'),
        cursor: stringOption(parsed, env, 'cursor', 'TYXTER_WEBHOOK_CURSOR'),
        ...eventFilter,
        waitMs: boundedNumberOption(parsed, env, 'wait-ms', 'TYXTER_WEBHOOK_WAIT_MS', 25_000, {
          min: 0,
          max: 25_000,
        }),
        limit: numberOption(parsed, env, 'limit', 'TYXTER_WEBHOOK_LIMIT', 20),
        pollIntervalMs: numberOption(
          parsed,
          env,
          'poll-interval-ms',
          'TYXTER_WEBHOOK_POLL_INTERVAL_MS',
          1_000,
        ),
        maxPollIntervalMs: numberOption(
          parsed,
          env,
          'max-poll-interval-ms',
          'TYXTER_WEBHOOK_MAX_POLL_INTERVAL_MS',
          30_000,
        ),
        once: booleanOption(parsed, 'once'),
        fromNow: booleanOption(parsed, 'from-now'),
        stateDir: stateDirOption(parsed, env),
        json: booleanOption(parsed, 'json'),
      },
    };
  }

  if (command === 'checkpoint') {
    const eventFilter = eventFilterOptions(parsed, env);
    return {
      kind: 'checkpoint',
      options: {
        apiUrl: stringOption(parsed, env, 'api-url', 'TYXTER_API_URL') ?? DEFAULT_API_URL,
        apiKey: requiredString(parsed, env, 'api-key', 'TYXTER_API_KEY'),
        signingSecret: stringOption(parsed, env, 'secret', 'TYXTER_WEBHOOK_SECRET'),
        cursor: stringOption(parsed, env, 'cursor', 'TYXTER_WEBHOOK_CURSOR'),
        ...eventFilter,
        limit: numberOption(parsed, env, 'limit', 'TYXTER_WEBHOOK_LIMIT', 100),
        stateDir: stateDirOption(parsed, env),
        json: booleanOption(parsed, 'json'),
      },
    };
  }

  if (command === 'simulate' && subcommand === 'inbound') {
    return {
      kind: 'simulate-inbound',
      options: {
        apiUrl: stringOption(parsed, env, 'api-url', 'TYXTER_API_URL') ?? DEFAULT_API_URL,
        apiKey: requiredString(parsed, env, 'api-key', 'TYXTER_API_KEY'),
        channel: channelOption(parsed, env),
        from: requiredString(parsed, env, 'from', 'TYXTER_SIMULATE_FROM'),
        to: requiredString(parsed, env, 'to', 'TYXTER_SIMULATE_TO'),
        body: stringOption(parsed, env, 'body', 'TYXTER_SIMULATE_BODY') ?? 'Hello from Tyxter',
        traceId: stringOption(parsed, env, 'trace-id', 'TYXTER_TRACE_ID'),
        idempotencyKey: stringOption(parsed, env, 'idempotency-key', 'TYXTER_IDEMPOTENCY_KEY'),
        json: booleanOption(parsed, 'json'),
      },
    };
  }

  if (command === 'events' && subcommand === 'resend') {
    const eventId = parsed.positionals[2];
    if (!eventId) throw new Error('Missing event id for events resend.');
    return {
      kind: 'events-resend',
      options: {
        apiUrl: stringOption(parsed, env, 'api-url', 'TYXTER_API_URL') ?? DEFAULT_API_URL,
        apiKey: requiredString(parsed, env, 'api-key', 'TYXTER_API_KEY'),
        eventId,
        forwardTo: requiredString(parsed, env, 'forward-to', 'TYXTER_WEBHOOK_FORWARD_URL'),
        signingSecret: stringOption(parsed, env, 'secret', 'TYXTER_WEBHOOK_SECRET'),
        stateDir: stateDirOption(parsed, env),
        json: booleanOption(parsed, 'json'),
      },
    };
  }

  if (command === 'logs' && subcommand === 'tail') {
    const eventFilter = eventFilterOptions(parsed, env);
    return {
      kind: 'logs-tail',
      options: {
        apiUrl: stringOption(parsed, env, 'api-url', 'TYXTER_API_URL') ?? DEFAULT_API_URL,
        apiKey: requiredString(parsed, env, 'api-key', 'TYXTER_API_KEY'),
        ...eventFilter,
        status: statusOption(parsed),
        last: boundedNumberOption(parsed, env, 'last', 'TYXTER_LOGS_LAST', 0, {
          min: 0,
          max: 100,
        }),
        pollIntervalMs: numberOption(
          parsed,
          env,
          'poll-interval-ms',
          'TYXTER_WEBHOOK_POLL_INTERVAL_MS',
          1_000,
        ),
        json: booleanOption(parsed, 'json'),
      },
    };
  }

  if (command === 'tour') {
    return {
      kind: 'tour',
      options: {
        apiUrl: stringOption(parsed, env, 'api-url', 'TYXTER_API_URL') ?? DEFAULT_API_URL,
        apiKey: requiredString(parsed, env, 'api-key', 'TYXTER_API_KEY'),
        forwardTo: requiredString(parsed, env, 'forward-to', 'TYXTER_WEBHOOK_FORWARD_URL'),
        signingSecret: stringOption(parsed, env, 'secret', 'TYXTER_WEBHOOK_SECRET'),
        stateDir: stateDirOption(parsed, env),
        channel: channelOption(parsed, env),
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
        json: booleanOption(parsed, 'json'),
      },
    };
  }

  if (command === 'doctor') {
    return {
      kind: 'doctor',
      options: {
        apiUrl: stringOption(parsed, env, 'api-url', 'TYXTER_API_URL') ?? DEFAULT_API_URL,
        apiKey: requiredString(parsed, env, 'api-key', 'TYXTER_API_KEY'),
        forwardTo: requiredString(parsed, env, 'forward-to', 'TYXTER_WEBHOOK_FORWARD_URL'),
        signingSecret: stringOption(parsed, env, 'secret', 'TYXTER_WEBHOOK_SECRET'),
        stateDir: stateDirOption(parsed, env),
        json: booleanOption(parsed, 'json'),
      },
    };
  }

  if (command === 'status') {
    if (booleanOption(parsed, 'print-secret')) {
      return {
        kind: 'print-secret',
        options: {
          signingSecret: stringOption(parsed, env, 'secret', 'TYXTER_WEBHOOK_SECRET'),
          stateDir: stateDirOption(parsed, env),
        },
      };
    }
    return {
      kind: 'status',
      options: {
        stateDir: stateDirOption(parsed, env),
        json: booleanOption(parsed, 'json'),
      },
    };
  }

  throw new Error(`Unknown command: ${parsed.positionals.join(' ')}`);
}

export function helpText(): string {
  return [
    'Tyxter CLI',
    '',
    'Usage:',
    '  tyxter --version',
    '  tyxter listen --api-key <tx_sandbox_...> --forward-to <url>',
    '  tyxter listen prod --api-key <tx_live_...> --forward-to <url> [--ttl-seconds 300]',
    '  tyxter listen --from-now --api-key <tx_sandbox_...> --forward-to <url>',
    '  tyxter listen --events "message.received,message.delivered" --api-key <tx_sandbox_...> --forward-to <url>',
    '  tyxter listen --print-secret',
    '  tyxter listen --wait-ms 25000 --api-key <tx_sandbox_...> --forward-to <url>',
    '  tyxter checkpoint --api-key <tx_sandbox_...>',
    '  tyxter events resend <event_id> --api-key <tx_sandbox_...> --forward-to <url>',
    '  tyxter logs tail --api-key <tx_sandbox_...> --events message.received --json',
    '  tyxter simulate inbound --api-key <tx_sandbox_...> --from <identity> --to <identity> [--channel whatsapp|instagram]',
    '  tyxter tour --api-key <tx_sandbox_...> --forward-to <url> --from <identity> --to <identity> [--channel whatsapp|instagram]',
    '  tyxter doctor --api-key <tx_sandbox_...> --forward-to <url>',
    '  tyxter status',
    '  tyxter status --print-secret',
    '',
    'Options:',
    '  --state-dir <path>  Shared local signing state (also used by tour)',
    '  --json              JSON output (JSON Lines for streaming commands)',
    '  --help, -h          Show help',
    '  --version, -V       Show the package version',
    '',
    'Environment:',
    `  TYXTER_API_URL=${DEFAULT_API_URL}`,
    '  TYXTER_API_KEY=tx_sandbox_...',
    '  TYXTER_WEBHOOK_FORWARD_URL=http://host.docker.internal:4242/webhooks/tyxter',
    '  TYXTER_WEBHOOK_SECRET=whsec_listen_...',
    '  TYXTER_WEBHOOK_EVENTS=message.received,message.delivered',
    '  TYXTER_WEBHOOK_LISTEN_TTL_SECONDS=300',
    '  TYXTER_SIMULATE_CHANNEL=whatsapp',
    '  TYXTER_WEBHOOK_WAIT_MS=25000',
    '  TYXTER_WEBHOOK_MAX_POLL_INTERVAL_MS=30000',
    '  TYXTER_CLI_STATE_DIR=/data',
  ].join('\n');
}

const BOOLEAN_FLAGS = new Set(['help', 'h', 'version', 'once', 'from-now', 'json', 'print-secret']);
const COMMON_FLAGS = ['api-url', 'api-key', 'json'];
const STATE_FLAGS = ['secret', 'state-dir'];
const FILTER_FLAGS = ['event-type', 'events'];
const TIMING_FLAGS = ['poll-interval-ms', 'max-poll-interval-ms', 'wait-ms', 'limit'];
const SIMULATE_FLAGS = ['from', 'to', 'body', 'channel', 'trace-id', 'idempotency-key'];
const COMMAND_FLAGS: Record<string, readonly string[]> = {
  listen: [
    ...COMMON_FLAGS, ...STATE_FLAGS, ...FILTER_FLAGS, ...TIMING_FLAGS,
    'forward-to', 'cursor', 'once', 'from-now', 'print-secret',
  ],
  'listen prod': [
    ...COMMON_FLAGS, ...STATE_FLAGS, ...FILTER_FLAGS, ...TIMING_FLAGS,
    'forward-to', 'once', 'ttl-seconds', 'reason',
  ],
  checkpoint: [...COMMON_FLAGS, ...STATE_FLAGS, ...FILTER_FLAGS, 'cursor', 'limit'],
  'simulate inbound': [...COMMON_FLAGS, ...SIMULATE_FLAGS],
  'events resend': [...COMMON_FLAGS, ...STATE_FLAGS, 'forward-to'],
  'logs tail': [...COMMON_FLAGS, ...FILTER_FLAGS, 'status', 'last', 'poll-interval-ms'],
  tour: [
    ...COMMON_FLAGS, ...STATE_FLAGS, ...SIMULATE_FLAGS,
    'forward-to', 'cursor', 'poll-attempts', 'poll-interval-ms',
  ],
  doctor: [...COMMON_FLAGS, ...STATE_FLAGS, 'forward-to'],
  status: [...STATE_FLAGS, 'json', 'print-secret'],
};
const KNOWN_FLAGS = new Set([...BOOLEAN_FLAGS, ...Object.values(COMMAND_FLAGS).flat()]);
const BOOLEAN_VALUES = ['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off'];

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '-h' || arg === '-V') {
      options[arg === '-h' ? 'help' : 'version'] = true;
      continue;
    }
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    const [flag, ...parts] = arg.slice(2).split('=');
    if (!KNOWN_FLAGS.has(flag)) throw new Error(`Unknown option: --${flag}`);
    const inline = parts.length > 0 ? parts.join('=') : undefined;
    const next = argv[i + 1];
    if (BOOLEAN_FLAGS.has(flag)) {
      const value = inline ?? (
        next && BOOLEAN_VALUES.includes(next.toLowerCase()) ? argv[++i] : undefined
      );
      if (value !== undefined && !BOOLEAN_VALUES.includes(value.toLowerCase())) {
        throw new Error(`--${flag} must be a boolean`);
      }
      options[flag] = value ?? true;
    } else {
      const value = inline ?? (next && !next.startsWith('-') ? argv[++i] : undefined);
      if (value === undefined || value.length === 0) throw new Error(`Missing value for --${flag}`);
      options[flag] = value;
    }
  }
  return { positionals, options };
}

function validateCommand(parsed: ParsedArgs): void {
  const [command = 'listen', subcommand] = parsed.positionals;
  let key = command;
  let count = 1;
  if (command === 'listen' && subcommand) {
    if (subcommand !== 'prod' && subcommand !== 'production') {
      throw new Error(`Unknown listen mode: ${subcommand}`);
    }
    key = 'listen prod';
    count = 2;
  } else if (['simulate', 'events', 'logs'].includes(command)) {
    key = `${command} ${subcommand ?? ''}`;
    count = command === 'events' ? 3 : 2;
  }
  const allowed = COMMAND_FLAGS[key];
  if (!allowed) throw new Error(`Unknown command: ${parsed.positionals.join(' ')}`);
  if (parsed.positionals.length > count) throw new Error('Unexpected positional arguments');
  for (const flag of Object.keys(parsed.options)) {
    if (!['help', 'h', 'version'].includes(flag) && !allowed.includes(flag)) {
      throw new Error(`--${flag} is not supported by ${key}`);
    }
  }
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

function channelOption(
  parsed: ParsedArgs,
  env: NodeJS.ProcessEnv,
): 'whatsapp' | 'instagram' | undefined {
  const value = stringOption(parsed, env, 'channel', 'TYXTER_SIMULATE_CHANNEL');
  if (value === undefined) return undefined;
  if (value === 'whatsapp' || value === 'instagram') return value;
  throw new Error('Invalid --channel. Expected whatsapp or instagram.');
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

function boundedNumberOption(
  parsed: ParsedArgs,
  env: NodeJS.ProcessEnv,
  flag: string,
  envKey: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const raw = stringOption(parsed, env, flag, envKey);
  if (!raw) return fallback;
  const parsedNumber = Number(raw);
  if (
    !Number.isInteger(parsedNumber) ||
    parsedNumber < bounds.min ||
    parsedNumber > bounds.max
  ) {
    throw new Error(`--${flag} must be an integer from ${bounds.min} to ${bounds.max}.`);
  }
  return parsedNumber;
}

function eventFilterOptions(
  parsed: ParsedArgs,
  env: NodeJS.ProcessEnv,
): { eventType?: string; eventTypes?: string[] } {
  const eventType = stringOption(parsed, env, 'event-type', 'TYXTER_WEBHOOK_EVENT_TYPE');
  const eventTypesRaw = stringOption(parsed, env, 'events', 'TYXTER_WEBHOOK_EVENTS');
  if (eventType && eventTypesRaw) {
    throw new Error('--event-type and --events cannot be used together.');
  }
  if (!eventTypesRaw) return eventType ? { eventType } : {};
  const eventTypes = eventTypesRaw.split(',').map((value) => value.trim());
  if (eventTypes.length === 0 || eventTypes.some((value) => value.length === 0)) {
    throw new Error('--events must be a comma-separated list of event types.');
  }
  return { eventTypes: [...new Set(eventTypes)] };
}

function statusOption(
  parsed: ParsedArgs,
): 'pending' | 'delivered' | 'failed' | undefined {
  const raw = parsed.options.status;
  if (raw === undefined) return undefined;
  if (raw !== 'pending' && raw !== 'delivered' && raw !== 'failed') {
    throw new Error('--status must be pending, delivered, or failed.');
  }
  return raw;
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

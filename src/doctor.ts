import { endpointUrl, type FetchLike } from './http.js';
import { FORWARDED_WEBHOOK_HEADERS, readListenPage } from './listener.js';
import { signWebhook } from './signature.js';
import { resolveListenerState } from './state.js';

export interface DoctorOptions {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly forwardTo: string;
  readonly signingSecret?: string;
  readonly stateDir: string;
  readonly fetchFn?: FetchLike;
  readonly now?: () => Date;
}

export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly message: string;
}

export interface DoctorResult {
  readonly object: 'tyxter_cli_doctor';
  readonly ok: boolean;
  readonly state_dir: string;
  readonly signing_secret: string | null;
  readonly cursor: string | null;
  readonly checks: readonly DoctorCheck[];
}

interface FetchErrorCause extends Error {
  readonly address?: string;
  readonly code?: string;
  readonly port?: number | string;
  readonly syscall?: string;
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  let signingSecret: string | null = null;
  let cursor: string | null = null;

  try {
    const state = await resolveListenerState({
      stateDir: options.stateDir,
      signingSecret: options.signingSecret,
      now: options.now,
    });
    signingSecret = state.signingSecret;
    cursor = state.cursor;
    checks.push({
      name: 'state',
      ok: true,
      message: `State is writable at ${options.stateDir}.`,
    });
  } catch (error) {
    checks.push({
      name: 'state',
      ok: false,
      message: errorMessage(error),
    });
  }

  try {
    await readListenPage({
      apiUrl: options.apiUrl,
      apiKey: options.apiKey,
      limit: 1,
      cursor: cursor ?? undefined,
      fetchFn: options.fetchFn,
    });
    checks.push({
      name: 'api',
      ok: true,
      message: `${endpointUrl(options.apiUrl, '/v1/webhook-events/listen')} accepted the sandbox key.`,
    });
  } catch (error) {
    checks.push({
      name: 'api',
      ok: false,
      message: errorMessage(error),
    });
  }

  if (signingSecret) {
    checks.push(await probeForwardUrl({ ...options, signingSecret }));
  } else {
    checks.push({
      name: 'forward',
      ok: false,
      message: 'Skipped forward URL probe because no signing secret is available.',
    });
  }

  return {
    object: 'tyxter_cli_doctor',
    ok: checks.every((check) => check.ok),
    state_dir: options.stateDir,
    signing_secret: signingSecret,
    cursor,
    checks,
  };
}

async function probeForwardUrl(
  options: DoctorOptions & { readonly signingSecret: string },
): Promise<DoctorCheck> {
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now?.() ?? new Date();
  const payload = {
    id: 'evt_listener_diagnostic',
    type: 'listener.diagnostic',
    created_at: now.toISOString(),
    environment: 'sandbox',
    trace_id: 'trc_listener_diagnostic',
    data: {
      message: 'Tyxter listener diagnostic probe',
    },
  };
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Math.floor(now.getTime() / 1000));
  let response: Response;
  try {
    response = await fetchFn(options.forwardTo, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [FORWARDED_WEBHOOK_HEADERS.ID]: payload.id,
        [FORWARDED_WEBHOOK_HEADERS.TIMESTAMP]: timestamp,
        [FORWARDED_WEBHOOK_HEADERS.SIGNATURE]: signWebhook(
          options.signingSecret,
          timestamp,
          rawBody,
        ),
      },
      body: rawBody,
    });
  } catch (error) {
    return {
      name: 'forward',
      ok: false,
      message: `${options.forwardTo} failed: ${errorMessage(error)}`,
    };
  }

  if (response.ok) {
    return {
      name: 'forward',
      ok: true,
      message: `${options.forwardTo} accepted a signed diagnostic webhook with HTTP ${response.status}.`,
    };
  }

  return {
    name: 'forward',
    ok: false,
    message: `${options.forwardTo} returned HTTP ${response.status}.`,
  };
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  const causeMessage = causeDiagnostic(cause);
  return causeMessage ? `${error.message}: ${causeMessage}` : error.message;
}

function causeDiagnostic(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return cause === undefined ? undefined : String(cause);
  const detail = cause as FetchErrorCause;
  const address = detail.address ? String(detail.address) : undefined;
  const port = detail.port === undefined ? undefined : String(detail.port);
  const endpoint = address && port ? `${address}:${port}` : address ?? port;
  const parts = [detail.code, detail.syscall, endpoint].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  if (parts.length > 0) return parts.join(' ');
  return cause.message;
}

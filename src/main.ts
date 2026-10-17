#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import { parseCli, helpText } from './args.js';
import { checkpointListenCursor } from './checkpoint.js';
import { runDoctor } from './doctor.js';
import { resendListenEvent } from './events.js';
import { HttpStatusError } from './http.js';
import {
  createWebhookListenSession,
  disableWebhookListenSession,
} from './listen-session.js';
import { runListener } from './listener.js';
import { tailWebhookLogs } from './logs.js';
import type { WebhookEventLog } from './schemas.js';
import { simulateInboundMessage } from './simulate.js';
import { readStatus } from './status.js';
import { resolveListenerState, writeListenerState } from './state.js';
import { runTour } from './tour.js';

async function main(): Promise<void> {
  try {
    const command = parseCli(process.argv.slice(2), process.env);
    if (command.kind === 'version') {
      const metadata = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
      ) as { version: string };
      console.log(metadata.version);
      return;
    }
    if (command.kind === 'help') {
      console.log(helpText());
      return;
    }

    if (command.kind === 'print-secret') {
      const state = await resolveListenerState({
        stateDir: command.options.stateDir,
        signingSecret: command.options.signingSecret,
      });
      console.log(state.signingSecret);
      return;
    }

    if (command.kind === 'listen-production') {
      const {
        stateDir,
        json,
        signingSecret: explicitSigningSecret,
        ttlSeconds,
        reason,
        ...listenOptions
      } = command.options;
      assertProductionApiKey(listenOptions.apiKey);
      const listenerState = await resolveListenerState({
        stateDir,
        signingSecret: explicitSigningSecret,
      });
      let session:
        | Awaited<ReturnType<typeof createWebhookListenSession>>
        | undefined;
      let primaryError: unknown;
      const controller = new AbortController();
      const removeSignalHandlers = bindAbortSignals(controller);

      try {
        session = await createWebhookListenSession({
          apiUrl: listenOptions.apiUrl,
          apiKey: listenOptions.apiKey,
          ttlSeconds,
          reason,
        });
        if (json) {
          console.log(
            compactJson({
              object: 'tyxter_cli_listen_session',
              action: 'created',
              listen_session_id: session.id,
              expires_at: session.expires_at,
              trace_id: session.trace_id,
            }),
          );
        } else {
          console.log(`Opened production listen session ${session.id}`);
          console.log(`Expires at: ${session.expires_at}`);
          console.log(`Forwarding production webhooks to ${listenOptions.forwardTo}`);
          console.log(`State directory: ${stateDir}`);
          console.log(`Local signing secret: ${listenerState.signingSecret}`);
        }

        const expiresInMs = Math.min(
          ttlSeconds * 1000, Math.max(0, Date.parse(session.expires_at) - Date.now()),
        );
        const expiryTimer = setTimeout(() => controller.abort(), expiresInMs);
        expiryTimer.unref();
        try {
          await runListener({
            ...listenOptions,
            signingSecret: listenerState.signingSecret,
            cursor: listenOptions.cursor,
            listenSessionId: session.id,
            signal: controller.signal,
            onStart: ({ signingSecret, cursor }) => {
              if (json) {
                console.log(
                  compactJson({
                    object: 'tyxter_cli_listen_start',
                    environment: 'production',
                    forward_to: listenOptions.forwardTo,
                    listen_session_id: session?.id,
                    expires_at: session?.expires_at,
                    signing_secret: signingSecret,
                    cursor,
                  }),
                );
                return;
              }
              if (cursor) console.log(`Starting after cursor: ${cursor}`);
              console.log('The session will be disabled when the command exits.');
            },
            onRateLimited: ({ retryAfterMs }) => {
              if (json) {
                console.log(
                  compactJson({
                    object: 'tyxter_cli_listen_rate_limited',
                    retry_after_ms: retryAfterMs,
                  }),
                );
                return;
              }
              console.log(`Listen rate limited; retrying after ${retryAfterMs}ms`);
            },
            onBatch: ({ delivered, eventIds, cursor, hasMore }) => {
              if (json) {
                console.log(
                  compactJson({
                    object: 'tyxter_cli_listen_batch',
                    environment: 'production',
                    listen_session_id: session?.id,
                    delivered,
                    event_ids: eventIds,
                    cursor,
                    has_more: hasMore,
                  }),
                );
                return;
              }
              if (delivered > 0) {
                const ids = eventIds.length > 0 ? `; event_ids=${eventIds.join(',')}` : '';
                console.log(
                  `Forwarded ${delivered} event${delivered === 1 ? '' : 's'}; cursor=${cursor ?? ''}${ids}`,
                );
              } else if (!hasMore) {
                console.log('No new events.');
              }
            },
          });
        } finally {
          clearTimeout(expiryTimer);
        }
      } catch (error) {
        primaryError = error;
        throw error;
      } finally {
        try {
          if (session) {
            try {
              const disabled = await disableWebhookListenSession({
                apiUrl: listenOptions.apiUrl,
                apiKey: listenOptions.apiKey,
                listenSessionId: session.id,
              });
              if (json) {
                console.log(
                  compactJson({
                    object: 'tyxter_cli_listen_session',
                    action: 'disabled',
                    listen_session_id: disabled.id,
                    status: disabled.status,
                    disabled_at: disabled.disabled_at,
                  }),
                );
              } else {
                console.log(`Disabled production listen session ${disabled.id}`);
              }
            } catch (cleanupError) {
              if (!primaryError) throw cleanupError;
              printCleanupWarning(cleanupError, json, session.id);
            }
          }
        } finally {
          removeSignalHandlers();
        }
      }
      return;
    }

    if (command.kind === 'listen') {
      const {
        stateDir,
        json,
        signingSecret: explicitSigningSecret,
        fromNow,
        ...listenOptions
      } = command.options;
      assertSandboxApiKey(listenOptions.apiKey, 'tyxter listen');
      const listenerState = await resolveListenerState({
        stateDir,
        signingSecret: explicitSigningSecret,
        cursor: listenOptions.cursor,
      });
      let startCursor = listenerState.cursor;
      if (fromNow) {
        const checkpoint = await checkpointListenCursor({
          apiUrl: listenOptions.apiUrl,
          apiKey: listenOptions.apiKey,
          cursor: startCursor ?? undefined,
          eventType: listenOptions.eventType,
          eventTypes: listenOptions.eventTypes,
          limit: listenOptions.limit,
        });
        startCursor = checkpoint.cursor ?? startCursor;
        await writeListenerState(stateDir, {
          signingSecret: listenerState.signingSecret,
          cursor: startCursor,
          updatedAt: new Date().toISOString(),
        });
        if (json) {
          console.log(compactJson({
            object: 'tyxter_cli_listen_checkpoint',
            skipped: checkpoint.skipped,
            cursor: startCursor,
          }));
        } else {
          console.log(
            `Checkpointed ${checkpoint.skipped} existing event${checkpoint.skipped === 1 ? '' : 's'}; cursor=${startCursor ?? ''}`,
          );
        }
      }
      const controller = new AbortController();
      process.once('SIGINT', () => controller.abort());
      process.once('SIGTERM', () => controller.abort());
      await runListener({
        ...listenOptions,
        signingSecret: listenerState.signingSecret,
        cursor: startCursor ?? undefined,
        signal: controller.signal,
        onStart: ({ signingSecret, cursor }) => {
          if (json) {
            console.log(
              compactJson({
                object: 'tyxter_cli_listen_start',
                forward_to: listenOptions.forwardTo,
                state_dir: stateDir,
                signing_secret: signingSecret,
                cursor,
              }),
            );
            return;
          }
          console.log(`Forwarding sandbox webhooks to ${listenOptions.forwardTo}`);
          console.log(`State directory: ${stateDir}`);
          console.log(`Local signing secret: ${signingSecret}`);
          if (cursor) console.log(`Starting after cursor: ${cursor}`);
        },
        onRateLimited: ({ retryAfterMs }) => {
          if (json) {
            console.log(
              compactJson({
                object: 'tyxter_cli_listen_rate_limited',
                retry_after_ms: retryAfterMs,
              }),
            );
            return;
          }
          console.log(`Listen rate limited; retrying after ${retryAfterMs}ms`);
        },
        onBatch: async ({ delivered, eventIds, cursor, hasMore }) => {
          await writeListenerState(stateDir, {
            signingSecret: listenerState.signingSecret,
            cursor,
            updatedAt: new Date().toISOString(),
          });
          if (json) {
            console.log(
              compactJson({
                object: 'tyxter_cli_listen_batch',
                delivered,
                event_ids: eventIds,
                cursor,
                has_more: hasMore,
              }),
            );
            return;
          }
          if (delivered > 0) {
            const ids = eventIds.length > 0 ? `; event_ids=${eventIds.join(',')}` : '';
            console.log(
              `Forwarded ${delivered} event${delivered === 1 ? '' : 's'}; cursor=${cursor ?? ''}${ids}`,
            );
          } else if (!hasMore) {
            console.log('No new events.');
          }
        },
      });
      return;
    }

    if (command.kind === 'checkpoint') {
      const { stateDir, json, signingSecret: explicitSigningSecret, ...checkpointOptions } =
        command.options;
      assertSandboxApiKey(checkpointOptions.apiKey, 'tyxter checkpoint');
      const listenerState = await resolveListenerState({
        stateDir,
        signingSecret: explicitSigningSecret,
        cursor: checkpointOptions.cursor,
      });
      const result = await checkpointListenCursor({
        ...checkpointOptions,
        cursor: listenerState.cursor ?? undefined,
      });
      await writeListenerState(stateDir, {
        signingSecret: listenerState.signingSecret,
        cursor: result.cursor ?? listenerState.cursor,
        updatedAt: new Date().toISOString(),
      });
      printJson(
        {
          object: 'tyxter_cli_checkpoint',
          state_dir: stateDir,
          skipped: result.skipped,
          pages: result.pages,
          cursor: result.cursor ?? listenerState.cursor,
        },
        json,
      );
      return;
    }

    if (command.kind === 'doctor') {
      assertSandboxApiKey(command.options.apiKey, 'tyxter doctor');
      const result = await runDoctor(command.options);
      printJson(result, command.options.json);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    if (command.kind === 'status') {
      printJson(await readStatus(command.options), command.options.json);
      return;
    }

    if (command.kind === 'events-resend') {
      const { stateDir, json, signingSecret: explicitSigningSecret, ...resendOptions } =
        command.options;
      assertSandboxApiKey(resendOptions.apiKey, 'tyxter events resend');
      const listenerState = await resolveListenerState({
        stateDir,
        signingSecret: explicitSigningSecret,
      });
      const result = await resendListenEvent({
        ...resendOptions,
        signingSecret: listenerState.signingSecret,
      });
      if (json) {
        console.log(compactJson(result));
      } else {
        console.log(
          `Forwarded ${result.type} event ${result.event_id} to ${result.forward_to}`,
        );
      }
      return;
    }

    if (command.kind === 'logs-tail') {
      const { json, ...tailOptions } = command.options;
      const controller = new AbortController();
      process.once('SIGINT', () => controller.abort());
      process.once('SIGTERM', () => controller.abort());
      if (!json) console.log(`Tailing webhook events from ${tailOptions.apiUrl}`);
      await tailWebhookLogs({
        ...tailOptions,
        signal: controller.signal,
        onEvent: (event) => {
          console.log(json ? compactJson(event) : formatWebhookEvent(event));
        },
      });
      return;
    }

    if (command.kind === 'tour') {
      assertSandboxApiKey(command.options.apiKey, 'tyxter tour');
      const state = await resolveListenerState({
        stateDir: command.options.stateDir,
        signingSecret: command.options.signingSecret,
      });
      if (!command.options.json) {
        console.log(`Running tour against ${command.options.apiUrl}`);
        console.log(`Forwarding sandbox webhooks to ${command.options.forwardTo}`);
        console.log(`Local signing secret: ${state.signingSecret}`);
      }
      const result = await runTour({
        ...command.options,
        signingSecret: state.signingSecret,
        onStep: command.options.json ? undefined : (message) => console.log(`tour: ${message}`),
      });
      printJson(
        {
          object: 'tyxter_cli_tour',
          message_id: result.simulated.id,
          trace_id: result.simulated.trace_id,
          forwarded: result.listen.delivered,
          event_ids: result.listen.eventIds,
          next_cursor: result.listen.cursor,
          listen_attempts: result.attempts,
        },
        command.options.json,
      );
      return;
    }

    assertSandboxApiKey(command.options.apiKey, 'tyxter simulate inbound');
    const result = await simulateInboundMessage(command.options);
    printJson(result, command.options.json);
  } catch (error) {
    process.exitCode = 1;
    if (error instanceof HttpStatusError) {
      console.error(error.message);
      if (error.body) console.error(error.body);
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
  }
}

function printJson(value: unknown, compact: boolean): void {
  console.log(compact ? compactJson(value) : JSON.stringify(value, null, 2));
}

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

function assertProductionApiKey(apiKey: string): void {
  if (!apiKey.startsWith('tx_live_')) {
    throw new Error(
      'tyxter listen prod requires a production API key (tx_live_...). Use tyxter listen for sandbox keys.',
    );
  }
}

function assertSandboxApiKey(apiKey: string, commandName: string): void {
  if (!apiKey.startsWith('tx_live_')) return;
  throw new Error(
    `${commandName} only supports sandbox API keys. Use tyxter listen prod for a short-lived production listen session.`,
  );
}

function bindAbortSignals(controller: AbortController): () => void {
  const abort = () => controller.abort();
  process.on('SIGINT', abort);
  process.on('SIGTERM', abort);
  return () => {
    process.off('SIGINT', abort);
    process.off('SIGTERM', abort);
  };
}

function printCleanupWarning(error: unknown, json: boolean, listenSessionId: string): void {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    console.error(
      compactJson({
        object: 'tyxter_cli_listen_session_cleanup_failed',
        listen_session_id: listenSessionId,
        error: message,
      }),
    );
    return;
  }
  console.error(`Could not disable production listen session ${listenSessionId}: ${message}`);
}

function formatWebhookEvent(event: WebhookEventLog): string {
  const attempt = event.attempts[event.attempts.length - 1];
  const status = attempt?.status_code ? `${event.status}/${attempt.status_code}` : event.status;
  return `${event.created_at} ${event.id} ${event.type} ${status} trace=${event.trace_id}`;
}

await main();

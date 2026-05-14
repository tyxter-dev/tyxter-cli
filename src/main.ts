#!/usr/bin/env node

import { parseCli, helpText } from './args.js';
import { checkpointListenCursor } from './checkpoint.js';
import { runDoctor } from './doctor.js';
import { resendListenEvent } from './events.js';
import { HttpStatusError } from './http.js';
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

    if (command.kind === 'listen') {
      const {
        stateDir,
        json,
        signingSecret: explicitSigningSecret,
        fromNow,
        ...listenOptions
      } = command.options;
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
          limit: listenOptions.limit,
        });
        startCursor = checkpoint.cursor ?? startCursor;
        await writeListenerState(stateDir, {
          signingSecret: listenerState.signingSecret,
          cursor: startCursor,
          updatedAt: new Date().toISOString(),
        });
        console.log(
          `Checkpointed ${checkpoint.skipped} existing event${checkpoint.skipped === 1 ? '' : 's'}; cursor=${startCursor ?? ''}`,
        );
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
      if (!command.options.json) {
        console.log(`Running tour against ${command.options.apiUrl}`);
        console.log(`Forwarding sandbox webhooks to ${command.options.forwardTo}`);
        console.log(`Local signing secret: ${command.options.signingSecret}`);
      }
      const result = await runTour({
        ...command.options,
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

function formatWebhookEvent(event: WebhookEventLog): string {
  const attempt = event.attempts[event.attempts.length - 1];
  const status = attempt?.status_code ? `${event.status}/${attempt.status_code}` : event.status;
  return `${event.created_at} ${event.id} ${event.type} ${status} trace=${event.trace_id}`;
}

await main();

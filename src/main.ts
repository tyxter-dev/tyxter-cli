#!/usr/bin/env node

import { parseCli, helpText } from './args.js';
import { runDoctor } from './doctor.js';
import { HttpStatusError } from './http.js';
import { runListener } from './listener.js';
import { simulateInboundMessage } from './simulate.js';
import { readStatus } from './status.js';
import { resolveListenerState, writeListenerState } from './state.js';
import { runTour } from './tour.js';

async function main(): Promise<void> {
  try {
    const command = parseCli(process.argv.slice(2), process.env);
    if (command.kind === 'help') {
      console.log(helpText());
      process.exitCode = 1;
      return;
    }

    if (command.kind === 'listen') {
      const { stateDir, signingSecret: explicitSigningSecret, ...listenOptions } = command.options;
      const listenerState = await resolveListenerState({
        stateDir,
        signingSecret: explicitSigningSecret,
        cursor: listenOptions.cursor,
      });
      const controller = new AbortController();
      process.once('SIGINT', () => controller.abort());
      process.once('SIGTERM', () => controller.abort());
      await runListener({
        ...listenOptions,
        signingSecret: listenerState.signingSecret,
        cursor: listenerState.cursor ?? undefined,
        signal: controller.signal,
        onStart: ({ signingSecret, cursor }) => {
          console.log(`Forwarding sandbox webhooks to ${listenOptions.forwardTo}`);
          console.log(`State directory: ${stateDir}`);
          console.log(`Local signing secret: ${signingSecret}`);
          if (cursor) console.log(`Starting after cursor: ${cursor}`);
        },
        onBatch: async ({ delivered, cursor, hasMore }) => {
          await writeListenerState(stateDir, {
            signingSecret: listenerState.signingSecret,
            cursor,
            updatedAt: new Date().toISOString(),
          });
          if (delivered > 0) {
            console.log(
              `Forwarded ${delivered} event${delivered === 1 ? '' : 's'}; cursor=${cursor ?? ''}`,
            );
          } else if (!hasMore) {
            console.log('No new events.');
          }
        },
      });
      return;
    }

    if (command.kind === 'doctor') {
      const result = await runDoctor(command.options);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    if (command.kind === 'status') {
      console.log(JSON.stringify(await readStatus(command.options), null, 2));
      return;
    }

    if (command.kind === 'tour') {
      console.log(`Running tour against ${command.options.apiUrl}`);
      console.log(`Forwarding sandbox webhooks to ${command.options.forwardTo}`);
      console.log(`Local signing secret: ${command.options.signingSecret}`);
      const result = await runTour({
        ...command.options,
        onStep: (message) => console.log(`tour: ${message}`),
      });
      console.log(
        JSON.stringify(
          {
            object: 'webhook_listener_tour',
            message_id: result.simulated.id,
            trace_id: result.simulated.trace_id,
            forwarded: result.listen.delivered,
            next_cursor: result.listen.cursor,
            listen_attempts: result.attempts,
          },
          null,
          2,
        ),
      );
      return;
    }

    const result = await simulateInboundMessage(command.options);
    console.log(JSON.stringify(result, null, 2));
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

await main();

import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';
import { resolveListenerState, readListenerState } from './state.js';
import { verifyWebhookSignature } from './signature.js';

const execFileAsync = promisify(execFile);

describe('listen command output', () => {
  it.each([
    ['listen', '--forward-to', 'http://localhost/hook'],
    ['checkpoint'],
    ['doctor', '--forward-to', 'http://localhost/hook'],
    ['tour', '--forward-to', 'http://localhost/hook', '--from', 'sender', '--to', 'recipient'],
    ['simulate', 'inbound', '--from', 'sender', '--to', 'recipient'],
    ['events', 'resend', 'out_test', '--forward-to', 'http://localhost/hook'],
  ])('rejects live keys before networking for %j', async (...args) => {
    await expect(execFileAsync(process.execPath, [
      '--import', 'tsx', 'src/main.ts', ...args,
      '--api-key', 'tx_live_test', '--api-url', 'http://127.0.0.1:1',
    ], { env: { PATH: process.env.PATH }, timeout: 4000 })).rejects.toMatchObject({
      code: 1, stderr: expect.stringContaining('only supports sandbox API keys'),
    });
  });
  it('keeps --from-now --json output as JSON Lines', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'tyxter-listen-test-'));
    const server = createServer((request, response) => {
      if (!request.url?.startsWith('/v1/webhook-events/listen')) {
        response.writeHead(404).end();
        return;
      }
      expect(new URL(request.url, 'http://localhost').searchParams.get('event_types')).toBe('message.received,message.delivered');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        object: 'webhook_event_listen',
        data: [],
        has_more: false,
        next_cursor: 'cur_test',
      }));
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test server port.');
      const { stdout, stderr } = await execFileAsync(process.execPath, [
        '--import', 'tsx', 'src/main.ts', 'listen', '--from-now', '--json', '--once',
        '--events', 'message.received,message.delivered',
        '--api-url', `http://127.0.0.1:${address.port}`,
        '--api-key', 'tx_sandbox_test',
        '--forward-to', `http://127.0.0.1:${address.port}/webhook`,
        '--state-dir', stateDir,
      ], { timeout: 10_000 });

      expect(stderr).toBe('');
      const lines = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
      expect(lines.map((line) => line.object)).toEqual([
        'tyxter_cli_listen_checkpoint',
        'tyxter_cli_listen_start',
        'tyxter_cli_listen_batch',
      ]);
      expect(lines[0]).toMatchObject({ skipped: 0, cursor: 'cur_test' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it('disables a production session when interrupted during creation and cleanup', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'tyxter-production-test-'));
    const requests: string[] = [];
    let created!: () => void;
    const creation = new Promise<void>((resolve) => { created = resolve; });
    let reply!: () => void;
    let interruptCleanup: () => void = () => {};
    const session = {
      id: 'wls_test', object: 'webhook_listen_session', environment: 'production', status: 'active',
      expires_at: new Date(Date.now() + 30_000).toISOString(), disabled_at: null,
      created_at: new Date().toISOString(), trace_id: 'trc_test',
      poll_endpoint: '/v1/webhook-events/listen', retrieve_endpoint: '/v1/webhook-events/listen/:outbox_event_id',
    };
    const server = createServer((request, response) => {
      requests.push(request.method ?? '');
      response.setHeader('content-type', 'application/json');
      if (request.method === 'POST') {
        reply = () => response.end(JSON.stringify(session));
        created();
      } else {
        interruptCleanup();
        setTimeout(() => response.end(JSON.stringify({ ...session, status: 'disabled', disabled_at: new Date().toISOString() })), 100);
      }
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing server port');
      const child = spawn(process.execPath, [
        '--import', 'tsx', 'src/main.ts', 'listen', 'prod', '--json',
        '--api-url', `http://127.0.0.1:${address.port}`, '--api-key', 'tx_live_test',
        '--forward-to', 'http://127.0.0.1:1/hook', '--state-dir', stateDir,
      ], { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stdout.resume();
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      const exit = new Promise<number | null>((resolve) => child.on('exit', resolve));
      const guard = setTimeout(() => child.kill('SIGKILL'), 8000);
      try {
        await creation;
        child.kill('SIGTERM');
        interruptCleanup = () => { child.kill('SIGTERM'); };
        // Keep creation pending while the OS delivers the signal to the child.
        await new Promise((resolve) => setTimeout(resolve, 100));
        reply();
        expect(await exit).toBe(0);
        expect(stderr).toBe('');
        expect(requests).toEqual(['POST', 'DELETE']);
      } finally { clearTimeout(guard); child.kill('SIGKILL'); }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 10_000);

  it('uses the persisted secret for tour without advancing the listener cursor', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'tyxter-tour-test-'));
    const state = await resolveListenerState({ stateDir, cursor: 'cur_listener' });
    let polls = 0;
    let verified = false;
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url?.startsWith('/v1/webhook-events/listen')) {
        response.end(JSON.stringify({ object: 'webhook_event_listen',
          data: ++polls === 1 ? [] : [{ id: 'out_tour', source_id: 'msg_tour', payload: { id: 'evt_tour' } }],
          has_more: false, next_cursor: 'cur_tour',
        }));
      } else if (request.url === '/v1/sandbox/inbound-messages') {
        response.end(JSON.stringify({ id: 'msg_tour', object: 'message', status: 'received',
          environment: 'sandbox', created_at: new Date().toISOString(), trace_id: 'trc_tour' }));
      } else {
        const chunks: Buffer[] = [];
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        request.on('end', () => {
          verified = verifyWebhookSignature({ secret: state.signingSecret,
            timestamp: String(request.headers['tyxter-webhook-timestamp']),
            signature: String(request.headers['tyxter-webhook-signature']), rawBody: Buffer.concat(chunks).toString(),
          });
          response.writeHead(verified ? 200 : 401).end('{}');
        });
      }
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing server port');
      const url = `http://127.0.0.1:${address.port}`;
      const { stdout, stderr } = await execFileAsync(process.execPath, [
        '--import', 'tsx', 'src/main.ts', 'tour', '--json', '--state-dir', stateDir,
        '--api-url', url, '--api-key', 'tx_sandbox_test', '--forward-to', `${url}/hook`,
        '--from', 'test_sender', '--to', 'test_recipient',
      ], { env: { PATH: process.env.PATH }, timeout: 8000 });
      expect(stderr).toBe('');
      expect(JSON.parse(stdout)).toMatchObject({ forwarded: 1 });
      expect(verified).toBe(true);
      expect((await readListenerState(stateDir))?.cursor).toBe('cur_listener');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});

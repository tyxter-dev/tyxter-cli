import { spawn } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');

const apiKey = process.env.TYXTER_TOUR_API_KEY ?? process.env.TYXTER_API_KEY;
if (!apiKey) {
  console.error('Set TYXTER_API_KEY or TYXTER_TOUR_API_KEY to a sandbox API key.');
  process.exit(1);
}

const apiUrl = process.env.TYXTER_API_URL ?? 'http://localhost:3001';
const port = readPort(process.env.TYXTER_TOUR_PORT, 4242);
const secret = process.env.TYXTER_WEBHOOK_SECRET ?? 'whsec_tour_demo';
const from = process.env.TYXTER_SIMULATE_FROM ?? '+15551230000';
const to = process.env.TYXTER_SIMULATE_TO ?? '+15557650000';
const body = process.env.TYXTER_SIMULATE_BODY ?? 'Hello from the Tyxter listener tour';
const forwardTo = `http://127.0.0.1:${port}/webhooks/tyxter`;

let received = false;
const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const timestamp = String(req.headers['tyxter-webhook-timestamp'] ?? '');
    const signature = String(req.headers['tyxter-webhook-signature'] ?? '');
    const webhookId = String(req.headers['tyxter-webhook-id'] ?? '');
    const verified = verifySignature(secret, timestamp, rawBody, signature);
    received = true;

    console.log(
      JSON.stringify(
        {
          object: 'tour_receiver_webhook',
          webhook_id: webhookId,
          signature_verified: verified,
          body: JSON.parse(rawBody),
        },
        null,
        2,
      ),
    );

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});

await listen(server, port);
console.log(`Tour demo receiver listening at ${forwardTo}`);

const child = spawn(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  [
    'run',
    'dev',
    '--',
    'tour',
    '--api-url',
    apiUrl,
    '--api-key',
    apiKey,
    '--forward-to',
    forwardTo,
    '--secret',
    secret,
    '--from',
    from,
    '--to',
    to,
    '--body',
    body,
    '--poll-attempts',
    '10',
  ],
  {
    cwd: appRoot,
    stdio: 'inherit',
  },
);

const timeout = setTimeout(() => {
  child.kill();
  server.close();
  console.error('Tour demo timed out before a webhook was received.');
  process.exit(1);
}, 30_000);

const code = await new Promise((resolveCode) => {
  child.on('error', (error) => {
    console.error(`Failed to start tour command: ${error.message}`);
    resolveCode(1);
  });
  child.on('exit', (exitCode) => resolveCode(exitCode ?? 1));
});
clearTimeout(timeout);
server.close();

if (code !== 0) process.exit(code);
if (!received) {
  console.error('Tour completed without the receiver seeing a webhook.');
  process.exit(1);
}

function verifySignature(secretValue, timestamp, rawBody, signature) {
  if (!timestamp || !signature) return false;
  const expected = createHmac('sha256', secretValue)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function readPort(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

function listen(httpServer, bindPort) {
  return new Promise((resolveListen) => {
    httpServer.listen(bindPort, '127.0.0.1', resolveListen);
  });
}

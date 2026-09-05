import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { sendToPrinter, probe, discoverPrinters } from '../src/printer.js';

function fakePrinter() {
  return new Promise((resolve) => {
    const received = [];
    const server = net.createServer((sock) => {
      sock.on('data', (d) => received.push(d));
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, received, close: () => server.close() });
    });
  });
}

test('sendToPrinter delivers the exact bytes', async () => {
  const p = await fakePrinter();
  await sendToPrinter('127.0.0.1', '^XA^XZ', { port: p.port });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(Buffer.concat(p.received).toString(), '^XA^XZ');
  p.close();
});

test('sendToPrinter rejects with the ip in the message when unreachable', async () => {
  await assert.rejects(
    () => sendToPrinter('127.0.0.1', 'x', { port: 1, timeoutMs: 500 }),
    /127\.0\.0\.1/,
  );
});

test('probe reports open and closed ports', async () => {
  const p = await fakePrinter();
  assert.equal(await probe('127.0.0.1', { port: p.port }), true);
  p.close();
  assert.equal(await probe('127.0.0.1', { port: 1, timeoutMs: 300 }), false);
});

test('discoverPrinters finds a listener when given explicit prefixes', async () => {
  const p = await fakePrinter();
  const found = await discoverPrinters({
    port: p.port,
    prefixes: ['127.0.0'],
  });
  assert.ok(found.includes('127.0.0.1'));
  p.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../src/queue.js';

test('jobs flow pending -> printing -> done', () => {
  const q = createQueue();
  const job = q.add('^XA^XZ', 'Test label');
  assert.ok(job.id);
  const next = q.next();
  assert.equal(next.id, job.id);
  assert.equal(next.name, 'Test label');
  assert.equal(Buffer.from(next.zpl, 'base64').toString(), '^XA^XZ');
  assert.equal(q.next(), null, 'a printing job is not handed out twice');
  assert.equal(q.complete(job.id), true);
  assert.equal(q.next(), null);
});

test('binary jobs survive the base64 round trip', () => {
  const q = createQueue();
  const bytes = Buffer.from([0x5e, 0x00, 0xff, 0x10]);
  q.add(bytes, 'raw');
  assert.deepEqual(Buffer.from(q.next().zpl, 'base64'), bytes);
});

test('failed jobs leave the queue', () => {
  const q = createQueue();
  const job = q.add('^XA^XZ', 'x');
  q.next();
  assert.equal(q.fail(job.id, 'printer offline'), true);
  assert.equal(q.next(), null);
  assert.equal(q.status().failed, 1);
});

test('jobs stuck printing are handed out again after the stale timeout', () => {
  let clock = 1000;
  const q = createQueue({ staleMs: 90000, now: () => clock });
  const job = q.add('^XA^XZ', 'x');
  q.next();
  clock += 91000;
  const retry = q.next();
  assert.equal(retry.id, job.id);
});

test('status counts pending jobs', () => {
  const q = createQueue();
  q.add('^XA^XZ', 'a');
  q.add('^XA^XZ', 'b');
  assert.equal(q.status().pending, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentBroker } from '../src/broker.mjs';

async function waitFor(broker, id, predicate) {
  for (let i = 0; i < 200; i++) {
    const job = await broker.status(id);
    if (predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Job did not reach expected state.');
}

test('broker cancellation waits for worker exit and preserves terminal jobs', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagc-lifecycle-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const broker = new AgentBroker({
    stateDir: path.join(root, 'state'),
    runtimes: {
      slow: { kind: 'cli', argv: [process.execPath, '-e', "console.log('ready');setInterval(()=>{},1000)"] },
      fast: { kind: 'cli', argv: [process.execPath, '-e', "console.log('done')"] },
    },
    defaults: { workspaceMode: 'shared', permissions: 'runtime-managed', timeoutSeconds: 10, maxDiffChars: 1000 },
  });
  await broker.init();
  const slow = await broker.delegate({ runtime: 'slow', cwd: root, task: 'wait' });
  await waitFor(broker, slow.id, (job) => job.status === 'running');
  await assert.rejects(broker.cleanup(slow.id), /active|unverified/);
  const cancelled = await broker.cancel(slow.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.finishedAt);
  assert.equal(broker.attempts.size, 0);
  assert.equal(broker.controllers.size, 0);
  assert.equal((await broker.cancel(slow.id)).status, 'cancelled');
  const fast = await broker.delegate({ runtime: 'fast', cwd: root, task: 'finish' });
  await waitFor(broker, fast.id, (job) => job.status === 'completed');
  assert.equal((await broker.cancel(fast.id)).status, 'completed');
  const cleaned = await broker.cleanup(fast.id);
  assert.deepEqual(await broker.cleanup(fast.id), cleaned);
  await assert.rejects(broker.apply(fast.id), /cleaned/);
  const reserved = broker.withAction(fast.id, () => new Promise((r) => setTimeout(r, 30)));
  await assert.rejects(broker.cancel(fast.id), /already in progress/);
  await reserved;
  const id = '000000000001';
  await broker.jobs.create({ id, kind: 'acp', status: 'completed', cleanedAt: 'now' });
  await assert.rejects(broker.resume(id, 'retry'), /cleaned/);
  await broker.jobs.update(id, { cleanedAt: null, appliedAt: 'now' });
  await assert.rejects(broker.resume(id, 'retry'), /Applied/);
  await broker.jobs.update(id, { status: 'running', appliedAt: null });
  const restarted = new AgentBroker(broker.config);
  await restarted.init();
  assert.equal((await restarted.status(id)).status, 'interrupted');
  await assert.rejects(restarted.cleanup(id), /unverified/);
});

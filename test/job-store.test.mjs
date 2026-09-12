import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JobStore } from '../src/job-store.mjs';

test('job storage rejects traversal and persists concurrent updates atomically', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagc-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new JobStore(root);
  for (const id of ['../outside', '../../outside', 'C:\\outside', '', 'ABCDEF123456']) {
    await assert.rejects(store.get(id), /Invalid job ID/);
    await assert.rejects(store.update(id, {}), /Invalid job ID/);
  }
  const id = 'abcdef123456';
  await store.create({ id, status: 'queued' });
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.update(id, { [`field${i}`]: i })));
  const disk = await new JobStore(root).get(id);
  for (let i = 0; i < 20; i++) assert.equal(disk[`field${i}`], i);
  const snapshot = await store.get(id);
  snapshot.status = 'tampered';
  assert.equal((await store.get(id)).status, 'queued');
  await assert.rejects(store.update(id, { id: '000000000000' }), /cannot be changed/);
  await assert.rejects(store.create({ id }), /already exists/);
  assert.deepEqual(await fs.readdir(store.jobDir(id)), ['job.json']);
  await fs.writeFile(store.jobFile(id), JSON.stringify({ id: '000000000000' }));
  await assert.rejects(new JobStore(root).get(id), /does not match/);
});

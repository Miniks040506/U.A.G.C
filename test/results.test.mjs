import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentBroker } from '../src/broker.mjs';

test('results do not expose stale patches and preserve shared-workspace diagnostics', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagc-results-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const broker = new AgentBroker({ stateDir: root, defaults: { maxDiffChars: 1000 } });
  const id = '000000000002';
  const patchFile = path.join(root, 'changes.patch');
  await fs.writeFile(patchFile, 'reviewable diff');
  await broker.jobs.create({ id, attempt: 1, captureAttempt: 1, patchFile, patchAvailable: false, workspace: { mode: 'shared' } });
  assert.equal((await broker.result(id)).diff, 'reviewable diff');
  await broker.jobs.update(id, { attempt: 2, captureAttempt: null });
  assert.equal((await broker.result(id)).diff, '');
  await broker.jobs.update(id, { captureAttempt: 2 });
  await fs.writeFile(patchFile, 'x'.repeat(1500));
  assert.equal((await broker.result(id)).diffTruncated, true);
  assert.equal((await broker.result(id, { includeDiff: false })).diff, '');
  await assert.rejects(broker.result(id, { maxDiffChars: -1 }), /maxDiffChars/);
});

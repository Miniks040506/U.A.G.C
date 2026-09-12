import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentBroker } from '../src/broker.mjs';
import { runCommand } from '../src/process.mjs';

async function must(command, args, cwd) {
  const r = await runCommand(command, args, { cwd });
  if (r.code !== 0) throw new Error(r.stderr || r.stdout);
}

async function waitForDone(broker, jobId) {
  for (let i = 0; i < 100; i += 1) {
    const status = await broker.status(jobId);
    if (!['queued', 'running'].includes(status.status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('job did not finish');
}

test('broker delegates to a generic CLI worker and applies reviewed patch', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagent-broker-'));
  const repo = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  await fs.mkdir(repo);
  await must('git', ['init'], repo);
  await must('git', ['config', 'core.autocrlf', 'false'], repo);
  await must('git', ['config', 'user.email', 'test@example.com'], repo);
  await must('git', ['config', 'user.name', 'Test'], repo);
  await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
  await must('git', ['add', '.'], repo);
  await must('git', ['commit', '-m', 'init'], repo);

  const fakeWorker = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-worker.mjs');
  const broker = new AgentBroker({
    stateDir,
    agents: {
      fake: {
        kind: 'cli',
        argv: [process.execPath, fakeWorker, '{{promptFile}}'],
        description: 'test worker',
      },
    },
    defaults: {
      workspaceMode: 'worktree',
      permissions: 'runtime-managed',
      timeoutSeconds: 30,
      maxDiffChars: 100000,
    },
  });
  await broker.init();

  const started = await broker.delegate({
    agent: 'fake',
    cwd: repo,
    task: 'Create worker output',
    plan: 'Write worker-output.txt',
  });
  const finalStatus = await waitForDone(broker, started.id);
  assert.equal(finalStatus.status, 'completed');
  assert.equal(finalStatus.runtime, 'fake');
  assert.equal(finalStatus.role, 'implementer');

  const result = await broker.result(started.id, { includeDiff: true });
  assert.deepEqual(result.changedFiles, ['worker-output.txt']);
  assert.match(result.assistantText, /Implemented requested change/);
  assert.match(result.diff, /worker-output\.txt/);

  await broker.apply(started.id);
  assert.match(await fs.readFile(path.join(repo, 'worker-output.txt'), 'utf8'), /plan-received/);

  await broker.cleanup(started.id);
  await fs.rm(root, { recursive: true, force: true });
});

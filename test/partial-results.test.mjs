import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentBroker } from '../src/broker.mjs';
import { runCommand } from '../src/process.mjs';

test('timeout and cancellation retain partial patches, uncertain termination does not capture', { timeout: 30000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagc-partial-'));
  const repo = path.join(root, 'repo'); await fs.mkdir(repo);
  const git = async (...args) => { const r = await runCommand('git', args, { cwd: repo }); assert.equal(r.code, 0, r.stderr); };
  await git('init'); await git('config', 'core.autocrlf', 'false');
  await git('config', 'user.name', 'Test'); await git('config', 'user.email', 'test@example.invalid');
  await fs.writeFile(path.join(repo, 'base.txt'), 'base\n'); await git('add', '.'); await git('commit', '-m', 'base');
  const runtime = { kind: 'cli', argv: [process.execPath, '-e', "require('node:fs').writeFileSync('partial.txt', 'saved work');setInterval(()=>{},1000)"] };
  const broker = new AgentBroker({ stateDir: path.join(root, 'state'), runtimes: { worker: runtime }, defaults: { workspaceMode: 'worktree', permissions: 'runtime-managed', timeoutSeconds: 3, maxDiffChars: 10000 } });
  await broker.init();
  t.after(async () => { for (const id of [...broker.attempts.keys()]) await broker.cancel(id); broker.close(); await fs.rm(root, { recursive: true, force: true, maxRetries: 3 }); });
  for (const cancel of [false, true]) {
    const job = await broker.delegate({ runtime: 'worker', cwd: repo, task: 'write then wait', timeoutSeconds: cancel ? 15 : 3 });
    if (cancel) {
      for (let i = 0; ; i++) {
        assert.ok(i < 200, 'worker did not write its file');
        if (await fs.stat(path.join(job.workspaceCwd, 'partial.txt')).then(() => true, () => false)) break;
        await new Promise(r => setTimeout(r, 25));
      }
      await broker.cancel(job.id);
    }
    await broker.attempts.get(job.id);
    const result = await broker.result(job.id);
    assert.equal(result.status, cancel ? 'cancelled' : 'failed');
    assert.equal(result.patchAvailable, true); assert.deepEqual(result.changedFiles, ['partial.txt']);
    assert.match(result.diff, /saved work/);
    await assert.rejects(broker.apply(job.id), /Only completed/);
    await broker.cleanup(job.id);
  }
  broker.cli.prompt = async () => { throw Object.assign(new Error('worker may survive'), { code: 'ETERMINATION' }); };
  broker.workspaces.capture = async () => { assert.fail('must not capture while worker might still write'); };
  const uncertain = await broker.delegate({ runtime: 'worker', cwd: repo, task: 'uncertain termination' });
  await broker.attempts.get(uncertain.id);
  const result = await broker.result(uncertain.id);
  assert.equal(result.status, 'termination-uncertain'); assert.equal(result.patchAvailable, false); assert.equal(result.diff, '');
  await assert.rejects(broker.cleanup(uncertain.id), /unverified/);
});

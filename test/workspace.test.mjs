import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../src/process.mjs';
import { WorkspaceManager } from '../src/workspace.mjs';

async function must(command, args, cwd) {
  const r = await runCommand(command, args, { cwd });
  if (r.code !== 0) throw new Error(r.stderr || r.stdout);
  return r;
}

test('worktree changes can be captured and applied after review', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagent-test-'));
  const repo = path.join(root, 'repo');
  const state = path.join(root, 'state');
  await fs.mkdir(repo);
  await must('git', ['init'], repo);
  await must('git', ['config', 'core.autocrlf', 'false'], repo);
  await must('git', ['config', 'user.email', 'test@example.com'], repo);
  await must('git', ['config', 'user.name', 'Test'], repo);
  await fs.writeFile(path.join(repo, 'a.txt'), 'one\n');
  await must('git', ['add', '.'], repo);
  await must('git', ['commit', '-m', 'init'], repo);

  const manager = new WorkspaceManager(state);
  const workspace = await manager.prepare(repo, 'worktree', 'job123');
  await fs.writeFile(path.join(workspace.workspaceCwd, 'a.txt'), 'two\n');
  await fs.writeFile(path.join(workspace.workspaceCwd, 'b.txt'), 'new\n');

  const jobDir = path.join(state, 'jobs', 'job123');
  await fs.mkdir(jobDir, { recursive: true });
  const patchFile = path.join(jobDir, 'changes.patch');
  const job = { workspace, patchFile };
  const captured = await manager.capture(job);
  await fs.writeFile(patchFile, captured.patch);

  assert.deepEqual(captured.changedFiles.sort(), ['a.txt', 'b.txt']);
  assert.match(captured.patch, /b\.txt/);

  const applied = await manager.apply(job);
  assert.equal(applied.targetRoot, await fs.realpath(repo));
  assert.equal(await fs.readFile(path.join(repo, 'a.txt'), 'utf8'), 'two\n');
  assert.equal(await fs.readFile(path.join(repo, 'b.txt'), 'utf8'), 'new\n');

  await manager.cleanup({ workspace });
  await fs.rm(root, { recursive: true, force: true });
});

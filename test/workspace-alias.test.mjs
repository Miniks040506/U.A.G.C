import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceManager } from '../src/workspace.mjs';
import { runCommand } from '../src/process.mjs';

test('worktree paths remain contained when source uses a symlink or Windows junction', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagc-alias-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'real-repository');
  const sub = path.join(repo, 'nested');
  await fs.mkdir(sub, { recursive: true });
  const git = async (...args) => {
    const r = await runCommand('git', args, { cwd: repo });
    assert.equal(r.code, 0, r.stderr);
  };
  await git('init'); await git('config', 'core.autocrlf', 'false');
  await git('config', 'user.name', 'Test'); await git('config', 'user.email', 'test@example.invalid');
  await fs.writeFile(path.join(sub, 'file.txt'), 'original\n');
  await git('add', '.'); await git('commit', '-m', 'baseline');
  const alias = path.join(root, 'alias');
  await fs.symlink(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const manager = new WorkspaceManager(path.join(root, 'state'));
  const workspace = await manager.prepare(path.join(alias, 'nested'), 'worktree', 'alias-job');
  assert.equal(workspace.originalGitRoot, await fs.realpath(repo));
  assert.equal(workspace.workspaceCwd, path.join(workspace.worktreePath, 'nested'));
  assert.equal(await fs.readFile(path.join(workspace.workspaceCwd, 'file.txt'), 'utf8'), 'original\n');
  await fs.writeFile(path.join(workspace.workspaceCwd, 'file.txt'), 'worker\n');
  assert.equal(await fs.readFile(path.join(sub, 'file.txt'), 'utf8'), 'original\n');
  assert.match((await manager.capture({ workspace })).patch, /worker/);
  await manager.cleanup({ workspace });
  await fs.unlink(alias);
});

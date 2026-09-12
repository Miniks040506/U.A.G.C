import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentBroker } from '../src/broker.mjs';
import { CliAdapter } from '../src/cli-adapter.mjs';
import { AcpxAdapter } from '../src/acpx-adapter.mjs';
import { loadConfig, validatePermissions } from '../src/config.mjs';

test('unsupported permission promises fail before creating workspaces or launching workers', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagc-permissions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runtime = { kind: 'cli', argv: [process.execPath, '-e', "throw Error('must not launch')"] };
  const config = { stateDir: root, runtimes: { fake: runtime }, defaults: { permissions: 'read-only' } };
  const broker = new AgentBroker(config);
  const input = { runtime: 'fake', cwd: root, task: 'audit' };
  for (const permissions of ['read-only', 'workspace-write', 'approve-all']) {
    await assert.rejects(broker.delegate({ ...input, permissions }), /cannot enforce/);
    await assert.rejects(new CliAdapter().prompt({ permissions }, runtime, 'missing'), /cannot enforce/);
  }
  assert.deepEqual(await fs.readdir(root), []);
  assert.equal((await loadConfig()).defaults.permissions, 'read-only');
  validatePermissions(runtime, 'runtime-managed');
  const adapter = new AcpxAdapter();
  const job = { workspace: { workspaceCwd: root }, timeoutSeconds: 10 };
  const acp = { kind: 'acp', target: 'fake' };
  assert.ok(adapter.baseArgs({ ...job, permissions: 'read-only' }, acp).includes('--approve-reads'));
  assert.ok(adapter.baseArgs({ ...job, permissions: 'approve-all' }, acp).includes('--approve-all'));
  assert.throws(() => adapter.baseArgs({ ...job, permissions: 'workspace-write' }, acp), /explicitly approve-all/);
  assert.throws(() => validatePermissions(acp, 'runtime-managed'), /cannot enforce/);
});

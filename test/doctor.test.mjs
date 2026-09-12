import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { AgentBroker } from '../src/broker.mjs';
import { runCommand } from '../src/process.mjs';

test('doctor reports discovery without claiming readiness or touching job state', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagc-doctor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDir = path.join(root, 'state');
  const runtimes = {
    found: { kind: 'cli', argv: [process.execPath] },
    missing: { kind: 'cli', argv: ['uagc-not-installed'] },
    unknown: { kind: 'acp', target: 'custom' },
  };
  const rows = new AgentBroker({ stateDir, runtimes }).listRuntimes();
  assert.deepEqual(rows.map((r) => r.readiness), ['executable-found', 'executable-missing', 'unknown']);
  assert.ok(rows.every((r) => r.connectionVerified === false));
  assert.deepEqual(rows[0].permissionModes, ['runtime-managed']);
  const configFile = path.join(root, 'config.json');
  await fs.writeFile(configFile, JSON.stringify({ stateDir, runtimes }));
  const script = fileURLToPath(new URL('../scripts/doctor.mjs', import.meta.url));
  const result = await runCommand(process.execPath, [script, '--config', configFile]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /NOT verified/);
  assert.match(result.stdout, /FOUND\s+found/);
  assert.match(result.stdout, /MISSING\s+missing/);
  await assert.rejects(fs.stat(stateDir), { code: 'ENOENT' });
});

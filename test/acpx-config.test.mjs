import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AcpxAdapter } from '../src/acpx-adapter.mjs';

test('ACP configuration lock prevents overlap and preserves external edits', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagc-acp-config-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = path.join(root, '.acpxrc.json');
  const original = '{"ttl":2}\n';
  await fs.writeFile(config, original);
  const adapter = new AcpxAdapter();
  adapter.cli = path.join(root, 'fake-cli.mjs');
  await fs.writeFile(adapter.cli, "console.log(JSON.stringify({result:{stopReason:'end_turn'}}));\n");
  const job = { agent: 'registry-id', permissions: 'read-only', timeoutSeconds: 5, sessionName: 'test', workspace: { workspaceCwd: root } };
  const agent = { kind: 'acp', target: 'custom-target', argv: [process.execPath, 'fake'] };
  let release, entered;
  const ready = new Promise((r) => { entered = r; });
  adapter.ensureSession = async () => { entered(); await new Promise((r) => { release = r; }); };
  const first = adapter.prompt(job, agent, 'prompt');
  await ready;
  assert.deepEqual(JSON.parse(await fs.readFile(config, 'utf8')).agents['custom-target'].argv, agent.argv);
  await assert.rejects(adapter.prompt(job, agent, 'prompt'), /busy or needs recovery/);
  release(); await first;
  assert.equal(await fs.readFile(config, 'utf8'), original);
  await assert.rejects(fs.stat(`${config}.uagc-lock`), { code: 'ENOENT' });
  adapter.ensureSession = async () => { await fs.writeFile(config, '{"user":"changed"}'); };
  await assert.rejects(adapter.prompt(job, agent, 'prompt'), /changed during execution/);
  assert.equal(await fs.readFile(config, 'utf8'), '{"user":"changed"}');
  assert.equal(JSON.parse(await fs.readFile(`${config}.uagc-lock`, 'utf8')).original, original);
});


test('ACP cleanup keeps real errors and only tolerates the exact missing-session response', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagc-close-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const adapter = new AcpxAdapter(); adapter.cli = path.join(root, 'cli.mjs');
  const cwd = await fs.realpath(root);
  const job = { agent: 'audit', permissions: 'read-only', timeoutSeconds: 5, sessionName: 'job', workspace: { workspaceCwd: cwd } };
  const agent = { kind: 'acp', target: 'audit', builtin: true };
  const missing = { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'No named session "job" for cwd ' + cwd + ' and agent audit', data: { origin: 'cli', acpxCode: 'RUNTIME' } } };
  await fs.writeFile(adapter.cli, 'console.log(' + JSON.stringify(JSON.stringify(missing)) + ');process.exit(1)');
  assert.equal((await adapter.close(job, agent)).alreadyAbsent, true);
  missing.error.message = 'Permission denied reading session storage';
  await fs.writeFile(adapter.cli, 'console.log(' + JSON.stringify(JSON.stringify(missing)) + ');process.exit(1)');
  await assert.rejects(adapter.close(job, agent), /Permission denied/);
  await fs.writeFile(adapter.cli, 'console.log("No named session");process.exit(1)');
  await assert.rejects(adapter.close(job, agent), /Cannot close/);
});

test('ACP restoration errors preserve uncertain termination classification and recovery backup', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagc-uncertain-config-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = path.join(root, '.acpxrc.json');
  await fs.writeFile(config, '{"ttl":30}');
  const adapter = new AcpxAdapter();
  // Simulate the transport's unconfirmed stop while another writer changes its config.
  adapter.ensureSession = async () => {
    await fs.writeFile(config, '{"external":"edit"}');
    throw Object.assign(new Error('Worker termination unknown'), { code: 'ETERMINATION' });
  };
  adapter.cancel = async () => ({ code: 0 });
  const job = { agent: 'audit', permissions: 'read-only', timeoutSeconds: 5, sessionName: 'job', workspace: { workspaceCwd: root } };
  await assert.rejects(adapter.prompt(job, { argv: ['audit'], target: 'audit' }, 'prompt'), (error) => {
    assert.equal(error.code, 'ETERMINATION');
    assert.match(error.message, /termination unknown/);
    assert.match(error.message, /config changed/);
    return true;
  });
  assert.equal(await fs.readFile(config, 'utf8'), '{"external":"edit"}');
  assert.equal(JSON.parse(await fs.readFile(config + '.uagc-lock', 'utf8')).original, '{"ttl":30}');
});

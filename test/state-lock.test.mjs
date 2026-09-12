import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { AgentBroker } from '../src/broker.mjs';

test('state ownership rejects another process before touching jobs and releases on close', { timeout: 15000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagc-owner-'));
  const config = { stateDir: root };
  const script = "import { AgentBroker } from " + JSON.stringify(new URL('../src/broker.mjs', import.meta.url).href) + "; const b = new AgentBroker(" + JSON.stringify(config) + "); await b.init(); await b.jobs.create({id:'000000000001',status:'running'}); console.log('ready'); process.stdin.resume(); process.stdin.on('end',()=>{b.close();});";
  const owner = spawn(process.execPath, ['--input-type=module', '-e', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(async () => { if (owner.exitCode === null) { const exited = once(owner, 'close'); owner.kill(); await exited; } await fs.rm(root, { recursive: true, force: true }); });
  const closed = once(owner, 'close');
  await once(owner.stdout, 'data');
  const competitor = new AgentBroker(config);
  await assert.rejects(competitor.init(), /locked/);
  const stored = JSON.parse(await fs.readFile(path.join(root, 'jobs/000000000001/job.json'), 'utf8'));
  assert.equal(stored.status, 'running');
  owner.stdin.end(); await closed;
  await competitor.init();
  assert.equal((await competitor.status(stored.id)).status, 'interrupted');
  competitor.close();
  await assert.rejects(fs.stat(path.join(root, 'gateway.lock')), { code: 'ENOENT' });
  await fs.writeFile(path.join(root, 'gateway.lock'), '{"pid":0}');
  await assert.rejects(new AgentBroker(config).init(), /needs recovery/);
});

test('broker cannot release state ownership while delegation is preparing its workspace', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagc-admission-'));
  const broker = new AgentBroker({ stateDir: path.join(root, 'state'), runtimes: { fast: { kind: 'cli', argv: [process.execPath, '-e', 'console.log("done")'] } }, defaults: { workspaceMode: 'shared', permissions: 'runtime-managed', timeoutSeconds: 5 } });
  await broker.init();
  let pending;
  t.after(async () => { if (pending) { const job = await pending; await broker.attempts.get(job.id); } broker.close(); await fs.rm(root, { recursive: true, force: true }); });
  pending = broker.delegate({ runtime: 'fast', cwd: root, task: 'finish' });
  assert.throws(() => broker.close(), /active/);
  await assert.rejects(new AgentBroker(broker.config).init(), /locked/);
  const job = await pending; await broker.attempts.get(job.id);
  broker.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import readline from 'node:readline';
import { runCommand } from '../src/process.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));

test('MCP stdio exercises CLI and real acpx transport, permissions and same-session resume', { timeout: 90000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagc-integration-'));
  const repo = path.join(root, 'repo'), home = path.join(root, 'home');
  await fs.mkdir(repo); await fs.mkdir(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, UAGC_FAKE_LOG: path.join(root, 'acp.ndjson') };
  const git = async (...args) => {
    const r = await runCommand('git', args, { cwd: repo });
    assert.equal(r.code, 0, r.stderr);
  };
  await git('init'); await git('config', 'core.autocrlf', 'false');
  await git('config', 'user.name', 'Audit'); await git('config', 'user.email', 'audit@example.invalid');
  const originalConfig = '{"ttl":30}\n';
  await fs.writeFile(path.join(repo, '.acpxrc.json'), originalConfig);
  await fs.writeFile(path.join(repo, 'base.txt'), 'base\n');
  await git('add', '.'); await git('commit', '-m', 'fixture baseline');
  const config = {
    stateDir: path.join(root, 'state'),
    runtimes: {
      brokenacp: { kind: 'acp', target: 'audit-broken', argv: [process.execPath, '-e', 'process.exit(1)'] },
      fakecli: { kind: 'cli', argv: [process.execPath, path.join(project, 'fixtures/fake-worker.mjs'), '{{promptFile}}'] },
      fakeacp: { kind: 'acp', target: 'audit-acp', argv: [process.execPath, path.join(project, 'fixtures/fake-acp.mjs')], modelSelection: { supportsModel: true, supportsProvider: true, format: '{{provider}}:{{model}}' } },
    },
    models: { audit: { provider: 'audit-provider', model: 'audit-model' } },
    profiles: { audit: { runtime: 'fakeacp', model: 'audit' } },
    defaults: { timeoutSeconds: 15 },
  };
  const configFile = path.join(root, 'config.json');
  await fs.writeFile(configFile, JSON.stringify(config));
  const child = spawn(process.execPath, [path.join(project, 'src/index.mjs'), '--config', configFile], { cwd: project, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let seq = 0, stderr = '';
  const createdJobs = [];
  const pending = new Map(), lines = readline.createInterface({ input: child.stdout });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  lines.on('line', (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
  });
  t.after(async () => {
    for (const jobId of createdJobs) {
      try { await call('agent_cancel', { jobId }); await call('agent_cleanup', { jobId }); } catch {}
    }
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Test closing')); }
    const closed = once(child, 'close');
    child.stdin.end(); child.kill(); await closed;
    lines.close();
    // Sessions are closed explicitly; allow Windows to release residual handles.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  function request(method, params = {}) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}\n${stderr}`)); }, 25000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  const call = async (name, args = {}) => {
    const result = await request('tools/call', { name, arguments: args });
    assert.ok(!result.isError, `${name}: ${JSON.stringify(result)}`);
    const value = result.structuredContent ?? JSON.parse(result.content[0].text);
    if (name === 'agent_delegate') createdJobs.push(value.id);
    return value;
  };
  async function done(id, expected = 'completed') {
    for (let i = 0; i < 200; i++) {
      const status = await call('agent_status', { jobId: id });
      if (!['queued', 'running', 'cancelling'].includes(status.status)) {
        assert.equal(status.status, expected, JSON.stringify(await call('agent_result', { jobId: id })));
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Job did not finish');
  }
  const init = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'uagc-test', version: '1.0.0' } });
  assert.equal(init.serverInfo.name, 'universal-agent-mcp');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  assert.equal((await request('tools/list')).tools.length, 12);
  for (const name of ['runtime_list', 'agent_list', 'model_list', 'profile_list']) await call(name);
  assert.equal((await call('execution_resolve', { profile: 'audit' })).runtimeModel, 'audit-provider:audit-model');
  assert.equal((await request('tools/call', { name: 'agent_delegate', arguments: {} })).isError, true);
  assert.equal((await request('tools/call', { name: 'agent_status', arguments: { jobId: '../../outside' } })).isError, true);
  const cli = await call('agent_delegate', { runtime: 'fakecli', cwd: repo, task: 'Create output', plan: 'Write file', permissions: 'runtime-managed' });
  await done(cli.id);
  assert.match((await call('agent_result', { jobId: cli.id })).diff, /worker-output/);
  await call('agent_apply', { jobId: cli.id });
  assert.match(await fs.readFile(path.join(repo, 'worker-output.txt'), 'utf8'), /plan-received/);
  await call('agent_cleanup', { jobId: cli.id });
  await git('add', '.'); await git('commit', '-m', 'CLI output');
  const acp = await call('agent_delegate', { profile: 'audit', cwd: repo, task: 'Create ACP output', permissions: 'approve-all' });
  await done(acp.id);
  assert.match((await call('agent_result', { jobId: acp.id })).assistantText, /implemented/);
  await call('agent_resume', { jobId: acp.id, feedback: 'Update output' });
  assert.equal((await done(acp.id)).attempt, 2);
  assert.match((await call('agent_result', { jobId: acp.id })).assistantText, /resumed/);
  assert.equal(await fs.readFile(path.join(acp.workspaceCwd, '.acpxrc.json'), 'utf8'), originalConfig);
  await call('agent_apply', { jobId: acp.id });
  assert.equal(await fs.readFile(path.join(repo, 'acp-output.txt'), 'utf8'), 'resumed\n');
  await call('agent_cleanup', { jobId: acp.id });
  await git('add', '.'); await git('commit', '-m', 'ACP output');
  const readonly = await call('agent_delegate', { profile: 'audit', cwd: repo, task: 'Try writing', permissions: 'read-only' });
  assert.equal((await done(readonly.id, 'failed')).exitCode, 5);
  assert.match((await call('agent_result', { jobId: readonly.id })).assistantText, /Permission denied/);
  assert.equal((await call('agent_result', { jobId: readonly.id })).diff, '');
  await call('agent_cancel', { jobId: readonly.id });
  assert.equal((await call('agent_status', { jobId: readonly.id })).status, 'failed');
  await call('agent_cleanup', { jobId: readonly.id });
  const broken = await call('agent_delegate', { runtime: 'brokenacp', cwd: repo, task: 'Fail before creating a session', permissions: 'read-only' });
  await done(broken.id, 'failed');
  assert.equal((await call('agent_cleanup', { jobId: broken.id })).cleaned, true);
  await assert.rejects(fs.stat(broken.workspaceCwd), { code: 'ENOENT' });
  const protocol = (await fs.readFile(env.UAGC_FAKE_LOG, 'utf8')).trim().split('\n').map(JSON.parse);
  const prompts = protocol.filter((m) => m.method === 'session/prompt');
  assert.equal(prompts.length, 3);
  assert.equal(prompts[0].params.sessionId, prompts[1].params.sessionId);
  assert.ok(protocol.some((m) => m.method === 'session/set_model' && m.params.modelId === 'audit-provider:audit-model'));
});

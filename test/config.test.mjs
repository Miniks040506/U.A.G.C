import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, parseCliArgs, publicRuntimeView } from '../src/config.mjs';
import { resolveExecution } from '../src/execution-resolver.mjs';
import { AgentBroker } from '../src/broker.mjs';
import { CliAdapter } from '../src/cli-adapter.mjs';

test('config validation and strict binding follow input, profile, defaults precedence', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'uagc-config-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'config.json');
  for (const config of [null, [], { runtimes: [] }, { runtimes: { bad: { kind: 'cli' } } },
    { defaults: { timeoutSeconds: -1 } }, { defaults: { maxDiffChars: 0 } },
    { defaults: { permissions: 'workspace-write' } }, { defaults: { workspaceMode: 'typo' } },
    { defaults: { strictModelBinding: 'false' } }]) {
    await fs.writeFile(file, JSON.stringify(config));
    await assert.rejects(loadConfig(file));
  }
  assert.throws(() => parseCliArgs(['--config']), /requires/);
  assert.throws(() => parseCliArgs(['--typo']), /Unknown/);
  const config = {
    runtimes: { cli: { kind: 'cli', argv: [process.execPath] } },
    profiles: { loose: { runtime: 'cli', model: 'test', strictModelBinding: false } },
    defaults: { strictModelBinding: true },
  };
  assert.equal(resolveExecution({ profile: 'loose' }, config).modelBinding.strict, false);
  assert.equal(new AgentBroker(config).resolve({ profile: 'loose' }).modelBinding.strict, false);
  assert.throws(() => resolveExecution({ profile: 'loose', strictModelBinding: true }, config), /does not declare/);
  config.defaults.strictModelBinding = false;
  assert.equal(resolveExecution({ runtime: 'cli', model: 'test' }, config).modelBinding.strict, false);
  assert.throws(() => resolveExecution({ runtime: 'toString' }, config), /Unknown runtime/);
  assert.throws(() => resolveExecution({ profile: '__proto__' }, config), /Unknown execution/);
  const runtime = { kind: 'cli', argv: [process.execPath, '-e', 'console.log(process.env.AUDIT_MODEL);console.log(process.argv[1])', '{{prompt}}'], env: { AUDIT_MODEL: '{{model}}' } };
  assert.equal(publicRuntimeView('cli', runtime, true).capabilities.modelSelection, true);
  assert.equal(resolveExecution({ runtime: 'cli', model: 'test' }, { runtimes: { cli: runtime } }).runtimeModel, 'test');
  const prompt = path.join(root, 'prompt');
  await fs.writeFile(prompt, 'Keep literal {{model}} intact');
  const result = await new CliAdapter().prompt({ permissions: 'runtime-managed', timeoutSeconds: 5, workspace: { workspaceCwd: root }, model: 'test' }, runtime, prompt);
  assert.match(result.stdout, /test\r?\nKeep literal \{\{model\}\} intact/);
});

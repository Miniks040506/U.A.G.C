import test from 'node:test';
import assert from 'node:assert/strict';
import { AcpxAdapter } from '../src/acpx-adapter.mjs';

test('acpx adapter forwards resolved provider:model binding via --model', () => {
  const adapter = new AcpxAdapter();
  const job = {
    agent: 'hermes',
    runtime: 'hermes',
    permissions: 'workspace-write',
    timeoutSeconds: 60,
    workspace: { workspaceCwd: '/tmp/repo' },
  };
  const args = adapter.baseArgs(job, { target: 'hermes' }, 'openrouter:qwen/qwen3-coder');
  const modelIndex = args.indexOf('--model');
  assert.ok(modelIndex > -1);
  assert.equal(args[modelIndex + 1], 'openrouter:qwen/qwen3-coder');
});

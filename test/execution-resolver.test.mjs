import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveExecution } from '../src/execution-resolver.mjs';

const config = {
  runtimes: {
    hermes: {
      kind: 'acp',
      modelSelection: {
        mode: 'acp',
        supportsModel: true,
        supportsProvider: true,
        format: '{{provider}}:{{model}}',
      },
    },
    codex: {
      kind: 'acp',
      modelSelection: {
        mode: 'acp',
        supportsModel: true,
        supportsProvider: false,
        format: '{{model}}',
      },
    },
  },
  models: {
    qwen: { provider: 'openrouter', model: 'qwen/qwen3-coder' },
  },
  profiles: {
    'qwen-hermes': { runtime: 'hermes', model: 'qwen', role: 'implementer' },
  },
};

test('resolves Qwen model alias through Hermes runtime with provider-aware ACP model id', () => {
  const resolved = resolveExecution({ runtime: 'hermes', model: 'qwen' }, config);
  assert.equal(resolved.runtime, 'hermes');
  assert.equal(resolved.provider, 'openrouter');
  assert.equal(resolved.model, 'qwen/qwen3-coder');
  assert.equal(resolved.modelAlias, 'qwen');
  assert.equal(resolved.runtimeModel, 'openrouter:qwen/qwen3-coder');
});

test('profile resolves the same runtime/model binding', () => {
  const resolved = resolveExecution({ profile: 'qwen-hermes' }, config);
  assert.equal(resolved.profile, 'qwen-hermes');
  assert.equal(resolved.runtime, 'hermes');
  assert.equal(resolved.runtimeModel, 'openrouter:qwen/qwen3-coder');
  assert.equal(resolved.role, 'implementer');
});

test('strict binding rejects a provider when runtime cannot select provider', () => {
  assert.throws(
    () => resolveExecution({ runtime: 'codex', model: 'qwen' }, config),
    /does not declare per-job provider selection support/,
  );
});

test('non-strict binding warns instead of silently pretending provider selection worked', () => {
  const resolved = resolveExecution({ runtime: 'codex', model: 'qwen', strictModelBinding: false }, config);
  assert.equal(resolved.runtimeModel, 'qwen/qwen3-coder');
  assert.equal(resolved.warnings.length, 1);
});

test('legacy agent selector remains supported', () => {
  const resolved = resolveExecution({ agent: 'hermes', model: 'qwen' }, config);
  assert.equal(resolved.runtime, 'hermes');
});

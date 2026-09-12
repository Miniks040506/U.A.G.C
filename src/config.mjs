import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bindingFor, publicModelView, publicProfileView } from './execution-resolver.mjs';

const DEFAULT_RUNTIMES = {
  codex: {
    kind: 'acp',
    target: 'codex',
    builtin: true,
    description: 'OpenAI Codex through the official codex-acp adapter',
    prerequisite: 'npx',
    modelSelection: { mode: 'acp', supportsModel: true, supportsProvider: false, format: '{{model}}' },
  },
  hermes: {
    kind: 'acp',
    target: 'hermes',
    argv: ['hermes', 'acp'],
    description: 'Hermes Agent in ACP mode; supports provider:model model choices',
    prerequisite: 'hermes',
    modelSelection: { mode: 'acp', supportsModel: true, supportsProvider: true, format: '{{provider}}:{{model}}' },
  },
  opencode: {
    kind: 'acp',
    target: 'opencode',
    builtin: true,
    description: 'OpenCode through the acpx built-in ACP profile',
    prerequisite: 'npx',
    modelSelection: { mode: 'acp', supportsModel: true, supportsProvider: false, format: '{{model}}' },
  },
  openclaw: {
    kind: 'acp',
    target: 'openclaw',
    builtin: true,
    description: 'OpenClaw ACP bridge',
    prerequisite: 'openclaw',
    modelSelection: { mode: 'acp', supportsModel: true, supportsProvider: false, format: '{{model}}' },
  },
  gemini: {
    kind: 'acp',
    target: 'gemini',
    builtin: true,
    description: 'Gemini CLI through ACP',
    prerequisite: 'gemini',
    modelSelection: { mode: 'acp', supportsModel: true, supportsProvider: false, format: '{{model}}' },
  },
  qwen: {
    kind: 'acp',
    target: 'qwen',
    builtin: true,
    description: 'Qwen Code coding runtime through the acpx built-in ACP profile (not the same as the qwen model alias)',
    prerequisite: 'qwen',
    modelSelection: { mode: 'acp', supportsModel: true, supportsProvider: false, format: '{{model}}' },
  },
  cursor: {
    kind: 'acp',
    target: 'cursor',
    builtin: true,
    description: 'Cursor CLI through ACP',
    prerequisite: 'cursor-agent',
    modelSelection: { mode: 'acp', supportsModel: true, supportsProvider: false, format: '{{model}}' },
  },
  copilot: {
    kind: 'acp',
    target: 'copilot',
    builtin: true,
    description: 'GitHub Copilot CLI through ACP',
    prerequisite: 'copilot',
    modelSelection: { mode: 'acp', supportsModel: true, supportsProvider: false, format: '{{model}}' },
  },
  kimi: {
    kind: 'acp',
    target: 'kimi',
    builtin: true,
    description: 'Kimi CLI through ACP',
    prerequisite: 'kimi',
    modelSelection: { mode: 'acp', supportsModel: true, supportsProvider: false, format: '{{model}}' },
  },
  kiro: {
    kind: 'acp',
    target: 'kiro',
    builtin: true,
    description: 'Kiro CLI through ACP',
    prerequisite: 'kiro-cli-chat',
    modelSelection: { mode: 'acp', supportsModel: true, supportsProvider: false, format: '{{model}}' },
  },
};

const DEFAULT_MODELS = {};
const DEFAULT_PROFILES = {};

export function parseCliArgs(argv = process.argv.slice(2)) {
  const out = { configPath: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--config') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--config requires a file path.');
      out.configPath = argv[i + 1];
      i += 1;
    } else if (token === '--help' || token === '-h') {
      out.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return out;
}

function validateRuntime(name, runtime) {
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
    throw new Error(`Invalid runtime config for ${name}`);
  }
  if (!['acp', 'cli'].includes(runtime.kind)) {
    throw new Error(`Runtime ${name} must have kind "acp" or "cli"`);
  }
  if (runtime.kind === 'cli' && !runtime.argv?.length) throw new Error(`Runtime ${name} requires argv.`);
  if (runtime.kind === 'acp' && !runtime.target) runtime.target = name;
  if (runtime.argv && (!Array.isArray(runtime.argv) || runtime.argv.some((x) => typeof x !== 'string'))) {
    throw new Error(`Runtime ${name}.argv must be an array of strings`);
  }
  if (runtime.modelSelection && (typeof runtime.modelSelection !== 'object' || Array.isArray(runtime.modelSelection))) {
    throw new Error(`Runtime ${name}.modelSelection must be an object`);
  }
  if (runtime.env && (typeof runtime.env !== 'object' || Array.isArray(runtime.env))) throw new Error(`Runtime ${name}.env must be an object.`);
  if (runtime.kind === 'acp' && runtime.env) throw new Error(`Runtime ${name}: env templates are supported only for CLI runtimes.`);
  for (const key of ['supportsModel', 'supportsProvider']) {
    if (runtime.modelSelection?.[key] != null && typeof runtime.modelSelection[key] !== 'boolean') throw new Error(`Runtime ${name}.${key} must be boolean.`);
  }
}

function validateModels(models) {
  for (const [name, value] of Object.entries(models)) {
    if (typeof value === 'string') continue;
    if (!value || typeof value !== 'object' || typeof (value.model ?? value.id) !== 'string') {
      throw new Error(`Model ${name} must be a string or an object with model/id.`);
    }
  }
}

function validateProfiles(profiles) {
  for (const [name, value] of Object.entries(profiles)) {
    if (!value || typeof value !== 'object') throw new Error(`Invalid profile ${name}`);
    if (!value.runtime && !value.agent) throw new Error(`Profile ${name} must define runtime.`);
  }
}

export async function loadConfig(configPath) {
  let user = {};
  if (configPath) {
    const absolute = path.resolve(configPath);
    const raw = await fs.readFile(absolute, 'utf8');
    user = JSON.parse(raw);
  }

  if (!user || typeof user !== 'object' || Array.isArray(user)) throw new Error('Config must be an object.');
  for (const key of ['agents', 'runtimes', 'models', 'profiles', 'defaults']) {
    if (user[key] != null && (typeof user[key] !== 'object' || Array.isArray(user[key]))) throw new Error(`Config ${key} must be an object.`);
  }
  // V0.1 used "agents". V0.2 calls them runtimes, while accepting both keys.
  const runtimes = {
    ...DEFAULT_RUNTIMES,
    ...(user.agents ?? {}),
    ...(user.runtimes ?? {}),
  };
  const models = { ...DEFAULT_MODELS, ...(user.models ?? {}) };
  const profiles = { ...DEFAULT_PROFILES, ...(user.profiles ?? {}) };

  for (const [name, runtime] of Object.entries(runtimes)) validateRuntime(name, runtime);
  validateModels(models);
  validateProfiles(profiles);

  const config = {
    stateDir: path.resolve(
      user.stateDir ?? process.env.UAG_STATE_DIR ?? path.join(os.homedir(), '.universal-agent-mcp'),
    ),
    runtimes,
    // Backward compatibility for V0.1 integrations/tests.
    agents: runtimes,
    models,
    profiles,
    defaults: {
      workspaceMode: user.defaults?.workspaceMode ?? 'worktree',
      permissions: user.defaults?.permissions ?? 'read-only',
      timeoutSeconds: user.defaults?.timeoutSeconds ?? 1800,
      maxDiffChars: user.defaults?.maxDiffChars ?? 120_000,
      strictModelBinding: user.defaults?.strictModelBinding ?? true,
    },
  };

  const defaults = config.defaults;
  if (!['worktree', 'shared'].includes(defaults.workspaceMode)) throw new Error('Invalid default workspaceMode.');
  if (!['read-only', 'approve-all', 'runtime-managed'].includes(defaults.permissions)) throw new Error('Invalid default permissions; workspace-write has been retired.');
  if (!Number.isInteger(defaults.timeoutSeconds) || defaults.timeoutSeconds < 1 || defaults.timeoutSeconds > 21600) throw new Error('Invalid timeoutSeconds (1-21600).');
  if (!Number.isInteger(defaults.maxDiffChars) || defaults.maxDiffChars < 1000 || defaults.maxDiffChars > 1000000) throw new Error('Invalid maxDiffChars (1000-1000000).');
  if (typeof defaults.strictModelBinding !== 'boolean') throw new Error('strictModelBinding must be boolean.');
  // Validate profile references and bindings early.
  for (const id of Object.keys(profiles)) {
    const view = publicProfileView(id, profiles[id], config);
    if (view.error) throw new Error(`Profile ${id}: ${view.error}`);
  }
  return config;
}

export function publicRuntimeView(name, runtime, available) {
  const selection = bindingFor(runtime);
  const supportsModelSelection = selection.supportsModel;
  const supportsProviderSelection = selection.supportsProvider;
  return {
    id: name,
    kind: runtime.kind,
    transport: runtime.kind === 'acp' ? 'ACP via acpx' : 'CLI',
    target: runtime.target ?? name,
    description: runtime.description ?? '',
    available,
    prerequisite: runtime.prerequisite ?? runtime.argv?.[0] ?? null,
    capabilities: {
      resume: runtime.kind === 'acp',
      modelSelection: Boolean(supportsModelSelection),
      providerSelection: Boolean(supportsProviderSelection),
    },
    modelSelection: {
      mode: selection.mode ?? (runtime.kind === 'acp' ? 'acp' : 'argv-template'),
      format: selection.format ?? '{{model}}',
    },
  };
}

// Legacy export name.
export const publicAgentView = publicRuntimeView;
export { publicModelView, publicProfileView };

export function validatePermissions(runtime, permissions) {
  const allowed = runtime.kind === 'acp' ? ['read-only', 'approve-all'] : ['runtime-managed'];
  if (!allowed.includes(permissions)) {
    throw new Error(`Runtime ${runtime.kind} cannot enforce permissions=${permissions}. Select explicitly: ${allowed.join(', ')}. Worktrees are not OS sandboxes.`);
  }
}

function renderTemplate(template, vars) {
  return String(template)
    .replaceAll('{{runtime}}', vars.runtime ?? '')
    .replaceAll('{{provider}}', vars.provider ?? '')
    .replaceAll('{{model}}', vars.model ?? '')
    .replaceAll('{{modelAlias}}', vars.modelAlias ?? '')
    .replaceAll('{{role}}', vars.role ?? '');
}

function normalizeModel(alias, raw) {
  if (typeof raw === 'string') {
    return { alias, provider: null, model: raw, description: '' };
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid model config for "${alias}".`);
  }
  const model = raw.model ?? raw.id;
  if (!model || typeof model !== 'string') {
    throw new Error(`Model alias "${alias}" must define a string model/id.`);
  }
  return {
    alias,
    provider: raw.provider ?? null,
    model,
    description: raw.description ?? '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    runtimeOverrides: raw.runtimeOverrides ?? {},
  };
}

export function getRuntimes(config) {
  return config.runtimes ?? config.agents ?? {};
}

export function listModels(config) {
  return Object.entries(config.models ?? {}).map(([alias, raw]) => normalizeModel(alias, raw));
}

export function listProfiles(config) {
  return Object.entries(config.profiles ?? {}).map(([id, profile]) => ({ id, ...profile }));
}

function resolveModel(config, requestedModel, explicitProvider) {
  if (!requestedModel) {
    if (explicitProvider) {
      throw new Error('A provider was requested without a model. Supply model=<alias-or-id> as well.');
    }
    return {
      alias: null,
      provider: null,
      model: null,
      description: '',
      tags: [],
      runtimeOverrides: {},
      source: 'runtime-default',
    };
  }

  const modelEntry = (Object.hasOwn(config.models ?? {}, requestedModel) ? config.models[requestedModel] : undefined);
  if (modelEntry != null) {
    const normalized = normalizeModel(requestedModel, modelEntry);
    return {
      ...normalized,
      provider: explicitProvider ?? normalized.provider,
      source: 'model-alias',
    };
  }

  return {
    alias: null,
    provider: explicitProvider ?? null,
    model: requestedModel,
    description: '',
    tags: [],
    runtimeOverrides: {},
    source: 'raw-model-id',
  };
}

function defaultBinding(runtime) {
  if (runtime.kind === 'acp') {
    return {
      mode: 'acp',
      supportsModel: true,
      supportsProvider: false,
      format: '{{model}}',
    };
  }

  const argv = runtime.argv ?? [];
  const joined = [...argv, ...Object.values(runtime.env ?? {})].join('\n');
  return {
    mode: 'argv-template',
    supportsModel: joined.includes('{{model}}') || joined.includes('{{runtimeModel}}'),
    supportsProvider: joined.includes('{{provider}}') || (joined.includes('{{runtimeModel}}') && (runtime.modelSelection?.format ?? '{{model}}').includes('{{provider}}')),
    format: '{{model}}',
  };
}

function validateBinding(runtime, binding) {
  if (runtime.kind !== 'cli') return binding;
  const templates = [...(runtime.argv ?? []), ...Object.values(runtime.env ?? {})].join('\n');
  for (const [capability, placeholder] of [['supportsModel', '{{model}}'], ['supportsProvider', '{{provider}}']]) {
    const transmitted = templates.includes(placeholder) || (templates.includes('{{runtimeModel}}') && String(binding.format ?? '{{model}}').includes(placeholder));
    if (binding[capability] && !transmitted) throw new Error(`CLI ${capability} requires an argv/env placeholder that transmits ${placeholder}.`);
  }
  return binding;
}

export function bindingFor(runtime) {
  return validateBinding(runtime, { ...defaultBinding(runtime), ...(runtime.modelSelection ?? {}) });
}

function formatRuntimeModel(binding, values) {
  if (!values.model) return null;
  if (!values.provider || !binding.supportsProvider) return values.model;
  return renderTemplate(binding.format ?? '{{model}}', values);
}

export function resolveExecution(input, config) {
  const runtimes = getRuntimes(config);
  const profileId = input.profile ?? null;
  const profile = profileId && Object.hasOwn(config.profiles ?? {}, profileId) ? config.profiles[profileId] : null;
  if (profileId && !profile) {
    throw new Error(`Unknown execution profile "${profileId}". Call profile_list first.`);
  }

  const runtimeId = input.runtime ?? input.agent ?? profile?.runtime ?? profile?.agent;
  if (!runtimeId) {
    throw new Error('No coding runtime selected. Supply runtime=<id>, agent=<legacy-id>, or profile=<id>.');
  }

  const runtime = Object.hasOwn(runtimes, runtimeId) ? runtimes[runtimeId] : null;
  if (!runtime) {
    throw new Error(`Unknown runtime "${runtimeId}". Call runtime_list (or legacy agent_list) first.`);
  }

  const requestedModel = input.model ?? profile?.model ?? null;
  const explicitProvider = input.provider ?? profile?.provider ?? null;
  const role = input.role ?? profile?.role ?? 'implementer';
  const resolvedModel = resolveModel(config, requestedModel, explicitProvider);
  const override = resolvedModel.runtimeOverrides?.[runtimeId] ?? {};

  const provider = override.provider ?? resolvedModel.provider;
  const model = override.model ?? resolvedModel.model;
  const binding = validateBinding(runtime, { ...bindingFor(runtime), ...(override.modelSelection ?? {}) });
  const strict = input.strictModelBinding ?? profile?.strictModelBinding ?? config.defaults?.strictModelBinding ?? true;
  if (typeof strict !== 'boolean') throw new Error('strictModelBinding must be boolean.');
  const warnings = [];

  if (model && !binding.supportsModel) {
    const message = `Runtime "${runtimeId}" does not declare per-job model selection support.`;
    if (strict) throw new Error(message);
    warnings.push(message);
  }

  if (provider && !binding.supportsProvider) {
    const message = `Runtime "${runtimeId}" does not declare per-job provider selection support, but provider "${provider}" was requested.`;
    if (strict) throw new Error(message);
    warnings.push(message);
  }

  const runtimeModel = model && binding.supportsModel
    ? formatRuntimeModel(binding, {
        runtime: runtimeId,
        provider,
        model,
        modelAlias: resolvedModel.alias,
        role,
      })
    : null;

  return {
    profile: profileId,
    runtime: runtimeId,
    runtimeKind: runtime.kind,
    role,
    provider,
    model,
    modelAlias: resolvedModel.alias,
    modelSource: resolvedModel.source,
    runtimeModel,
    modelBinding: {
      mode: binding.mode,
      supportsModel: Boolean(binding.supportsModel),
      supportsProvider: Boolean(binding.supportsProvider),
      format: binding.format ?? '{{model}}',
      strict,
    },
    warnings,
  };
}

export function publicModelView(alias, raw) {
  const model = normalizeModel(alias, raw);
  return {
    id: alias,
    provider: model.provider,
    model: model.model,
    description: model.description,
    tags: model.tags ?? [],
    runtimeOverrides: Object.keys(model.runtimeOverrides ?? {}),
  };
}

export function publicProfileView(id, profile, config) {
  let resolved = null;
  let error = null;
  try {
    resolved = resolveExecution({ profile: id }, config);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return {
    id,
    runtime: profile.runtime ?? profile.agent ?? null,
    model: profile.model ?? null,
    provider: profile.provider ?? null,
    role: profile.role ?? 'implementer',
    description: profile.description ?? '',
    resolved,
    error,
  };
}

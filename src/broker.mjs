import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JobStore } from './job-store.mjs';
import { acquireStateLock } from './state-lock.mjs';
import { WorkspaceManager } from './workspace.mjs';
import { AcpxAdapter } from './acpx-adapter.mjs';
import { CliAdapter } from './cli-adapter.mjs';
import { buildImplementationPrompt, buildResumePrompt } from './prompt.mjs';
import { commandExists } from './process.mjs';
import { publicRuntimeView, publicModelView, publicProfileView, validatePermissions } from './config.mjs';
import { getRuntimes, resolveExecution } from './execution-resolver.mjs';

function shortId() {
  return randomUUID().replaceAll('-', '').slice(0, 12);
}

function now() {
  return new Date().toISOString();
}

function tail(text, max = 8000) {
  if (!text) return '';
  return text.length <= max ? text : text.slice(-max);
}

export class AgentBroker {
  constructor(config) {
    this.config = config;
    this.jobs = new JobStore(config.stateDir);
    this.workspaces = new WorkspaceManager(config.stateDir);
    this.acpx = new AcpxAdapter();
    this.cli = new CliAdapter();
    this.controllers = new Map();
    this.attempts = new Map();
    this.actions = new Set();
    this.admissions = 0;
  }

  async init() {
    await fs.mkdir(this.config.stateDir, { recursive: true });
    const release = acquireStateLock(this.config.stateDir);
    try {
      await this.recoverJobs();
      this.releaseStateLock = release;
    } catch (error) { release(); throw error; }
  }

  close() {
    if (this.admissions || this.attempts.size || this.actions.size) throw new Error('Cannot close an active broker; cancel its jobs first.');
    this.releaseStateLock?.();
    this.releaseStateLock = null;
  }

  async recoverJobs() {
    const entries = await fs.readdir(path.join(this.config.stateDir, 'jobs')).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const id of entries.filter((id) => /^[a-f0-9]{12}$/.test(id))) {
      const job = await this.jobs.get(id);
      if (job && ['queued', 'running', 'cancelling'].includes(job.status)) {
        await this.jobs.update(id, { status: 'interrupted', error: 'Gateway restarted; inspect any surviving worker before manual recovery.' });
      }
    }
  }

  runtimes() {
    return getRuntimes(this.config);
  }

  listRuntimes() {
    return Object.entries(this.runtimes()).map(([name, runtime]) => {
      const prerequisite = runtime.prerequisite ?? runtime.argv?.[0];
      const available = prerequisite ? commandExists(prerequisite) : null;
      return publicRuntimeView(name, runtime, available);
    });
  }

  // V0.1 compatibility.
  listAgents() {
    return this.listRuntimes();
  }

  listModels() {
    return Object.entries(this.config.models ?? {}).map(([name, model]) => publicModelView(name, model));
  }

  listProfiles() {
    return Object.entries(this.config.profiles ?? {}).map(([name, profile]) => publicProfileView(name, profile, this.config));
  }

  resolve(input) {
    return resolveExecution(input, this.config);
  }

  getRuntime(name) {
    const runtime = this.runtimes()[name];
    if (!runtime) throw new Error(`Unknown runtime "${name}". Call runtime_list first.`);
    return runtime;
  }

  // V0.1 compatibility.
  getAgent(name) {
    return this.getRuntime(name);
  }

  async delegate(input) {
    this.admissions += 1;
    try { return await this.delegateJob(input); } finally { this.admissions -= 1; }
  }

  async delegateJob(input) {
    const execution = resolveExecution(input, this.config);
    const runtime = this.getRuntime(execution.runtime);
    const permissions = input.permissions ?? this.config.defaults.permissions;
    validatePermissions(runtime, permissions);
    if (!this.releaseStateLock) throw new Error('Initialize the broker before starting jobs.');
    if (typeof input.cwd !== 'string' || !input.cwd.trim() || typeof input.task !== 'string' || !input.task.trim()) throw new Error('cwd and task are required.');
    const timeout = input.timeoutSeconds ?? this.config.defaults.timeoutSeconds;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 21600) throw new Error('Invalid worker timeout.');
    for (const key of ['plan', 'extraContext']) {
      if (input[key] != null && typeof input[key] !== 'string') throw new Error(`${key} must be a string.`);
    }
    const id = shortId();
    const workspace = await this.workspaces.prepare(
      input.cwd,
      input.workspaceMode ?? this.config.defaults.workspaceMode,
      id,
    );
    const jobDir = this.jobs.jobDir(id);
    const promptFile = path.join(jobDir, 'prompt-1.md');
    const eventsFile = path.join(jobDir, 'attempt-1.ndjson');
    const stderrFile = path.join(jobDir, 'attempt-1.stderr.log');
    const patchFile = path.join(jobDir, 'changes.patch');
    const promptInput = { ...input, role: execution.role, execution };
    const prompt = buildImplementationPrompt(promptInput);

    await fs.mkdir(jobDir, { recursive: true });
    await fs.writeFile(promptFile, prompt);

    const job = {
      id,
      // V0.1 field retained for existing clients/state readers.
      agent: execution.runtime,
      runtime: execution.runtime,
      kind: runtime.kind,
      profile: execution.profile,
      role: execution.role,
      provider: execution.provider,
      model: execution.model,
      modelAlias: execution.modelAlias,
      runtimeModel: execution.runtimeModel,
      modelBinding: execution.modelBinding,
      executionWarnings: execution.warnings,
      status: 'queued',
      createdAt: now(),
      updatedAt: now(),
      attempt: 0,
      task: input.task,
      plan: input.plan ?? '',
      extraContext: input.extraContext ?? '',
      permissions,
      timeoutSeconds: input.timeoutSeconds ?? this.config.defaults.timeoutSeconds,
      sessionName: `uagent-${id}`,
      workspace,
      promptFile,
      eventsFile,
      stderrFile,
      patchFile,
      assistantText: '',
      stopReason: null,
      exitCode: null,
      error: null,
      changedFiles: [],
      diffStat: '',
      patchAvailable: false,
      workspaceNote: workspace.note,
    };

    await this.jobs.create(job);
    this.startAttempt(id, promptFile);

    return this.publicJob(await this.jobs.get(id));
  }

  adapterFor(runtime) {
    return runtime.kind === 'acp' ? this.acpx : this.cli;
  }

  startAttempt(jobId, promptFile) {
    const controller = new AbortController();
    this.controllers.set(jobId, controller);
    const pending = this.runAttempt(jobId, promptFile, controller).catch(async (error) => {
      const status = error.code === 'ETERMINATION' ? 'termination-uncertain'
        : controller.signal.aborted ? 'cancelled' : 'failed';
      await this.jobs.update(jobId, { status, error: error.message ?? String(error), finishedAt: now(), patchAvailable: false });
    }).finally(() => {
      this.controllers.delete(jobId);
      this.attempts.delete(jobId);
    });
    this.attempts.set(jobId, pending);
    void pending.catch((error) => console.error('[uagc] Cannot persist job outcome:', error.message));
  }

  async withAction(id, action) {
    if (!this.releaseStateLock) throw new Error('Initialize the broker before changing jobs.');
    if (this.actions.has(id)) throw new Error('Another operation is already in progress for this job.');
    this.actions.add(id);
    try { return await action(); } finally { this.actions.delete(id); }
  }

  assertIdle(job) {
    if (this.attempts.has(job.id) || ['queued', 'running', 'cancelling', 'interrupted', 'termination-uncertain'].includes(job.status)) {
      throw new Error('Job is active or worker termination is unverified; inspect it before proceeding.');
    }
    if (job.cleanedAt) throw new Error('Job worktree has already been cleaned.');
  }

  resume(id, feedback) { return this.withAction(id, () => this.resumeJob(id, feedback)); }
  cancel(id) { return this.withAction(id, () => this.cancelJob(id)); }
  apply(id, allowDirty = false) { return this.withAction(id, () => this.applyJob(id, allowDirty)); }
  cleanup(id, deleteBranch = true) { return this.withAction(id, () => this.cleanupJob(id, deleteBranch)); }

  async runAttempt(jobId, promptFile, controller) {
    const job = await this.requireJob(jobId);
    const runtimeName = job.runtime ?? job.agent;
    const runtime = this.getRuntime(runtimeName);
    const attempt = (job.attempt ?? 0) + 1;
    const jobDir = this.jobs.jobDir(job.id);
    const eventsFile = path.join(jobDir, `attempt-${attempt}.ndjson`);
    const stderrFile = path.join(jobDir, `attempt-${attempt}.stderr.log`);

    await fs.writeFile(eventsFile, '');
    await fs.writeFile(stderrFile, '');
    await this.jobs.update(job.id, {
      status: 'running',
      attempt,
      eventsFile,
      stderrFile,
      error: null,
      finishedAt: null,
      exitCode: null,
      stopReason: null,
      assistantTextTruncated: false,
      patchAvailable: false,
      assistantText: '',
      captureAttempt: null,
      changedFiles: [],
      diffStat: '',
      startedAt: now(),
    });

    let diagnostics = Promise.resolve();
    const append = (file, chunk) => {
      diagnostics = diagnostics.then(() => fs.appendFile(file, chunk)).catch(() => {});
    };

    let result, executionError;
    try {
      result = await this.adapterFor(runtime).prompt(job, runtime, promptFile, {
        signal: controller.signal,
        model: job.runtimeModel ?? undefined,
        provider: job.provider ?? undefined,
        rawModel: job.model ?? undefined,
        onStdout: (chunk) => void append(eventsFile, chunk),
        onStderr: (chunk) => void append(stderrFile, chunk),
      });
    } catch (error) {
      if (error.code === 'ETERMINATION') throw error;
      executionError = error;
    } finally {
      await diagnostics;
    }

    const refreshed = await this.requireJob(job.id);
    let captured;
    try {
      captured = await this.workspaces.capture(refreshed);
      await fs.writeFile(refreshed.patchFile, captured.patch ?? '');
    } catch (error) {
      if (executionError) throw new Error(executionError.message + '; partial-change capture failed: ' + error.message);
      throw error;
    }

    const status = controller.signal.aborted
      ? 'cancelled'
      : !executionError && result.code === 0
        ? 'completed'
        : 'failed';

    return this.jobs.update(job.id, {
      status,
      exitCode: result?.code ?? null,
      stopReason: result?.parsed?.stopReason ?? null,
      assistantText: tail(result?.parsed?.assistantText?.trim() || result?.stdout),
      assistantTextTruncated: (result?.parsed?.assistantText?.trim() || result?.stdout || '').length > 8000,
      captureAttempt: attempt,
      error: executionError ? tail(executionError.message) : result.code === 0 ? null : tail(result.stderr || result.stdout),
      changedFiles: captured.changedFiles,
      diffStat: captured.diffStat,
      patchAvailable: captured.patchAvailable,
      captureNote: captured.note ?? null,
      finishedAt: now(),
    });
  }

  async resumeJob(jobId, feedback) {
    if (typeof feedback !== 'string' || !feedback.trim()) throw new Error('Feedback is required.');
    const job = await this.requireJob(jobId);
    if (job.kind !== 'acp') {
      throw new Error('agent_resume currently requires an ACP-backed runtime.');
    }
    this.assertIdle(job);
    if (job.appliedAt) throw new Error('Applied jobs cannot be resumed; start a new job from the updated repository.');
    const nextAttempt = (job.attempt ?? 0) + 1;
    const promptFile = path.join(this.jobs.jobDir(job.id), `prompt-${nextAttempt}.md`);
    await fs.writeFile(promptFile, buildResumePrompt(feedback));
    await this.jobs.update(job.id, { promptFile, reviewFeedback: feedback, status: 'queued' });
    this.startAttempt(job.id, promptFile);
    return this.publicJob(await this.requireJob(job.id));
  }

  async cancelJob(jobId) {
    const job = await this.requireJob(jobId);
    if (!this.attempts.has(job.id)) return this.publicJob(job);
    const runtime = this.getRuntime(job.runtime ?? job.agent);
    await this.jobs.update(job.id, { status: 'cancelling', cancelledAt: now() });
    const pending = this.attempts.get(job.id);
    this.controllers.get(job.id)?.abort();
    try { await this.adapterFor(runtime).cancel(job, runtime); } catch {}
    await pending;
    return this.publicJob(await this.requireJob(job.id));
  }

  async applyJob(jobId, allowDirty = false) {
    const job = await this.requireJob(jobId);
    this.assertIdle(job);
    if (job.appliedAt) throw new Error('Job has already been applied.');
    if (job.status !== 'completed') throw new Error('Only completed jobs can be applied.');
    const result = await this.workspaces.apply(job, { allowDirty });
    await this.jobs.update(job.id, { appliedAt: now(), applyResult: result });
    return result;
  }

  async cleanupJob(jobId, deleteBranch = true) {
    const job = await this.requireJob(jobId);
    if (job.cleanedAt) return job.cleanupResult;
    this.assertIdle(job);
    if (job.kind === 'acp') await this.acpx.close(job, this.getRuntime(job.runtime ?? job.agent));
    const result = await this.workspaces.cleanup(job, { deleteBranch });
    await this.jobs.update(job.id, { cleanedAt: now(), cleanupResult: result });
    return result;
  }

  async status(jobId) {
    const job = await this.requireJob(jobId);
    let stderrTail = '';
    try {
      stderrTail = tail(await fs.readFile(job.stderrFile, 'utf8'), 5000);
    } catch {}
    return { ...this.publicJob(job), stderrTail };
  }

  async result(jobId, { includeDiff = true, maxDiffChars } = {}) {
    const job = await this.requireJob(jobId);
    const limit = maxDiffChars ?? this.config.defaults.maxDiffChars;
    if (!Number.isInteger(limit) || limit < 1000 || limit > 1000000) throw new Error('maxDiffChars must be an integer between 1000 and 1000000.');
    let diff = '';
    let diffTruncated = false;
    if (includeDiff && job.captureAttempt === job.attempt && job.patchFile) {
      try {
        const raw = await fs.readFile(job.patchFile, 'utf8');
        diffTruncated = raw.length > limit;
        diff = diffTruncated ? `${raw.slice(0, limit)}\n\n[diff truncated; full patch: ${job.patchFile}]` : raw;
      } catch {}
    }
    return {
      ...this.publicJob(job),
      assistantText: job.assistantText,
      assistantTextTruncated: job.assistantTextTruncated ?? false,
      error: job.error,
      changedFiles: job.changedFiles,
      diffStat: job.diffStat,
      diff,
      diffTruncated,
      patchFile: job.patchFile,
      eventsFile: job.eventsFile,
      stderrFile: job.stderrFile,
    };
  }

  async requireJob(id) {
    const job = await this.jobs.get(id);
    if (!job) throw new Error(`Unknown job: ${id}`);
    return job;
  }

  publicJob(job) {
    return {
      id: job.id,
      // Keep both names so V0.1 callers still work.
      agent: job.runtime ?? job.agent,
      runtime: job.runtime ?? job.agent,
      kind: job.kind,
      profile: job.profile ?? null,
      role: job.role ?? 'implementer',
      provider: job.provider ?? null,
      model: job.model ?? null,
      modelAlias: job.modelAlias ?? null,
      runtimeModel: Object.hasOwn(job, 'runtimeModel') ? job.runtimeModel : job.model ?? null,
      modelBinding: job.modelBinding ?? null,
      executionWarnings: job.executionWarnings ?? [],
      status: job.status,
      attempt: job.attempt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt ?? null,
      finishedAt: job.finishedAt ?? null,
      workspaceMode: job.workspace?.mode,
      workspaceCwd: job.workspace?.workspaceCwd,
      originalCwd: job.workspace?.originalCwd,
      branch: job.workspace?.branch,
      sessionName: job.sessionName,
      permissions: job.permissions,
      stopReason: job.stopReason,
      exitCode: job.exitCode,
      patchAvailable: job.patchAvailable,
      changedFiles: job.changedFiles ?? [],
      diffStat: job.diffStat ?? '',
      note: job.workspaceNote ?? job.captureNote ?? null,
      appliedAt: job.appliedAt ?? null,
      cleanedAt: job.cleanedAt ?? null,
    };
  }
}

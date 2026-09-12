import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JobStore } from './job-store.mjs';
import { WorkspaceManager } from './workspace.mjs';
import { AcpxAdapter } from './acpx-adapter.mjs';
import { CliAdapter } from './cli-adapter.mjs';
import { buildImplementationPrompt, buildResumePrompt } from './prompt.mjs';
import { commandExists } from './process.mjs';
import { publicRuntimeView, publicModelView, publicProfileView } from './config.mjs';
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
  }

  async init() {
    await fs.mkdir(this.config.stateDir, { recursive: true });
  }

  runtimes() {
    return getRuntimes(this.config);
  }

  listRuntimes() {
    return Object.entries(this.runtimes()).map(([name, runtime]) => {
      const prerequisite = runtime.prerequisite ?? runtime.argv?.[0];
      const available = prerequisite ? commandExists(prerequisite) : true;
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
    const execution = resolveExecution(
      {
        ...input,
        strictModelBinding: input.strictModelBinding ?? this.config.defaults.strictModelBinding,
      },
      this.config,
    );
    const runtime = this.getRuntime(execution.runtime);
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
      permissions: input.permissions ?? this.config.defaults.permissions,
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
    void this.runAttempt(id, promptFile).catch(async (error) => {
      await this.jobs.update(id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
    });

    return this.publicJob(await this.jobs.get(id));
  }

  adapterFor(runtime) {
    return runtime.kind === 'acp' ? this.acpx : this.cli;
  }

  async runAttempt(jobId, promptFile) {
    const job = await this.requireJob(jobId);
    const runtimeName = job.runtime ?? job.agent;
    const runtime = this.getRuntime(runtimeName);
    const attempt = (job.attempt ?? 0) + 1;
    const jobDir = this.jobs.jobDir(job.id);
    const eventsFile = path.join(jobDir, `attempt-${attempt}.ndjson`);
    const stderrFile = path.join(jobDir, `attempt-${attempt}.stderr.log`);
    const controller = new AbortController();
    this.controllers.set(job.id, controller);

    await fs.writeFile(eventsFile, '');
    await fs.writeFile(stderrFile, '');
    await this.jobs.update(job.id, {
      status: 'running',
      attempt,
      eventsFile,
      stderrFile,
      error: null,
      startedAt: now(),
    });

    const append = async (file, chunk) => {
      try {
        await fs.appendFile(file, chunk);
      } catch {
        // Diagnostics should not crash the worker.
      }
    };

    let result;
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
      this.controllers.delete(job.id);
      const cancelled = controller.signal.aborted;
      await this.jobs.update(job.id, {
        status: cancelled ? 'cancelled' : 'failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: now(),
      });
      throw error;
    }

    this.controllers.delete(job.id);
    const refreshed = await this.requireJob(job.id);
    const captured = await this.workspaces.capture(refreshed);
    await fs.writeFile(refreshed.patchFile, captured.patch ?? '');

    const status = controller.signal.aborted
      ? 'cancelled'
      : result.code === 0
        ? 'completed'
        : 'failed';

    return this.jobs.update(job.id, {
      status,
      exitCode: result.code,
      stopReason: result.parsed?.stopReason ?? null,
      assistantText: result.parsed?.assistantText?.trim() || tail(result.stdout),
      error: result.code === 0 ? null : tail(result.stderr || result.stdout),
      changedFiles: captured.changedFiles,
      diffStat: captured.diffStat,
      patchAvailable: captured.patchAvailable,
      captureNote: captured.note ?? null,
      finishedAt: now(),
    });
  }

  async resume(jobId, feedback) {
    const job = await this.requireJob(jobId);
    if (job.kind !== 'acp') {
      throw new Error('agent_resume currently requires an ACP-backed runtime.');
    }
    if (job.status === 'running' || job.status === 'queued') {
      throw new Error('Job is still running; wait for completion or cancel it first.');
    }
    const nextAttempt = (job.attempt ?? 0) + 1;
    const promptFile = path.join(this.jobs.jobDir(job.id), `prompt-${nextAttempt}.md`);
    await fs.writeFile(promptFile, buildResumePrompt(feedback));
    await this.jobs.update(job.id, { promptFile, reviewFeedback: feedback, status: 'queued' });
    void this.runAttempt(job.id, promptFile).catch(async (error) => {
      await this.jobs.update(job.id, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
    });
    return this.publicJob(await this.requireJob(job.id));
  }

  async cancel(jobId) {
    const job = await this.requireJob(jobId);
    const runtime = this.getRuntime(job.runtime ?? job.agent);
    this.controllers.get(job.id)?.abort();
    try {
      await this.adapterFor(runtime).cancel(job, runtime);
    } catch {
      // Cooperative cancellation is best effort; local abort still applies.
    }
    await this.jobs.update(job.id, { status: 'cancelled', cancelledAt: now() });
    return this.publicJob(await this.requireJob(job.id));
  }

  async apply(jobId, allowDirty = false) {
    const job = await this.requireJob(jobId);
    if (job.status !== 'completed') throw new Error('Only completed jobs can be applied.');
    const result = await this.workspaces.apply(job, { allowDirty });
    await this.jobs.update(job.id, { appliedAt: now(), applyResult: result });
    return result;
  }

  async cleanup(jobId, deleteBranch = true) {
    const job = await this.requireJob(jobId);
    if (job.status === 'running' || job.status === 'queued') {
      throw new Error('Cannot clean up a running job. Cancel it first.');
    }
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
    let diff = '';
    let diffTruncated = false;
    if (includeDiff && job.patchFile) {
      try {
        const raw = await fs.readFile(job.patchFile, 'utf8');
        diffTruncated = raw.length > limit;
        diff = diffTruncated ? `${raw.slice(0, limit)}\n\n[diff truncated; full patch: ${job.patchFile}]` : raw;
      } catch {}
    }
    return {
      ...this.publicJob(job),
      assistantText: job.assistantText,
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
      runtimeModel: job.runtimeModel ?? job.model ?? null,
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

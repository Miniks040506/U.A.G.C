import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from './process.mjs';
import { parseAcpNdjson } from './output.mjs';

function permissionArgs(permissions) {
  if (permissions === 'read-only') return ['--approve-reads', '--non-interactive-permissions', 'deny'];
  if (permissions === 'approve-all') return ['--approve-all', '--non-interactive-permissions', 'deny'];
  throw new Error('ACP permissions must be read-only or explicitly approve-all.');
}

async function withTemporaryAcpxConfig(cwd, agentName, agent, fn) {
  const directory = await fs.realpath(cwd);
  const configPath = path.join(directory, '.acpxrc.json');
  const lockPath = `${configPath}.uagc-lock`;
  const lock = await fs.open(lockPath, 'wx').catch((error) => {
    if (error.code === 'EEXIST') throw new Error(`ACP workspace is busy or needs recovery: inspect ${lockPath}.`);
    throw error;
  });
  let original = null, injected, preserve = false;
  try {
    try { original = await fs.readFile(configPath, 'utf8'); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid, original }, null, 2));
    await lock.sync();
    if (!agent.builtin && agent.argv) {
      const parsed = original == null ? {} : JSON.parse(original);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('ACP config must be a JSON object.');
      injected = JSON.stringify({ ...parsed, agents: { ...(parsed.agents ?? {}), [agentName]: { argv: agent.argv } } }, null, 2);
      await fs.writeFile(configPath, injected);
    }
    return await fn();
  } finally {
    try {
      if (injected !== undefined) {
        const current = await fs.readFile(configPath, 'utf8').catch(() => null);
        if (current !== injected) {
          preserve = true;
          throw new Error(`ACP config changed during execution; preserving it and recovery backup ${lockPath}.`);
        }
        if (original == null) await fs.rm(configPath); else await fs.writeFile(configPath, original);
      }
    } catch (error) {
      preserve = true;
      throw error;
    } finally {
      await lock.close();
      if (!preserve) await fs.rm(lockPath);
    }
  }
}

export class AcpxAdapter {
  constructor() {
    this.cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/acpx/dist/cli.js');
  }

  baseArgs(job, agent, model) {
    const args = [this.cli, '--cwd', job.workspace.workspaceCwd, '--format', 'json', '--json-strict',
      ...permissionArgs(job.permissions), '--timeout', String(job.timeoutSeconds)];
    if (model) args.push('--model', model);
    args.push(agent.target ?? job.agent);
    return args;
  }

  async ensureSession(job, agent, { signal, model, timeoutMs } = {}) {
    const args = [...this.baseArgs(job, agent, model), 'sessions', 'ensure', '--name', job.sessionName];
    const result = await runCommand(process.execPath, args, {
      cwd: job.workspace.workspaceCwd, signal, timeoutMs: timeoutMs ?? job.timeoutSeconds * 1000,
    });
    if (result.code !== 0) throw new Error(`acpx session ensure failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
    return result;
  }

  async prompt(job, agent, promptFile, { signal, model, onStdout, onStderr } = {}) {
    const deadline = Date.now() + job.timeoutSeconds * 1000;
    return withTemporaryAcpxConfig(job.workspace.workspaceCwd, agent.target ?? job.agent, agent, async () => {
      try {
        await this.ensureSession(job, agent, { signal, model, timeoutMs: Math.max(1, deadline - Date.now()) });
        const args = [...this.baseArgs(job, agent, model), '-s', job.sessionName, '--file', promptFile];
        const result = await runCommand(process.execPath, args, {
          cwd: job.workspace.workspaceCwd, signal, timeoutMs: Math.max(1, deadline - Date.now()), onStdout, onStderr,
        });
        return { ...result, parsed: parseAcpNdjson(result.stdout) };
      } catch (error) {
        // acpx may keep a detached queue owner; request remote cancellation as well.
        if (['ABORT_ERR', 'ETIMEDOUT', 'EOUTPUTLIMIT', 'ETERMINATION'].includes(error.code)) {
          try {
            const cancelled = await this.cancel(job, agent);
            if (cancelled.code !== 0) throw new Error(cancelled.stderr || cancelled.stdout);
          } catch {
            throw Object.assign(new Error('ACP cancellation could not be confirmed; inspect the session before cleanup.'), { code: 'ETERMINATION' });
          }
        }
        throw error;
      }
    });
  }

  async close(job, agent) {
    return withTemporaryAcpxConfig(job.workspace.workspaceCwd, agent.target ?? job.agent, agent, async () => {
      const args = [...this.baseArgs(job, agent), 'sessions', 'close', job.sessionName];
      const result = await runCommand(process.execPath, args, { cwd: job.workspace.workspaceCwd, timeoutMs: 15000 });
      if (result.code !== 0) throw new Error(`Cannot close ACP session: ${result.stderr || result.stdout}`);
      return result;
    });
  }

  async cancel(job, agent) {
    // The running prompt owns the temporary config lock until cancellation settles.
    const args = [...this.baseArgs(job, agent), 'cancel', '-s', job.sessionName];
    return runCommand(process.execPath, args, { cwd: job.workspace.workspaceCwd, timeoutMs: 5000 });
  }
}

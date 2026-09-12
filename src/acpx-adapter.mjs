import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from './process.mjs';
import { parseAcpNdjson } from './output.mjs';

function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function acpxCliPath() {
  return path.join(packageRoot(), 'node_modules', 'acpx', 'dist', 'cli.js');
}

function permissionArgs(permissions) {
  if (permissions === 'read-only') {
    return ['--approve-reads', '--non-interactive-permissions', 'deny'];
  }
  return ['--approve-all', '--non-interactive-permissions', 'deny'];
}

async function withTemporaryAcpxConfig(cwd, agentName, agent, fn) {
  if (agent.builtin || !agent.argv) return fn();

  const configPath = path.join(cwd, '.acpxrc.json');
  let original = null;
  try {
    original = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  let parsed = {};
  if (original) {
    try {
      parsed = JSON.parse(original);
    } catch {
      throw new Error(`Existing ${configPath} is not valid JSON; cannot safely merge temporary agent config.`);
    }
  }

  const next = {
    ...parsed,
    agents: {
      ...(parsed.agents ?? {}),
      [agentName]: { argv: agent.argv },
    },
  };

  await fs.writeFile(configPath, JSON.stringify(next, null, 2));
  try {
    return await fn();
  } finally {
    if (original == null) {
      await fs.rm(configPath, { force: true });
    } else {
      await fs.writeFile(configPath, original);
    }
  }
}

export class AcpxAdapter {
  constructor() {
    this.cli = acpxCliPath();
  }

  baseArgs(job, agent, model) {
    const args = [
      this.cli,
      '--cwd', job.workspace.workspaceCwd,
      '--format', 'json',
      '--json-strict',
      ...permissionArgs(job.permissions),
      '--timeout', String(job.timeoutSeconds),
    ];
    if (model) args.push('--model', model);
    args.push(agent.target ?? job.agent);
    return args;
  }

  async ensureSession(job, agent, { signal, model } = {}) {
    return withTemporaryAcpxConfig(job.workspace.workspaceCwd, job.agent, agent, async () => {
      const args = [
        ...this.baseArgs(job, agent, model),
        'sessions', 'ensure', '--name', job.sessionName,
      ];
      const result = await runCommand(process.execPath, args, {
        cwd: job.workspace.workspaceCwd,
        signal,
      });
      if (result.code !== 0) {
        throw new Error(`acpx session ensure failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
      }
      return result;
    });
  }

  async prompt(job, agent, promptFile, { signal, model, onStdout, onStderr } = {}) {
    return withTemporaryAcpxConfig(job.workspace.workspaceCwd, job.agent, agent, async () => {
      await this.ensureSession(job, agent, { signal, model });
      const args = [
        ...this.baseArgs(job, agent, model),
        '-s', job.sessionName,
        '--file', promptFile,
      ];
      const result = await runCommand(process.execPath, args, {
        cwd: job.workspace.workspaceCwd,
        signal,
        onStdout,
        onStderr,
      });
      return { ...result, parsed: parseAcpNdjson(result.stdout) };
    });
  }

  async cancel(job, agent) {
    return withTemporaryAcpxConfig(job.workspace.workspaceCwd, job.agent, agent, async () => {
      const args = [
        ...this.baseArgs(job, agent),
        'cancel', '-s', job.sessionName,
      ];
      return runCommand(process.execPath, args, { cwd: job.workspace.workspaceCwd });
    });
  }
}

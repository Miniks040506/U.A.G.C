import fs from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from './process.mjs';

async function git(cwd, args, options = {}) {
  const result = await runCommand('git', args, { cwd, ...options });
  if (result.code !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(' ')} failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result;
}

export async function findGitRoot(cwd) {
  const result = await git(cwd, ['rev-parse', '--show-toplevel'], { allowFailure: true });
  if (result.code !== 0) return null;
  return path.resolve(result.stdout.trim());
}

function safeName(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'repo';
}

export class WorkspaceManager {
  constructor(stateDir) {
    this.stateDir = stateDir;
  }

  async prepare(originalCwd, requestedMode, jobId) {
    const absoluteCwd = path.resolve(originalCwd);
    const gitRoot = await findGitRoot(absoluteCwd);

    if (requestedMode !== 'worktree' || !gitRoot) {
      return {
        requestedMode,
        mode: 'shared',
        originalCwd: absoluteCwd,
        workspaceCwd: absoluteCwd,
        gitRoot,
        originalGitRoot: gitRoot,
        worktreePath: null,
        branch: null,
        note: requestedMode === 'worktree' && !gitRoot ? 'Not a git repository; fell back to shared workspace.' : null,
      };
    }

    const repoName = safeName(path.basename(gitRoot));
    const relativeCwd = path.relative(gitRoot, absoluteCwd);
    const worktreePath = path.join(this.stateDir, 'worktrees', repoName, jobId);
    const branch = `uagent/${jobId}`;
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });

    await git(gitRoot, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD']);

    return {
      requestedMode,
      mode: 'worktree',
      originalCwd: absoluteCwd,
      workspaceCwd: path.join(worktreePath, relativeCwd),
      gitRoot: worktreePath,
      originalGitRoot: gitRoot,
      worktreePath,
      branch,
      note: null,
    };
  }

  async capture(job) {
    if (!job.workspace?.gitRoot) {
      return { changedFiles: [], diffStat: '', patch: '', patchAvailable: false };
    }

    if (job.workspace.mode === 'worktree') {
      await git(job.workspace.gitRoot, ['add', '-A']);
      const changed = await git(job.workspace.gitRoot, ['diff', '--cached', '--name-only', 'HEAD']);
      const stat = await git(job.workspace.gitRoot, ['diff', '--cached', '--stat', 'HEAD']);
      const patch = await git(job.workspace.gitRoot, ['diff', '--cached', '--binary', 'HEAD']);
      return {
        changedFiles: changed.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
        diffStat: stat.stdout.trim(),
        patch: patch.stdout,
        patchAvailable: true,
      };
    }

    const changed = await git(job.workspace.gitRoot, ['status', '--porcelain'], { allowFailure: true });
    const trackedDiff = await git(job.workspace.gitRoot, ['diff', '--binary', 'HEAD'], { allowFailure: true });
    return {
      changedFiles: changed.stdout
        .split(/\r?\n/)
        .map((line) => line.slice(3).trim())
        .filter(Boolean),
      diffStat: '',
      patch: trackedDiff.stdout,
      patchAvailable: false,
      note: 'Shared workspace patch excludes untracked-file contents and is not eligible for agent_apply.',
    };
  }

  async apply(job, { allowDirty = false } = {}) {
    if (job.workspace?.mode !== 'worktree' || !job.patchFile || !job.workspace.originalGitRoot) {
      throw new Error('agent_apply requires a worktree-backed job with a captured patch.');
    }

    const targetRoot = job.workspace.originalGitRoot;
    const status = await git(targetRoot, ['status', '--porcelain']);
    if (status.stdout.trim() && !allowDirty) {
      throw new Error('Target repository has local changes. Refusing to apply automatically; commit/stash them or call with allowDirty=true.');
    }

    const result = await git(targetRoot, ['apply', '--3way', '--index', job.patchFile], { allowFailure: true });
    if (result.code !== 0) {
      throw new Error(`git apply failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }

    await git(targetRoot, ['reset']);
    const after = await git(targetRoot, ['status', '--porcelain']);
    return {
      targetRoot,
      changed: after.stdout.split(/\r?\n/).filter(Boolean),
    };
  }

  async cleanup(job, { deleteBranch = true } = {}) {
    if (job.workspace?.mode !== 'worktree' || !job.workspace.worktreePath || !job.workspace.originalGitRoot) {
      return { cleaned: false, reason: 'No isolated worktree to clean.' };
    }

    await git(job.workspace.originalGitRoot, ['worktree', 'remove', '--force', job.workspace.worktreePath], { allowFailure: true });
    if (deleteBranch && job.workspace.branch) {
      await git(job.workspace.originalGitRoot, ['branch', '-D', job.workspace.branch], { allowFailure: true });
    }
    return { cleaned: true, worktreePath: job.workspace.worktreePath, branch: job.workspace.branch };
  }
}

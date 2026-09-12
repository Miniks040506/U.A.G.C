import { runCommand } from './process.mjs';
import { validatePermissions } from './config.mjs';

function expand(value, vars) {
  return value
    .replaceAll('{{cwd}}', vars.cwd)
    .replaceAll('{{promptFile}}', vars.promptFile)
    .replaceAll('{{prompt}}', vars.prompt)
    .replaceAll('{{model}}', vars.model ?? '')
    .replaceAll('{{runtimeModel}}', vars.runtimeModel ?? vars.model ?? '')
    .replaceAll('{{provider}}', vars.provider ?? '')
    .replaceAll('{{runtime}}', vars.runtime ?? '');
}

function expandEnv(rawEnv, vars) {
  if (!rawEnv) return process.env;
  const out = { ...process.env };
  for (const [key, value] of Object.entries(rawEnv)) {
    out[key] = expand(String(value), vars);
  }
  return out;
}

export class CliAdapter {
  async prompt(job, runtime, promptFile, { signal, model, provider, rawModel, onStdout, onStderr } = {}) {
    validatePermissions(runtime, job.permissions);
    if (!runtime.argv?.length) throw new Error(`CLI runtime ${job.runtime ?? job.agent} has no argv.`);
    const [rawCommand, ...rawArgs] = runtime.argv;
    const prompt = await import('node:fs/promises').then((fs) => fs.readFile(promptFile, 'utf8'));
    const vars = {
      cwd: job.workspace.workspaceCwd,
      promptFile,
      prompt,
      model: rawModel ?? job.model ?? '',
      runtimeModel: model ?? job.runtimeModel ?? rawModel ?? '',
      provider: provider ?? job.provider ?? '',
      runtime: job.runtime ?? job.agent,
    };
    const command = expand(rawCommand, vars);
    const args = rawArgs.map((x) => expand(x, vars));
    const containsPromptPlaceholder = runtime.argv.some((x) => x.includes('{{promptFile}}') || x.includes('{{prompt}}'));
    const stdin = containsPromptPlaceholder ? undefined : prompt;
    const result = await runCommand(command, args, {
      cwd: job.workspace.workspaceCwd,
      signal,
      timeoutMs: job.timeoutSeconds * 1000,
      stdin,
      env: expandEnv(runtime.env, vars),
      onStdout,
      onStderr,
    });
    return {
      ...result,
      parsed: {
        assistantText: result.stdout.trim(),
        toolEvents: [],
        stopReason: result.code === 0 ? 'end_turn' : 'error',
        events: [],
      },
    };
  }

  async cancel() {
    return { code: 0, stdout: '', stderr: '' };
  }
}

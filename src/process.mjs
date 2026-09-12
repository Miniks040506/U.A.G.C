import { spawn, spawnSync } from 'node:child_process';

export function commandExists(command) {
  if (!command) return true;
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(probe, [command], {
    stdio: 'ignore',
    windowsHide: true,
  });
  return result.status === 0;
}

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      options.onStdout?.(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      options.onStderr?.(chunk);
    });

    const abort = () => {
      if (child.exitCode == null && child.signalCode == null) {
        try {
          child.kill('SIGINT');
        } catch {
          try {
            child.kill();
          } catch {
            // Ignore best-effort cancellation errors.
          }
        }
      }
    };

    if (options.signal) {
      if (options.signal.aborted) abort();
      options.signal.addEventListener('abort', abort, { once: true });
    }

    if (options.stdin != null) {
      child.stdin.end(String(options.stdin));
    } else {
      child.stdin.end();
    }

    child.on('error', reject);
    child.on('close', (code, signal) => {
      options.signal?.removeEventListener('abort', abort);
      resolve({ code, signal, stdout, stderr, child });
    });
  });
}

export function spawnBackground(command, args = [], options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  });
  return child;
}

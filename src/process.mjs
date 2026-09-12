import { spawn, spawnSync } from 'node:child_process';

export function commandExists(command) {
  if (!command) return false;
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
    stdio: 'ignore', windowsHide: true, timeout: 5000,
  });
  return result.status === 0;
}

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(Object.assign(new Error('Process cancelled before launch.'), { code: 'ABORT_ERR' }));
    const timeoutMs = options.timeoutMs ?? 60_000;
    const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(maxOutputBytes) || maxOutputBytes <= 0) {
      return reject(new Error('Process timeout and output limit must be positive finite numbers.'));
    }
    const child = spawn(command, args, {
      cwd: options.cwd, env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false,
      detached: process.platform !== 'win32',
    });
    let stdout = '', stderr = '', bytes = 0, failure, escalation, termination, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline); clearTimeout(escalation); clearTimeout(termination);
      options.signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(result);
    };
    const stop = (error) => {
      if (failure || settled) return;
      failure = error;
      if (child.pid) {
        if (process.platform === 'win32') {
          // ponytail: taskkill is best effort; detached descendants need an OS job/container boundary.
          spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore', windowsHide: true, timeout: 5000,
          });
          child.kill();
        } else {
          try { process.kill(-child.pid, 'SIGTERM'); } catch {}
          escalation = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 500);
        }
      }
      termination = setTimeout(() => {
        child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy(); child.unref();
        finish(Object.assign(new Error('Process termination could not be confirmed; inspect the worker before cleanup.'), { code: 'ETERMINATION' }));
      }, 6000);
    };
    const abort = () => stop(Object.assign(new Error('Process cancelled.'), { code: 'ABORT_ERR' }));
    const deadline = setTimeout(() => stop(Object.assign(new Error(`Process timed out after ${timeoutMs} ms.`), { code: 'ETIMEDOUT' })), timeoutMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    for (const [stream, callback, isError] of [[child.stdout, options.onStdout, false], [child.stderr, options.onStderr, true]]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        if (failure) return;
        bytes += Buffer.byteLength(chunk);
        if (bytes > maxOutputBytes) return stop(Object.assign(new Error('Process output limit exceeded.'), { code: 'EOUTPUTLIMIT' }));
        if (isError) stderr += chunk; else stdout += chunk;
        try { callback?.(chunk); } catch (error) { stop(error); }
      });
    }
    child.on('error', (error) => finish(error));
    child.stdin.on('error', (error) => { if (error.code !== 'EPIPE') stop(error); });
    child.on('close', (code, signal) => finish(failure, { code, signal, stdout, stderr }));
    child.stdin.end(options.stdin == null ? undefined : String(options.stdin));
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../src/process.mjs';

test('process runner enforces deadlines, cancellation and output bounds', async () => {
  const start = Date.now();
  await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 150 }), { code: 'ETIMEDOUT' });
  assert.ok(Date.now() - start < 8000);
  await assert.rejects(runCommand(process.execPath, ['-e', "process.stdout.write('x'.repeat(100000))"], { maxOutputBytes: 100 }), { code: 'EOUTPUTLIMIT' });
  const controller = new AbortController();
  const pending = runCommand(process.execPath, ['-e', "console.log('ready');setInterval(()=>{},1000)"], {
    signal: controller.signal, onStdout: () => controller.abort(),
  });
  await assert.rejects(pending, { code: 'ABORT_ERR' });
  await assert.rejects(runCommand('must-not-launch', [], { signal: controller.signal }), { code: 'ABORT_ERR' });
  const result = await runCommand(process.execPath, ['-e', "process.stdin.pipe(process.stdout)"], { stdin: 'hello\n' });
  assert.equal(result.stdout, 'hello\n');
  await assert.rejects(runCommand('uagc-nonexistent-executable'), { code: 'ENOENT' });
  await assert.rejects(runCommand(process.execPath, [], { timeoutMs: -1 }), /positive finite/);
});

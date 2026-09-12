import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function acquireStateLock(stateDir) {
  const file = path.join(stateDir, 'gateway.lock');
  const content = JSON.stringify({ pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() });
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('State directory is locked by another gateway or needs recovery: ' + file + '. Stop the owner; after a crash inspect workers before removing this lock.');
    throw error;
  }
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } catch (error) {
    fs.closeSync(fd); fs.unlinkSync(file); throw error;
  }
  fs.closeSync(fd);
  // ponytail: crash locks require manual inspection; never guess that surviving workers stopped.
  const release = () => {
    try {
      if (fs.readFileSync(file, 'utf8') === content) fs.unlinkSync(file);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    process.removeListener('exit', onExit);
  };
  const onExit = () => { try { release(); } catch {} };
  process.once('exit', onExit);
  return release;
}

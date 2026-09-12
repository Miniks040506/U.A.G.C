import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class JobStore {
  constructor(stateDir) {
    this.stateDir = stateDir;
    this.jobs = new Map();
    this.writes = new Map();
  }

  jobDir(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{12}$/.test(id)) {
      throw new Error('Invalid job ID: expected 12 lowercase hexadecimal characters.');
    }
    return path.join(this.stateDir, 'jobs', id);
  }

  jobFile(id) {
    return path.join(this.jobDir(id), 'job.json');
  }

  async create(job) {
    return this.write(job.id, async () => {
      if (await this.get(job.id)) throw new Error(`Job already exists: ${job.id}`);
      return structuredClone(job);
    });
  }

  async get(id) {
    const file = this.jobFile(id);
    if (this.jobs.has(id)) return structuredClone(this.jobs.get(id));
    try {
      const job = JSON.parse(await fs.readFile(file, 'utf8'));
      if (job.id !== id) throw new Error('Stored job ID does not match its directory.');
      this.jobs.set(id, job);
      return structuredClone(job);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async update(id, patch) {
    if ('id' in patch) throw new Error('A job ID cannot be changed.');
    return this.write(id, async () => {
      const job = await this.get(id);
      if (!job) throw new Error(`Unknown job: ${id}`);
      return { ...job, ...structuredClone(patch), updatedAt: new Date().toISOString() };
    });
  }

  async write(id, build) {
    const file = this.jobFile(id);
    const previous = this.writes.get(id) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      const job = await build();
      const temporary = `${file}.${randomUUID()}.tmp`;
      await fs.mkdir(this.jobDir(id), { recursive: true });
      try {
        await fs.writeFile(temporary, JSON.stringify(job, null, 2), { flag: 'wx' });
        await fs.rename(temporary, file);
        this.jobs.set(id, job);
        return structuredClone(job);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    });
    this.writes.set(id, write);
    try { return await write; } finally {
      if (this.writes.get(id) === write) this.writes.delete(id);
    }
  }
}

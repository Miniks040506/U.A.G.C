import fs from 'node:fs/promises';
import path from 'node:path';

export class JobStore {
  constructor(stateDir) {
    this.stateDir = stateDir;
    this.jobs = new Map();
  }

  jobDir(id) {
    return path.join(this.stateDir, 'jobs', id);
  }

  jobFile(id) {
    return path.join(this.jobDir(id), 'job.json');
  }

  async create(job) {
    await fs.mkdir(this.jobDir(job.id), { recursive: true });
    this.jobs.set(job.id, job);
    await this.save(job);
    return job;
  }

  async get(id) {
    if (this.jobs.has(id)) return this.jobs.get(id);
    try {
      const raw = await fs.readFile(this.jobFile(id), 'utf8');
      const job = JSON.parse(raw);
      this.jobs.set(id, job);
      return job;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async update(id, patch) {
    const job = await this.get(id);
    if (!job) throw new Error(`Unknown job: ${id}`);
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    await this.save(job);
    return job;
  }

  async save(job) {
    const serializable = { ...job };
    await fs.mkdir(this.jobDir(job.id), { recursive: true });
    await fs.writeFile(this.jobFile(job.id), JSON.stringify(serializable, null, 2));
  }
}

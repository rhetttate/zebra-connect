import crypto from 'node:crypto';

// In-memory print queue for station mode: the tablet by the printer polls
// jobs off this queue and relays them over Bluetooth.
export function createQueue({ staleMs = 90000, now = Date.now } = {}) {
  const jobs = [];
  let failed = 0;

  return {
    add(zpl, name) {
      const job = {
        id: crypto.randomUUID(),
        name: name || 'Print job',
        zpl: Buffer.from(zpl).toString('base64'),
        status: 'pending',
        takenAt: 0,
      };
      jobs.push(job);
      return job;
    },
    next() {
      const t = now();
      const job = jobs.find((j) =>
        j.status === 'pending' ||
        (j.status === 'printing' && t - j.takenAt > staleMs));
      if (!job) return null;
      job.status = 'printing';
      job.takenAt = t;
      return { id: job.id, name: job.name, zpl: job.zpl };
    },
    complete(id) {
      const i = jobs.findIndex((j) => j.id === id);
      if (i === -1) return false;
      jobs.splice(i, 1);
      return true;
    },
    fail(id, error) {
      const i = jobs.findIndex((j) => j.id === id);
      if (i === -1) return false;
      jobs.splice(i, 1);
      failed++;
      return true;
    },
    status: () => ({
      pending: jobs.filter((j) => j.status !== 'failed').length,
      failed,
    }),
  };
}

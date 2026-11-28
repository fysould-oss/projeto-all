import { cpus } from 'node:os';

export function createCpuMeter({ readCpus = cpus, now = Date.now, minIntervalMs = 1000 } = {}) {
  let previous;
  let sampledAt = -Infinity;
  let cached = null;

  return function cpuPercent() {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) return null;
    if (timestamp >= sampledAt && timestamp - sampledAt < minIntervalMs) return cached;

    const processors = readCpus();
    if (!Array.isArray(processors) || !processors.length) return null;
    const current = processors.map(({ times }) => ({
      idle: times?.idle,
      total: times && times.user + times.nice + times.sys + times.idle + times.irq,
    }));
    const baseline = previous;
    previous = current;
    sampledAt = timestamp;
    cached = null;
    if (baseline?.length !== current.length) return cached;

    let total = 0;
    let idle = 0;
    for (const [index, counter] of current.entries()) {
      const elapsed = counter.total - baseline[index].total;
      const idleTime = counter.idle - baseline[index].idle;
      if (!Number.isFinite(elapsed) || !Number.isFinite(idleTime)
        || idleTime < 0 || elapsed < idleTime) return cached;
      total += elapsed;
      idle += idleTime;
    }
    if (total > 0) cached = 100 * (total - idle) / total;
    return cached;
  };
}

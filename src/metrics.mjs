import os from 'node:os';
import { statfs } from 'node:fs/promises';
import { InputError } from './core.mjs';

export const METRIC_INTERVAL_MS = 5 * 60 * 1000;
export const METRIC_RETENTION_DAYS = 30;
export const METRIC_RANGE_DAYS = Object.freeze([1, 3, 7, 15, 30]);

let previousCpu = null;

export function validateMetricRangeDays(value) {
  const days = Number(value ?? 1);
  if (!METRIC_RANGE_DAYS.includes(days)) throw new InputError('Metric range must be 1, 3, 7, 15, or 30 days.');
  return days;
}

export async function collectHostMetrics(options = {}) {
  const now = options.now ?? Date.now();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const memoryUsed = Math.max(0, totalMemory - freeMemory);
  const disk = await readDiskUsage(options.diskPath);
  return {
    at: now,
    cpuPercent: sampleCpuPercent(),
    memoryUsedBytes: memoryUsed,
    memoryTotalBytes: totalMemory,
    diskUsedBytes: disk.usedBytes,
    diskTotalBytes: disk.totalBytes,
    uptimeSeconds: Math.floor(os.uptime())
  };
}

export function sampleCpuPercent(readCpus = os.cpus) {
  const cpus = readCpus();
  if (!Array.isArray(cpus) || !cpus.length) return 0;
  const current = summarizeCpu(cpus);
  const previous = previousCpu;
  previousCpu = current;
  if (!previous) {
    const load = os.loadavg()?.[0];
    if (Number.isFinite(load) && load > 0) return clampPercent((load / cpus.length) * 100);
    return 0;
  }
  const idleDelta = current.idle - previous.idle;
  const totalDelta = current.total - previous.total;
  if (totalDelta <= 0) return 0;
  return clampPercent((1 - idleDelta / totalDelta) * 100);
}

export function resetCpuSampleState() {
  previousCpu = null;
}

export function publicMetricSample(sample) {
  const memoryTotal = sample.memoryTotalBytes || 0;
  const diskTotal = sample.diskTotalBytes || 0;
  return {
    at: new Date(sample.at).toISOString(),
    cpuPercent: roundMetric(sample.cpuPercent),
    memoryPercent: memoryTotal ? roundMetric((sample.memoryUsedBytes / memoryTotal) * 100) : 0,
    diskPercent: diskTotal ? roundMetric((sample.diskUsedBytes / diskTotal) * 100) : 0,
    memoryUsedBytes: sample.memoryUsedBytes,
    memoryTotalBytes: sample.memoryTotalBytes,
    diskUsedBytes: sample.diskUsedBytes,
    diskTotalBytes: sample.diskTotalBytes
  };
}

export function publicCurrentMetrics(sample) {
  return {
    ...publicMetricSample(sample),
    uptimeSeconds: sample.uptimeSeconds ?? 0
  };
}

async function readDiskUsage(diskPath) {
  const target = diskPath ?? (process.platform === 'win32' ? process.cwd().slice(0, 3) || 'C:\\' : '/');
  try {
    const stats = await statfs(target);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail ?? stats.bfree) * Number(stats.bsize);
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    if (!Number.isFinite(totalBytes) || totalBytes <= 0) return { usedBytes: 0, totalBytes: 0 };
    return { usedBytes, totalBytes };
  } catch {
    return { usedBytes: 0, totalBytes: 0 };
  }
}

function summarizeCpu(cpus) {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.irq + times.idle;
  }
  return { idle, total };
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function roundMetric(value) {
  return Math.round(clampPercent(value) * 10) / 10;
}

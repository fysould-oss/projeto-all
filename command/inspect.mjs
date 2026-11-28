import { execFile } from 'node:child_process';
import { cpus, freemem, totalmem, uptime } from 'node:os';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export function resources() {
  return { cores: cpus().length, free: freemem(), total: totalmem(), uptime: uptime(), serverRss: process.memoryUsage().rss };
}

export async function inspectProject(project, kind) {
  const args = kind === 'check'
    ? ['diff', '--check', '--no-ext-diff', '--no-textconv', 'HEAD', '--']
    : kind === 'diff'
    ? ['diff', '--no-ext-diff', '--no-textconv', '--no-color', 'HEAD', '--']
    : ['status', '--porcelain=v1', '--branch', '--untracked-files=normal'];
  const result = await execute('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
    cwd: project.path, windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024,
  }).catch(error => {
    if (kind === 'check' && error.code === 2 && error.stdout) {
      return { stdout: error.stdout, issue: true };
    }
    throw error;
  });
  return { output: result.stdout, passed: kind === 'check' ? !result.issue : undefined };
}

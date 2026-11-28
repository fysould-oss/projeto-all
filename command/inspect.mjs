import { execFile } from 'node:child_process';
import { cpus, freemem, totalmem, uptime } from 'node:os';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export function resources() {
  return { cores: cpus().length, free: freemem(), total: totalmem(), uptime: uptime(), serverRss: process.memoryUsage().rss };
}

export async function inspectProject(project, kind, prepared) {
  if (kind === 'approval-diff' && ![prepared?.head, prepared?.tree].every(value =>
    typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value))) {
    throw new Error('O escopo Git da aprovação é inválido.');
  }
  const args = kind === 'check'
    ? ['diff', '--check', '--no-ext-diff', '--no-textconv', 'HEAD', '--']
    : kind === 'diff'
    ? ['diff', '--no-ext-diff', '--no-textconv', '--no-color', 'HEAD', '--']
    : kind === 'staged'
    ? ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '--']
    : kind === 'approval-diff'
    ? ['diff', '--no-ext-diff', '--no-textconv', '--no-color', prepared.head, prepared.tree, '--']
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

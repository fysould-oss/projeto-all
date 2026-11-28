import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createChecks } from './checks.mjs';

async function project(scripts) {
  const dir = await mkdtemp(join(tmpdir(), 'checks-'));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts }));
  return dir;
}

async function waitForRun(checks, dir, id, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const entry = checks.list(dir).find(item => item.id === id);
    if (entry && predicate(entry)) return entry;
    await delay(50);
  }
  assert.fail('The expected check state did not arrive.');
}

test('executes configured scripts and bounds output', async t => {
  const dir = await project({ lint: 'node -e "console.log(\'ok\')"', build: 'node -e "process.exit(2)"', typecheck: 'node -e "console.log(\'x\'.repeat(10000))"', other: 'echo no' });
  const checks = createChecks({ maxOutputBytes: 4096 });
  t.after(async () => {
    await checks.close();
    await rm(dir, { recursive: true, force: true });
  });
  assert.deepEqual(await checks.available({ path: dir }), ['lint', 'build', 'typecheck']);
  const run = await checks.start(dir, 'lint');
  assert.equal(run.status, 'running');
  const final = await waitForRun(checks, dir, run.id, item => item.durationMs != null);
  assert.equal(final.status, 'passed');
  assert.match(final.output, /ok/);
  const failed = await checks.start(dir, 'build');
  assert.equal((await waitForRun(checks, dir, failed.id, item => item.durationMs != null)).status, 'failed');
  const noisy = await checks.start(dir, 'typecheck');
  const noisyResult = await waitForRun(checks, dir, noisy.id, item => item.durationMs != null);
  assert.ok(noisyResult.output.length <= 4200);
  assert.match(noisyResult.output, /output truncated/);
});

test('cancels a long-running script', async t => {
  const dir = await project({ test: 'node -e "console.log(123456, process.pid); setTimeout(() => {}, 60000)"' });
  const checks = createChecks({ timeoutMs: 15000 });
  t.after(async () => {
    await checks.close();
    await rm(dir, { recursive: true, force: true });
  });
  const run = await checks.start(dir, 'test');
  const running = await waitForRun(checks, dir, run.id, item => /^123456 \d+/m.test(item.output));
  const pid = Number(running.output.match(/^123456 (\d+)/m)[1]);
  assert.doesNotThrow(() => process.kill(pid, 0));
  assert.equal(checks.activeCount(), 1);
  const result = await checks.cancel(dir, run.id);
  assert.equal(result.status, 'cancelled');
  assert.equal(checks.activeCount(), 0);
  assert.equal((await checks.list(dir))[0].status, 'cancelled');
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

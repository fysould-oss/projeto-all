import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCpuMeter } from './telemetry.mjs';
const sample = (user, idle) => [{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }];
test('computes interval CPU percent and caches within minimum interval', () => {
  let time = 0, index = 0; const values = [sample(10, 90), sample(30, 110), sample(40, 120)];
  const meter = createCpuMeter({ readCpus: () => values[index], now: () => time, minIntervalMs: 100 });
  assert.equal(meter(), null); index = 1; time = 100; assert.equal(meter(), 50); index = 2; time = 150; assert.equal(meter(), 50);
});
test('resets on hotplug or counter reset and has no timer side effects', () => {
  let index = 0; const values = [sample(1, 1), [{ times: { user: 2, nice: 0, sys: 0, idle: 2, irq: 0 } }, { times: { user: 1, nice: 0, sys: 0, idle: 1, irq: 0 } }], sample(2, 2)];
  let time = 0; const meter = createCpuMeter({ readCpus: () => values[index], now: () => time, minIntervalMs: 0 });
  assert.equal(meter(), null); index = 1; time++; assert.equal(meter(), null); index = 2; time++; assert.equal(meter(), null);
});

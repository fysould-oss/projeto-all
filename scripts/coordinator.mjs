import { access, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { enqueue, openQueue, recentJobs, recover, runSlot } from '../monitor/coordinator.mjs';

const [command, arg] = process.argv.slice(2);
const abort = new AbortController();
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => abort.abort());
let db;
try {
  if (command === 'list') {
    console.table(recentJobs());
  } else {
    db = openQueue();
    if (command === 'add' && arg) {
      const chunks = [];
      let size = 0;
      for await (const chunk of process.stdin) {
        size += chunk.length;
        if (size > 32768) throw new Error('A instrução excede 32 KiB.');
        chunks.push(chunk);
      }
      console.log(await enqueue(db, resolve(arg), Buffer.concat(chunks).toString('utf8')));
    } else if (command === 'run' || command === 'once') {
      const config = JSON.parse(await readFile(arg, 'utf8'));
      if (!Array.isArray(config.executors) || config.executors.length !== 2 ||
          config.executors.some(entry => !entry || typeof entry.binary !== 'string' || !isAbsolute(entry.binary) ||
            (entry.model != null && typeof entry.model !== 'string'))) throw new Error('Configure dois executores com binary e model opcional.');
      await Promise.all(config.executors.map(entry => access(entry.binary)));
      await Promise.all(config.executors.map(async (entry, index) => {
        do {
          const result = await runSlot(db, index ? 'b' : 'a', { binary: entry.binary, model: entry.model, signal: abort.signal });
          if (command === 'once') {
            if (result?.status === 'failed') process.exitCode = 1;
            break;
          }
          if (abort.signal.aborted) break;
          if (!result) await sleep(1000);
        } while (!abort.signal.aborted);
      }));
    } else if (command === 'events' && arg) {
      console.table(db.prepare('SELECT kind,at FROM events WHERE job=? ORDER BY seq').all(arg));
    } else if (command === 'recover' && arg) {
      recover(db, arg);
    } else throw new Error('Use add <repo>, list, events <id>, run <config>, once <config> ou recover <id>.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { db?.close(); }

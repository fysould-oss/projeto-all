import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coordinateResume, enqueue, openQueue, recentJobs, recover, runSlot } from './coordinator.mjs';

test('dois executores isolam arquivos, limitam concorrência e guardam somente metadados', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'office-coordinator-'));
  const repo = join(dir, 'repo');
  await mkdir(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  const db = openQueue(dir);
  try {
    git('init', '-q');
    await writeFile(join(repo, 'base.txt'), 'original');
    git('add', 'base.txt');
    git('-c','user.name=QA','-c','user.email=qa@example.invalid','commit','-qm','base');
    await writeFile(join(repo, 'base.txt'), 'modificação local');
    const ids = [];
    for (const prompt of ['consulta A', 'consulta B', 'consulta C']) ids.push(await enqueue(db, repo, prompt));
    const opts = { binary: process.execPath, dir, model: 'qa', start(binary, args, options) {
      assert.deepEqual(args, ['exec','--json','--sandbox','workspace-write','--model','qa','-']);
      assert.equal(options.shell, false);
      return spawn(binary, ['-e', `
        process.stdin.on('data', () => {});
        process.stdin.on('end', () => {
          require('fs').writeFileSync('resultado.txt','teste');
          console.log(JSON.stringify({type:'item.completed',item:{text:'CONTEUDO_SENSIVEL'}}));
          console.log(JSON.stringify({type:'turn.completed'}));
        });
      `], options);
    }};
    const a = runSlot(db, 'a', opts), b = runSlot(db, 'b', opts);
    const remote = coordinateResume(db, 'remote-test', repo, new AbortController().signal, async record => {
      record('turn.started'); record('turn.completed');
    });
    assert.equal(db.prepare("SELECT status FROM jobs WHERE id='remote-test'").get().status, 'waiting_remote');
    assert.equal(await runSlot(db, 'a', opts), null);
    const results = await Promise.all([a,b]);
    assert.deepEqual(results.map(r => r.status), ['done','done']);
    assert.deepEqual(results.map(r => r.files), [1,1]);
    assert.equal(await readFile(join(repo,'base.txt'),'utf8'),'modificação local');
    await remote;
    assert.equal(db.prepare("SELECT status FROM jobs WHERE id='remote-test'").get().status,'done');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='turn.completed'").get().n, 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE prompt<>''").get().n, 1);
    assert.doesNotMatch(JSON.stringify(recentJobs(dir)), /consulta|CONTEUDO_SENSIVEL|base\.txt/);
    const failed = await runSlot(db,'a',{...opts,start(exe,_args,o){return spawn(exe,['-e','process.stdin.resume()'],o);}});
    assert.equal(failed.status,'failed');
    assert.equal(await runSlot(db,'a',opts),null);
    db.prepare("UPDATE jobs SET status='running',owner=?,child=NULL WHERE id=?").run(process.pid,ids[2]);
    assert.throws(()=>recover(db, ids[2]), /processo ainda existe/);
    db.prepare("UPDATE jobs SET owner=NULL WHERE id=?").run(ids[2]);
    recover(db,ids[2]);
    assert.equal(db.prepare('SELECT result FROM jobs WHERE id=?').get(ids[2]).result,'interrupted');
  } finally { db.close(); await rm(dir,{recursive:true,force:true,maxRetries:5}); }
});

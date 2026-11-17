import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Archive } from '../src/archive.js';
import { Collector, slotFor } from '../src/collector.js';

test('collector preserves full payloads, zero/null/stale waits and survives reopening without duplicates',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'disney-history-'));const path=join(dir,'history.sqlite');let archive=new Archive(path);let now=Date.parse('2026-11-17T12:02:00Z');let calls=0;
 const live={liveData:[{id:'zero',queue:{STANDBY:{waitTime:0},PAID:{price:1500}},lastUpdated:'2020-01-01T00:00:00Z'}, {id:'unknown',queue:{STANDBY:{waitTime:null}},futureField:{preserve:true}}]};
 const fetchImpl=async url=>{calls++;return Response.json(url.endsWith('/children')?{children:[]}:url.endsWith('/live')?live:{id:url.split('/').at(-1)});};
 try{
  let collector=new Collector(archive,{fetchImpl,now:()=>now,pause:async()=>{}});
  assert.equal((await collector.collect()).status,'complete');
  const rows=archive.db.prepare('SELECT * FROM observations ORDER BY entity_id').all();assert.equal(rows.length,2);
  assert.equal(rows[1].standby_minutes,0);assert.equal(rows[0].standby_minutes,null);assert.equal(rows[1].source_updated_at,'2020-01-01T00:00:00Z');
  assert.deepEqual(archive.payload(rows[0].response_id),live);
  const count=calls;archive.close();archive=new Archive(path);collector=new Collector(archive,{fetchImpl,now:()=>now,pause:async()=>{}});
  assert.equal((await collector.collect()).skipped,true);assert.equal(calls,count);
  now+=300000;await collector.collect();assert.equal(archive.db.prepare('SELECT count(*) n FROM observations').get().n,4);
  assert.equal(archive.db.prepare('SELECT count(*) n FROM payloads').get().n,3);
 }finally{archive.close();rmSync(dir,{recursive:true,force:true});}
});
test('upstream failure and persistent rate limit leave visible gaps without synthetic observations',async()=>{
 const a=new Archive(':memory:');let calls=0;const now=Date.parse('2026-11-17T12:00:00Z');
 try{
  const c=new Collector(a,{now:()=>now,pause:async()=>{},fetchImpl:async()=>{calls++;return Response.json({error:'slow down'},{status:429,headers:{'retry-after':'600'}});}});
  assert.equal((await c.collect()).status,'partial');assert.equal(calls,1);
  assert.equal(a.db.prepare('SELECT count(*) n FROM observations').get().n,0);
  const c2=new Collector(a,{now:()=>now+300000,pause:async()=>{},fetchImpl:async()=>{throw Error('must not fetch');}});
  assert.equal((await c2.collect()).status,'partial');
  assert.equal(a.db.prepare('SELECT count(*) n FROM runs').get().n,2);
  a.start(slotFor(now+600000),new Date(now+600000).toISOString());
  a.start(slotFor(now+900000),new Date(now+900000).toISOString());
  assert.equal(a.db.prepare('SELECT status FROM runs WHERE slot=?').get(slotFor(now+600000)).status,'interrupted');
 }finally{a.close();}
});

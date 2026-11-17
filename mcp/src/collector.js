import { mkdirSync, statfsSync, writeFileSync, renameSync } from 'node:fs';
import { backup } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Archive } from './archive.js';
import { DESTINATION_ID } from './disneyworld.js';

export const INTERVAL=300_000;
export const slotFor = now => new Date(Math.floor(now/INTERVAL)*INTERVAL).toISOString();
export class Collector {
  constructor(archive, { fetchImpl=fetch, now=Date.now, pause=delay }={}) {
    this.archive=archive;this.fetch=fetchImpl;this.now=now;this.pause=pause;
    this.blockedUntil=Number(archive.db.prepare("SELECT value FROM state WHERE key='blocked_until'").get()?.value??0);
  }
  async request(slot,path,validate,live=false) {
    if(this.now()<this.blockedUntil) {
      this.archive.save(slot,path,{fetchedAt:new Date(this.now()).toISOString(),error:'Rate-limit backoff; not requested'});
      return null;
    }
    let result={fetchedAt:new Date(this.now()).toISOString()};let data;
    try {
      const headers={Accept:'application/json','User-Agent':'DisneyWorldHistory/1.0'};
      if(process.env.THEMEPARKS_API_KEY)headers['X-API-Key']=process.env.THEMEPARKS_API_KEY;
      const r=await this.fetch(`https://api.themeparks.wiki/v1/${path}`,{headers,signal:AbortSignal.timeout(20_000)});
      result={...result,status:r.status,headers:Object.fromEntries(['date','etag','cache-control','last-modified','retry-after'].map(k=>[k,r.headers.get(k)])),body:await r.text()};
      if(r.status===429) {
        const raw=r.headers.get('retry-after');const seconds=Number(raw);
        this.blockedUntil=this.now()+(raw&&Number.isFinite(seconds)?Math.max(1,seconds)*1000:Math.max(60_000,Date.parse(raw)-this.now()||0));
        this.archive.db.prepare("INSERT INTO state VALUES('blocked_until',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(this.blockedUntil));
      }
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      data=JSON.parse(result.body);if(!validate(data))throw new Error('Invalid response schema');
    }catch(e){ result.error=result.status?`HTTP ${result.status}: invalid or unsuccessful response`:'Network request failed';data=null; }
    this.archive.save(slot,path,result,live);
    await this.pause(300);
    return data;
  }
  async collect() {
    const slot=slotFor(this.now());
    if(!this.archive.start(slot,new Date(this.now()).toISOString()))return {slot,skipped:true};
    const root=`entity/${DESTINATION_ID}`;
    const directory=await this.request(slot,`${root}/children`,d=>Array.isArray(d?.children)&&d.children.every(r=>typeof r.id==='string'));
    if(directory) {
      const put=this.archive.db.prepare('INSERT INTO entities VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,entity_type=excluded.entity_type,park_id=excluded.park_id,last_seen=excluded.last_seen');
      for(const r of [{id:DESTINATION_ID,name:directory.name,entityType:'DESTINATION'},...directory.children])put.run(r.id,r.name??null,r.entityType??null,r.parkId??r.parentId??null,new Date(this.now()).toISOString());
    }
    await this.request(slot,`${root}/live`,d=>Array.isArray(d?.liveData)&&d.liveData.every(r=>typeof r.id==='string'),true);
    const parks=this.archive.db.prepare("SELECT id FROM entities WHERE entity_type='PARK'").all();
    for(const p of parks)await this.request(slot,`entity/${p.id}/schedule`,d=>Array.isArray(d?.schedule));
    // Spread full metadata acquisition over successive ticks, then refresh daily.
    const due=this.archive.db.prepare(`SELECT e.id FROM entities e LEFT JOIN responses r ON r.path='entity/'||e.id AND r.error IS NULL
      GROUP BY e.id HAVING max(r.fetched_at) IS NULL OR max(r.fetched_at)<? ORDER BY max(r.fetched_at),e.id LIMIT 30`).all(new Date(this.now()-86400_000).toISOString());
    for(const e of due)await this.request(slot,`entity/${e.id}`,d=>d?.id===e.id);
    this.archive.finish(slot,new Date(this.now()).toISOString());
    return {slot,...this.archive.db.prepare('SELECT status FROM runs WHERE slot=?').get(slot),observations:this.archive.db.prepare('SELECT count(*) AS n FROM observations WHERE slot=?').get(slot).n};
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const path=process.env.ARCHIVE_DB??'/data/history.sqlite';mkdirSync(dirname(path),{recursive:true});
  const archive=new Archive(path);const collector=new Collector(archive);let stopping=false;
  const abort=new AbortController();for(const sig of ['SIGTERM','SIGINT'])process.once(sig,()=>{stopping=true;abort.abort();});
  try{
    do {
      const disk=statfsSync(dirname(path));
      if(disk.bavail*disk.bsize<2*1024**3)throw new Error('Less than 2 GiB free; collection paused to protect existing history');
      const result=await collector.collect();console.log(JSON.stringify(result));
      const health=join(dirname(path),'health.json');writeFileSync(health+'.tmp',JSON.stringify({...result,checkedAt:new Date().toISOString()}));renameSync(health+'.tmp',health);
      if(process.env.ARCHIVE_BACKUP_DIR && !stopping) {
        const day=new Date().toISOString().slice(0,10);
        const last=archive.db.prepare("SELECT value FROM state WHERE key='backup_day'").get()?.value;
        if(last!==day) {
          try {
            const destination=join(process.env.ARCHIVE_BACKUP_DIR,'history-latest.sqlite');
            await backup(archive.db,destination+'.tmp');renameSync(destination+'.tmp',destination);
            archive.db.prepare("INSERT INTO state VALUES('backup_day',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(day);
            console.log(JSON.stringify({backup:'complete',day}));
          }catch { console.error('Daily backup failed; retrying next collection'); }
        }
      }
      if(process.argv.includes('--once')||stopping)break;
      await delay(INTERVAL-Date.now()%INTERVAL,undefined,{signal:abort.signal}).catch(e=>{if(!stopping)throw e;});
    }while(!stopping);
  }finally{archive.close();}
}

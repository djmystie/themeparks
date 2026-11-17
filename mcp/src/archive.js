import { DatabaseSync } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export class Archive {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS payloads (hash TEXT PRIMARY KEY, json_gzip BLOB NOT NULL, bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (slot TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS responses (id INTEGER PRIMARY KEY, slot TEXT NOT NULL REFERENCES runs(slot), path TEXT NOT NULL,
        fetched_at TEXT NOT NULL, http_status INTEGER, headers_json TEXT, payload_hash TEXT REFERENCES payloads(hash), error TEXT,
        UNIQUE(slot,path));
      CREATE INDEX IF NOT EXISTS responses_path_time ON responses(path,fetched_at);
      CREATE TABLE IF NOT EXISTS observations (slot TEXT NOT NULL REFERENCES runs(slot), entity_id TEXT NOT NULL, name TEXT,
        entity_type TEXT, park_id TEXT, status TEXT, standby_minutes REAL, source_updated_at TEXT, collected_at TEXT NOT NULL,
        response_id INTEGER NOT NULL REFERENCES responses(id), PRIMARY KEY(slot,entity_id));
      CREATE INDEX IF NOT EXISTS observations_entity_time ON observations(entity_id,collected_at);
      CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, name TEXT, entity_type TEXT, park_id TEXT, last_seen TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  start(slot, now) {
    // A process interruption is evidence of an incomplete run, never a successful sample.
    this.db.prepare("UPDATE runs SET status='interrupted' WHERE status='running' AND slot<>?").run(slot);
    const old = this.db.prepare('SELECT status FROM runs WHERE slot=?').get(slot);
    if (old?.status === 'complete') return false;
    this.db.prepare("INSERT INTO runs VALUES(?,?,NULL,'running') ON CONFLICT(slot) DO UPDATE SET status='running',finished_at=NULL").run(slot,now);
    return true;
  }
  save(slot, path, result, live = false) {
    const { body, fetchedAt, status, headers, error } = result;
    const hash = body === undefined ? null : createHash('sha256').update(body).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (hash) this.db.prepare('INSERT OR IGNORE INTO payloads VALUES(?,?,?)').run(hash,gzipSync(body),Buffer.byteLength(body));
      this.db.prepare(`INSERT INTO responses(slot,path,fetched_at,http_status,headers_json,payload_hash,error) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(slot,path) DO UPDATE SET fetched_at=excluded.fetched_at,http_status=excluded.http_status,
        headers_json=excluded.headers_json,payload_hash=excluded.payload_hash,error=excluded.error`).run(slot,path,fetchedAt,status??null,JSON.stringify(headers??{}),hash,error??null);
      const response = this.db.prepare('SELECT id FROM responses WHERE slot=? AND path=?').get(slot,path);
      if (live && !error) {
        const data=JSON.parse(body);
        this.db.prepare('DELETE FROM observations WHERE slot=?').run(slot);
        const insert=this.db.prepare('INSERT INTO observations VALUES(?,?,?,?,?,?,?,?,?,?)');
        for (const row of data.liveData) insert.run(slot,row.id,row.name??null,row.entityType??null,row.parkId??null,row.status??null,
          typeof row.queue?.STANDBY?.waitTime==='number'?row.queue.STANDBY.waitTime:null,row.lastUpdated??null,fetchedAt,response.id);
      }
      this.db.exec('COMMIT');
    } catch(e) { this.db.exec('ROLLBACK'); throw e; }
  }
  payload(id) {
    const row=this.db.prepare('SELECT json_gzip FROM payloads JOIN responses ON hash=payload_hash WHERE responses.id=?').get(id);
    return row ? JSON.parse(gunzipSync(row.json_gzip).toString()) : null;
  }
  finish(slot, now) {
    const errors=this.db.prepare('SELECT count(*) AS n FROM responses WHERE slot=? AND error IS NOT NULL').get(slot).n;
    this.db.prepare('UPDATE runs SET finished_at=?,status=? WHERE slot=?').run(now,errors?'partial':'complete',slot);
  }
  close() { this.db.close(); }
}

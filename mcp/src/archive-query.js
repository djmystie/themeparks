import { DatabaseSync } from 'node:sqlite';
const db=new DatabaseSync(process.env.ARCHIVE_DB??'/data/history.sqlite',{readOnly:true});
try {
  const [entity,from,to]=process.argv.slice(2);
  if(!entity){
    console.log(JSON.stringify({runs:db.prepare('SELECT status,count(*) AS count FROM runs GROUP BY status').all(),observations:db.prepare('SELECT count(*) AS count,min(collected_at) AS first,max(collected_at) AS last FROM observations').get(),latest:db.prepare('SELECT * FROM runs ORDER BY slot DESC LIMIT 3').all()},null,2));
  }else{
    if(!from||!to||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to)))throw new Error('Supply entity UUID and ISO from/to timestamps');
    for(const row of db.prepare('SELECT * FROM observations WHERE entity_id=? AND collected_at>=? AND collected_at<? ORDER BY collected_at').iterate(entity,new Date(from).toISOString(),new Date(to).toISOString()))console.log(JSON.stringify(row));
  }
}finally{db.close();}

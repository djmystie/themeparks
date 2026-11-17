import { DatabaseSync, backup } from 'node:sqlite';
import { renameSync } from 'node:fs';
const target=process.argv[2];if(!target)throw new Error('Provide backup destination path (different from live database)');
const source=process.env.ARCHIVE_DB??'/data/history.sqlite';
if(source===target||source===target+'.tmp')throw new Error('Backup must not overwrite the live database');
const db=new DatabaseSync(source,{readOnly:true});
try{await backup(db,target+'.tmp');renameSync(target+'.tmp',target);console.log('Consistent SQLite backup completed');}finally{db.close();}

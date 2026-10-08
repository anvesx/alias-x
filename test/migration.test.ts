import {test} from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import {URL as NodeURL} from 'node:url';
test('chunk migration preserves existing aliases, retry budgets, fencing and rollback on a copy',()=>{
 const db=new DatabaseSync(':memory:');try {
 for(const name of ['0001.sql','0002.sql','0003.sql'])db.exec(readFileSync(new NodeURL('../migrations/'+name,import.meta.url),'utf8'));
 db.exec(`INSERT INTO aliases VALUES ('T1','C1','existing','["U123"]','U123',1,1,1);
 INSERT INTO deliveries(team,event_id,channel,aliases,thread,status,attempt,created_at,touched_at,due_at) VALUES
 ('T1','queued','C1','["existing"]','1.2','queued',4,1,1,1),
 ('T1','preparing','C1','["existing"]','1.2','preparing',4,1,1,1),
 ('T1','sending','C1','["existing"]','1.2','sending',4,1,1,1),
 ('T1','done','C1','["existing"]','1.2','done',1,1,1,1);`);
 const before=db.prepare('SELECT * FROM aliases').all();const migration=readFileSync(new NodeURL('../migrations/0004.sql',import.meta.url),'utf8');
 db.exec('BEGIN');db.exec(migration);db.exec('ROLLBACK');
 assert.ok(!db.prepare('PRAGMA table_info(deliveries)').all().some(r=>r.name==='recipients'));
 assert.deepEqual(db.prepare('SELECT * FROM aliases').all(),before);
 db.exec(migration);
 assert.deepEqual(db.prepare('SELECT * FROM aliases').all(),before);
 const rows=db.prepare('SELECT * FROM deliveries').all();assert.equal(rows.length,4);
 for(const row of rows){assert.equal(row.recipients,null);assert.equal(row.next_recipient,0);assert.equal(row.aliases,'["existing"]');}
 assert.equal(rows.find(r=>r.event_id==='queued')!.failures,4);
 assert.equal(rows.find(r=>r.event_id==='preparing')!.failures,3);
 assert.equal(rows.find(r=>r.event_id==='sending')!.status,'sending');
 assert.equal(rows.find(r=>r.event_id==='sending')!.attempt,4);
 assert.equal(rows.find(r=>r.event_id==='done')!.status,'done');
 }finally{db.close();}
});

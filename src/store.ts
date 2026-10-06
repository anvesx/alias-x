import {InputError} from './core.ts';
export interface Alias {team:string;channel:string;name:string;members:string;creator:string;created_at:number;updated_at:number;revision:number}
export interface Delivery {team:string;event_id:string;channel:string;aliases:string;thread:string;status:'queued'|'preparing'|'sending'|'done'|'failed'|'uncertain';attempt:number;created_at:number;touched_at:number;due_at:number;error:string|null}
export class Store {
 constructor(readonly db:D1Database){}
 async list(team:string,channel:string):Promise<Alias[]> {return (await this.db.prepare('SELECT * FROM aliases WHERE team=? AND channel=? ORDER BY name').bind(team,channel).all<Alias>()).results;}
 async get(team:string,channel:string,name:string):Promise<Alias|null> {return this.db.prepare('SELECT * FROM aliases WHERE team=? AND channel=? AND name=?').bind(team,channel,name).first<Alias>();}
 async create(team:string,channel:string,name:string,members:string[],actor:string,now:number,max:number):Promise<void> {
 // INSERT..SELECT limit and composite PK execute atomically in SQLite; concurrent creates cannot bypass the cap.
 const insert=this.db.prepare('INSERT OR IGNORE INTO aliases(team,channel,name,members,creator,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM aliases WHERE team=?) < ?').bind(team,channel,name,JSON.stringify(members),actor,now,now,team,max);
 const [result]=await this.db.batch([insert,this.auditStatement(team,channel,name,actor,'create',now)]);
 if(!result!.meta.changes) throw new InputError((await this.get(team,channel,name))?'Alias already exists. Use set to update members.':`Maximum ${max} aliases reached.`);
 }
 async update(row:Alias,members:string[],now:number,actor=row.creator,action='set'):Promise<void> {
 const mutation=this.db.prepare('UPDATE aliases SET members=?,updated_at=?,revision=revision+1 WHERE team=? AND channel=? AND name=? AND revision=?').bind(JSON.stringify(members),now,row.team,row.channel,row.name,row.revision);
 const [r]=await this.db.batch([mutation,this.auditStatement(row.team,row.channel,row.name,actor,action,now)]);
 if(!r!.meta.changes) throw new InputError('Alias changed concurrently. Read it again and retry.');
 }
 async remove(row:Alias,actor=row.creator,now=row.updated_at):Promise<void> {
 const mutation=this.db.prepare('DELETE FROM aliases WHERE team=? AND channel=? AND name=? AND revision=?').bind(row.team,row.channel,row.name,row.revision);
 const [r]=await this.db.batch([mutation,this.auditStatement(row.team,row.channel,row.name,actor,'delete',now)]);
 if(!r!.meta.changes) throw new InputError('Alias changed concurrently. Read it again and retry.');
 }
 private auditStatement(team:string,channel:string,name:string,actor:string,action:string,now:number):D1PreparedStatement {return this.db.prepare('INSERT INTO audit(team,channel,name,actor,action,happened_at) SELECT ?,?,?,?,?,? WHERE changes()>0').bind(team,channel,name,actor,action,now);}
 async claim(team:string,eventId:string,channel:string,now:number):Promise<boolean> {
 const r=await this.db.prepare("INSERT OR IGNORE INTO events(team,event_id,channel,status,received_at) VALUES (?,?,?,'processing',?)").bind(team,eventId,channel,now).run(); return r.meta.changes===1;
 }
 async finish(team:string,eventId:string,error?:string):Promise<void> {await this.db.prepare('UPDATE events SET status=?,error=? WHERE team=? AND event_id=?').bind(error?'failed':'done',error??null,team,eventId).run();}
 async claimCommand(team:string,id:string,channel:string,now:number):Promise<boolean> {
 const r=await this.db.prepare("INSERT OR IGNORE INTO commands(team,request_id,channel,status,received_at) VALUES (?,?,?,'processing',?)").bind(team,id,channel,now).run();return r.meta.changes===1;
 }
 async commandResult(team:string,id:string):Promise<string|null> {return this.db.prepare('SELECT result FROM commands WHERE team=? AND request_id=?').bind(team,id).first<string>('result');}
 async finishCommand(team:string,id:string,result:string):Promise<void> {await this.db.prepare("UPDATE commands SET status='done',result=? WHERE team=? AND request_id=?").bind(result,team,id).run();}

 async enqueueDelivery(team:string,eventId:string,channel:string,names:string[],thread:string,now:number):Promise<void> {
 // Legacy claims suppress retries across the migration; their delivery outcome cannot be reconstructed.
 await this.db.prepare("INSERT OR IGNORE INTO deliveries(team,event_id,channel,aliases,thread,status,created_at,touched_at,due_at) SELECT ?,?,?,?,?,'queued',?,?,? WHERE NOT EXISTS (SELECT 1 FROM events WHERE team=? AND event_id=?)").bind(team,eventId,channel,JSON.stringify(names),thread,now,now,now,team,eventId).run();
 }
 async getDelivery(team:string,id:string):Promise<Delivery|null> {return this.db.prepare('SELECT * FROM deliveries WHERE team=? AND event_id=?').bind(team,id).first<Delivery>();}
 async takeDelivery(team:string,id:string,now:number):Promise<Delivery|null> {
 return this.db.prepare("UPDATE deliveries SET status='preparing',attempt=attempt+1,touched_at=? WHERE team=? AND event_id=? AND attempt<5 AND ((status='queued' AND due_at<=?) OR (status='preparing' AND touched_at<?)) RETURNING *").bind(now,team,id,now,now-120000).first<Delivery>();
 }
 async markSending(job:Delivery,now:number):Promise<boolean> {
 const r=await this.db.prepare("UPDATE deliveries SET status='sending',touched_at=? WHERE team=? AND event_id=? AND status='preparing' AND attempt=? AND touched_at>=?").bind(now,job.team,job.event_id,job.attempt,now-120000).run();return r.meta.changes===1;
 }
 async settleDelivery(job:Delivery,from:'preparing'|'sending',status:'queued'|'done'|'failed'|'uncertain',now:number,due=now,error:string|null=null):Promise<boolean> {
 const r=await this.db.prepare('UPDATE deliveries SET status=?,touched_at=?,due_at=?,error=? WHERE team=? AND event_id=? AND status=? AND attempt=?').bind(status,now,due,error,job.team,job.event_id,from,job.attempt).run();return r.meta.changes===1;
 }
 async dueDeliveries(team:string,now:number):Promise<Delivery[]> {return (await this.db.prepare("SELECT * FROM deliveries WHERE team=? AND attempt<5 AND ((status='queued' AND due_at<=?) OR (status='preparing' AND touched_at<?)) ORDER BY due_at LIMIT 10").bind(team,now,now-120000).all<Delivery>()).results;}
 async maintain(team:string,now:number):Promise<void> {
 await this.db.batch([
 this.db.prepare("UPDATE deliveries SET status='uncertain',error='worker_interrupted_during_send',touched_at=? WHERE team=? AND status='sending' AND touched_at<?").bind(now,team,now-120000),
 this.db.prepare("UPDATE deliveries SET status='failed',error='retry_limit_after_interruption',touched_at=? WHERE team=? AND status='preparing' AND attempt>=5 AND touched_at<?").bind(now,team,now-120000),
 this.db.prepare("DELETE FROM deliveries WHERE team=? AND ((status='done' AND touched_at<?) OR (status IN ('failed','uncertain') AND touched_at<?))").bind(team,now-7*86400000,now-30*86400000),
 this.db.prepare("DELETE FROM commands WHERE team=? AND ((status='done' AND received_at<?) OR (status='processing' AND received_at<?))").bind(team,now-7*86400000,now-30*86400000),
 this.db.prepare('DELETE FROM events WHERE team=? AND received_at<?').bind(team,now-30*86400000)
 ]);
 }

}

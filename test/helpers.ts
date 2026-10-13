import {URL as NodeURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';
import {d1FromSqlite} from '../src/sqlite-d1.ts';import {Store} from '../src/store.ts';import {Service} from '../src/service.ts';import type {SlackPort} from '../src/slack.ts';
import {DeliveryRunner} from '../src/delivery.ts';import {extractAliases} from '../src/core.ts';
export function fixture(){
 const sql=new DatabaseSync(':memory:');for(const name of readdirSync(new NodeURL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) sql.exec(readFileSync(new NodeURL('../migrations/'+name,import.meta.url),'utf8'));
 const db=d1FromSqlite(sql); // Same adapter the production server uses, running the real migration/query SQL.
 let current=new Set(['U123','U456','U789']);const posts:{channel:string;text:string;thread?:string}[]=[];
 const slack:SlackPort={async members(){return current;},async post(channel,text,thread){posts.push({channel,text,thread});}};
 const store=new Store(db),service=new Service(store,slack,()=>1700000000000);
 const runner=new DeliveryRunner(store,service,slack,()=>1700000000000);
 return {store,service,posts,sql,setMembers(v:string[]){current=new Set(v);},async mention(team:string,channel:string,text:string,thread:string){
 await store.enqueueDelivery(team,thread,channel,extractAliases(text),thread,1700000000000);await runner.run(team,thread);
 }};
}

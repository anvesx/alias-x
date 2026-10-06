import {URL as NodeURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';
import {Store} from '../src/store.ts';import {Service} from '../src/service.ts';import type {SlackPort} from '../src/slack.ts';
export function fixture(max=3){
 const sql=new DatabaseSync(':memory:');for(const name of readdirSync(new NodeURL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) sql.exec(readFileSync(new NodeURL('../migrations/'+name,import.meta.url),'utf8'));
 // Test-only D1 adapter executes actual migration/query SQL; Worker runtime is checked separately.
 const db={batch(statements:{execute():unknown}[]){sql.exec('BEGIN');try{const results=statements.map(s=>s.execute());sql.exec('COMMIT');return Promise.resolve(results);}catch(error){sql.exec('ROLLBACK');throw error;}},prepare(query:string){const statement=sql.prepare(query);let args:(string|number|null)[]=[];return {bind(...values:(string|number|null)[]){args=values;return this;},async first(column?:string){const row=statement.get(...args);return column?row?.[column]??null:row??null;},async all(){return {results:statement.all(...args)};},execute(){const r=statement.run(...args);return {meta:{changes:Number(r.changes)}};},async run(){return this.execute();}};}} as unknown as D1Database;
 let current=new Set(['U123','U456','U789']);const posts:{channel:string;text:string;thread?:string}[]=[];
 const slack:SlackPort={async members(){return current;},async post(channel,text,thread){posts.push({channel,text,thread});}};
 const store=new Store(db),service=new Service(store,slack,()=>1700000000000,max);
 return {store,service,posts,sql,setMembers(v:string[]){current=new Set(v);}};
}

import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';

type Param=string|number|null;
interface Runnable {execute():{meta:{changes:number}}}

/**
 * Minimal D1-compatible adapter over node:sqlite, so src/store.ts runs unchanged on a plain
 * Node server with a local SQLite file. Only the D1 methods that store.ts uses are implemented.
 * node:sqlite is synchronous, so a batch can never interleave with another request.
 */
export function d1FromSqlite(sql:DatabaseSync):D1Database {
 return {
  batch(statements:Runnable[]){
   sql.exec('BEGIN');
   try{const results=statements.map(s=>s.execute());sql.exec('COMMIT');return Promise.resolve(results);}
   catch(error){sql.exec('ROLLBACK');return Promise.reject(error);}
  },
  prepare(query:string){
   const statement=sql.prepare(query);let args:Param[]=[];
   return {
    bind(...values:Param[]){args=values;return this;},
    async first(column?:string){const row=statement.get(...args);return column?row?.[column]??null:row??null;},
    async all(){return {results:statement.all(...args),meta:{changes:0}};},
    execute(){const r=statement.run(...args);return {meta:{changes:Number(r.changes)}};},
    async run(){return this.execute();}
   };
  }
 } as unknown as D1Database;
}

/** Applies each migrations/*.sql file once, in name order, remembering what ran in _migrations. */
export function migrate(sql:DatabaseSync,migrationsDir:string):string[] {
 sql.exec('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
 const done=new Set((sql.prepare('SELECT name FROM _migrations').all() as {name:string}[]).map(r=>r.name));
 const applied:string[]=[];
 for(const name of readdirSync(migrationsDir).filter(n=>n.endsWith('.sql')).sort()) {
  if(done.has(name)) continue;
  sql.exec('BEGIN');
  try{
   sql.exec(readFileSync(join(migrationsDir,name),'utf8'));
   sql.prepare('INSERT INTO _migrations(name,applied_at) VALUES (?,?)').run(name,Date.now());
   sql.exec('COMMIT');
  }catch(error){sql.exec('ROLLBACK');throw new Error(`Migration ${name} failed: ${error instanceof Error?error.message:String(error)}`);}
  applied.push(name);
 }
 return applied;
}

/** Opens (creating if needed) the SQLite file, tunes it for a long-running server, and migrates it. */
export function openDatabase(path:string,migrationsDir:string):{sql:DatabaseSync;db:D1Database;applied:string[]} {
 if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
 const sql=new DatabaseSync(path);
 sql.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL;PRAGMA busy_timeout=5000;');
 const applied=migrate(sql,migrationsDir);
 return {sql,db:d1FromSqlite(sql),applied};
}

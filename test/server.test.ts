import {test} from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {URL as NodeURL,fileURLToPath} from 'node:url';
import {startServer,type RunningServer} from '../src/server.ts';import {openDatabase} from '../src/sqlite-d1.ts';
const now=1700000000000,secret='test-secret',migrationsDir=fileURLToPath(new NodeURL('../migrations',import.meta.url));
function sign(body:string){const ts=String(now/1000);return {'x-slack-request-timestamp':ts,'x-slack-signature':'v0='+createHmac('sha256',secret).update(`v0:${ts}:${body}`).digest('hex')};}
function command(text:string){return new URLSearchParams({team_id:'T1',channel_id:'C1',user_id:'U123',command:'/alias-x',trigger_id:'t'+text,response_url:'https://hooks.slack.com/commands/test',text}).toString();}
async function until(check:()=>boolean){for(let i=0;i<200&&!check();i++) await new Promise(r=>setTimeout(r,10));assert.ok(check(),'timed out waiting for background work');}
function setup(dbPath:string){
 const posts:string[]=[],callbacks:string[]=[];
 const io:typeof fetch=async(url,init)=>{
  if(String(url).includes('conversations.members')) return Response.json({ok:true,members:['U123','U456']});
  if(String(url).includes('chat.postMessage')){posts.push(String(init?.body));return Response.json({ok:true});}
  callbacks.push(String(init?.body));return new Response('',{status:200});
 };
 const start=()=>startServer({dbPath,migrationsDir,port:0,host:'127.0.0.1',token:'test',signingSecret:secret,teamId:'T1',allowedChannels:'C1',cronMs:3600000,io,clock:()=>now});
 return {posts,callbacks,start};
}
const post=(s:RunningServer,path:string,body:string,headers:Record<string,string>)=>fetch(`http://127.0.0.1:${s.port}${path}`,{method:'POST',body,headers});

test('server answers health and rejects unknown paths, unsigned and oversized requests',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'alias-x-'));const t=setup(join(dir,'a.db'));const s=await t.start();
 try{
  const health=await fetch(`http://127.0.0.1:${s.port}/health`);assert.equal(health.status,200);assert.deepEqual(await health.json(),{app:'alias-x',status:'ready'});
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/nope`)).status,404);
  assert.equal((await post(s,'/slack/commands',command('help'),{})).status,401);
  assert.equal((await post(s,'/slack/commands','x'.repeat(80000),sign('x'.repeat(80000)))).status,413);
 }finally{await s.close();rmSync(dir,{recursive:true,force:true});}
});

test('signed command and event work over HTTP and aliases survive a server restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'alias-x-'));const t=setup(join(dir,'a.db'));let s=await t.start();
 try{
  const create=command('create devs <@U123>');
  assert.equal((await post(s,'/slack/commands',create,sign(create))).status,200);
  await until(()=>t.callbacks.length===1);assert.match(t.callbacks[0]!,/Created !devs/);
  await s.close();s=await t.start(); // Same SQLite file, new process state.
  const show=command('show devs');
  assert.equal((await post(s,'/slack/commands',show,sign(show))).status,200);
  await until(()=>t.callbacks.length===2);assert.match(t.callbacks[1]!,/devs/);
  const before=t.posts.length; // creating an alias also announces itself in the channel
  const event=JSON.stringify({type:'event_callback',team_id:'T1',event_id:'E1',event:{type:'message',channel:'C1',user:'U456',text:'ping !devs',ts:'1.2'}});
  assert.equal((await post(s,'/slack/events',event,sign(event))).status,200);
  await until(()=>t.posts.length>before);assert.match(t.posts.at(-1)!,/<@U123>/);
  await s.sweep(); // The cron replacement runs cleanly.
 }finally{await s.close();rmSync(dir,{recursive:true,force:true});}
});

test('migrations apply once and are remembered in the SQLite file',()=>{
 const dir=mkdtempSync(join(tmpdir(),'alias-x-'));const path=join(dir,'m.db');
 try{
  const first=openDatabase(path,migrationsDir);assert.deepEqual(first.applied,['0001.sql','0002.sql','0003.sql','0004.sql']);first.sql.close();
  const second=openDatabase(path,migrationsDir);assert.deepEqual(second.applied,[]);second.sql.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

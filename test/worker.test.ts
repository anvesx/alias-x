import {test} from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';
import {createWorker,type Env} from '../src/worker.ts';import {fixture} from './helpers.ts';
const now=1700000000000,secret='test-secret';
function signed(body:string,path='/slack/commands'){const ts=String(now/1000);return new Request('https://worker.test'+path,{method:'POST',body,headers:{'x-slack-request-timestamp':ts,'x-slack-signature':'v0='+createHmac('sha256',secret).update(`v0:${ts}:${body}`).digest('hex')}});}
function setup(){const f=fixture();const jobs:Promise<unknown>[]=[];const posts:string[]=[];const callbacks:string[]=[];
 const io:typeof fetch=async (url,init)=>{if(String(url).includes('conversations.members'))return Response.json({ok:true,members:['U123','U456']});if(String(url).includes('chat.postMessage')){posts.push(String(init?.body));return Response.json({ok:true});}callbacks.push(String(init?.body));return new Response('',{status:200});};
 const env:Env={DB:f.store.db,SLACK_BOT_TOKEN:'test',SLACK_SIGNING_SECRET:secret,SLACK_TEAM_ID:'T1',ALLOWED_CHANNEL_IDS:'C1'};
 const ctx={waitUntil(p:Promise<unknown>){jobs.push(p);}} as unknown as ExecutionContext;
 return {...f,jobs,posts,callbacks,env,ctx,worker:createWorker(io,()=>now)};}
function command(text='create devs <@U123>',extra:Record<string,string>={}){return new URLSearchParams({team_id:'T1',channel_id:'C1',user_id:'U123',command:'/alias-x',trigger_id:'trigger-1',response_url:'https://hooks.slack.com/commands/test',text,...extra}).toString();}
test('signed slash command replay does not repeat mutation or channel announcement',async()=>{const f=setup();try{
 const req=command();const result=await f.worker.fetch!(signed(req),f.env,f.ctx);assert.equal(result.status,200);await Promise.all(f.jobs);
 const replay=await f.worker.fetch!(signed(req),f.env,f.ctx);assert.equal(replay.status,200);assert.match(await replay.text(),/Created !devs/);
 assert.equal(f.posts.length,1);assert.equal(f.callbacks.length,1);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM audit').get()!.n,1);
}finally{await Promise.allSettled(f.jobs);f.sql.close();}});
test('in-flight or interrupted command is not re-executed',async()=>{const f=setup();try{
 const body=command();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body))),b=>b.toString(16).padStart(2,'0')).join('');
 await f.store.claimCommand('T1',hash,'C1',now);const r=await f.worker.fetch!(signed(body),f.env,f.ctx);assert.match(await r.text(),/already accepted/);assert.equal(f.posts.length,0);assert.equal(f.jobs.length,0);
}finally{await Promise.allSettled(f.jobs);f.sql.close();}});
test('Worker rejects bad identities, callback hosts, signatures and oversized bodies',async()=>{const f=setup();try{
 for(const [extra,status] of [[{team_id:'T2'},403],[{channel_id:'C2'},403],[{command:'/other'},400],[{user_id:'bad'},400],[{response_url:'https://evil.test/commands/a'},400]] as const){const r=await f.worker.fetch!(signed(command('help',extra)),f.env,f.ctx);assert.equal(r.status,status);}
 const bad=new Request('https://worker.test/slack/commands',{method:'POST',body:command()});assert.equal((await f.worker.fetch!(bad,f.env,f.ctx)).status,401);
 assert.equal((await f.worker.fetch!(signed('x'.repeat(65537)),f.env,f.ctx)).status,413);assert.equal(f.jobs.length,0);
}finally{await Promise.allSettled(f.jobs);f.sql.close();}});
test('bot, edited, deleted and unauthorized channel events do not notify',async()=>{const f=setup();try{
 for(const change of [{bot_id:'B1'},{subtype:'message_changed'},{subtype:'message_deleted'},{channel:'C2'}]){const body=JSON.stringify({type:'event_callback',team_id:'T1',event_id:'E1',event:{type:'message',channel:'C1',user:'U123',text:'!devs',ts:'1.2',...change}});assert.equal((await f.worker.fetch!(signed(body,'/slack/events'),f.env,f.ctx)).status,200);}
 assert.equal(f.jobs.length,0);assert.equal(f.posts.length,0);
}finally{await Promise.allSettled(f.jobs);f.sql.close();}});
test('signed event is durable before acknowledgement and duplicate events post once',async()=>{const f=setup();try{
 await f.store.create('T1','C1','devs',['U123'],'U123',now);
 const body=JSON.stringify({type:'event_callback',team_id:'T1',event_id:'E2',event:{type:'message',channel:'C1',user:'U123',text:'private content !devs',ts:'1.2'}});
 assert.equal((await f.worker.fetch!(signed(body,'/slack/events'),f.env,f.ctx)).status,200);
 const job=await f.store.getDelivery('T1','E2');assert.ok(job);assert.equal(job.aliases,'["devs"]');assert.equal(job.thread,'1.2');assert.ok(!JSON.stringify(job).includes('private content'));
 await Promise.all(f.jobs);await f.worker.fetch!(signed(body,'/slack/events'),f.env,f.ctx);await Promise.all(f.jobs);assert.equal(f.posts.length,1);assert.equal((await f.store.getDelivery('T1','E2'))!.status,'done');
}finally{await Promise.allSettled(f.jobs);f.sql.close();}});
test('scheduled sweep recovers persisted jobs and fails closed for removed allowlist channels',async()=>{const f=setup();try{
 await f.store.create('T1','C1','devs',['U123'],'U123',now);
 await f.store.enqueueDelivery('T1','E3','C1',['devs'],'1.3',now);await f.store.enqueueDelivery('T1','E4','C2',['devs'],'1.4',now);
 const controller={cron:'* * * * *',scheduledTime:now,noRetry(){}} as ScheduledController;
 await f.worker.scheduled!(controller,f.env,f.ctx);assert.equal(f.posts.length,1);assert.equal((await f.store.getDelivery('T1','E3'))!.status,'done');assert.equal((await f.store.getDelivery('T1','E4'))!.status,'failed');
}finally{await Promise.allSettled(f.jobs);f.sql.close();}});

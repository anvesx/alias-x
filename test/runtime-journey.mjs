// Actual workerd + local D1 journey. Slack transport is mocked; no humans are notified.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,Response as MockResponse,convertV4MiniflareOptions} from 'miniflare';

const repo=dirname(dirname(fileURLToPath(import.meta.url)));
const temp=await mkdtemp(join(tmpdir(),'alias-runtime-'));
const secret='runtime-test-secret',owner='UOWNER';
const members=Array.from({length:20000},(_,i)=>'U'+String(i).padStart(11,'0'));
let current=[owner,...members.slice(0,800)],posts=[],callbacks=[],sequence=0,mf;
const outbound=async req=>{
 const url=new URL(req.url);
 if(url.hostname==='slack.com'&&url.pathname==='/api/conversations.members') {
 const start=Number(url.searchParams.get('cursor')||0),end=start+200;
 return MockResponse.json({ok:true,members:current.slice(start,end),response_metadata:{next_cursor:end<current.length?String(end):''}});
 }
 if(url.hostname==='slack.com'&&url.pathname==='/api/chat.postMessage') {
 posts.push(await req.json());return MockResponse.json({ok:true});
 }
 if(url.hostname==='hooks.slack.com'&&url.pathname==='/commands/runtime') {
 callbacks.push(await req.json());return new MockResponse('');
 }
 throw new Error('Unexpected outbound request: '+url.origin+url.pathname);
};
async function waitFor(check) {
 const deadline=Date.now()+10000;
 while(!await check()){if(Date.now()>deadline)throw new Error('Background Worker did not settle');await new Promise(resolve=>setTimeout(resolve,10));}
}
function headers(body) {
 const ts=String(Math.floor(Date.now()/1000));
 return {'x-slack-request-timestamp':ts,'x-slack-signature':'v0='+createHmac('sha256',secret).update(`v0:${ts}:${body}`).digest('hex')};
}
async function signed(body,path='/slack/commands') {
 return mf.dispatchFetch('https://worker.test'+path,{method:'POST',body,headers:headers(body)});
}
async function command(text) {
 const before=callbacks.length;
 const body=new URLSearchParams({team_id:'T1',channel_id:'C1',user_id:owner,command:'/alias-x',trigger_id:'runtime-'+sequence++,response_url:'https://hooks.slack.com/commands/runtime',text}).toString();
 assert.equal((await signed(body)).status,200);await waitFor(()=>callbacks.length>before);
 return callbacks.at(-1).text;
}
const mentionText=users=>users.map(user=>`<@${user}>`).join(' ');
try {
 // Only this temporary entry point exposes a sweep trigger. Production routes are unchanged.
 const entry=join(temp,'entry.mjs'),bundle=join(temp,'worker.mjs');
 await writeFile(entry,`import worker from ${JSON.stringify(join(repo,'src/worker.ts'))};
 export default {async fetch(req,env,ctx){
 if(new URL(req.url).pathname==='/__test/sweep'){await worker.scheduled({},env,ctx);return Response.json({swept:true});}
 return worker.fetch(req,env,ctx);
 }};`);
 await build({entryPoints:[entry],outfile:bundle,bundle:true,format:'esm',platform:'browser',logLevel:'silent'});
 const options={script:await readFile(bundle,'utf8'),modules:true,compatibilityDate:'2026-10-05',host:'127.0.0.1',port:0,cf:false,
 resourcePersistencePath:join(temp,'state'),resourceTmpPath:join(temp,'scratch'),
 d1Databases:{DB:'runtime-alias-db'},bindings:{SLACK_TEAM_ID:'T1',ALLOWED_CHANNEL_IDS:'C1',SLACK_BOT_TOKEN:'test',SLACK_SIGNING_SECRET:secret,MAX_ALIASES:'3'},outboundService:outbound};
 // Wrangler's pinned Miniflare exposes an adapter for its V4 worker options.
 mf=new Miniflare(convertV4MiniflareOptions(options));await mf.ready;let db=await mf.getD1Database('DB');
 // D1 exec treats each line as a statement; these migrations use multiline plain SQL.
 for(const name of (await readdir(join(repo,'migrations'))).filter(name=>name.endsWith('.sql')).sort()) {
 const statements=(await readFile(join(repo,'migrations',name),'utf8')).split(';').map(sql=>sql.trim()).filter(Boolean);
 await db.batch(statements.map(sql=>db.prepare(sql)));
 }
 assert.deepEqual(await (await mf.dispatchFetch('https://worker.test/health')).json(),{app:'alias-x',status:'ready'});
 for(let i=0;i<25;i++)assert.equal(await command(`create group${i} <@${owner}>`),`Created !group${i}.`);
 assert.equal(await command('create large '+mentionText(members.slice(0,400))),'Created !large.');
 assert.equal(await command('add large '+mentionText(members.slice(400,800))),'Updated !large: 800 members.');
 assert.equal((await db.prepare('SELECT count(*) AS n FROM aliases').first()).n,26);
 assert.equal((await db.prepare("SELECT json_array_length(members) AS n FROM aliases WHERE name='large'").first()).n,800);
 assert.match(await command('show large 4'),new RegExp(`<@${members[799]}>`));
 assert.match(await command('show large 5'),/Page does not exist/);
 assert.match(await command('list'),/\*!group24\*/);
 assert.match(await command(`create group0 <@${owner}>`),/already exists/);
 console.log('PASS: signed commands create 26 aliases from one owner; 800-member alias and show/list verified; legacy MAX_ALIASES=3 ignored.');

 // Large recipient fixture tests real D1 storage, JSON lookup, >100 Slack pages and chunk progress.
 await db.prepare("UPDATE aliases SET members=?,revision=revision+1 WHERE name='large'").bind(JSON.stringify(members)).run();current=[owner,...members];
 const event=JSON.stringify({type:'event_callback',team_id:'T1',event_id:'RuntimeLarge',event:{type:'message',channel:'C1',user:owner,text:'!large !large',ts:'1.2'}});
 assert.equal((await signed(event,'/slack/events')).status,200);
 await waitFor(async()=>['queued','done'].includes((await db.prepare("SELECT status FROM deliveries WHERE event_id='RuntimeLarge'").first()).status));
 let job=await db.prepare("SELECT * FROM deliveries WHERE event_id='RuntimeLarge'").first();
 assert.equal(job.status,'queued');assert.ok(job.next_recipient>0&&job.next_recipient<20000);
 const savedCursor=job.next_recipient;
 await mf.dispose();mf=new Miniflare(convertV4MiniflareOptions(options));await mf.ready;db=await mf.getD1Database('DB');
 job=await db.prepare("SELECT * FROM deliveries WHERE event_id='RuntimeLarge'").first();assert.equal(job.next_recipient,savedCursor);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM aliases').first()).n,26);
 for(let i=0;i<20&&job.status!=='done';i++) {
 await db.prepare("UPDATE deliveries SET due_at=0 WHERE event_id='RuntimeLarge'").run();
 assert.deepEqual(await (await mf.dispatchFetch('https://worker.test/__test/sweep')).json(),{swept:true});
 job=await db.prepare("SELECT * FROM deliveries WHERE event_id='RuntimeLarge'").first();
 }
 assert.equal(job.status,'done');assert.equal(job.next_recipient,20000);assert.equal(job.failures,0);assert.ok(job.attempt>5);
 const replies=posts.filter(post=>post.thread_ts==='1.2');assert.ok(replies.length>5);assert.ok(replies.every(post=>post.text.length<=39000));
 assert.deepEqual(replies.flatMap(post=>post.text.match(/<@[^>]+>/g)),members.map(user=>`<@${user}>`));
 assert.equal((await signed(event,'/slack/events')).status,200);
 await db.prepare("UPDATE deliveries SET due_at=0 WHERE event_id='RuntimeLarge'").run();await mf.dispatchFetch('https://worker.test/__test/sweep');
 assert.equal(posts.filter(post=>post.thread_ts==='1.2').length,replies.length);
 const tampered=event+' ';
 assert.equal((await mf.dispatchFetch('https://worker.test/slack/events',{method:'POST',body:tampered,headers:headers(event)})).status,401);
 console.log(`PASS: actual workerd/D1 delivered 20,000 synthetic handles in ${replies.length} chunks; cold restart, sweep continuation, dedup and HMAC error path verified.`);
 console.log('NOT RUN: live Slack rendering, recipient notifications or production deployment.');
}finally {
 if(mf)await mf.dispose();await rm(temp,{recursive:true,force:true});
}

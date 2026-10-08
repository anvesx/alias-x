import {test} from 'node:test';import assert from 'node:assert/strict';
import {URL as NodeURL} from 'node:url';
import {Slack,SlackError} from '../src/slack.ts';
import {fixture} from './helpers.ts';
import {verifySignature} from '../src/worker.ts';import {createHmac} from 'node:crypto';
test('full command lifecycle, membership changes, creation metadata and deletion',async()=>{
 const f=fixture();try {
 assert.match(await f.service.command('T1','C1','U123','help'),/channel-specific/);
 assert.match(await f.service.command('T1','C1','U123','list'),/No aliases/);
 assert.match(await f.service.command('T1','C1','U123','create !devs <@U123>'),/Created/);
 assert.equal(f.posts.length,1);assert.ok(!f.posts[0]!.text.includes('<@'));
 assert.match(await f.service.command('T1','C1','U123','show devs'),/2023-11-14/);
 await f.service.command('T1','C1','U123','add devs <@U456>');
 await f.service.command('T1','C1','U123','remove devs <@U123>');
 assert.match(await f.service.command('T1','C1','U123','show devs'),/<@U456>/);
 await f.service.command('T1','C1','U123','set devs <@U789>');
 assert.match(await f.service.command('T1','C1','U123','list'),/1 members/);
 await f.service.command('T1','C1','U123','delete devs');
 await assert.rejects(()=>f.service.command('T1','C1','U123','show devs'),/does not exist/);
 assert.equal(f.sql.prepare('SELECT count(*) AS n FROM audit').get()!.n,5);
 }finally{f.sql.close();}
});
test('workspace and channel isolation with same alias',async()=>{const f=fixture(10);try{
 await f.service.command('T1','C1','U123','create devs <@U123>');await f.service.command('T1','C2','U123','create devs <@U456>');await f.service.command('T2','C1','U123','create devs <@U789>');
 await f.service.mention('T1','C2','!devs','1.2');assert.match(f.posts.at(-1)!.text,/<@U456>/);assert.ok(!f.posts.at(-1)!.text.includes('<@U123>'));
 await f.service.mention('T2','C1','!devs','1.3');assert.match(f.posts.at(-1)!.text,/<@U789>/);
}finally{f.sql.close();}});
test('reject duplicate, nonmembers, empty membership and unknown aliases',async()=>{const f=fixture();try{
 await assert.rejects(()=>f.service.command('T1','C1','U999','help'),/must be a member/);
 await assert.rejects(()=>f.service.command('T1','C1','U123','create devs <@U999>'),/Every target/);
 await f.service.command('T1','C1','U123','create devs <@U123>');
 await assert.rejects(()=>f.service.command('T1','C1','U123','create devs <@U123>'),/already exists/);
 await assert.rejects(()=>f.service.command('T1','C1','U123','remove devs <@U123>'),/must contain/);
 await assert.rejects(()=>f.service.command('T1','C1','U123','delete unknown'),/does not exist/);
}finally{f.sql.close();}});
test('remove accepts stored members who left the channel while additions remain restricted',async()=>{const f=fixture();try{
 await f.service.command('T1','C1','U123','create devs <@U123> <@U456>');
 f.setMembers(['U123']);
 assert.equal(await f.service.command('T1','C1','U123','remove devs <@U456>'),'Updated !devs: 1 members.');
 assert.deepEqual(JSON.parse((await f.store.get('T1','C1','devs'))!.members),['U123']);
 await assert.rejects(()=>f.service.command('T1','C1','U123','add devs <@U456>'),/Every target/);
 await assert.rejects(()=>f.service.command('T1','C1','U123','set devs <@U456>'),/Every target/);
 await assert.rejects(()=>f.service.command('T1','C1','U999','remove devs <@U123>'),/must be a member/);
}finally{f.sql.close();}});
test('atomic create cap and optimistic concurrent update protection',async()=>{const f=fixture();try{
 const results=await Promise.allSettled(['a','b','c','d'].map(n=>f.store.create('T1','C1',n,['U123'],'U123',1,3)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,3);
 const row=(await f.store.get('T1','C1','a'))!;
 await f.store.update(row,['U456'],2);await assert.rejects(()=>f.store.update(row,['U789'],3),/concurrently/);
}finally{f.sql.close();}});
test('alias replies deduplicate overlapping members and remove channel leavers',async()=>{const f=fixture();try{
 await f.service.command('T1','C1','U123','create devs <@U123> <@U456>');await f.service.command('T1','C1','U123','create ops <@U123> <@U789>');f.setMembers(['U123','U789']);
 await f.service.mention('T1','C1','!devs !ops !devs','1.2');const last=f.posts.at(-1)!;
 assert.equal(last.text,'<@U123> <@U789>');
 assert.equal(last.thread,'1.2');assert.equal((last.text.match(/<@U123>/g)??[]).length,1);assert.ok(!last.text.includes('U456'));assert.match(last.text,/<@U789>/);
 const count=f.posts.length;await f.service.mention('T1','C1','!unknown `!devs`','1.3');assert.equal(f.posts.length,count);
 f.setMembers([]);await f.service.mention('T1','C1','!devs !ops','1.4');assert.equal(f.posts.length,count);
}finally{f.sql.close();}});
test('event claims suppress concurrent retries, with explicit failure state',async()=>{const f=fixture();try{
 const claims=await Promise.all([f.store.claim('T1','E1','C1',1),f.store.claim('T1','E1','C1',1)]);assert.equal(claims.filter(Boolean).length,1);
 await f.store.finish('T1','E1','failed_delivery');assert.equal(f.sql.prepare('SELECT status FROM events').get()!.status,'failed');
}finally{f.sql.close();}});
test('HMAC validates authentic payload and rejects tampering/stale/future/missing signatures',async()=>{
 const ts=1700000000,body='{"challenge":"test"}',secret='test-secret';
 const sig='v0='+createHmac('sha256',secret).update(`v0:${ts}:${body}`).digest('hex');const headers=new Headers({'x-slack-request-timestamp':String(ts),'x-slack-signature':sig});
 assert.equal(await verifySignature(body,headers,secret,ts),true);assert.equal(await verifySignature(body+'x',headers,secret,ts),false);
 assert.equal(await verifySignature(body,headers,secret,ts+301),false);assert.equal(await verifySignature(body,headers,secret,ts-301),false);assert.equal(await verifySignature(body,new Headers(),secret,ts),false);
});
test('Slack client paginates members and fails closed on errors or malformed responses',async()=>{
 let calls=0;const io:typeof fetch=async()=>{calls++;return Response.json(calls===1?{ok:true,members:['U123'],response_metadata:{next_cursor:'next'}}:{ok:true,members:['U456']});};
 assert.deepEqual(await new Slack('test',io).members('C1'),new Set(['U123','U456']));assert.equal(calls,2);
 await assert.rejects(()=>new Slack('test',async()=>Response.json({ok:false,error:'missing_scope'})).members('C1'),SlackError);
 await assert.rejects(()=>new Slack('test',async()=>Response.json({ok:true,members:'wrong'})).members('C1'),/invalid_members/);
 await assert.rejects(()=>new Slack('test',async()=>new Response('',{status:429})).members('C1'),/http_429/);
});

test('Slack membership uses GET query and posting uses JSON with unbound fetch',async()=>{
 const requests:{url:string;init:RequestInit}[]=[];
 const io:typeof fetch=async function(this:unknown,input,init){
 assert.equal(this,undefined);requests.push({url:String(input),init:init!});
 return Response.json(String(input).includes('conversations.members')?{ok:true,members:['U123']}:{ok:true});
 };
 const slack=new Slack('test',io);await slack.members('C1');await slack.post('C1','test','1.2');
 assert.equal(requests[0]!.init.method,'GET');assert.equal(new NodeURL(requests[0]!.url).searchParams.get('channel'),'C1');assert.equal(requests[0]!.init.body,undefined);
 assert.equal(requests[1]!.init.method,'POST');assert.deepEqual(JSON.parse(String(requests[1]!.init.body)),{channel:'C1',text:'test',thread_ts:'1.2',unfurl_links:false,unfurl_media:false});
});
test('membership pagination obeys one total time budget',async()=>{
 let calls=0;
 const io:typeof fetch=async (_input,init)=>{calls++;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,16);const signal=init?.signal;const abort=()=>{clearTimeout(timer);reject(new DOMException('Membership budget exceeded','AbortError'));};if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});return Response.json({ok:true,members:['U123'],response_metadata:{next_cursor:'more'}});};
 await assert.rejects(()=>new Slack('test',io,25).members('C1'),{name:'AbortError'});assert.ok(calls<=2);
});

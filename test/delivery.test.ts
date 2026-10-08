import {test} from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './helpers.ts';import {DeliveryRunner} from '../src/delivery.ts';
import {Service} from '../src/service.ts';import {SlackError,type SlackPort} from '../src/slack.ts';
function setup(){const f=fixture();let now=1700000000000;let readFail=false;let postError:Error|undefined;const sent:string[]=[];
 const slack:SlackPort={async members(){if(readFail)throw new SlackError('http_503',0,true);return new Set(['U123','U456']);},async post(_channel,text){if(postError)throw postError;sent.push(text);}};
 const clock=()=>now;const runner=new DeliveryRunner(f.store,new Service(f.store,slack,clock),slack,clock);
 return {...f,runner,sent,clock,setReadFail(v:boolean){readFail=v;},setPostError(e?:Error){postError=e;},advance(ms:number){now+=ms;}};}
async function seed(f:ReturnType<typeof setup>,id='E1'){await f.store.create('T1','C1','devs',['U123'],'U123',f.clock());await f.store.enqueueDelivery('T1',id,'C1',['devs'],'1.2',f.clock());}
test('durable event dedup and successful delivery transition',async()=>{const f=setup();try{await seed(f);await f.store.enqueueDelivery('T1','E1','C1',['devs'],'1.2',f.clock());await Promise.all([f.runner.run('T1','E1'),f.runner.run('T1','E1')]);assert.equal(f.sent.length,1);assert.equal((await f.store.getDelivery('T1','E1'))!.status,'done');}finally{f.sql.close();}});
test('read failure is safely retried with latest membership after recovery',async()=>{const f=setup();try{await seed(f);f.setReadFail(true);await f.runner.run('T1','E1');assert.equal((await f.store.getDelivery('T1','E1'))!.status,'queued');assert.equal(f.sent.length,0);f.setReadFail(false);const row=(await f.store.get('T1','C1','devs'))!;await f.store.update(row,['U456'],f.clock());f.advance(60000);await f.runner.run('T1','E1');assert.match(f.sent[0]!,/<@U456>/);assert.ok(!f.sent[0]!.includes('U123'));assert.equal((await f.store.getDelivery('T1','E1'))!.status,'done');}finally{f.sql.close();}});
test('expired preparation lease recovers and fences stale worker',async()=>{const f=setup();try{await seed(f);const stale=(await f.store.takeDelivery('T1','E1',f.clock()))!;f.advance(120001);const fresh=(await f.store.takeDelivery('T1','E1',f.clock()))!;assert.equal(fresh.attempt,2);assert.equal(await f.store.markSending(stale,f.clock()),false);assert.equal(await f.store.markSending(fresh,f.clock()),true);}finally{f.sql.close();}});
test('known 429 honors retry-after and does not duplicate delivery',async()=>{const f=setup();try{await seed(f);f.setPostError(new SlackError('http_429',180000));await f.runner.run('T1','E1');f.setPostError();f.advance(60000);await f.runner.run('T1','E1');assert.equal(f.sent.length,0);f.advance(120000);await f.runner.run('T1','E1');assert.equal(f.sent.length,1);}finally{f.sql.close();}});
test('ambiguous post failure is recorded and never blindly retried',async()=>{const f=setup();try{await seed(f);f.setPostError(new Error('socket disconnected after write'));await f.runner.run('T1','E1');assert.equal((await f.store.getDelivery('T1','E1'))!.status,'uncertain');f.setPostError();f.advance(600000);await f.store.maintain('T1',f.clock());await f.runner.run('T1','E1');assert.equal(f.sent.length,0);}finally{f.sql.close();}});
test('crash during sending becomes explicit uncertain state; completed ledgers expire',async()=>{const f=setup();try{await seed(f);const job=(await f.store.takeDelivery('T1','E1',f.clock()))!;await f.store.markSending(job,f.clock());f.advance(120001);await f.store.maintain('T1',f.clock());assert.equal((await f.store.getDelivery('T1','E1'))!.status,'uncertain');await f.runner.run('T1','E1');assert.equal(f.sent.length,0);await f.store.claimCommand('T1','R1','C1',f.clock());await f.store.finishCommand('T1','R1','done');f.advance(8*86400000);await f.store.maintain('T1',f.clock());assert.equal(await f.store.commandResult('T1','R1'),null);assert.equal((await f.store.getDelivery('T1','E1'))!.status,'uncertain');f.advance(23*86400000);await f.store.maintain('T1',f.clock());assert.equal(await f.store.getDelivery('T1','E1'),null);}finally{f.sql.close();}});
test('permanent failure is explicit and retries are bounded',async()=>{const f=setup();try{await seed(f);f.setPostError(new SlackError('missing_scope'));await f.runner.run('T1','E1');assert.equal((await f.store.getDelivery('T1','E1'))!.status,'failed');await f.store.enqueueDelivery('T1','E2','C1',['devs'],'1.3',f.clock());f.setPostError();f.setReadFail(true);for(let i=0;i<5;i++){await f.runner.run('T1','E2');f.advance(600000);}assert.equal((await f.store.getDelivery('T1','E2'))!.status,'failed');assert.equal((await f.store.getDelivery('T1','E2'))!.attempt,5);}finally{f.sql.close();}});
test('successful chunks retain fencing generations and reset only failure budgets',async()=>{const f=setup();try{
 await seed(f);const stale=(await f.store.takeDelivery('T1','E1',f.clock()))!;
 assert.equal(await f.store.prepareRecipients(stale,['U123','U456'],f.clock()),true);
 assert.equal(await f.store.markSending(stale,f.clock()),true);
 assert.equal(await f.store.advanceDelivery(stale,1,false,f.clock()),true);
 f.advance(1001);const fresh=(await f.store.takeDelivery('T1','E1',f.clock()))!;
 assert.equal(fresh.attempt,2);assert.equal(fresh.failures,0);assert.equal(fresh.next_recipient,1);
 assert.equal(await f.store.prepareRecipients(stale,['U789'],f.clock()),false);
 assert.equal(await f.store.markSending(stale,f.clock()),false);
 assert.equal(await f.store.settleDelivery(stale,'preparing','done',f.clock()),false);
 assert.equal(await f.store.advanceDelivery(stale,2,true,f.clock()),false);
 assert.equal(await f.store.markSending(fresh,f.clock()),true);
 assert.equal(await f.store.advanceDelivery(fresh,2,true,f.clock()),true);
}finally{f.sql.close();}});
test('five interrupted preparations exhaust failures even after successful chunks',async()=>{const f=setup();try{
 await seed(f);let job=(await f.store.takeDelivery('T1','E1',f.clock()))!;
 await f.store.prepareRecipients(job,['U123','U456'],f.clock());await f.store.markSending(job,f.clock());await f.store.advanceDelivery(job,1,false,f.clock());f.advance(1001);
 job=(await f.store.takeDelivery('T1','E1',f.clock()))!;
 for(let i=0;i<4;i++){f.advance(120001);job=(await f.store.takeDelivery('T1','E1',f.clock()))!;}
 assert.equal(job.failures,4);assert.equal(job.attempt,6);
 f.advance(120001);await f.store.maintain('T1',f.clock());
 const failed=(await f.store.getDelivery('T1','E1'))!;assert.equal(failed.status,'failed');assert.equal(failed.failures,5);
 assert.equal(await f.store.takeDelivery('T1','E1',f.clock()),null);
}finally{f.sql.close();}});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.ts';
import {DeliveryRunner} from '../src/delivery.ts';
import {Service} from '../src/service.ts';
import {SlackError,type SlackPort} from '../src/slack.ts';

function largeFixture() {
 const f=fixture();let now=1700000000000;let error:Error|undefined;
 const members=Array.from({length:20000},(_,i)=>'U'+String(i).padStart(11,'0'));
 let current=new Set(members);const posts:string[]=[];
 const slack:SlackPort={async members(){return current;},async post(_channel,text){if(error)throw error;posts.push(text);}};
 const runner=new DeliveryRunner(f.store,new Service(f.store,slack,()=>now),slack,()=>now);
 return {...f,members,posts,runner,clock:()=>now,advance(){now+=60000;},setError(value?:Error){error=value;},setMembers(value:string[]){current=new Set(value);}};
}
async function seed(f:ReturnType<typeof largeFixture>) {
 await f.store.create('T1','C1','large',f.members,'U123',f.clock());
 await f.store.enqueueDelivery('T1','LargeEvent','C1',['large'],'1.2',f.clock());
}

test('large mention resumes across sweeps and reaches every recipient without truncation or duplicates',async()=>{
 const f=largeFixture();try {
 await seed(f);
 for(let i=0;i<20;i++) {
 await f.runner.run('T1','LargeEvent');
 if((await f.store.getDelivery('T1','LargeEvent'))!.status==='done')break;
 f.advance();
 }
 const job=(await f.store.getDelivery('T1','LargeEvent'))!;
 assert.equal(job.status,'done');assert.ok(f.posts.length>5);
 assert.ok(f.posts.every(text=>text.length<=39000));
 assert.deepEqual(f.posts.join(' ').match(/<@([^>]+)>/g),f.members.map(u=>`<@${u}>`));
 assert.equal(job.next_recipient,20000);
 f.advance();await f.runner.run('T1','LargeEvent');assert.equal(f.posts.join(' ').match(/<@/g)!.length,20000);
 }finally{f.sql.close();}
});

test('a later chunk rate limit retries only remaining recipients and removes leavers',async()=>{
 const f=largeFixture();try {
 await seed(f);await f.runner.run('T1','LargeEvent');
 const first=f.posts[0]!;const cursor=(await f.store.getDelivery('T1','LargeEvent'))!.next_recipient;
 assert.ok(cursor>0&&cursor<20000);
 f.advance();f.setError(new SlackError('http_429',120000));await f.runner.run('T1','LargeEvent');
 assert.equal(f.posts.length,1);assert.equal((await f.store.getDelivery('T1','LargeEvent'))!.next_recipient,cursor);
 f.setError();f.setMembers(f.members.filter((_,i)=>i!==cursor));
 f.advance();await f.runner.run('T1','LargeEvent');assert.equal(f.posts.length,1);
 f.advance();await f.runner.run('T1','LargeEvent');assert.equal(f.posts.length,2);
 assert.equal(f.posts[0],first);assert.ok(!f.posts[1]!.includes(`<@${f.members[cursor]}>`));
 assert.ok(!f.posts[1]!.includes(`<@${f.members[0]}>`));
 }finally{f.sql.close();}
});

test('an ambiguous later chunk never repeats earlier recipients or the uncertain chunk',async()=>{
 const f=largeFixture();try {
 await seed(f);await f.runner.run('T1','LargeEvent');f.advance();
 f.setError(new Error('response lost'));await f.runner.run('T1','LargeEvent');
 assert.equal((await f.store.getDelivery('T1','LargeEvent'))!.status,'uncertain');
 f.setError();f.advance();await f.runner.run('T1','LargeEvent');assert.equal(f.posts.length,1);
 }finally{f.sql.close();}
});
test('a continuation completes without posting if every remaining recipient left',async()=>{
 const f=largeFixture();try {
 await seed(f);await f.runner.run('T1','LargeEvent');f.setMembers([]);f.advance();
 await f.runner.run('T1','LargeEvent');const job=(await f.store.getDelivery('T1','LargeEvent'))!;
 assert.equal(job.status,'done');assert.equal(job.next_recipient,20000);assert.equal(f.posts.length,1);
 }finally{f.sql.close();}
});

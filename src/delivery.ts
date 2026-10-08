import {Store} from './store.ts';import {Service} from './service.ts';import {SlackError,type SlackPort} from './slack.ts';
function retryable(error:unknown):boolean {return !(error instanceof SlackError)||/^(http_429|http_5\d\d|ratelimited|rate_limited|internal_error|fatal_error)$/.test(error.code);}
function mentionChunk(recipients:readonly string[],start:number,current:ReadonlySet<string>):{text:string;next:number} {
 const parts:string[]=[];let length=0,next=start;
 for(;next<recipients.length;next++) {
 const member=recipients[next]!;if(!current.has(member))continue;
 const handle=`<@${member}>`;if(handle.length>39000)throw new SlackError('mention_token_too_long');
 const added=handle.length+(parts.length?1:0);if(length+added>39000)break;
 parts.push(handle);length+=added;
 }
 return {text:parts.join(' '),next};
}
export class DeliveryRunner {
 constructor(private store:Store,private service:Service,private slack:SlackPort,private clock:()=>number){}
 async run(team:string,eventId:string):Promise<void> {
 const job=await this.store.takeDelivery(team,eventId,this.clock());if(!job) return;
 let phase:'preparing'|'sending'='preparing';
 try {
 let recipients:string[],current:Set<string>;
 if(job.recipients===null) {
 recipients=await this.service.resolveMembers(team,job.channel,JSON.parse(job.aliases) as string[]);
 if(!recipients.length){await this.store.settleDelivery(job,phase,'done',this.clock());return;}
 if(!await this.store.prepareRecipients(job,recipients,this.clock()))return;
 current=new Set(recipients);
 }else {
 recipients=JSON.parse(job.recipients) as string[];
 // Recheck channel leavers on each resumed chunk; the saved snapshot prevents duplicates.
 current=await this.slack.members(job.channel);
 }
 const chunk=mentionChunk(recipients,job.next_recipient,current);
 if(!chunk.text){await this.store.advanceDelivery(job,chunk.next,true,this.clock(),'preparing');return;}
 // Persist the send boundary and fence stale workers before performing any external side effect.
 if(!await this.store.markSending(job,this.clock())) return;
 phase='sending';await this.slack.post(job.channel,chunk.text,job.thread);
 await this.store.advanceDelivery(job,chunk.next,chunk.next===recipients.length,this.clock());
 }catch(error){
 const now=this.clock();const code=error instanceof SlackError?error.code:phase==='sending'?'delivery_outcome_unknown':'preparation_failed';
 const uncertain=phase==='sending'&&(!(error instanceof SlackError)||error.uncertain);
 const status=uncertain?'uncertain':retryable(error)&&job.failures<4?'queued':'failed';
 const delay=Math.max(Math.min(1000*2**(job.failures+1),300000),error instanceof SlackError?error.retryAfterMs:0);
 await this.store.settleDelivery(job,phase,status,now,now+delay,code);
 console.error('delivery_state',{eventId,status,code});
 }
 }
}

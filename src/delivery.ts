import {Store} from './store.ts';import {Service} from './service.ts';import {SlackError,type SlackPort} from './slack.ts';
function retryable(error:unknown):boolean {return !(error instanceof SlackError)||/^(http_429|http_5\d\d|ratelimited|rate_limited|internal_error|fatal_error)$/.test(error.code);}
export class DeliveryRunner {
 constructor(private store:Store,private service:Service,private slack:SlackPort,private clock:()=>number){}
 async run(team:string,eventId:string):Promise<void> {
 const job=await this.store.takeDelivery(team,eventId,this.clock());if(!job) return;
 let phase:'preparing'|'sending'='preparing';
 try {
 const reply=await this.service.prepareMention(team,job.channel,JSON.parse(job.aliases) as string[]);
 if(!reply){await this.store.settleDelivery(job,phase,'done',this.clock());return;}
 // Persist the send boundary and fence stale workers before performing any external side effect.
 if(!await this.store.markSending(job,this.clock())) return;
 phase='sending';await this.slack.post(job.channel,reply,job.thread);
 await this.store.settleDelivery(job,phase,'done',this.clock());
 }catch(error){
 const now=this.clock();const code=error instanceof SlackError?error.code:phase==='sending'?'delivery_outcome_unknown':'preparation_failed';
 const uncertain=phase==='sending'&&(!(error instanceof SlackError)||error.uncertain);
 const status=uncertain?'uncertain':retryable(error)&&job.attempt<5?'queued':'failed';
 const delay=Math.max(Math.min(1000*2**job.attempt,300000),error instanceof SlackError?error.retryAfterMs:0);
 await this.store.settleDelivery(job,phase,status,now,now+delay,code);
 console.error('delivery_state',{eventId,status,code});
 }
 }
}

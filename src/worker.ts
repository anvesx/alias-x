import {InputError,extractAliases} from './core.ts';
import {DeliveryRunner} from './delivery.ts';
import {Slack,SlackError} from './slack.ts';
import {Store} from './store.ts';
import {Service} from './service.ts';
export interface Env {DB:D1Database;SLACK_BOT_TOKEN:string;SLACK_SIGNING_SECRET:string;SLACK_TEAM_ID:string;ALLOWED_CHANNEL_IDS:string}
export async function verifySignature(body:string,headers:Headers,secret:string,nowSeconds:number):Promise<boolean> {
 const ts=headers.get('x-slack-request-timestamp')??'';
 const sig=headers.get('x-slack-signature')??'';
 if(!/^\d{10}$/.test(ts)||Math.abs(nowSeconds-Number(ts))>300||!/^v0=[a-f0-9]{64}$/.test(sig)||!secret) return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=Uint8Array.from(sig.slice(3).match(/../g)!,s=>parseInt(s,16));
 return crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(`v0:${ts}:${body}`));
}
function record(v:unknown):v is Record<string,unknown> {return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function allowed(env:Env,team:string,channel:string):boolean {return team===env.SLACK_TEAM_ID&&env.ALLOWED_CHANNEL_IDS.split(',').map(s=>s.trim()).includes(channel);}
function response(text:string,status=200):Response {return Response.json({response_type:'ephemeral',text},{status});}
function errorText(error:unknown):string {
 if(error instanceof InputError) return error.message;
 if(error instanceof SlackError) return `${error.message}. Check permissions or retry after recovery.`;
 return 'Operation failed. Check server logs before retrying.';
}
export function createWorker(io:typeof fetch=fetch,clock:()=>number=Date.now) {return {
 async fetch(req:Request,env:Env,ctx:ExecutionContext):Promise<Response> {
 const path=new URL(req.url).pathname;
 if(req.method==='GET'&&path==='/health') return Response.json({app:'alias-x',status:'ready'});
 if(req.method!=='POST'||!['/slack/events','/slack/commands'].includes(path)) return new Response('Not found',{status:404});
 if(!env.SLACK_SIGNING_SECRET||!env.SLACK_BOT_TOKEN) return new Response('App credentials missing',{status:503});
 const reader=req.body?.getReader(); if(!reader) return response('Missing body',400);
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const chunk=await reader.read();if(chunk.done) break;size+=chunk.value.length;if(size>65536){await reader.cancel();return response('Body too large',413);}chunks.push(chunk.value);}
 const body=new TextDecoder().decode(Uint8Array.from(chunks.flatMap(c=>Array.from(c))));
 const now=clock(); // Boundary clock: pure service and verification receive the time explicitly.
 if(!await verifySignature(body,req.headers,env.SLACK_SIGNING_SECRET,Math.floor(now/1000))) return response('Invalid signature',401);
 const store=new Store(env.DB);const slack=new Slack(env.SLACK_BOT_TOKEN,io);const service=new Service(store,slack,()=>now);
 try {
 if(path==='/slack/commands') {
 const form=new URLSearchParams(body);const team=form.get('team_id')??'';const channel=form.get('channel_id')??'';const user=form.get('user_id')??'';
 if(!allowed(env,team,channel)) return response('This app is limited to the configured workspace and test channels.',403);
 if(form.get('command')!=='/alias-x'||!/^U[A-Z0-9]+$/.test(user)) return response('Invalid command identity',400);
 const responseUrl=form.get('response_url');
 if(!responseUrl) return response('Missing Slack response URL',400);
 const url=new URL(responseUrl);
 if(url.protocol!=='https:'||url.hostname!=='hooks.slack.com'||!url.pathname.startsWith('/commands/')) return response('Invalid Slack response URL',400);
 const id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body))),b=>b.toString(16).padStart(2,'0')).join('');
 if(!await store.claimCommand(team,id,channel,now)) return response((await store.commandResult(team,id))??'This command was already accepted. If it was interrupted, its outcome may be uncertain; use show or list before submitting another change.');
 ctx.waitUntil((async()=>{
 let text:string;
 try{text=await service.command(team,channel,user,form.get('text')??'');}
 catch(error){text=errorText(error);console.error('command_failed',{channel,error:text});}
 await store.finishCommand(team,id,text);
 const res=await io(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({response_type:'ephemeral',text}),signal:AbortSignal.timeout(8000)});
 if(!res.ok) throw new Error(`Slack command response failed: ${res.status}`);
 })());
 return new Response('',{status:200});
 }
 let payload:unknown;try{payload=JSON.parse(body);}catch{return response('Invalid JSON',400);}
 if(!record(payload)) return response('Invalid event',400);
 if(payload.type==='url_verification'&&typeof payload.challenge==='string') return Response.json({challenge:payload.challenge});
 if(payload.type!=='event_callback'||typeof payload.team_id!=='string'||typeof payload.event_id!=='string'||!record(payload.event)) return response('Invalid event envelope',400);
 const event=payload.event;const channel=event.channel;
 if(typeof channel!=='string'||!allowed(env,payload.team_id,channel)) return new Response('',{status:200});
 if(event.type!=='message'||event.bot_id||event.subtype||typeof event.user!=='string'||typeof event.text!=='string'||typeof event.ts!=='string') return new Response('',{status:200});
 const team=payload.team_id,eventId=payload.event_id,text=event.text;
 const thread=typeof event.thread_ts==='string'?event.thread_ts:event.ts;
 const names=extractAliases(text);if(!names.length) return new Response('',{status:200});
 await store.enqueueDelivery(team,eventId,channel,names,thread,now);
 ctx.waitUntil(new DeliveryRunner(store,service,slack,clock).run(team,eventId));
 return new Response('',{status:200});
 }catch(error){console.error('request_failed',{error:errorText(error)});return response(errorText(error),500);}
 },
 async scheduled(_controller:ScheduledController,env:Env,_ctx:ExecutionContext):Promise<void> {
 if(!env.SLACK_BOT_TOKEN) throw new Error('App credentials missing');
 const store=new Store(env.DB);const slack=new Slack(env.SLACK_BOT_TOKEN,io);const service=new Service(store,slack,clock);
 await store.maintain(env.SLACK_TEAM_ID,clock());
 const runner=new DeliveryRunner(store,service,slack,clock);
 for(const job of await store.dueDeliveries(env.SLACK_TEAM_ID,clock())) {
 if(!allowed(env,job.team,job.channel)){const claimed=await store.takeDelivery(job.team,job.event_id,clock());if(claimed) await store.settleDelivery(claimed,'preparing','failed',clock(),clock(),'channel_no_longer_allowed');continue;}
 await runner.run(job.team,job.event_id);
 }
 }
} satisfies ExportedHandler<Env>;}
export default createWorker();

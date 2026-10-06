export class SlackError extends Error {constructor(readonly code:string,readonly retryAfterMs=0,readonly uncertain=false){super(`Slack API: ${code}`);}}
export interface SlackPort {members(channel:string):Promise<Set<string>>; post(channel:string,text:string,thread?:string):Promise<void>}
export class Slack implements SlackPort {
 constructor(private token:string,private io:typeof fetch=fetch,private membershipBudgetMs=20000){}
 async call(method:string,payload:Record<string,unknown>,budget?:AbortSignal):Promise<Record<string,unknown>> {
 const io=this.io;
 const readMembers=method==='conversations.members';
 const query=new URLSearchParams(Object.entries(payload).map(([key,value])=>[key,String(value)]));
 const res=await io(`https://slack.com/api/${method}${readMembers?'?'+query.toString():''}`,{method:readMembers?'GET':'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json; charset=utf-8'},...(readMembers?{}:{body:JSON.stringify(payload)}),signal:budget?AbortSignal.any([budget,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});
 if(!res.ok) {const seconds=Number(res.headers.get('retry-after'));const retry=Number.isFinite(seconds)&&seconds>0?Math.ceil(Math.min(seconds,86400)*1000):0;throw new SlackError(`http_${res.status}`,retry,res.status>=500);}
 const data:unknown=await res.json();
 if(!data||typeof data!=='object'||!('ok'in data)||data.ok!==true) {const code=data&&typeof data==='object'&&'error'in data?String(data.error):'invalid_response';throw new SlackError(code,0,['internal_error','fatal_error','invalid_response'].includes(code));}
 return data as Record<string,unknown>;
 }
 async members(channel:string):Promise<Set<string>> {
 const budget=AbortSignal.timeout(this.membershipBudgetMs);
 const members=new Set<string>();let cursor='';
 for(let page=0;page<100;page++) {
 const data=await this.call('conversations.members',{channel,limit:200,...(cursor?{cursor}:{})},budget);
 if(!Array.isArray(data.members)||data.members.some(v=>typeof v!=='string')) throw new SlackError('invalid_members');
 for(const member of data.members) members.add(member as string);
 const metadata=data.response_metadata;
 cursor=metadata&&typeof metadata==='object'&&'next_cursor'in metadata?String(metadata.next_cursor??''):'';
 if(!cursor) return members;
 }
 throw new SlackError('membership_pagination_limit');
 }
 async post(channel:string,text:string,thread?:string):Promise<void> {
 await this.call('chat.postMessage',{channel,text,...(thread?{thread_ts:thread}:{}),unfurl_links:false,unfurl_media:false});
 }
}

import {createServer,type IncomingHttpHeaders,type IncomingMessage,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import type {DatabaseSync} from 'node:sqlite';
import {createWorker,type Env} from './worker.ts';
import {openDatabase} from './sqlite-d1.ts';

export interface ServerOptions {
 dbPath:string;migrationsDir:string;port:number;host:string;
 token:string;signingSecret:string;teamId:string;allowedChannels:string;
 cronMs?:number;io?:typeof fetch;clock?:()=>number;
}
export interface RunningServer {server:Server;port:number;sql:DatabaseSync;sweep():Promise<void>;close():Promise<void>}

const MAX_BODY=70000; // The Worker itself rejects bodies over 64 KiB; this only bounds memory.

function toHeaders(raw:IncomingHttpHeaders):Headers {
 const headers=new Headers();
 for(const [key,value] of Object.entries(raw)) if(value!==undefined) headers.set(key,Array.isArray(value)?value.join(', '):value);
 return headers;
}
async function readBody(req:IncomingMessage):Promise<Buffer|null> {
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of req as AsyncIterable<Buffer>) {size+=chunk.length;if(size>MAX_BODY) return null;chunks.push(chunk);}
 return Buffer.concat(chunks);
}
const logError=(label:string,error:unknown)=>console.error(label,error instanceof Error?error.message:String(error));

/** Runs the unchanged Worker handlers on a plain Node HTTP server with a local SQLite file. */
export async function startServer(o:ServerOptions):Promise<RunningServer> {
 const clock=o.clock??Date.now;
 const {sql,db,applied}=openDatabase(o.dbPath,o.migrationsDir);
 if(applied.length) console.log('migrations_applied',applied.join(','));
 const env:Env={DB:db,SLACK_BOT_TOKEN:o.token,SLACK_SIGNING_SECRET:o.signingSecret,SLACK_TEAM_ID:o.teamId,ALLOWED_CHANNEL_IDS:o.allowedChannels};
 const worker=createWorker(o.io??fetch,clock);

 // Cloudflare's ctx.waitUntil becomes "keep this promise and wait for it on shutdown".
 const pending=new Set<Promise<unknown>>();
 const ctx={
  waitUntil(p:Promise<unknown>){const t:Promise<unknown>=p.catch(e=>logError('background_failed',e)).finally(()=>{pending.delete(t);});pending.add(t);},
  passThroughOnException(){}
 } as unknown as ExecutionContext;

 const server=createServer(async(req,res)=>{
  try {
   const buffer=req.method==='GET'||req.method==='HEAD'?undefined:await readBody(req);
   if(buffer===null) {res.writeHead(413,{Connection:'close'}).end('Body too large');return;}
   const request=new Request(`http://${req.headers.host??'localhost'}${req.url??'/'}`,{method:req.method,headers:toHeaders(req.headers),body:buffer});
   const response=await worker.fetch(request,env,ctx);
   res.writeHead(response.status,Object.fromEntries(response.headers));
   res.end(Buffer.from(await response.arrayBuffer()));
  } catch(error) {
   logError('http_failed',error);
   if(!res.headersSent) res.writeHead(500);
   res.end();
  }
 });

 // Cloudflare's one-minute cron becomes a timer. One sweep at a time; a slow sweep never overlaps itself.
 let sweeping=false;
 const sweep=async()=>{
  if(sweeping) return;sweeping=true;
  try{await worker.scheduled({cron:'* * * * *',scheduledTime:clock(),noRetry(){}} as unknown as ScheduledController,env,ctx);}
  catch(error){logError('sweep_failed',error);}
  finally{sweeping=false;}
 };
 const timer=setInterval(()=>{void sweep();},o.cronMs??60000);

 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(o.port,o.host,resolve);});
 const port=(server.address() as AddressInfo).port;
 void sweep(); // Recover anything interrupted by the previous shutdown.

 return {server,port,sql,sweep,async close(){
  clearInterval(timer);
  server.closeIdleConnections();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  await Promise.race([Promise.allSettled([...pending]),new Promise(r=>setTimeout(r,10000))]);
  sql.close();
 }};
}

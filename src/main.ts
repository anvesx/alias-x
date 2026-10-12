import {URL as NodeURL,fileURLToPath} from 'node:url';
import {startServer} from './server.ts';

function need(name:string):string {
 const value=process.env[name];
 if(!value){console.error(`Missing required setting ${name}. See .env.example.`);process.exit(1);}
 return value;
}

const running=await startServer({
 dbPath:process.env.DB_PATH??'./data/alias-x.db',
 migrationsDir:fileURLToPath(new NodeURL('../migrations',import.meta.url)),
 port:Number(process.env.PORT??8787),
 host:process.env.HOST??'127.0.0.1', // Caddy on the same machine forwards to this; never expose it directly.
 token:need('SLACK_BOT_TOKEN'),
 signingSecret:need('SLACK_SIGNING_SECRET'),
 teamId:need('SLACK_TEAM_ID'),
 allowedChannels:need('ALLOWED_CHANNEL_IDS')
});
console.log('alias-x listening',{port:running.port});

let stopping=false;
for(const signal of ['SIGTERM','SIGINT'] as const) process.on(signal,async()=>{
 if(stopping) return;stopping=true;
 console.log('shutting down',signal);
 await running.close();
 process.exit(0);
});

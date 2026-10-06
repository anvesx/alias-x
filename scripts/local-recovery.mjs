import {setTimeout} from 'node:timers/promises';
const watch=process.argv.includes('--watch');
do {
 try {
 const res=await fetch('http://127.0.0.1:8787/cdn-cgi/local/explorer/api/local/scheduled?worker=alias-x',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cron:'* * * * *'}),signal:AbortSignal.timeout(60000)});
 const data=await res.json();
 if(!res.ok||data.success!==true||data.result?.outcome!=='ok') throw new Error(`Scheduled recovery failed: HTTP ${res.status}, outcome ${data.result?.outcome??'missing'}`);
 console.log('Scheduled recovery: ok');
 }catch(error){console.error(error instanceof Error?error.message:'Scheduled recovery failed');if(!watch){process.exitCode=1;break;}}
 if(watch) await setTimeout(60000);
}while(watch);

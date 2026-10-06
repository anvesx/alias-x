import http from 'node:http';
const paths=new Set(['/slack/events','/slack/commands','/health']);
http.createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(!paths.has(path)){res.writeHead(404);res.end('Not found');return;}
 const upstream=http.request({hostname:'127.0.0.1',port:8787,path: req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode??502,r.headers);r.pipe(res);});
 upstream.on('error',()=>{res.writeHead(502);res.end('Local worker unavailable');});
 req.pipe(upstream);
}).listen(8788,'127.0.0.1',()=>console.log('Slack-only proxy ready on 127.0.0.1:8788'));

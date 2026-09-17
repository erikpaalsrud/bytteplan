import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import webpush from 'web-push';
import {Store,dispatchDue,TITLES} from './store.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const port=Number(process.env.PORT||3000);
const origin=process.env.PUBLIC_ORIGIN||`http://localhost:${port}`;
if(new URL(origin).origin!==origin)throw new Error('PUBLIC_ORIGIN must be an origin without a path or trailing slash');
if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY||!process.env.VAPID_SUBJECT)throw new Error('Configure VAPID keys and VAPID_SUBJECT in .env (see server/README.md)');
webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
await mkdir(root+'data',{recursive:true,mode:0o700});
const store=new Store(process.env.DB_PATH||root+'data/push.sqlite');
const assets=new Map([['/','index.html'],...['index.html','sw.js','manifest.json','crest.png','icon-192.png','icon-512.png'].map(x=>['/'+x,x])]);
const types={html:'text/html; charset=utf-8',js:'application/javascript',json:'application/json',png:'image/png'};
const rates=new Map();
function rate(key,limit){const now=Date.now();let entry=rates.get(key);if(!entry||entry.until<now){entry={until:now+60000,count:0};rates.set(key,entry);}return ++entry.count<=limit;}
setInterval(()=>{for(const [k,v] of rates)if(v.until<Date.now())rates.delete(k);},60000).unref();
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>10000)throw new Error('Body too large');}return JSON.parse(text||'{}');}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
  const path=new URL(req.url,'http://localhost').pathname;
  try{
    if(req.method==='GET'&&path==='/healthz')return json(res,200,{ok:true});
    if(path.startsWith('/api/push/')){
      if(req.method==='GET'&&path==='/api/push/config')return json(res,200,{publicKey:process.env.VAPID_PUBLIC_KEY});
      if(req.headers.origin!==origin)return json(res,403,{error:'Origin not allowed'});
      if(req.headers['content-type']!=='application/json')return json(res,415,{error:'JSON required'});
      if(!rate('all',600)||!rate('ip:'+req.socket.remoteAddress,120))return json(res,429,{error:'Too many requests'});
      if(req.method==='POST'&&path==='/api/push/register'){
        if(!rate('register',20))return json(res,429,{error:'Try again later'});
        const {subscription}=await body(req);
        if(store.db.prepare('SELECT count(*) AS n FROM devices').get().n>=10000)return json(res,503,{error:'Capacity reached'});
        return json(res,201,store.register(subscription));
      }
      const match=path.match(/^\/api\/push\/devices\/([a-f0-9-]+)(\/test)?$/);
      if(!match)return json(res,404,{error:'Not found'});
      const id=match[1],token=req.headers.authorization?.replace(/^Bearer /,'');
      if(!store.authorized(id,token))return json(res,401,{error:'Unauthorized'});
      if(req.method==='DELETE'){store.remove(id);return json(res,200,{ok:true});}
      if(req.method==='PUT'&&!match[2]){
        const input=await body(req);
        const ok=store.replace(id,input.revision,input.events,input.silent);
        return json(res,ok?200:409,{ok});
      }
      if(req.method==='POST'&&match[2]){
        if(!rate('test:'+id,3))return json(res,429,{error:'Too many tests'});
        const device=store.db.prepare('SELECT subscription FROM devices WHERE id=?').get(id);
        try{
          await webpush.sendNotification(JSON.parse(device.subscription),JSON.stringify({title:TITLES.test[0],body:TITLES.test[1],eventId:'test',expiresAt:Date.now()+60000}),{TTL:60,urgency:'high',timeout:10000});
        }catch(error){
          if(error.statusCode===404||error.statusCode===410){store.remove(id);return json(res,410,{error:'Subscription expired'});}
          throw error;
        }
        return json(res,200,{ok:true});
      }
      return json(res,405,{error:'Method not allowed'});
    }
    if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
    const file=assets.get(path);if(!file)return json(res,404,{error:'Not found'});
    res.writeHead(200,{'Content-Type':types[file.split('.').at(-1)],'Cache-Control':file.endsWith('.png')?'public, max-age=86400':'no-cache'});
    res.end(await readFile(root+file));
  }catch(e){json(res,e.code?.startsWith('ERR_SQLITE')?409:400,{error:'Request could not be completed'});}
});
let working=false;
const timer=setInterval(async()=>{if(working)return;working=true;try{await dispatchDue(store,(...args)=>webpush.sendNotification(...args));}catch{console.error('Push dispatch failed');}finally{working=false;}},1000);
server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Bytteplan listening on port ${port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{clearInterval(timer);server.close(()=>process.exit(0));});

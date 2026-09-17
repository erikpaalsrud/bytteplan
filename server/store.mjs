import {DatabaseSync} from 'node:sqlite';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
const hash=token=>createHash('sha256').update(token).digest('hex');
export const TITLES={sub:['Byttetid','Åpne Bytteplan og bekreft byttet ved neste døde ball.'],period:['Perioden er ferdig','Pause. Åpne Bytteplan før neste periode.'],end:['Kampslutt','Åpne Bytteplan for å lagre kampen.'],break:['Pausen er over','Åpne Bytteplan og start neste periode.'],test:['Bytteplan – testvarsel','Dette varselet er sendt fra serveren.']};
export function validateSubscription(sub){
  let url;try{url=new URL(sub?.endpoint);}catch{throw new Error('Invalid subscription');}
  const host=url.hostname;
  if(url.protocol!=='https:'||url.port||url.username||url.password||!(host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.push.apple.com')||host.endsWith('.notify.windows.com'))) throw new Error('Unsupported push service');
  if(sub.endpoint.length>2048||!/^[A-Za-z0-9_-]{87}={0,2}$/.test(sub.keys?.p256dh||'')||!/^[A-Za-z0-9_-]{22}={0,2}$/.test(sub.keys?.auth||''))throw new Error('Invalid subscription keys');
  return {endpoint:sub.endpoint,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}};
}
export function validateEvents(events,now){
  if(!Array.isArray(events)||events.length>3)throw new Error('Invalid events');
  const ids=new Set();
  return events.map(e=>{
    if(!['sub','period','end','break'].includes(e.kind)||typeof e.id!=='string'||e.id.length>160||ids.has(e.id)||!Number.isSafeInteger(e.at)||e.at<now-60000||e.at>now+4*3600000) throw new Error('Invalid event');
    ids.add(e.id);return {id:e.id,kind:e.kind,at:e.at};
  });
}
export class Store{
  constructor(path=':memory:'){
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, token TEXT NOT NULL, endpoint TEXT UNIQUE NOT NULL, subscription TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(device TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,id TEXT NOT NULL,kind TEXT NOT NULL,at INTEGER NOT NULL, revision INTEGER NOT NULL,silent INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,next_try INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(device,id));
      CREATE TABLE IF NOT EXISTS delivered(device TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,id TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(device,id));`);
  }
  register(subscription,now=Date.now()){
    const sub=validateSubscription(subscription),id=randomUUID(),token=randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO devices(id,token,endpoint,subscription,updated) VALUES(?,?,?,?,?)').run(id,hash(token),sub.endpoint,JSON.stringify(sub),now);
    return {id,token,revision:0};
  }
  authorized(id,token){return typeof token==='string'&&!!this.db.prepare('SELECT id FROM devices WHERE id=? AND token=?').get(id,hash(token));}
  replace(id,revision,events,silent,now=Date.now()){
    events=validateEvents(events,now);
    if(!Number.isSafeInteger(revision)||revision<1)throw new Error('Invalid revision');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const d=this.db.prepare('SELECT revision FROM devices WHERE id=?').get(id);
      if(!d||revision<=d.revision){this.db.exec('ROLLBACK');return false;}
      this.db.prepare('DELETE FROM jobs WHERE device=?').run(id);
      const put=this.db.prepare('INSERT INTO jobs(device,id,kind,at,revision,silent) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM delivered WHERE device=? AND id=?)');
      for(const e of events)put.run(id,e.id,e.kind,e.at,revision,silent?1:0,id,e.id);
      this.db.prepare('UPDATE devices SET revision=?,updated=? WHERE id=?').run(revision,now,id);
      this.db.exec('COMMIT');return true;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  remove(id){this.db.prepare('DELETE FROM devices WHERE id=?').run(id);}
  due(now=Date.now()){
    this.db.prepare('DELETE FROM jobs WHERE at<?').run(now-60000);
    this.db.prepare('DELETE FROM delivered WHERE at<?').run(now-86400000);
    this.db.prepare('DELETE FROM devices WHERE updated<?').run(now-30*86400000);
    return this.db.prepare('SELECT jobs.*,devices.subscription FROM jobs JOIN devices ON devices.id=jobs.device WHERE jobs.at<=? AND next_try<=? ORDER BY jobs.at LIMIT 50').all(now,now);
  }
  current(job){return !!this.db.prepare('SELECT 1 FROM jobs WHERE device=? AND id=? AND revision=?').get(job.device,job.id,job.revision);}
  delivered(job,now){
    // Remember event even if an in-flight request was cancelled; it cannot be recalled.
    if(!this.db.prepare('SELECT id FROM devices WHERE id=?').get(job.device))return;
    this.db.prepare('INSERT OR IGNORE INTO delivered VALUES(?,?,?)').run(job.device,job.id,now);
    this.db.prepare('DELETE FROM jobs WHERE device=? AND id=?').run(job.device,job.id);
  }
  retry(job,now){this.db.prepare('UPDATE jobs SET attempts=attempts+1,next_try=? WHERE device=? AND id=? AND revision=?').run(now+Math.min(30000,2000*2**job.attempts),job.device,job.id,job.revision);}
  close(){this.db.close();}
}
export async function dispatchDue(store,send,now=Date.now()){
  for(const job of store.due(now)){
    if(!store.current(job))continue;
    const [title,body]=TITLES[job.kind];
    const expiresAt=job.at+60000;
    try{
      await send(JSON.parse(job.subscription),JSON.stringify({title,body,eventId:job.id,expiresAt,silent:!!job.silent}),{TTL:Math.max(1,Math.floor((expiresAt-now)/1000)),urgency:'high',timeout:10000});
      store.delivered(job,now);
    }catch(e){
      if(e.statusCode===404||e.statusCode===410)store.remove(job.device);
      else store.retry(job,now);
    }
  }
}

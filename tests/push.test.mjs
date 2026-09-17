import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,dispatchDue,validateSubscription,validateEvents} from '../server/store.mjs';
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:'B'.repeat(87),auth:'A'.repeat(22)}};
const now=1800000000000;
const event=(id,kind='sub',at=now)=>({id,kind,at});
function fixture(){const store=new Store();const device=store.register(subscription,now);return {store,device};}
test('subscription endpoint validation rejects SSRF and malformed keys',()=>{
  for(const endpoint of ['http://127.0.0.1','https://localhost','https://fcm.googleapis.com.evil.test/x','https://fcm.googleapis.com:123/x','https://user:pass@fcm.googleapis.com/x'])assert.throws(()=>validateSubscription({...subscription,endpoint}));
  assert.throws(()=>validateSubscription({...subscription,keys:{}}));
  assert.equal(validateSubscription(subscription).endpoint,subscription.endpoint);
});
test('device capability authenticates only its owner',()=>{const {store,device}=fixture();try{assert.equal(store.authorized(device.id,device.token),true);assert.equal(store.authorized(device.id,'wrong'),false);assert.equal(store.authorized('other',device.token),false);}finally{store.close();}});
test('schedule replacements cancel old jobs and reject stale revisions',()=>{
  const {store,device}=fixture();try{
    store.replace(device.id,1,[event('first')],false,now);store.replace(device.id,3,[event('postponed','sub',now+60000)],false,now);
    assert.equal(store.replace(device.id,2,[event('first')],false,now),false);
    assert.equal(store.due(now).length,0);assert.equal(store.due(now+60000)[0].id,'postponed');
    store.replace(device.id,4,[],false,now);assert.equal(store.due(now+60000).length,0);
  }finally{store.close();}
});
test('reject arbitrary messages, too many events, duplicates, and unbounded schedules',()=>{
  for(const events of [[event('x','arbitrary')],[event('x'),event('x')],Array.from({length:4},(_,i)=>event(String(i))),[event('x','sub',now+5*3600000)]])assert.throws(()=>validateEvents(events,now));
});
test('dispatch sends generic payload once and keeps sent-event dedup across new revisions',async()=>{
  const {store,device}=fixture();try{
    store.replace(device.id,1,[event('sub-1')],true,now);const sent=[];
    await dispatchDue(store,async(...args)=>sent.push(args),now);
    store.replace(device.id,2,[event('sub-1')],false,now);await dispatchDue(store,async(...args)=>sent.push(args),now);
    assert.equal(sent.length,1);const payload=JSON.parse(sent[0][1]);assert.equal(payload.title,'Byttetid');assert.equal(payload.silent,true);assert.equal(sent[0][2].TTL,60);
  }finally{store.close();}
});
test('subscription expiration removes device and every pending event',async()=>{
  const {store,device}=fixture();try{store.replace(device.id,1,[event('1'),event('2','period')],false,now);await dispatchDue(store,async()=>{throw {statusCode:410};},now);assert.equal(store.authorized(device.id,device.token),false);assert.equal(store.due(now).length,0);}finally{store.close();}
});
test('temporary failure retries with backoff and stale events expire',async()=>{
  const {store,device}=fixture();try{store.replace(device.id,1,[event('1')],false,now);await dispatchDue(store,async()=>{throw {statusCode:503};},now);assert.equal(store.due(now+1000).length,0);assert.equal(store.due(now+2000).length,1);assert.equal(store.due(now+60001).length,0);}finally{store.close();}
});
test('schedule persists across process/store restarts',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bytte-push-'));let store;
  try{store=new Store(join(dir,'push.sqlite'));const d=store.register(subscription,now);store.replace(d.id,1,[event('persist')],false,now);store.close();store=new Store(join(dir,'push.sqlite'));assert.equal(store.due(now)[0].id,'persist');assert.equal(store.authorized(d.id,d.token),true);}finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});

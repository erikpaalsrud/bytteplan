import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
function worker(){
 const handlers={},shown=[],messages=[];let focused=0,closed=0;
 const scope='https://example.com/bytteplan/';
 const self={addEventListener:(k,fn)=>handlers[k]=fn,registration:{scope,showNotification:async(...args)=>shown.push(args)},clients:{matchAll:async()=>[{url:scope,focus:async()=>focused++,postMessage:msg=>messages.push(msg)}]}};
 vm.runInNewContext(source,{self,Date,URL});
 return {handlers,shown,messages,focused:()=>focused,closed:()=>closed,notification:{close:()=>closed++}};
}
test('worker displays server push and suppresses expired payloads',async()=>{
 const w=worker();let pending;
 const event=p=>({data:{json:()=>p},waitUntil:p=>pending=p});
 w.handlers.push(event({title:'Byttetid',body:'Åpne appen',eventId:'sub',expiresAt:Date.now()+60000}));await pending;
 assert.equal(w.shown.length,1);assert.equal(w.shown[0][1].tag,'bytteplan-match');
 w.handlers.push(event({title:'Old',expiresAt:Date.now()-1}));await pending;assert.equal(w.shown.length,1);
});
test('notification click focuses existing app and opens match view',async()=>{
 const w=worker();let pending;w.handlers.notificationclick({notification:w.notification,waitUntil:p=>pending=p});await pending;
 assert.equal(w.focused(),1);assert.equal(w.closed(),1);assert.equal(w.messages[0].type,'OPEN_MATCH');
});
test('API requests bypass the offline cache',()=>{
 const w=worker();let intercepted=false;w.handlers.fetch({request:{url:'https://example.com/api/push/config',method:'GET'},respondWith:()=>intercepted=true});assert.equal(intercepted,false);
});

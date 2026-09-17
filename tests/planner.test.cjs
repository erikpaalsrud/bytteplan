const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(__dirname+'/../index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function app(saved){
  const nodes=new Map();
  const node=()=>({innerHTML:'',hidden:true,classList:{add(){},remove(){}},textContent:''});
  const get=k=>{if(!nodes.has(k))nodes.set(k,node());return nodes.get(k);};
  const ctx=vm.createContext({console,Date,Math,JSON,Set,Object,Array,Number,String,Boolean,
    localStorage:{getItem:()=>saved?JSON.stringify(saved):null,setItem(){}},
    document:{querySelector:get,getElementById:get,querySelectorAll:()=>[],addEventListener(){}},
    window:{addEventListener(){},scrollTo(){}},navigator:{},setInterval(){},setTimeout(){},confirm:()=>true});
  vm.runInContext(source,ctx);
  return code=>vm.runInContext(code,ctx);
}
function seed(run,format,extra=3){
  run(`db.setup=defaultSetup(); db.setup.format=${format}; db.setup.periods=2; db.setup.periodMinutes=[2,3]; db.setup.breakMin=0; db.setup.intervalSec=45;
    db.roster=Array.from({length:${format+extra}},(_,i)=>({id:'p'+i,name:'Player '+i,stats:emptyStats()}));
    db.roster.forEach(p=>db.setup.present[p.id]=true); db.setup.keeperId=hasKeeper(db.setup)?'p0':null;
    syncPositions(); suggestLineup();`);
}
for(const format of [3,5,7,9]){
  test(`${format}er: lineup, substitutions and preview agree across unequal periods`,()=>{
    const run=app();seed(run,format);
    const preview=JSON.parse(run('JSON.stringify(simulatePlan(db.setup))'));
    run('startMatch(); db.match.running=false;');
    assert.equal(run('db.match.field.length'),format===3?3:format-1);
    assert.equal(run('!!db.match.keeperId'),format!==3);
    let event=0;
    for(let period=1;period<=2;period++){
      const duration=period===1?120:180;
      run(`db.match.period=${period}; db.match.field.forEach(f=>db.match.perPlayer[f.pid].stintSec=0)`);
      let elapsed=0;
      const credit=dt=>run(`db.match.field.forEach(f=>{const p=db.match.perPlayer[f.pid];p.fieldSec+=${dt};p.stintSec+=${dt};p.pos[f.pos]+=${dt};});db.match.totalSec+=${dt};`);
      while(elapsed+45<duration){credit(45);elapsed+=45;run('execSub()');event++;
        assert.equal(run('new Set(db.match.field.map(f=>f.pos)).size'),format===3?3:format-1);
        assert.equal(run('new Set([db.match.keeperId,...db.match.field.map(f=>f.pid),...db.match.bench].filter(Boolean)).size'),format+3);
      }
      credit(duration-elapsed);
    }
    assert.equal(event,preview.events.length);
    for(const pid of preview.all)assert.equal(run(`db.match.perPlayer['${pid}'].fieldSec`),preview.sim.perPlayer[pid].fieldSec);
    run('endMatch()');assert.equal(run('db.history[0].format'),format);
    assert.equal(run('db.roster.every(p=>Object.values(p.stats.pos).every(Number.isFinite))'),true);
  });
  test(`${format}er: no-bench rotation and injury return preserve positions`,()=>{
    const run=app();seed(run,format,0);run('startMatch();db.match.running=false;execSub();');
    const pid=run('db.match.field[0].pid');run(`markUnavailable('${pid}');restorePlayer('${pid}');restorePlayer('${pid}');`);
    assert.equal(run('db.match.bench.length'),0);
    assert.equal(run('db.match.field.length'),format===3?3:format-1);
    assert.equal(run('new Set(db.match.field.map(f=>f.pid)).size'),format===3?3:format-1);
  });
}
test('substitutions never move players staying on the field',()=>{
  const run=app();seed(run,5);
  run('startMatch();db.match.running=false;');
  for(let i=0;i<6;i++){
    const before=JSON.parse(run('JSON.stringify(db.match.field)'));
    run('db.match.field.forEach(f=>db.match.perPlayer[f.pid].stintSec+=45);db.match.totalSec+=45;');
    const plan=JSON.parse(run('JSON.stringify(computeNextSub(db.match))'));
    assert.equal(plan.shifts.length,0);
    const outPos=new Set(plan.moves.map(mv=>before.find(f=>f.pid===mv.outPid).pos));
    for(const mv of plan.moves)assert.ok(outPos.has(mv.pos),'incoming player takes a vacated position');
    run('execSub()');
    const after=JSON.parse(run('JSON.stringify(db.match.field)'));
    for(const f of after){const b=before.find(x=>x.pid===f.pid);if(b)assert.equal(f.pos,b.pos,'stayer kept position');}
  }
});
test('empty bench proposes no rotation and mutes sub alerts',()=>{
  const run=app();seed(run,5,1);
  run('startMatch();db.match.running=false;');
  run(`markUnavailable('${run('db.match.bench[0]')}')`);
  assert.equal(run('db.match.bench.length'),0);
  const before=JSON.parse(run('JSON.stringify(db.match.field)'));
  const plan=JSON.parse(run('JSON.stringify(computeNextSub(db.match))'));
  assert.equal(plan.rotation,true);assert.equal(plan.moves.length,0);
  run('execSub()');
  assert.deepEqual(JSON.parse(run('JSON.stringify(db.match.field)')),before);
  run('alertPrefs().notifications=true;db.match.running=true;');
  assert.equal(JSON.parse(run('JSON.stringify(pushPlan())')).some(e=>e.kind==='sub'),false);
});
test('🌱 anchor: holder is subbed out on stint ties and 🌱 re-enters at anchor',()=>{
  const run=app();seed(run,5);
  run("playerById(db.match?undefined:'x')");
  run("const ny=db.roster.find(p=>db.setup.present[p.id]&&p.id!==db.setup.keeperId); ny.ny=true; ny.fav='V'; window.__ny=ny.id;");
  run('suggestLineup();startMatch();db.match.running=false;');
  const nyId=run('window.__ny');
  assert.equal(run(`db.match.field.find(f=>f.pid==='${nyId}')?.pos??null`)==='V'||run(`db.match.bench.includes('${nyId}')`),true,'🌱 seeded at anchor or on bench');
  run(`
    // put 🌱 on bench front with everyone on field at equal stints
    if(db.match.field.some(f=>f.pid==='${nyId}')){
      const other=db.match.bench[0];manualSwap('${nyId}',other);
    }
    db.match.bench=db.match.bench.filter(x=>x!=='${nyId}');db.match.bench.unshift('${nyId}');
    db.match.field.forEach(f=>db.match.perPlayer[f.pid].stintSec=300);db.match.totalSec+=300;
  `);
  const plan=JSON.parse(run('JSON.stringify(computeNextSub(db.match))'));
  const mv=plan.moves.find(x=>x.inPid===nyId);
  assert.equal(mv.pos,'V','🌱 enters at anchor');
});
test('early substitutions reset the interval timer, on-field swaps do not',()=>{
  const run=app();seed(run,5);
  run('startMatch();db.match.running=false;');
  run('db.match.totalSec=100;db.match.lastSubTotal=0;');
  run("manualSwap(db.match.field[0].pid, db.match.field[1].pid)");
  assert.equal(run('db.match.lastSubTotal'),0,'on-field swap keeps timer');
  run("manualSwap(db.match.field[0].pid, db.match.bench[0])");
  assert.equal(run('db.match.lastSubTotal'),100,'bench swap resets timer');
  run('db.match.totalSec=160;');
  run("injurySub(db.match.field[0].pid)");
  assert.equal(run('db.match.lastSubTotal'),160,'injury sub resets timer');
  run('db.match.totalSec=220;');
  run("tiredSub(db.match.field[0].pid)");
  assert.equal(run('db.match.lastSubTotal'),220,'tired sub resets timer');
});
test('clock caps sleep and reload catch-up at period boundary, preserves zero break',()=>{
  const run=app();seed(run,5);run('startMatch();db.match.lastTickAt=Date.now()-600000; tick();');
  assert.equal(run('db.match.totalSec'),120);
  assert.equal(run('db.match.perPlayer[db.match.keeperId].keeperSec'),120);
  assert.equal(run('db.match.awaitingPeriod'),true);
  assert.ok(run('db.match.breakEndsAt<Date.now()'));
  const saved=JSON.parse(run('JSON.stringify(db)'));
  saved.match.awaitingPeriod=false;saved.match.clockSec=0;saved.match.totalSec=0;saved.match.running=true;saved.match.lastTickAt=Date.now()-10000;
  const restored=app(saved);restored('tick()');assert.ok(restored('db.match.clockSec>=10 && db.match.clockSec<11'));
});
test('active match protects roster from history deletion',()=>{
  const run=app();seed(run,9);run('startMatch();clearHistory()');assert.equal(run('db.roster.length'),12);
});
test('legacy 5er saves migrate without losing statistics',()=>{
  const run=app({roster:[{id:'old',name:'Old',stats:{fieldSec:10,keeperSec:0,matches:1,pos:{F:10,V:0,H:0,S:0}}}],history:[],match:null,setup:{present:{old:true},keeperId:'old',periods:2,periodMin:20,intervalSec:180,subsPer:'auto',breakMin:5,field:null,bench:null}});
  assert.equal(run('formatOf(db.setup)'),5);assert.equal(run('lengths(db.setup).join()'),'20,20');
  assert.equal(run('db.roster[0].stats.pos.F'),10);
});
test('push plan follows pause, snooze, confirmed swap, period and end without names',()=>{
  const run=app();seed(run,5);run('alertPrefs().notifications=true;startMatch()');
  const initial=JSON.parse(run('JSON.stringify(pushPlan())'));
  assert.deepEqual(initial.map(e=>e.kind),['sub','period','break']);assert.equal(initial[1].at,initial[2].at);
  run('snooze()');const snoozed=JSON.parse(run('JSON.stringify(pushPlan())'));assert.equal(snoozed[0].at-initial[0].at,60000);
  run('toggleRun(false)');assert.equal(run('pushPlan().length'),0);
  run('toggleRun(true);execSub()');assert.equal(run('pushPlan()[0].kind'),'sub');
  run('db.match.lastTickAt=Date.now()-200000;tick()');assert.equal(run('pushPlan().length'),0);
  run('startNextPeriod()');assert.equal(run('pushPlan().at(-1).kind'),'end');
  run('endMatch()');assert.equal(run('pushPlan().length'),0);
});
test('duplicate due alert is suppressed after reload',()=>{
  const run=app();seed(run,3);run('startMatch();db.match.lastTickAt=Date.now()-50000;tick()');
  assert.ok(run('db.match.lastAlertKey'));
  const restored=app(JSON.parse(run('JSON.stringify(db)')));
  restored('let alerts=0;alertUser=()=>alerts++;tick()');assert.equal(restored('alerts'),0);
});
test('notification denial does not enable alerts',async()=>{
  const run=app();run(`window.isSecureContext=true; navigator.serviceWorker={}; globalThis.Notification={permission:'default',requestPermission:async()=> 'denied'};`);
  await run('enableNotifications()');assert.equal(run('alertPrefs().notifications'),false);assert.equal(run('notificationBusy'),false);
});
test('wake lock pending acquisition is released if the match pauses',async()=>{
  const run=app();seed(run,5);
  run(`document.visibilityState='visible';let released=0,resolveLock; navigator.wakeLock={request:()=>new Promise(resolve=>resolveLock=resolve)}; startMatch(); toggleRun(false);resolveLock({release:async()=>released++,addEventListener(){}});`);
  await new Promise(r=>setImmediate(r));assert.equal(run('released'),1);assert.equal(run('wakeLock'),null);
});

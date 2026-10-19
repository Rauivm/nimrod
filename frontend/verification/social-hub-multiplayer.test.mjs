import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
async function moduleUrl(relative, imports={}) {
  const source=await fs.readFile(new URL(`../src/features/social-hub/${relative}.ts`,import.meta.url),'utf8');
  let {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
  for(const [from,to] of Object.entries(imports)) outputText=outputText.replaceAll(`'${from}'`,`'${to}'`).replaceAll(`"${from}"`,`"${to}"`);
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}
const nav=await moduleUrl('world/Navigation'), mapUrl=await moduleUrl('world/tavernMap');
const protocol=await moduleUrl('multiplayer/protocol',{'../world/tavernMap':mapUrl,'../world/Navigation':nav});
const {readSnapshot}=await import(protocol);
const {HubRoom}=await import(await moduleUrl('multiplayer/HubRoom',{'../world/tavernMap':mapUrl,'./protocol':protocol}));
const {RoomMotion}=await import(await moduleUrl('multiplayer/RoomMotion',{'../world/tavernMap':mapUrl,'../world/Navigation':nav}));
const {tavernMap:map}=await import(mapUrl);
const player=(id='own',overrides={})=>({id,name:'Fixture',level:3,classe:'Mago',position:{...map.spawn},direction:{x:0,y:1},moving:false,presence:'online',...overrides});
const frame=(players=[player()],revision=1)=>({version:1,mapId:map.id,mapVersion:map.version,revision,players});
function fixture(admission){
  const sent=[],listeners=new Set();let time=0,serial=0;
  const room=new HubRoom({send:msg=>{sent.push(msg);return true;},observe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}},'own',()=>time,()=>`request-${++serial}`,admission);
  room.start();room.setConnected(true);
  const deliver=(type,data)=>listeners.forEach(fn=>fn({type,data}));
  const join=()=>deliver('HUB_JOINED',{...frame(),requestId:sent.findLast(m=>m.type==='HUB_JOIN').requestId,sessionId:`session-${serial}`,selfId:'own'});
  return {room,sent,listeners,deliver,join,clock:ms=>{time+=ms;}};
}
test('snapshot parser rejects wrong maps, duplicates, invalid identity/positions and impossible counts',()=>{
  assert.ok(readSnapshot(frame()));
  for(const value of [{...frame(),mapVersion:999},frame([player(),player()]),frame([player('a',{position:{x:1,y:9}})]),frame([player('a',{position:{x:'4',y:2}})]),frame([player('a',{level:-1})]),frame(Array.from({length:33},(_,i)=>player(String(i))))]) assert.equal(readSnapshot(value),null);
});
test('uses the shared transport, waits for a correlated JOIN acknowledgement, and sends intentions without positions',()=>{
  const f=fixture();try{
    assert.equal(f.room.getSnapshot().status,'joining');assert.equal(f.room.move({x:7,y:10}),false);
    f.deliver('HUB_JOINED',{...frame(),requestId:'old',sessionId:'old',selfId:'own'});assert.equal(f.room.getSnapshot().status,'joining');
    f.join();assert.equal(f.room.getSnapshot().status,'joined');f.room.move({x:7,y:10});
    assert.deepEqual(f.sent.at(-1),{type:'HUB_MOVE',sessionId:'session-1',target:{x:7,y:10}});
    assert.ok(!f.sent.some(msg=>'position' in msg||'userId' in msg||'name' in msg));
  }finally{f.room.stop();}
});
test('presence follows authoritative revisions and stale/foreign messages cannot overwrite it',()=>{
  const f=fixture();try{
    f.join();f.deliver('HUB_STATE',frame([player(),player('other',{name:'Outro',presence:'away'})],3));
    assert.equal(f.room.getSnapshot().players.length,2);
    f.deliver('HUB_STATE',frame([player()],2));assert.equal(f.room.getSnapshot().players.length,2);
    f.deliver('HUB_ERROR',{code:'SESSION_REPLACED',sessionId:'foreign'});assert.equal(f.room.getSnapshot().status,'joined');
    f.deliver('HUB_STATE',frame([player()],4));assert.equal(f.room.getSnapshot().players.length,1);
  }finally{f.room.stop();}
});
test('disconnect freezes membership and reconnect obtains a new session without stale cleanup',()=>{
  const f=fixture();try{
    f.join();f.room.input({x:1,y:0});f.room.setConnected(false);assert.equal(f.room.getSnapshot().players.length,0);
    assert.equal(f.room.move({x:6,y:10}),false);f.room.setConnected(true);f.join();
    assert.equal(f.room.getSnapshot().status,'joined');assert.equal(f.sent.findLast(m=>m.type==='HUB_JOIN').requestId,'request-2');
    f.room.stop();assert.equal(f.listeners.size,0);assert.equal(f.sent.findLast(m=>m.type==='HUB_LEAVE').sessionId,'session-2');
    f.room.start();f.join();assert.equal(f.room.getSnapshot().status,'joined');
  }finally{f.room.stop();}
});
test('takeover/revocation clears presence and requires explicit retry rather than fighting another tab',()=>{
  const f=fixture();try{
    f.join();f.deliver('HUB_ERROR',{sessionId:'session-1',code:'SESSION_REPLACED'});
    assert.equal(f.room.getSnapshot().status,'error');assert.equal(f.room.getSnapshot().players.length,0);
    f.room.setConnected(true);assert.equal(f.sent.filter(m=>m.type==='HUB_JOIN').length,1);
    f.room.retry();f.join();assert.equal(f.room.getSnapshot().status,'joined');
  }finally{f.room.stop();}
});
test('unmount while JOIN is pending cancels its nonce and cannot accept late acknowledgements',()=>{
  const f=fixture();f.room.stop();f.join();assert.equal(f.room.getSnapshot().status,'offline');
  assert.equal(f.listeners.size,0);assert.deepEqual(f.sent.at(-1),{type:'HUB_CANCEL',requestId:'request-1'});
});
test('roster-driven remounts retain a takeover block until an explicit room retry',()=>{
  const admission={blocked:false},first=fixture(admission);first.join();
  first.deliver('HUB_ERROR',{sessionId:'session-1',code:'SESSION_REPLACED'});first.room.stop();
  const second=fixture(admission);try{
    assert.equal(second.room.getSnapshot().status,'error');assert.equal(second.sent.filter(m=>m.type==='HUB_JOIN').length,0);
    second.room.setConnected(false);second.room.setConnected(true);assert.equal(second.sent.filter(m=>m.type==='HUB_JOIN').length,0);
    second.room.retry();second.join();assert.equal(second.room.getSnapshot().status,'joined');assert.equal(admission.blocked,false);
  }finally{second.room.stop();}
});
test('held input and heartbeats are bounded, idle snapshots do not prevent pings, timeout clears stale presence',t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const f=fixture();try{
    f.join();f.room.input({x:1,y:0});f.clock(100);t.mock.timers.tick(100);
    assert.equal(f.sent.filter(m=>m.type==='HUB_INPUT').length,2);
    f.room.stopMoving();f.clock(4900);f.deliver('HUB_STATE',frame([player()],2));t.mock.timers.tick(100);
    assert.ok(f.sent.some(m=>m.type==='HUB_PING'));
    f.clock(6100);t.mock.timers.tick(100);assert.equal(f.room.getSnapshot().status,'error');assert.equal(f.room.getSnapshot().players.length,0);
  }finally{f.room.stop();}
});
test('JOIN timeout reports an error and sends cancellation',t=>{
  t.mock.timers.enable({apis:['setInterval']});const f=fixture();try{
    f.clock(8100);t.mock.timers.tick(100);assert.equal(f.room.getSnapshot().status,'error');assert.equal(f.sent.at(-1).type,'HUB_CANCEL');
  }finally{f.room.stop();}
});
test('a bounded JOIN refusal is correlated to the current request and requires explicit retry',()=>{
  const f=fixture();try{
    f.deliver('HUB_ERROR',{code:'JOIN_RATE_LIMITED',requestId:'request-1',sessionId:null});
    assert.equal(f.room.getSnapshot().status,'error');assert.match(f.room.getSnapshot().error,/Muitas trocas/);
    f.room.retry();f.join();assert.equal(f.room.getSnapshot().status,'joined');
  }finally{f.room.stop();}
});
test('visual smoothing never predicts past a server target or interpolates through furniture',()=>{
  const p=player(),motion=new RoomMotion(p);
  motion.accept(player('own',{position:{x:4.9,y:2.3},moving:true}),0);
  motion.update(.05,.05);assert.ok(motion.position.x>4.7&&motion.position.x<4.9);
  for(let n=0;n<40;n++)motion.update(.05,.1+n*.05);
  assert.ok(motion.position.x<=4.9);assert.equal(motion.moving,false);
  motion.accept(player('own',{position:{x:2.7,y:9},moving:false}),3);
  assert.deepEqual(motion.position,{x:2.7,y:9});
  motion.accept(player('own',{position:{x:2.7,y:8.8},moving:false}),4,true);
  assert.deepEqual(motion.position,{x:2.7,y:8.8},'first confirmed spawn/rejoin is never interpolated from an invented position');
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { SocialHubRoom } from '../src/services/socialHub/Room.js';
import { tavernMap as map } from '../src/services/socialHub/world/tavernMap.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rooms = [];
afterEach(() => { rooms.splice(0).forEach(room => room.destroy()); });
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; messages = [];
  send(raw) { this.messages.push(JSON.parse(raw)); }
  close(code, reason) { this.readyState = 3; this.closed = { code, reason }; this.emit('close'); }
}
function fixture(options = {}) {
  let time = 0;
  const characters = Array.from({ length: 5 }, (_, n) => ({ id: id(n+1), user_id: id(n+101), name: `Fixture ${n+1}`, level: n+1, classe: 'Mago' }));
  const load = vi.fn(async (char, owner) => characters.find(row => row.id === char && row.user_id === owner) ?? null);
  const revalidate = vi.fn(async ids => characters.filter(row => ids.includes(row.id)));
  const room = new SocialHubRoom({ loadCharacter: load, revalidate, now: () => time, ...options }); rooms.push(room);
  const attach = (n = 1) => {
    const socket = new Socket(); const stop = room.attach(socket, { id: id(n+100) }); socket.on('close', stop); return socket;
  };
  const send = (socket, message) => room.accept(socket, JSON.stringify(message));
  const join = async (socket, n=1, requestId=`request-${n}`) => {
    send(socket, { type: 'HUB_JOIN', requestId, characterId: id(n), version: 1, mapId: map.id, mapVersion: map.version });
    await new Promise(resolve => setImmediate(resolve));
    return socket.messages.findLast(msg => msg.type === 'HUB_JOINED')?.data;
  };
  return { room, attach, send, join, load, revalidate, characters,
    advance: ms => { time += ms; room.tick(); } };
}

describe('Authoritative HTML5 room', () => {
  it('joins real owned rows and broadcasts only room character fields, never account/private metadata', async () => {
    const f = fixture(), a = f.attach(), b = f.attach(2);
    const joined = await f.join(a); await f.join(b,2);
    expect(f.load).toHaveBeenCalledWith(id(1),id(101));
    expect(joined.selfId).toBe(id(1)); expect(joined.players[0].position).toEqual(map.spawn);
    const state = a.messages.findLast(m=>m.type==='HUB_STATE').data;
    expect(state.players).toHaveLength(2);
    expect(state.players[0].position).not.toEqual(state.players[1].position);
    for (const player of state.players) expect(f.room.navigation.isWalkable(player.position)).toBe(true);
    expect(Object.keys(state.players[0]).sort()).toEqual(['id','name','level','classe','position','direction','moving','presence'].sort());
    expect(state.players[0]).not.toHaveProperty('userId'); expect(state.players[0]).not.toHaveProperty('sessionId');
  });
  it('refuses another owner and refuses identity/position claims or a mismatched map before querying', async () => {
    const f = fixture(), a=f.attach(); await f.join(a,2);
    expect(f.room.players.size).toBe(0); expect(a.messages.at(-1).data.code).toBe('CHARACTER_UNAVAILABLE');
    f.load.mockClear();
    f.send(a,{type:'HUB_JOIN',requestId:'spoof',characterId:id(1),version:1,mapId:map.id,mapVersion:map.version,userId:id(101)});
    f.send(a,{type:'HUB_JOIN',requestId:'wrong-map',characterId:id(1),version:1,mapId:map.id,mapVersion:99});
    expect(f.load).not.toHaveBeenCalled(); expect(f.room.players.size).toBe(0);
  });
  it('a cancelled or disconnected asynchronous join cannot create a ghost', async () => {
    let finish; const f=fixture({loadCharacter:()=>new Promise(resolve=>{finish=resolve;})}), a=f.attach();
    f.send(a,{type:'HUB_JOIN',requestId:'pending',characterId:id(1),version:1,mapId:map.id,mapVersion:map.version});
    f.send(a,{type:'HUB_CANCEL',requestId:'pending'}); a.close(1000,'done'); finish(f.characters[0]);
    await new Promise(resolve=>setImmediate(resolve)); expect(f.room.players.size).toBe(0); expect(f.room.timer).toBeNull();
  });
  it('newer joins win races and stale cleanup cannot remove the replacement session', async () => {
    const pending=[]; const f=fixture({loadCharacter:()=>new Promise(resolve=>pending.push(resolve))}), a=f.attach();
    const msg=requestId=>({type:'HUB_JOIN',requestId,characterId:id(1),version:1,mapId:map.id,mapVersion:map.version});
    f.send(a,msg('old')); f.send(a,msg('new')); expect(pending).toHaveLength(1);
    pending[0](f.characters[0]); await new Promise(resolve=>setImmediate(resolve));
    expect(pending).toHaveLength(2); pending[1](f.characters[0]); await new Promise(resolve=>setImmediate(resolve));
    f.send(a,{type:'HUB_CANCEL',requestId:'old'});
    expect(f.room.players.size).toBe(1); expect(f.room.players.get(id(1)).requestId).toBe('new');
  });
  it('one avatar per account: another tab takes over without closing the shared classic socket', async () => {
    const f=fixture(), a=f.attach(), b=f.attach(); const old=await f.join(a); await f.join(b,1,'second-tab');
    expect(a.messages.findLast(m=>m.type==='HUB_ERROR').data.code).toBe('SESSION_REPLACED');
    expect(a.readyState).toBe(1); f.send(a,{type:'HUB_LEAVE',sessionId:old.sessionId}); a.close(1000,'old tab');
    expect(f.room.players.get(id(1)).record.socket).toBe(b);
  });
  it('enforces capacity without evicting existing users', async () => {
    const f=fixture({maxPlayers:2}); await f.join(f.attach()); await f.join(f.attach(2),2); const c=f.attach(3); await f.join(c,3);
    expect(f.room.players.size).toBe(2); expect(c.messages.at(-1).data.code).toBe('ROOM_FULL');
  });
  it('only the server integrates speed; oversized time gaps cannot teleport', async () => {
    const f=fixture(), a=f.attach(), {sessionId}=await f.join(a);
    f.send(a,{type:'HUB_INPUT',sessionId,direction:{x:2,y:2}}); f.advance(1000);
    const p=f.room.players.get(id(1)); expect(Math.hypot(p.motion.position.x-map.spawn.x,p.motion.position.y-map.spawn.y)).toBeLessThanOrEqual(0.14001);
    expect(f.room.navigation.isWalkable(p.motion.position)).toBe(true);
  });
  it('routes to the actual board approach around solid furniture and stops at its exact destination', async () => {
    const f=fixture(), a=f.attach(), {sessionId}=await f.join(a), target=map.points.find(p=>p.id==='missions').position;
    f.send(a,{type:'HUB_MOVE',sessionId,target});
    let previous={...map.spawn};
    for(let step=0;step<250;step++) { f.advance(50); const p=f.room.players.get(id(1)).motion.position;
      expect(f.room.navigation.canTraverse(previous,p)).toBe(true); previous={...p}; }
    expect(previous).toEqual(target); expect(f.room.players.get(id(1)).motion.pending).toBe(false);
    expect(a.messages.findLast(m=>m.type==='HUB_STATE').data.players[0].moving).toBe(false);
  });
  it('rejects blocked, nonfinite/coerced targets, extra equipment/identity fields and stale tokens', async () => {
    const f=fixture(), a=f.attach(), {sessionId}=await f.join(a);
    for(const target of [{x:1,y:9},{x:null,y:2},{x:'4',y:2},{x:999,y:2}]) f.send(a,{type:'HUB_MOVE',sessionId,target});
    f.send(a,{type:'HUB_INPUT',sessionId,direction:{x:99,y:0}});
    f.send(a,{type:'HUB_MOVE',sessionId,target:{x:6,y:8},position:{x:6,y:8}});
    f.send(a,{type:'HUB_MOVE',sessionId:'wrong',target:{x:6,y:8}});
    f.advance(100); expect(f.room.players.get(id(1)).motion.position).toEqual(map.spawn);
  });
  it('releases held keyboard input after 400 ms and expires silent membership after 15 s', async () => {
    const f=fixture(), a=f.attach(), {sessionId}=await f.join(a);
    f.send(a,{type:'HUB_INPUT',sessionId,direction:{x:1,y:0}}); f.advance(50); const at={...f.room.players.get(id(1)).motion.position};
    f.advance(500); expect(f.room.players.get(id(1)).motion.position).toEqual(at);
    f.advance(15000); expect(f.room.players.size).toBe(0); expect(f.room.timer).toBeNull();
  });
  it('keeps idle members alive with pings and exposes only explicit away state', async () => {
    const f=fixture(), a=f.attach(), {sessionId}=await f.join(a);
    for(let n=0;n<8;n++){f.advance(5000);f.send(a,{type:'HUB_PING',sessionId,away:n%2===0});}
    expect(f.room.players.size).toBe(1); expect(f.room.snapshot().players[0].presence).toBe('online');
  });
  it('periodically removes revoked characters and updates authoritative name/class/level', async () => {
    const f=fixture(), a=f.attach(), b=f.attach(2); await f.join(a); await f.join(b,2);
    f.characters[0].name='Atualizado'; f.characters[0].classe='Bardo'; f.characters[0].level=7; f.characters.splice(1,1);
    await f.room.validateMembers(); expect(f.room.snapshot().players).toHaveLength(1);
    expect(f.room.snapshot().players[0]).toMatchObject({name:'Atualizado',classe:'Bardo',level:7});
    expect(b.messages.findLast(m=>m.type==='HUB_ERROR').data.code).toBe('CHARACTER_UNAVAILABLE');
  });
  it('fails closed on revalidation failure and ignores a stale validation after reconnect', async () => {
    const f=fixture(), a=f.attach(); await f.join(a); f.revalidate.mockRejectedValueOnce(Error('DB offline'));
    await f.room.validateMembers(); expect(f.room.players.size).toBe(0);
    expect(a.messages.findLast(m=>m.type==='HUB_ERROR').data.code).toBe('SERVICE_UNAVAILABLE');
    await f.join(a,1,'retry'); let finish; f.revalidate.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=f.room.validateMembers(); a.close(1000,'gone'); const b=f.attach(); await f.join(b,1,'fresh'); finish([]); await pending;
    expect(f.room.players.get(id(1)).record.socket).toBe(b);
  });
  it('cleans presence on close/leave and stops the room loop when empty', async () => {
    const f=fixture(), a=f.attach(), b=f.attach(2); await f.join(a); const {sessionId}=await f.join(b,2);
    a.close(1000,'left'); expect(b.messages.findLast(m=>m.type==='HUB_STATE').data.players).toHaveLength(1);
    f.send(b,{type:'HUB_LEAVE',sessionId}); expect(f.room.players.size).toBe(0); expect(f.room.timer).toBeNull();
  });
  it('bounds malformed/oversized messages and terminates flood/slow consumers', async () => {
    const f=fixture(), a=f.attach(); await f.join(a);
    f.room.accept(a,'{'); f.room.accept(a,'x'.repeat(3000));
    for(let n=0;n<250;n++) f.send(a,{type:'HUB_STOP',sessionId:'bad'});
    expect(a.closed.code).toBe(1008); expect(f.room.players.size).toBe(0);
    const b=f.attach(2); await f.join(b,2); b.bufferedAmount=200000; f.room.publish();
    expect(b.closed.code).toBe(1013); expect(f.room.players.size).toBe(0);
  });
  it('caps concurrent owned-character queries across connections', async () => {
    const pending=[], f=fixture({loadCharacter:()=>new Promise(resolve=>pending.push(resolve))});
    for(let n=1;n<=9;n++) f.send(f.attach(n),{type:'HUB_JOIN',requestId:`pending-${n}`,characterId:id(n),version:1,mapId:map.id,mapVersion:map.version});
    expect(pending).toHaveLength(8); expect(f.room.lookups).toBe(8);
    pending.forEach(resolve=>resolve(null));await new Promise(resolve=>setImmediate(resolve));expect(f.room.lookups).toBe(0);
  });
  it('evicts on a stalled validation deadline and blocks new joins until that query recovers', async () => {
    const f=fixture({validationTimeoutMs:5}), a=f.attach();await f.join(a);
    let finish;f.revalidate.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const validating=f.room.validateMembers();
    await new Promise(resolve=>setTimeout(resolve,15));expect(f.room.players.size).toBe(0);expect(f.room.validationUnavailable).toBe(true);
    const b=f.attach(2);await f.join(b,2);expect(b.messages.at(-1).data.code).toBe('SERVICE_UNAVAILABLE');
    finish([]);await validating;expect(f.room.validationUnavailable).toBe(false);
  });
  it('leaves legacy messages for their existing handler and adds no HTML5 chat handler', async () => {
    const f=fixture(), a=f.attach(), {sessionId}=await f.join(a);
    expect(f.send(a,{type:'JOIN',characterId:id(1)})).toBe(false);
    expect(f.send(a,{type:'CHAT_SEND',text:'legacy'})).toBe(false);
    f.send(a,{type:'HUB_CHAT_SEND',sessionId,text:'not implemented'});
    expect(a.messages.findLast(m=>m.type==='HUB_ERROR').data.code).toBe('INVALID_MESSAGE');
  });
});

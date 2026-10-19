import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';

vi.mock('../src/db/index.js', () => ({ query: vi.fn(), pool: {} }));
vi.mock('../src/ws/broadcast.js', () => ({ registerClient: vi.fn() }));
vi.mock('../src/services/tavernRoom.js', () => ({ handleTavernMessage: vi.fn(async()=>{}), handleTavernSocketClose: vi.fn() }));
import { query } from '../src/db/index.js';
import { registerClient } from '../src/ws/broadcast.js';
import { handleTavernMessage } from '../src/services/tavernRoom.js';
import { connectNimrodSocket } from '../src/ws/connection.js';
import { socialHubRoom } from '../src/services/socialHub/index.js';

let app, sockets;
const characterId='00000000-0000-4000-8000-000000000001', owner='00000000-0000-4000-8000-000000000101';
beforeEach(async()=>{
  vi.clearAllMocks(); sockets=[];
  query.mockImplementation(async (sql)=> typeof sql==='object' ? {rows:[{id:characterId,user_id:owner,name:'Socket fixture',level:4,classe:'Bardo'}]} : {rows:[{id:owner,name:'Test account',role:'PLAYER'}]});
  app=Fastify(); await app.register(websocket,{options:{maxPayload:16384}});
  app.get('/ws',{websocket:true},(connection,req)=>connectNimrodSocket(connection,req,app.log));
  await app.listen({host:'127.0.0.1',port:0});
});
afterEach(async()=>{
  sockets.forEach(socket=>socket.terminate());
  for(const socket of [...socialHubRoom.connections.keys()])socialHubRoom.detach(socket);
  await app.close();
});
function connect(auth=true){
  const ws=new WebSocket(`ws://127.0.0.1:${app.server.address().port}/ws`,{headers:auth?{'cf-access-authenticated-user-email':'socket-fixture@example.invalid'}:{}});sockets.push(ws);return ws;
}
function message(ws,type){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`Missing ${type}`)),3000);const listen=raw=>{const m=JSON.parse(raw);if(m.type===type){clearTimeout(timer);ws.off('message',listen);resolve(m);}};ws.on('message',listen);});}
it('existing auth refuses unauthenticated sockets before registration or membership',async()=>{
  const ws=connect(false);const closed=await new Promise(resolve=>ws.once('close',(code,reason)=>resolve({code,reason:String(reason)})));
  expect(closed).toEqual({code:1008,reason:'Unauthorized'});expect(registerClient).not.toHaveBeenCalled();expect(socialHubRoom.players.size).toBe(0);
});
it('CONNECTED follows authentication; real socket joins and routes legacy messages without a second login',async()=>{
  const ws=connect();await message(ws,'CONNECTED');
  expect(registerClient).toHaveBeenCalledWith(expect.anything(),owner);
  const joined=message(ws,'HUB_JOINED');ws.send(JSON.stringify({type:'HUB_JOIN',requestId:'socket-test',characterId,version:1,mapId:'nimrod-tavern-v1',mapVersion:2}));
  const {data}=await joined;expect(data.selfId).toBe(characterId);expect(data.players[0].name).toBe('Socket fixture');
  const sql=query.mock.calls.find(([sql])=>typeof sql==='object'&&sql.text.includes('user_id = $2'))[0];
  expect(sql.values).toEqual([characterId,owner]);expect(sql.query_timeout).toBe(3000);
  ws.send(JSON.stringify({type:'JOIN',characterId}));await new Promise(resolve=>setTimeout(resolve,30));
  expect(handleTavernMessage).toHaveBeenCalled();
  ws.close();await new Promise(resolve=>ws.once('close',resolve));await new Promise(resolve=>setTimeout(resolve,20));
  expect(socialHubRoom.players.size).toBe(0);
});
it('bounds transport frames before JSON dispatch',async()=>{
  const ws=connect();await message(ws,'CONNECTED');const closed=new Promise(resolve=>ws.once('close',resolve));ws.send('x'.repeat(17000));
  expect(await closed).toBe(1009);expect(socialHubRoom.players.size).toBe(0);
});
it('revalidation reads eligibility and owner from the existing table, not from websocket claims',async()=>{
  await socialHubRoom.loadCharacter(characterId,owner);await socialHubRoom.revalidate([characterId]);
  const configs=query.mock.calls.filter(([sql])=>typeof sql==='object').map(([sql])=>sql);
  expect(configs).toHaveLength(2);
  expect(configs[0].text).toContain('active = TRUE AND retired = FALSE AND COALESCE(dead, FALSE) = FALSE');
  expect(configs[1].text).toContain('user_id');expect(configs[1].values).toEqual([[characterId]]);
});

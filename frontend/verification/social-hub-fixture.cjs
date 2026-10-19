// Isolated loopback harness. No .env, real database, Foundry or production access.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { WebSocketServer } = require('../../backend/node_modules/ws');

exports.startFixture = async function () {
  const { SocialHubRoom } = await import(pathToFileURL(path.resolve(__dirname, '../../backend/src/services/socialHub/Room.js')).href);
  const accounts = ['one','two'].map((key,index) => ({ key,
    user: { id: `00000000-0000-4000-8000-00000000010${index+1}`, displayName: `Conta de teste ${index+1}`, role:'PLAYER' },
    character: { id: `00000000-0000-4000-8000-00000000000${index+1}`, userId:`00000000-0000-4000-8000-00000000010${index+1}`,
      name:`Personagem de teste ${index+1}`,level:3+index,classe:index?'Guerreiro':'Mago',race:'Humano',active:true,retired:false,dead:false,
      tokenImg:null,portraitImg:null,foundryActorId:null,lastSyncedAt:null } }));
  const eligible = c => c.active && !c.dead && !c.retired;
  const room = new SocialHubRoom({
    loadCharacter:async(id,owner)=>accounts.map(a=>a.character).find(c=>c.id===id&&c.userId===owner&&eligible(c))??null,
    revalidate:async ids=>accounts.map(a=>a.character).filter(c=>ids.includes(c.id)&&eligible(c)).map(c=>({...c,user_id:c.userId})),
  });
  const account = req => accounts.find(a=>req.headers.cookie?.split(';').some(value=>value.trim()===`nimrod_fixture=${a.key}`));
  const root=path.resolve(__dirname,'../dist'), clients=new Map();let socketCount=0,mutations=0;
  const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://fixture.invalid').pathname, current=account(req);
    if(req.method!=='GET'){mutations++;return json(res,405,{error:'Read-only fixture'});}
    if(pathname.startsWith('/api/')){
      if(!current)return json(res,401,{error:'Unauthorized'});
      if(pathname==='/api/me')return json(res,200,current.user);
      if(pathname==='/api/me/characters')return json(res,200,[current.character]);
      if(pathname==='/api/notifications')return json(res,200,{items:[]});
      if(pathname==='/api/world/calendar')return json(res,503,{error:'Fixture calendar unavailable'});
      if(pathname==='/api/foundry/launch')return json(res,503,{error:'No Foundry launches in fixture'});
      return json(res,200,[]);
    }
    let file=path.resolve(root,'.'+decodeURIComponent(pathname));
    if(file!==root&&!file.startsWith(root+path.sep))return json(res,404,{});
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())file=path.join(root,'index.html');
    const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json','.woff2':'font/woff2'};
    res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:16384});
  server.on('upgrade',(req,socket,head)=>{
    const current=account(req);
    if(!current||req.url!=='/ws'){socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>{
      socketCount++;clients.set(ws,current);const stop=room.attach(ws,current.user);
      ws.on('message',(raw,binary)=>room.accept(ws,raw,binary));ws.on('close',()=>{stop();clients.delete(ws);});
      ws.send(JSON.stringify({type:'CONNECTED',ts:Date.now()}));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return { base:`http://127.0.0.1:${server.address().port}`, room, accounts, clients,
    socketCount:()=>socketCount,mutations:()=>mutations,
    disconnect:key=>{for(const [ws,a] of clients)if(a.key===key)ws.terminate();},
    emit:(type,data)=>{for(const ws of clients.keys())ws.send(JSON.stringify({type,data,ts:Date.now()}));},
    close:async()=>{room.destroy();for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});},
  };
};

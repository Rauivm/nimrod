const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const AxeBuilder=require('@axe-core/playwright').default;
const WebSocket=require('../../backend/node_modules/ws');
const {startFixture}=require('./social-hub-fixture.cjs');
const output=path.resolve(__dirname,'../node_modules/.cache/social-hub-multiplayer');fs.mkdirSync(output,{recursive:true});
const passed=[],errors=[];let fixture,browser;const contexts=[];
async function ready(page,count=2){
  await page.getByRole('status').filter({hasText:'Conectado ao salão compartilhado.'}).waitFor();
  await page.waitForFunction(count=>document.querySelectorAll('[aria-label="Personagens presentes"] li').length===count,count);
  await page.waitForFunction(()=>document.querySelector('.social-hub-canvas canvas')?.dataset.renderer==='pixi-webgl');
}
async function position(page){return page.locator('.social-hub-canvas canvas').evaluate(c=>({x:+c.dataset.explorerX,y:+c.dataset.explorerY}));}
async function floorPoint(page,p){
  const canvas=page.locator('.social-hub-canvas canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
  const padding=box.width<480?8:20,scale=Math.min((box.width-padding*2)/1328,(box.height-padding*2)/862);
  return {x:box.x+box.width/2+((p.x-p.y)*48-48)*scale,y:box.y+box.height/2+((p.x+p.y)*24-251)*scale};
}
async function poll(check,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,25));}throw Error('Fixture condition timed out');}
(async()=>{
  try{
    fixture=await startFixture();browser=await chromium.launch({channel:'msedge',headless:true});
    async function context(key,mobile=false){
      const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},reducedMotion:'reduce'});contexts.push(ctx);
      await ctx.addCookies([{url:fixture.base,name:'nimrod_fixture',value:key}]);
      await ctx.addInitScript(()=>localStorage.setItem('lgpd_seen','true'));return ctx;
    }
    const ca=await context('one'),cb=await context('two',true),a=await ca.newPage(),b=await cb.newPage();
    for(const page of [a,b])page.on('pageerror',e=>errors.push(e.message));
    await a.goto(fixture.base+'/lobby/html5');await ready(a,1);
    await b.goto(fixture.base+'/lobby/html5');await ready(b);await ready(a);
    for(const page of [a,b])await page.waitForFunction(()=>document.querySelector('canvas')?.dataset.remoteAvatars==='1');
    assert.equal(fixture.socketCount(),2);assert.equal(fixture.room.players.size,2);
    passed.push('Two independent fixture accounts join one real WebSocket room and render each other with real class atlases');
    await cb.route('**/social-hub/avatars-arcane-v1.png',route=>route.fulfill({status:503,body:'Asset fixture failure'}));
    await b.getByRole('button',{name:'Reconectar à sala',exact:true}).click();
    await b.getByRole('status').filter({hasText:'Um visual de personagem não carregou.'}).waitFor();
    assert.equal(await b.locator('.social-hub-canvas canvas').getAttribute('data-remote-avatars'),'0');
    assert.equal(fixture.room.players.size,2);
    await cb.unroute('**/social-hub/avatars-arcane-v1.png');
    await b.getByRole('button',{name:'Reconectar à sala',exact:true}).click();await ready(b);
    await b.waitForFunction(()=>document.querySelector('canvas')?.dataset.remoteAvatars==='1');
    passed.push('A failed remote atlas leaves presence truthful and recovers with fresh scene-owned resources after room retry');
    let started;const loading=new Promise(resolve=>{started=resolve;});
    await cb.route('**/social-hub/avatars-arcane-v1.png',async route=>{started();await new Promise(r=>setTimeout(r,350));await route.continue().catch(()=>{});});
    await b.getByRole('button',{name:'Reconectar à sala',exact:true}).click();await loading;
    await b.getByRole('navigation',{name:'Alternar experiência'}).getByRole('link',{name:'Modo Clássico',exact:true}).click();
    await b.waitForTimeout(500);assert.equal(await b.locator('.social-hub-canvas canvas').count(),0);await poll(()=>fixture.room.players.size===1);
    await cb.unroute('**/social-hub/avatars-arcane-v1.png');
    await b.getByRole('button',{name:'Abrir navegação',exact:true}).click();
    await b.getByRole('link',{name:'Taverna HTML5 · Experimental',exact:true}).click();await ready(b);await ready(a);
    await b.waitForFunction(()=>document.querySelector('canvas')?.dataset.remoteAvatars==='1');
    passed.push('Leaving during a pending remote atlas load cannot recreate a scene or keep room membership');
    const before=await b.locator('.social-hub-canvas canvas').screenshot(),bPosition=await position(b);
    const target={x:7,y:10.8},click=await floorPoint(a,target);await a.mouse.click(click.x,click.y);
    await a.waitForFunction(p=>{const c=document.querySelector('.social-hub-canvas canvas');return c?.dataset.walking==='false'&&Math.hypot(+c.dataset.explorerX-p.x,+c.dataset.explorerY-p.y)<.002;},target,{timeout:15000});
    const server=fixture.room.players.get(fixture.accounts[0].character.id).motion.position;
    assert.ok(Math.hypot(server.x-target.x,server.y-target.y)<.001);
    assert.ok(!(await b.locator('.social-hub-canvas canvas').screenshot()).equals(before));
    assert.deepEqual(await position(b),bPosition);
    passed.push('Server pathfinding reaches a clicked target; the other browser renders the remote movement without moving its own character');
    await a.locator('canvas').focus();await a.keyboard.down('ArrowRight');await a.waitForTimeout(250);await a.keyboard.up('ArrowRight');
    await a.waitForTimeout(350);const keyboard=await position(a);assert.ok(Math.hypot(keyboard.x-target.x,keyboard.y-target.y)>.05);
    assert.ok(fixture.room.navigation.isWalkable(keyboard));passed.push('Held keyboard input moves through the authoritative tick and stops on keyup');
    const rogue=new WebSocket(fixture.base.replace('http:','ws:')+'/ws',{headers:{cookie:'nimrod_fixture=two'}});
    await new Promise(resolve=>rogue.once('message',resolve));
    const refused=new Promise(resolve=>rogue.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='HUB_ERROR')resolve(m);}));
    rogue.send(JSON.stringify({type:'HUB_JOIN',requestId:'forged-owner',characterId:fixture.accounts[0].character.id,version:1,mapId:'nimrod-tavern-v1',mapVersion:2}));
    assert.equal((await refused).data.code,'CHARACTER_UNAVAILABLE');rogue.close();
    passed.push('A third transport cannot borrow the other account’s character');
    await a.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    await poll(()=>fixture.room.players.get(fixture.accounts[0].character.id)?.away);
    await b.getByRole('listitem').filter({hasText:fixture.accounts[0].character.name}).getByText('Nível 3 · Ausente',{exact:true}).waitFor();
    await a.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
    passed.push('Visibility changes stop input and propagate the validated away flag');
    await a.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await poll(()=>fixture.room.players.size===1);
    await a.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await ready(a);await ready(b);
    passed.push('Page lifecycle suspension leaves the room and a persisted pageshow rejoins without another socket');
    fixture.disconnect('one');
    await a.getByRole('status').filter({hasText:'Sem conexão com a sala.'}).waitFor();
    assert.equal(fixture.room.players.size,1);await ready(a);await ready(b);
    assert.equal(fixture.room.players.size,2);passed.push('A dropped real socket removes presence and the existing WsProvider reconnects/rejoins without another login');
    for(const page of [a,b]){
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.equal(axe.violations.length,0,JSON.stringify(axe.violations));
    }
    await a.screenshot({path:path.join(output,'desktop-two-players.png'),fullPage:true});await b.screenshot({path:path.join(output,'mobile-two-players.png'),fullPage:true});
    passed.push('Desktop/mobile layouts have no overflow and no Axe WCAG 2/2.1 A/AA violations');
    await cb.close();await poll(()=>fixture.room.players.size===1);await ready(a,1);
    const a2=await ca.newPage();a2.on('pageerror',e=>errors.push(e.message));await a2.goto(fixture.base+'/lobby/html5');await ready(a2,1);
    await a.getByRole('status').filter({hasText:'Sua conta entrou na taverna em outra aba.'}).waitFor();
    fixture.emit('FOUNDRY_ACTORS_SYNCED',{updated:1});await ready(a2,1);
    await a.getByRole('status').filter({hasText:'Sua conta entrou na taverna em outra aba.'}).waitFor();
    await a.waitForTimeout(1100);assert.equal(fixture.room.players.size,1);
    await a2.close();await poll(()=>fixture.room.players.size===0);await a.getByRole('button',{name:'Reconectar à sala',exact:true}).click();await ready(a,1);
    passed.push('Another tab takes over one avatar; even Foundry roster refresh cannot trigger an automatic takeover loop');
    fixture.accounts[0].character.active=false;await fixture.room.validateMembers();
    await a.getByRole('status').filter({hasText:'O personagem não está mais autorizado'}).waitFor();
    fixture.emit('CHARACTER_UPDATED',{userId:fixture.accounts[0].user.id});
    await a.getByRole('status').filter({hasText:'Nenhum personagem ativo'}).waitFor();assert.equal(await a.locator('canvas').count(),0);
    assert.equal(fixture.room.players.size,0);assert.equal(fixture.room.timer,null);
    passed.push('Server-side revocation evicts membership; the existing character event refresh removes the scene and room loop');
    assert.equal(fixture.mutations(),0);assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({base:'isolated loopback fixture',passed,errors,mutations:0,realDatabase:false,realFoundry:false},null,2));
    console.log(JSON.stringify({passed,errors,mutations:0},null,2));
  }catch(error){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({passed,errors,error:String(error.stack)},null,2));console.error(error);process.exitCode=1;}
  finally{for(const ctx of contexts)await ctx.close().catch(()=>{});await browser?.close();await fixture?.close();}
})();

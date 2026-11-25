import * as R from './runtime.mjs';
import testTelekinetic from './telekinetic.mjs';
import testAlchemy from './alchemy.mjs';
import testEnchantmentGraveyard from './enchantment-graveyard.mjs';
const {assert,player,give,count,run,configs,id,obj,inv,worn,World,Packet,PlayerLoading,ScriptState,ScriptProvider,ServerTriggerType}=R;
const wallets=['mta_telekinetic_points','mta_alchemy_points','mta_enchantment_points','mta_graveyard_points'];
const caps=[4000,8000,16000,4000];
const ResumePauseButtonHandler=(await R.load('network/game/client/handler/ResumePauseButtonHandler.ts')).default;
const ResumePauseButton=(await R.load('network/game/client/model/ResumePauseButton.ts')).default;
const resumePause=new ResumePauseButtonHandler();
const balances=p=>wallets.map(name=>p.getVar(id('VarPlayerType',name)));
const setBalances=(p,values)=>wallets.forEach((name,i)=>p.setVar(id('VarPlayerType',name),values[i]));
function settle(p,state){for(let i=0;state.execution===ScriptState.SUSPENDED&&i<30;i++){World.currentTick=Math.max(World.currentTick+1,p.delayedUntil);p.delayed=false;p.executeScript(state,true,true);}return state;}
function finish(p,state){settle(p,state);assert.equal(state.execution,ScriptState.FINISHED,state.script.name);return state;}
function stock(p){const invId=id('InvType','magictraining_inventory');const inventory=p.getInventory(invId);assert(inventory,'shared stock exists');return inventory;}
function purchase(p,slot){finish(p,run(p,'[proc,mta_buy]',[slot]));}
let passed=0;
async function check(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
await check('original wallet IDs, permanent scope, server-only transport and exact period caps',()=>{
  const p=player();
  wallets.forEach((name,i)=>{const v=configs.VarPlayerType.get(id('VarPlayerType',name));assert.equal(v.id,[199,216,220,221][i]);assert.equal(v.scope,configs.VarPlayerType.SCOPE_PERM);assert.equal(v.transmit,false);run(p,'[proc,mta_award]',[i+1,100000]);});
  assert.deepEqual(balances(p),caps);
  run(p,'[proc,mta_award]',[1,-1]);assert.deepEqual(balances(p),caps);
  const data=p.save();assert(PlayerLoading.verify(new Packet(data)));
  const loaded=PlayerLoading.load(p.username,new Packet(data),null);assert(loaded);assert.deepEqual(balances(loaded),caps);
});
await check('hat grant, checking, equip compatibility, colour and entry gates',()=>{
  const p=player();const type=id('NpcType','magictraining_guard_entrance');
  const script=ScriptProvider.getByTrigger(ServerTriggerType.OPNPC1,type,configs.NpcType.get(type).category);assert.equal(script?.name,'[opnpc1,magictraining_guard_entrance]');
  finish(p,run(p,script));assert.equal(count(p,'magictraining_proghat_dull'),1);
  finish(p,run(p,script));assert.equal(count(p,'magictraining_proghat_dull'),1,'replacement must not duplicate a carried hat');
  run(p,'[proc,mta_award]',[1,2]);assert.equal(count(p,'magictraining_proghat_energised'),1);
  finish(p,run(p,'[opheld1,magictraining_proghat_energised]'));assert(p.messages.some(text=>text==='Telekinetic Pizazz Points: 2'));
  p.getInventory(inv).removeAll();give(p,'magictraining_proghat_dull',1,worn);
  const has=run(p,'[proc,mta_has_hat]');assert.equal(has.intStack[has.isp-1],1,'worn hat permits entry');
  const empty=player();const no=run(empty,'[proc,mta_entry_check]',[7]);assert.equal(no.intStack[no.isp-1],0);
});
await check('24 period rewards fit original shop and preserve published price matrix',()=>{
  const p=player();const inventory=stock(p);
  const rows=[['magictraining_wand_beg',30,30,300,30],['magictraining_wand_appr',60,60,600,60],['magictraining_wand_teach',150,200,1500,150],['magictraining_wand_master',240,240,2400,240],['magictraining_infinitytop',400,450,4000,400],['magictraining_infinityhat',350,400,3000,350],['magictraining_infinityboots',120,120,1200,120],['magictraining_infinitygloves',175,225,1500,175],['magictraining_infinitybottom',450,500,5000,450],['magictraining_bookofmagic',500,550,6000,500],['magictraining_peachspell',200,300,2000,200],...['mistrune','dustrune','mudrune','smokerune','steamrune','lavarune'].map(name=>[name,1,1,15,1]),['cosmicrune',0,0,5,0],['chaosrune',0,1,5,1],['naturerune',0,1,0,1],['deathrune',2,1,20,1],['lawrune',2,0,0,0],['soulrune',2,2,25,2],['bloodrune',2,2,25,2]];
  rows.forEach(([name,...cost],slot)=>{assert.equal(inventory.get(slot)?.id,obj(name));const s=run(p,'[proc,mta_price]',[obj(name)]);assert.deepEqual(s.intStack.slice(0,4),cost);});
  assert.equal(inventory.get(24),null);
});
await check('all currency shortages preserve stock, points and player inventory',()=>{
  for(let missing=0;missing<4;missing++){
    const p=player();stock(p);setBalances(p,[30,30,300,30]);p.setVar(id('VarPlayerType',wallets[missing]),0);
    const before=balances(p);const initial=count(p,'magictraining_wand_beg',id('InvType','magictraining_inventory'));
    purchase(p,0);assert.deepEqual(balances(p),before);assert.equal(count(p,'magictraining_wand_beg'),0);assert.equal(count(p,'magictraining_wand_beg',id('InvType','magictraining_inventory')),initial);
  }
});
await check('physical purchase, full-inventory refusal and one-wand upgrade settlement',()=>{
  const p=player();stock(p);setBalances(p,[30,30,300,30]);purchase(p,0);assert.equal(count(p,'magictraining_wand_beg'),1);assert.deepEqual(balances(p),[0,0,0,0]);
  setBalances(p,[60,60,600,60]);for(let i=0;i<27;i++)give(p,'bones');purchase(p,1);assert.equal(count(p,'magictraining_wand_appr'),1);assert.equal(count(p,'magictraining_wand_beg'),0);assert.deepEqual(balances(p),[0,0,0,0]);
  setBalances(p,caps);const before=balances(p);purchase(p,4);assert.equal(count(p,'magictraining_infinitytop'),0);assert.deepEqual(balances(p),before);
  const missing=player();stock(missing);setBalances(missing,caps);purchase(missing,2);assert.equal(count(missing,'magictraining_wand_teach'),0);assert.deepEqual(balances(missing),caps);
});
await check('persistent peaches entitlement, no physical icon, no-debit repeat and full bag',()=>{
  const p=player();stock(p);setBalances(p,[200,300,2000,200]);for(let i=0;i<28;i++)give(p,'bones');purchase(p,10);
  assert.equal(p.getVarBit(id('VarBitType','magictraining_bonespeaches')),1);assert.equal(count(p,'magictraining_peachspell'),0);assert.deepEqual(balances(p),[0,0,0,0]);
  setBalances(p,caps);purchase(p,10);assert.deepEqual(balances(p),caps);
  const loaded=PlayerLoading.load(p.username,new Packet(p.save()),null);assert.equal(loaded.getVarBit(id('VarBitType','magictraining_bonespeaches')),1);
});
await check('manual exact-coins full-bag settlement and shortage refusal',()=>{
  const p=player();give(p,'coins',200);for(let i=0;i<27;i++)give(p,'bones');finish(p,run(p,'[proc,mta_buy_manual]'));assert.equal(count(p,'magictraining_arenalorebook'),1);assert.equal(count(p,'coins'),0);
  const short=player();give(short,'coins',199);finish(short,run(short,'[proc,mta_buy_manual]'));assert.equal(count(short,'coins'),199);assert.equal(count(short,'magictraining_arenalorebook'),0);
});
await check('confirmed hat destruction loses points, other items do not, warning is explicit',()=>{
  const p=player();setBalances(p,caps);run(p,'[proc,mta_destroyed]',[obj('bones')]);assert.deepEqual(balances(p),caps);
  run(p,'[proc,mta_destroy_warning]',[obj('magictraining_proghat_dull')]);assert(p.packets.some(packet=>String(packet.text).includes('Pizazz Points')));
  run(p,'[proc,mta_destroyed]',[obj('magictraining_proghat_dull')]);assert.deepEqual(balances(p),[0,0,0,0]);
});
await check('all MTA room items and hats are untradeable without cache option changes',()=>{
  for(const name of ['magictraining_proghat_dull','magictraining_proghat_energised','magictraining_proghat_full','magictraining_leather_boots','magictraining_adamant_kiteshield','magictraining_adamant_med_helm','magictraining_emerald','magictraining_rune_longsword','magictraining_enchan_cylinder','magictraining_enchan_cube','magictraining_enchan_icosahendron','magictraining_enchan_pentamid','magictraining_enchan_shapeorb','magictraining_dragonstone','magictraining_bones1','magictraining_bones2','magictraining_bones3','magictraining_bones4'])assert.equal(configs.ObjType.get(obj(name)).tradeable,false,name);
});
await check('all original portal dispatchers enforce hat and level gates, then native exits clear each room',()=>{
  const rooms=[
    ['telekinetic_teleport',3363,3315,33,1,[3335,9718,0]],
    ['alchemists_teleport',3363,3321,21,2,[3362,9623,2]],
    ['enchanters_teleport',3360,3318,7,3,[3363,9650,0]],
    ['graveyard_teleport',3366,3318,15,4,[3363,9640,1]]
  ];
  for(const [name,x,z,level,room,[ex,ez,el]] of rooms){
    const target=World.getLoc(x,z,0,id('LocType',name));assert(target,`original ${name} map target`);
    const p=player({x,z:z-1});finish(p,R.trigger(p,'OPLOC1',target));assert.equal(p.z,z-1,'no hat: no entry');
    give(p,'magictraining_proghat_dull');p.levels[6]=level-1;finish(p,R.trigger(p,'OPLOC1',target));assert.equal(p.z,z-1,'insufficient Magic: no entry');
    p.levels[6]=99;if(room===1)p.setVar(id('VarPlayerType','varp625_bits'),3);
    finish(p,R.trigger(p,'OPLOC1',target));let state=run(p,'[proc,mta_room]');assert.equal(state.intStack[state.isp-1],room);
    if(room===1)assert.equal(p.packets.filter(packet=>packet?.component===id('Component','pizazz_telekinetic:com_5')&&packet.constructor?.name==='IfSetText').at(-1)?.text,'3','native Telekinetic entry shows the saved streak instead of the cache placeholder');
    const exit=World.getLoc(ex,ez,el,id('LocType','exit_teleport'));assert(exit,`original room ${room} exit`);
    finish(p,R.trigger(p,'OPLOC1',exit));assert.deepEqual([p.x,p.z,p.level],[3363,3314,0]);assert.deepEqual(balances(p),[0,0,0,0]);
  }
});
await check('stale Duel Arena zone queues cannot replace any MTA room overlay',()=>{
  const rooms=[
    ['telekinetic_teleport',3363,3315,'pizazz_telekinetic'],
    ['alchemists_teleport',3363,3321,'pizazz_alchemy'],
    ['enchanters_teleport',3360,3318,'pizazz_enchantment'],
    ['graveyard_teleport',3366,3318,'pizazz_graveyard']
  ];
  for(const [name,x,z,overlay] of rooms){
    const p=player({x,z:z-1});give(p,'magictraining_proghat_dull');
    const pending=()=>[...p.queue.all(),...p.weakQueue.all()].filter(request=>request.script.name==='[queue,check_duel_arena_challenge_area]').length;
    finish(p,run(p,'[zone,0_52_51_32_48]'));assert.equal(pending(),1,'the actual overlapping hall-zone trigger queues its Duel Arena check');
    const target=World.getLoc(x,z,0,id('LocType',name));assert(target);
    finish(p,R.trigger(p,'OPLOC1',target));
    assert.equal(pending(),0,'native MTA entry cancels the already queued Duel Arena check');
    const expected=id('Component',overlay);assert.equal(p.overlay,expected,'native entry selects the room overlay');
    R.tick(p,2);assert.equal(p.overlay,expected,'the queue phase preserves the room overlay');
    finish(p,run(p,'[zone,0_52_51_32_48]'));assert.equal(pending(),1,'a late stale zone callback is queued through its real script');
    R.tick(p,2);assert.equal(pending(),0,'the late callback really executes');assert.equal(p.overlay,expected,'Duel Arena cleanup must not clear the active MTA overlay');
    finish(p,run(p,'[proc,mta_leave]'));
  }
  const outside=player();outside.openMainOverlay(id('Component','overlay_duel'));
  finish(outside,run(outside,'[proc,toggle_duel_challenge_off]'));assert.equal(outside.overlay,-1,'Duel Arena cleanup outside MTA remains unchanged');
});
await check('native alchemy entry refuses carried coins without losing coins or the hat',()=>{
  const p=player({x:3363,z:3320});give(p,'magictraining_proghat_dull');give(p,'coins',200);
  const target=World.getLoc(3363,3321,0,id('LocType','alchemists_teleport'));assert(target);
  finish(p,R.trigger(p,'OPLOC1',target));assert.deepEqual([p.x,p.z,p.level],[3363,3314,0]);
  assert.equal(count(p,'coins'),200);assert.equal(count(p,'magictraining_proghat_dull'),1);assert.deepEqual(balances(p),[0,0,0,0]);
});
await check('native alchemy exit warns, staying retains coins and leaving forfeits only unredeemed coins',()=>{
  const exit=World.getLoc(3362,9623,2,id('LocType','exit_teleport'));assert(exit);
  for(const choice of [2,1]){
    const p=player({x:3363,z:9623,level:2});give(p,'magictraining_proghat_dull');give(p,'coins',100);setBalances(p,[2,3,4,5]);
    const state=settle(p,R.trigger(p,'OPLOC1',exit));assert.equal(state.execution,ScriptState.PAUSEBUTTON);
    assert(p.packets.some(packet=>String(packet.text).includes('undeclared coins')));
    const component=id('Component',`multi2:com_${choice}`);assert(p.resumeButtons.includes(component));p.lastCom=component;
    assert(resumePause.handle(new ResumePauseButton(component),p));finish(p,state);
    assert.deepEqual(balances(p),[2,3,4,5]);assert.equal(count(p,'magictraining_proghat_energised')+count(p,'magictraining_proghat_dull'),1);
    if(choice===2){assert.equal(count(p,'coins'),100);assert.deepEqual([p.x,p.z,p.level],[3363,9623,2]);}
    else{assert.equal(count(p,'coins'),0);assert.deepEqual([p.x,p.z,p.level],[3363,3314,0]);}
  }
});
await check('login room recovery preserves saved wallets, maze streak and peaches while clearing room items',()=>{
  const cases=[[3336,9718,0,null],[3355,9693,1,null],[3359,9701,2,null],[3363,9624,2,'magictraining_rune_longsword'],[3364,9650,0,'magictraining_enchan_shapeorb'],[3363,9641,1,'magictraining_bones4']];
  for(const [x,z,level,item] of cases){
    const p=player({x,z,level});give(p,'magictraining_proghat_dull');if(item)give(p,item);give(p,'lawrune',3);setBalances(p,[2,3,4,5]);
    p.setVar(id('VarPlayerType','varp625_bits'),4);p.setVarBit(id('VarBitType','magictraining_bonespeaches'),1);
    finish(p,run(p,'[proc,mta_login]'));assert.deepEqual([p.x,p.z,p.level],[3363,3314,0]);if(item)assert.equal(count(p,item),0);
    assert.equal(count(p,'lawrune'),3);assert.deepEqual(balances(p),[2,3,4,5]);assert.equal(p.getVar(id('VarPlayerType','varp625_bits')),4);assert.equal(p.getVarBit(id('VarBitType','magictraining_bonespeaches')),1);
    const restored=PlayerLoading.load(p.username,new Packet(p.save()),null);assert(restored);assert.deepEqual(balances(restored),[2,3,4,5]);assert.equal(restored.getVar(id('VarPlayerType','varp625_bits')),4);assert.equal(restored.getVarBit(id('VarBitType','magictraining_bonespeaches')),1);
  }
});
await check('chamber dragonstones spawn on reachable packed floor, stay bounded, permit native pickup and respawn',async()=>{
  const map=await R.load('engine/GameMap.ts');const p=player({x:3364,z:9650});give(p,'magictraining_proghat_dull');
  finish(p,run(p,'[proc,mta_enchantment_enter]'));run(p,'[proc,mta_enchantment_ground]');
  const other=player({x:3364,z:9650});run(other,'[proc,mta_enchantment_ground]');
  const reachable=new Set(['3364,9650']);const queue=[[3364,9650]];
  for(let at=0;at<queue.length;at++){const [x,z]=queue[at];for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz,key=`${nx},${nz}`;if(nx<3328||nx>3391||nz<9600||nz>9663||reachable.has(key)||!map.isLineOfWalk(0,x,z,nx,nz))continue;reachable.add(key);queue.push([nx,nz]);}}
  const tiles=[];
  for(let i=0;i<5;i++){
    const state=run(p,'[proc,mta_dragonstone_tile]',[i]);const packed=state.intStack[state.isp-1];const x=(packed>>>14)&16383,z=packed&16383;tiles.push([x,z]);
    assert(reachable.has(`${x},${z}`),`dragonstone ${i} reachable from original entry on packed collision`);
    const ground=World.getObj(x,z,0,obj('magictraining_dragonstone'),p.hash64);assert(ground,`dragonstone ${i} materialized`);
    p.x=x;p.z=z;finish(p,R.trigger(p,'OPOBJ3',ground));assert.equal(count(p,'magictraining_dragonstone'),i+1);
    assert.equal(World.getObj(x,z,0,obj('magictraining_dragonstone'),p.hash64),null,'repeat/player entry must not duplicate a spawn');
  }
  R.tick(p,50);for(const [x,z] of tiles)assert(World.getObj(x,z,0,obj('magictraining_dragonstone'),p.hash64),'timer replenishes picked spawn');
  run(p,'[proc,mta_enchantment_cleanup]');assert.equal(count(p,'magictraining_dragonstone'),0);
});
await check('ordinary gameplay teleport releases each arena room but does not affect outside or same-room moves',()=>{
  const destination=(3363<<14)|3314;
  for(const [x,z,level,item] of [[3336,9718,0,null],[3363,9624,2,'magictraining_rune_longsword'],[3364,9650,0,'magictraining_enchan_shapeorb'],[3363,9641,1,'magictraining_bones4']]){
    const p=player({x,z,level});give(p,'magictraining_proghat_dull');give(p,'lawrune',3);if(item)give(p,item);if(level===2&&z===9624)give(p,'coins',100);setBalances(p,[2,3,4,5]);
    finish(p,run(p,'[proc,p_telejump_safe]',[destination]));assert.deepEqual([p.x,p.z,p.level],[3363,3314,0]);if(item)assert.equal(count(p,item),0);
    if(level===2&&z===9624)assert.equal(count(p,'coins'),0);assert.equal(count(p,'lawrune'),3);assert.deepEqual(balances(p),[2,3,4,5]);
  }
  const outside=player();give(outside,'coins',100);give(outside,'lawrune',3);finish(outside,run(outside,'[proc,p_telejump_safe]',[(3364<<14)|3314]));assert.equal(count(outside,'coins'),100);assert.equal(count(outside,'lawrune'),3);
  const inside=player({x:3364,z:9650});give(inside,'magictraining_enchan_shapeorb');finish(inside,run(inside,'[proc,p_telejump_safe]',[(3365<<14)|9650]));assert.equal(count(inside,'magictraining_enchan_shapeorb'),1);
});
await check('chamber XP follows the named reduced-XP default rather than a token training reward',()=>{
  const p=player({x:3364,z:9650});give(p,'magictraining_enchan_cube');give(p,'cosmicrune');give(p,'airrune',3);
  run(p,'[proc,mta_enchantment_enter]');const slot=p.getInventory(inv).getItemIndex(obj('magictraining_enchan_cube'));p.lastSlot=slot;p.lastItem=obj('magictraining_enchan_cube');
  const before=p.stats[6];finish(p,run(p,'[opheldt,magic:enchant_lvl2]'));assert.equal(p.stats[6]-before,333,'90% of authored 37 XP, in tenths');assert.equal(count(p,'magictraining_enchan_shapeorb'),1);
  run(p,'[proc,mta_enchantment_cleanup]');
});
await testTelekinetic(R);
await testAlchemy(R);
await testEnchantmentGraveyard(R);
console.log(`RESULT PASS mta: ${passed} ledger/shop checks and all room modules`);
process.exit(0);

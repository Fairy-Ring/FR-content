export default async function testAlchemy(R) {
  const {assert,player,give,count,run,trigger,loc,obj,inv,World,Packet,PlayerLoading,ScriptState,ScriptProvider,ServerTriggerType,id}=R;
  const bank=id('InvType','bank');
  const alchemyWallet=id('VarPlayerType','mta_alchemy_points');
  const coinReward=id('VarBitType','magictraining_alchem_coinreward');
  const wallets=['mta_telekinetic_points','mta_alchemy_points','mta_enchantment_points','mta_graveyard_points'].map(name=>id('VarPlayerType',name));
  const clockwise=[
    ['cupboard_10783',3360,9632],
    ['cupboard_10797',3369,9632],
    ['cupboard_10795',3369,9636],
    ['cupboard_10793',3369,9640],
    ['cupboard_10791',3369,9644],
    ['cupboard_10789',3360,9644],
    ['cupboard_10787',3360,9640],
    ['cupboard_10785',3360,9636]
  ];
  let passed=0;
  function finish(p,state){
    for(let i=0;state.execution===ScriptState.SUSPENDED&&i<30;i++){
      World.currentTick=Math.max(World.currentTick+1,p.delayedUntil);
      p.delayed=false;
      p.executeScript(state,true,true);
    }
    assert.equal(state.execution,ScriptState.FINISHED,state.script.name);
    return state;
  }
  function resultInt(p,name,args=[]){
    const state=finish(p,run(p,name,args));
    return state.intStack[state.isp-1];
  }
  function inRoom(){
    const p=player({x:3363,z:3320});
    give(p,'magictraining_proghat_dull',1,R.worn);
    finish(p,trigger(p,'OPLOC1',loc('alchemists_teleport',3363,3321)));
    assert.equal(resultInt(p,'[proc,mta_room]'),2,'entered the Alchemists\' Playground');
    return p;
  }
  function cupboard(p,slot){
    const [name,x,z]=clockwise[slot];
    return trigger(p,'OPLOC1',loc(name,x,z,2));
  }
  function cast(p,spell,item){
    const itemId=obj(item);
    const selectedSlot=p.getInventory(inv).getItemIndex(itemId);
    assert.notEqual(selectedSlot,-1,`${item} must be selected in inventory`);
    p.lastItem=itemId;
    p.lastSlot=selectedSlot;
    const component=id('Component',`magic:${spell}`);
    const script=ScriptProvider.getByTrigger(ServerTriggerType.OPHELDT,component,-1);
    assert(script,`compiled OPHELDT dispatch for ${spell}`);
    return finish(p,run(p,script));
  }
  function roomPrices(p){
    const component=name=>id('Component',`pizazz_alchemy:${name}`);
    const latest=name=>p.packets.filter(packet=>packet?.component===component(name)&&packet.constructor?.name==='IfSetText').at(-1)?.text??null;
    return {total:latest('com_3'),boots:latest('com_9'),shield:latest('com_10'),helm:latest('com_11'),emerald:latest('com_12'),sword:latest('com_13')};
  }
  function roomPhase(p){return resultInt(p,'[proc,mta_alchemy_phase]');}
  function pending(p){return resultInt(p,'[proc,mta_alchemy_pending]');}
  function balances(p){return wallets.map(wallet=>p.getVar(wallet));}
  function capture(p){
    p.messages=[];p.packets=[];
    p.write=value=>p.packets.push(value);
    p.messageGame=text=>p.messages.push(String(text));
    p.wrappedMessageGame=p.messageGame;
    return p;
  }
  function check(name,fn){fn();passed++;console.log(`PASS MTA alchemy: ${name}`);}

  check('carried coins refuse room entry without deletion or room state',()=>{
    const p=player({x:3363,z:9624,level:2});
    give(p,'coins',7);
    finish(p,run(p,'[proc,mta_alchemy_enter]'));
    assert.equal(resultInt(p,'[proc,mta_room]'),0);
    assert.equal(count(p,'coins'),7,'ordinary carried coins are preserved');
    assert.equal(count(p,'coins',bank),0,'entry refusal does not bank the coins');
    assert.equal(roomPhase(p),0,'refused entry does not advance phase');
    assert.equal(p.getVar(alchemyWallet),0);
  });

  check('four actual High/Low Alch dispatches produce 120 coins and one deposited point',()=>{
    const p=inRoom();
    assert.deepEqual(roomPrices(p),{total:'0',boots:'1',shield:'5',helm:'8',emerald:'15',sword:'30 (Free)'});
    const beforeXp=p.stats[6];
    for(const spell of ['highlvl_alchemy','lowlvl_alchemy','highlvl_alchemy']){
      cupboard(p,0);
      assert.equal(count(p,'magictraining_rune_longsword'),1);
      cast(p,spell,'magictraining_rune_longsword');
    }
    assert.equal(count(p,'coins'),90,'three 30-coin casts are below one point');
    assert.equal(p.getVar(alchemyWallet),0);
    assert.equal(p.stats[6]-beforeXp,1150+310+1150,'High Alch candidate XP and standard Low Alch XP in tenths');
    cupboard(p,0);
    cast(p,'highlvl_alchemy','magictraining_rune_longsword');
    assert.equal(count(p,'coins'),120,'the fourth free cast reaches 100 coins');
    const beforeDepositXp=p.stats[6];
    trigger(p,'OPLOC1',loc('magictraining_coin_collector',3364,9650,2));
    assert.equal(count(p,'coins'),0,'all deposited coins are consumed');
    assert.equal(p.getVar(alchemyWallet),1,'120 deposited coins award floor(120/100) points');
    assert.equal(p.stats[6]-beforeDepositXp,2400,'120 coins award two Magic XP per coin in tenths');
    assert.equal(p.getVarBit(coinReward),12,'10% cash reward waits for leaving');
    assert.equal(roomPrices(p).total,'1','mta_award refreshes the room HUD');
    assert.equal(count(p,'coins',bank),0,'bank reward is deferred until leaving');
    finish(p,run(p,'[proc,mta_leave]'));
    assert.equal(resultInt(p,'[proc,mta_room]'),0);
    assert.equal(count(p,'coins',bank),12,'leaving pays the deposited 10% bonus once');
    assert.equal(p.getVarBit(coinReward),0);
    assert.deepEqual(balances(p),[0,1,0,0]);
  });

  check('40-phase cycle rotates all alchemy values and cupboard positions',()=>{
    const p=inRoom();
    const items=['magictraining_rune_longsword','magictraining_emerald','magictraining_adamant_med_helm','magictraining_adamant_kiteshield','magictraining_leather_boots'];
    const prices=[30,15,8,5,1];
    for(let phase=0;phase<40;phase++){
      assert.equal(roomPhase(p),phase);
      for(let i=0;i<items.length;i++){
        const rotated=(i+phase)%5;
        assert.equal(resultInt(p,'[proc,mta_alchemy_value]',[obj(items[i])]),prices[rotated],`${items[i]} price in phase ${phase}`);
        assert.equal(resultInt(p,'[proc,mta_alchemy_free]',[obj(items[i])]),rotated===0?1:0,`${items[i]} free status in phase ${phase}`);
      }
      if(phase<8){
        for(let slot=0;slot<clockwise.length;slot++){
          const index=(slot-phase+8)%8;
          cupboard(p,slot);
          for(let i=0;i<items.length;i++)assert.equal(count(p,items[i]),i===index?1:0,`cupboard ${slot}, phase ${phase}, ${items[i]}`);
          if(index<items.length)finish(p,run(p,'[proc,mta_alchemy_remove]',[obj(items[index])]));
        }
      }
      if(phase<39)R.tick(p,50);
    }
    R.tick(p,50);
    assert.equal(roomPhase(p),0,'the 40-phase period wraps');
    finish(p,run(p,'[proc,mta_alchemy_cleanup]'));
  });

  check('50-tick rotation keeps a free 30-coin target and enforces ordinary runes otherwise',()=>{
    const p=inRoom();
    R.tick(p,50);
    assert.equal(roomPhase(p),1);
    assert.deepEqual(roomPrices(p),{total:'0',boots:'30 (Free)',shield:'1',helm:'5',emerald:'8',sword:'15'});
    cupboard(p,0);
    assert.equal(count(p,'magictraining_rune_longsword'),0,'the first cupboard is empty after clockwise movement');
    cupboard(p,5);
    assert.equal(count(p,'magictraining_leather_boots'),1,'the rotating 30-coin item is free in phase one');
    const freeXp=p.stats[6];
    cast(p,'highlvl_alchemy','magictraining_leather_boots');
    assert.equal(count(p,'coins'),30,'free High Alch still produces the 30-coin value');
    assert.equal(p.stats[6]-freeXp,1150,'free High Alch awards candidate 115 XP in tenths');
    cupboard(p,1);
    assert.equal(count(p,'magictraining_rune_longsword'),1);
    give(p,'firerune',3);
    const refusedXp=p.stats[6];
    cast(p,'lowlvl_alchemy','magictraining_rune_longsword');
    assert.equal(count(p,'magictraining_rune_longsword'),1,'non-free item stays when Nature runes are missing');
    assert.equal(count(p,'coins'),30);
    assert.equal(p.stats[6],refusedXp);
    assert.equal(count(p,'firerune'),3,'failed rune check consumes no Fire runes');
    assert.equal(count(p,'naturerune'),0,'the missing Nature Rune remains absent');
    assert(p.messages.includes('You do not have enough Nature Runes to cast this spell.'));
    give(p,'naturerune',1);
    const beforeRuneXp=p.stats[6];
    cast(p,'lowlvl_alchemy','magictraining_rune_longsword');
    assert.equal(count(p,'magictraining_rune_longsword'),0);
    assert.equal(count(p,'firerune'),0);
    assert.equal(count(p,'naturerune'),0);
    assert.equal(count(p,'coins'),45,'non-free Low Alch pays the same 15-coin value');
    assert.equal(p.stats[6]-beforeRuneXp,310,'standard Low Alch XP is 31 XP in tenths');
    finish(p,run(p,'[proc,mta_alchemy_cleanup]'));
    assert.equal(count(p,'coins'),0,'un-deposited room coins are removed on cleanup');
  });

  check('brought items are refused in-room; outside hook is false; full cupboards do not overflow',()=>{
    const p=inRoom();
    give(p,'bronze_dagger',1);
    give(p,'firerune',5);
    give(p,'naturerune',1);
    const beforeXp=p.stats[6];
    cast(p,'highlvl_alchemy','bronze_dagger');
    assert.equal(count(p,'bronze_dagger'),1,'brought non-MTA item is not alched');
    assert.equal(count(p,'firerune'),5,'brought-item refusal consumes no Fire runes');
    assert.equal(count(p,'naturerune'),1,'brought-item refusal consumes no Nature runes');
    assert.equal(count(p,'coins'),0);
    assert.equal(p.stats[6],beforeXp,'brought-item refusal awards no XP');
    finish(p,run(p,'[proc,mta_alchemy_cleanup]'));

    const outside=player();
    give(outside,'magictraining_rune_longsword',1);
    const result=run(outside,'[proc,mta_alchemy]',[0,obj('magictraining_rune_longsword')]);
    assert.equal(result.intStack[result.isp-1],0,'outside room the hook returns false immediately');
    assert.equal(count(outside,'magictraining_rune_longsword'),1);
    assert.equal(count(outside,'coins'),0);

    const full=inRoom();
    give(full,'bones',28);
    cupboard(full,0);
    assert.equal(count(full,'magictraining_rune_longsword'),0,'full inventory refuses the cupboard item');
    assert.equal(count(full,'bones'),28);
    finish(full,run(full,'[proc,mta_alchemy_cleanup]'));
  });

  check('save/load recovery removes only room loot and pays full escrow exactly once',()=>{
    const p=inRoom();
    give(p,'coins',7,bank);
    const beforeTrainingXp=p.stats[6];
    for(let i=0;i<342;i++){
      cupboard(p,0);
      cast(p,'highlvl_alchemy','magictraining_rune_longsword');
    }
    assert.equal(p.stats[6]-beforeTrainingXp,342*1150,'each High Alch awards 115 XP in tenths');
    assert.equal(count(p,'coins'),10260,'342 actual free casts produce 10,260 room coins');
    const beforeDepositXp=p.stats[6];
    trigger(p,'OPLOC1',loc('magictraining_coin_collector',3364,9650,2));
    assert.equal(p.stats[6]-beforeDepositXp,205200,'10,260 coins award 20,520 Magic XP in tenths');
    assert.equal(p.getVar(alchemyWallet),102);
    assert.equal(p.getVarBit(coinReward),2);
    assert.equal(pending(p),1026,'high pending bits retain reward beyond the original 10-bit varbit');
    give(p,'bronze_dagger',1);
    cupboard(p,0);
    cupboard(p,0);
    cast(p,'highlvl_alchemy','magictraining_rune_longsword');
    assert.equal(count(p,'magictraining_rune_longsword'),1,'one MTA item remains at logout');
    assert.equal(count(p,'coins'),30,'un-deposited room coins remain until cleanup');
    assert.equal(count(p,'bronze_dagger'),1,'ordinary inventory items remain untouched');
    assert.equal(count(p,'coins',bank),7,'bank cash remains untouched before leaving');
    assert.deepEqual(balances(p),[0,102,0,0]);

    const loaded=PlayerLoading.load(p.username,new Packet(p.save()),null);
    assert(loaded,'room state loads for login recovery');
    capture(loaded);
    assert.equal(resultInt(loaded,'[proc,mta_room]'),2);
    assert.equal(pending(loaded),1026,'both pending fields survive save/load');
    assert.equal(count(loaded,'magictraining_rune_longsword'),1);
    assert.equal(count(loaded,'coins'),30);
    finish(loaded,run(loaded,'[proc,mta_login]'));
    assert.equal(resultInt(loaded,'[proc,mta_room]'),0,'login recovery returns to the hall');
    assert.equal(count(loaded,'magictraining_rune_longsword'),0,'cleanup removes room-only MTA items');
    assert.equal(count(loaded,'coins'),0,'cleanup removes un-deposited room coins');
    assert.equal(count(loaded,'bronze_dagger'),1,'cleanup preserves ordinary items');
    assert.equal(count(loaded,'coins',bank),1033,'saved bank coins plus the full 1,026 reward');
    assert.equal(pending(loaded),0,'paid escrow clears');
    assert.deepEqual(balances(loaded),[0,102,0,0],'all saved point wallets survive cleanup');
    finish(loaded,run(loaded,'[proc,mta_login]'));
    assert.equal(count(loaded,'coins',bank),1033,'a second login does not pay twice');
    const saved=PlayerLoading.load(loaded.username,new Packet(loaded.save()),null);
    assert(saved);
    assert.equal(count(saved,'coins',bank),1033,'bank reward persists across another save/load');
    assert.deepEqual(balances(saved),[0,102,0,0]);
  });

  console.log(`RESULT PASS MTA alchemy: ${passed} room scenarios`);
}
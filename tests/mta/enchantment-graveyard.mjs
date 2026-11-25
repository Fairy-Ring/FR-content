export default async function testEnchantmentGraveyard(R) {
  const {assert,player,give,count,run,trigger,loc,obj,inv,worn,id,World,ScriptState}=R;
  function finish(p,state){
    for(let i=0;state.execution===ScriptState.SUSPENDED&&i<30;i++){
      World.currentTick=Math.max(World.currentTick+1,p.delayedUntil);
      p.delayed=false;
      p.executeScript(state,true,true);
    }
    assert.equal(state.execution,ScriptState.FINISHED,state.script.name);
    return state;
  }
  function place(p,room){
    if(room===3){p.x=3363;p.z=9650;p.level=0;}
    else {p.x=3363;p.z=9641;p.level=1;}
  }
  function locClick(p,name,x,z,level){
    return finish(p,trigger(p,'OPLOC1',loc(name,x,z,level),'LocType'));
  }
  function enchant(p,spell,item){
    const slot=p.getInventory(inv).getItemIndex(obj(item));
    assert.notEqual(slot,-1,`${item} available to enchant`);
    p.lastItem=obj(item);
    p.lastSlot=slot;
    return finish(p,run(p,`[opheldt,magic:enchant_lvl${spell}]`));
  }
  const enchantPoints=p=>p.getVar(id('VarPlayerType','mta_enchantment_points'));
  const gravePoints=p=>p.getVar(id('VarPlayerType','mta_graveyard_points'));
  const checks=[];
  function check(name,fn){console.log(`RUN mta enchantment/graveyard: ${name}`);fn();checks.push(name);}

  check('outside-room enchant remains the ordinary jewelry spell',()=>{
    const p=player();
    give(p,'sapphire_ring');give(p,'waterrune',1);give(p,'cosmicrune',1);
    enchant(p,1,'sapphire_ring');
    assert.equal(count(p,'ring_of_recoil'),1);
    assert.equal(count(p,'magictraining_enchan_shapeorb'),0);
  });

  check('Enchantment picks, ten-shape bonus, matching rotation, deposit points and dragonstone score',()=>{
    const p=player({x:3363,z:9650,level:0});
    give(p,'waterrune',8);give(p,'airrune',6);give(p,'cosmicrune',10);
    run(p,'[proc,mta_enchantment_enter]');
    for(let i=0;i<8;i++)locClick(p,'cube_pile',3345,9654,0);
    for(let i=0;i<2;i++)locClick(p,'cylinder_pile',3355,9621,0);
    assert.equal(count(p,'magictraining_enchan_cube'),8);
    assert.equal(count(p,'magictraining_enchan_cylinder'),2);
    for(let i=0;i<8;i++)enchant(p,1,'magictraining_enchan_cube');
    for(let i=0;i<2;i++)enchant(p,2,'magictraining_enchan_cylinder');
    assert.equal(count(p,'magictraining_enchan_shapeorb'),10);
    assert.equal(enchantPoints(p),0,'points wait for the hole deposit');
    locClick(p,'hole_10803',3363,9640,0);
    assert.equal(count(p,'magictraining_enchan_shapeorb'),0);
    assert.equal(enchantPoints(p),22,'ten ordinary points, eight matching-shape points, and the level-2 tenth-shape bonus');
    run(p,'[proc,mta_enchantment_cleanup]');

    const dragon=player({x:3363,z:9650,level:0});
    give(dragon,'magictraining_dragonstone');give(dragon,'earthrune',10);give(dragon,'cosmicrune',1);
    run(dragon,'[proc,mta_enchantment_enter]');
    enchant(dragon,4,'magictraining_dragonstone');
    assert.equal(count(dragon,'magictraining_enchan_shapeorb'),1);
    locClick(dragon,'hole_10803',3363,9640,0);
    assert.equal(enchantPoints(dragon),8,'dragonstone pays twice the enchantment level');
    run(dragon,'[proc,mta_enchantment_cleanup]');
  });

  check('twenty deposited orbs give one random three-rune reward and cleanup preserves ordinary runes',()=>{
    const p=player({x:3363,z:9650,level:0});
    give(p,'magictraining_enchan_cube',20);give(p,'waterrune',20);give(p,'cosmicrune',20);
    run(p,'[proc,mta_enchantment_enter]');
    for(let i=0;i<20;i++)enchant(p,1,'magictraining_enchan_cube');
    locClick(p,'hole_10803',3363,9640,0);
    assert.equal(count(p,'magictraining_enchan_shapeorb'),0);
    assert.equal(count(p,'bloodrune')+count(p,'deathrune')+count(p,'cosmicrune'),3);
    assert.equal(enchantPoints(p),28);
    give(p,'magictraining_dragonstone');give(p,'magictraining_enchan_pentamid');
    run(p,'[proc,mta_enchantment_cleanup]');
    assert.equal(count(p,'magictraining_dragonstone')+count(p,'magictraining_enchan_pentamid'),0);
    assert.equal(count(p,'waterrune'),0);
  });

  check('wide pending field survives a native cast and deposits more than 255 points intact',()=>{
    const p=player({x:3363,z:9650,level:0});
    run(p,'[proc,mta_enchantment_enter]');
    // Seed a large pending-score precondition, then take the actual shared spell dispatch.
    p.setVar(id('VarPlayerType','varp627_bits'),280 << 4);
    give(p,'magictraining_enchan_cube');give(p,'cosmicrune');give(p,'waterrune');
    enchant(p,1,'magictraining_enchan_cube');
    locClick(p,'hole_10803',3363,9640,0);
    assert.equal(enchantPoints(p),282,'the cast preserves existing high pending bits before adding two points');
  });

  check('Graveyard entry preserves forbidden carried items; four-tier pile cycle and one-cast deposit',()=>{
    const blocked=player({x:3363,z:9641,level:1});
    give(blocked,'banana');
    run(blocked,'[proc,mta_graveyard_enter]');
    assert.equal(count(blocked,'banana'),1);
    assert.deepEqual([blocked.level,blocked.x,blocked.z],[0,3363,3314]);

    const p=player({x:3363,z:9641,level:1});
    run(p,'[proc,mta_graveyard_enter]');
    for(let i=0;i<4;i++)locClick(p,'magictraining_bones_pile4',3372,9657,1);
    assert.equal(count(p,'magictraining_bones4'),4);
    assert.equal(count(p,'magictraining_bones1'),0);
    locClick(p,'magictraining_bones_pile4',3372,9657,1);
    assert.equal(count(p,'magictraining_bones1'),1,'the pile cycles after four bones');
    give(p,'naturerune',1);give(p,'waterrune',2);give(p,'earthrune',2);
    finish(p,run(p,'[if_button,magic:bones_to_bananas]'));
    assert.equal(count(p,'magictraining_bones4'),0);
    assert.equal(count(p,'banana'),18);
    locClick(p,'magictraining_grave_foodshute',3362,9648,1);
    assert.equal(count(p,'banana'),0);
    assert.equal(gravePoints(p),1);
    assert.equal(count(p,'waterrune')+count(p,'naturerune')+count(p,'deathrune')+count(p,'bloodrune'),1);
    run(p,'[proc,mta_graveyard_cleanup]');
  });

  check('Bones to Peaches unlock, level and rune gates preserve bones on refusal',()=>{
    const locked=player({x:3363,z:9641,level:1});
    run(locked,'[proc,mta_graveyard_enter]');
    give(locked,'magictraining_bones1');
    finish(locked,run(locked,'[if_button,magic:com_559]'));
    assert.equal(count(locked,'magictraining_bones1'),1);
    assert.equal(count(locked,'peach'),0);
    run(locked,'[proc,mta_graveyard_cleanup]');

    const p=player({x:3363,z:9641,level:1});
    run(p,'[proc,mta_graveyard_enter]');
    p.setVarBit(id('VarBitType','magictraining_bonespeaches'),1);
    give(p,'magictraining_bones1');give(p,'naturerune',2);give(p,'waterrune',4);give(p,'earthrune',4);
    finish(p,run(p,'[if_button,magic:com_559]'));
    assert.equal(count(p,'magictraining_bones1'),0);
    assert.equal(count(p,'peach'),2);
    run(p,'[proc,mta_graveyard_cleanup]');
  });

  check('periodic two-damage fall and safe would-lethal ejection retain equipment and apply min(10, points)',()=>{
    const hurt=player({x:3363,z:9641,level:1});
    hurt.levels[3]=10;hurt.baseLevels[3]=99;
    run(hurt,'[proc,mta_graveyard_enter]');
    R.tick(hurt,50);
    assert.equal(hurt.levels[3],8);
    run(hurt,'[proc,mta_graveyard_cleanup]');

    const low=player({x:3363,z:9641,level:1});
    low.levels[3]=2;low.baseLevels[3]=99;
    give(low,'magictraining_proghat_dull',1,worn);
    run(low,'[proc,mta_graveyard_enter]');
    run(low,'[proc,mta_award]',[4,7]);
    give(low,'magictraining_bones2');give(low,'banana',2);
    R.tick(low,50);
    assert.deepEqual([low.level,low.x,low.z],[0,3363,3314]);
    assert.equal(low.levels[3],99);
    assert.equal(gravePoints(low),0);
    assert.equal(count(low,'magictraining_bones2'),0);
    assert.equal(count(low,'banana'),0);
    assert.equal(count(low,'magictraining_proghat_dull',worn)+count(low,'magictraining_proghat_energised',worn)+count(low,'magictraining_proghat_full',worn),1);

    const high=player({x:3363,z:9641,level:1});
    high.levels[3]=2;high.baseLevels[3]=99;
    run(high,'[proc,mta_graveyard_enter]');
    run(high,'[proc,mta_award]',[4,15]);
    R.tick(high,50);
    assert.equal(gravePoints(high),5);
  });

  console.log(`PASS mta enchantment/graveyard: ${checks.length} compiled activity checks`);
}

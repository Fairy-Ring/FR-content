import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

export default async function testTelekinetic(R) {
  const {assert,player,give,count,run,trigger,World,Packet,PlayerLoading,ScriptState,ScriptProvider,ServerTriggerType,id,obj}=R;
  const teleWallet=id('VarPlayerType','mta_telekinetic_points');
  const streakVarp=id('VarPlayerType','varp625_bits');
  const mazeSolved=id('VarBitType','magictraining_mazesolved');
  const statueType=obj('magictraining_guardianstatue');
  const guardianType=id('NpcType','magictraining_guard_maze');
  const grabComponent=id('Component','magic:telekinetic_grab');
  const grabScript=ScriptProvider.getByTrigger(ServerTriggerType.OPOBJT,grabComponent,-1);
  assert(grabScript,'compiled Telekinetic Grab object dispatch exists');
  const map=await R.load('engine/GameMap.ts');
  const {CoordGrid}=await R.load('engine/CoordGrid.ts');
  const directions=[
    {name:'east',dx:1,dz:0},
    {name:'north',dx:0,dz:1},
    {name:'west',dx:-1,dz:0},
    {name:'south',dx:0,dz:-1}
  ];
  const wallet=p=>p.getVar(teleWallet);
  const streak=p=>p.getVar(streakVarp)&7;
  let scenarios=0;

  function finish(p,state){
    for(let i=0;state.execution===ScriptState.SUSPENDED&&i<30;i++){
      World.currentTick=Math.max(World.currentTick+1,p.delayedUntil);
      p.delayed=false;
      p.executeScript(state,true,true);
    }
    assert.equal(state.execution,ScriptState.FINISHED,state.script.name);
    return state;
  }
  function intResult(p,name,args=[]){
    const state=finish(p,run(p,name,args));
    return state.intStack[state.isp-1];
  }
  function inMazeBounds(pos){
    return pos&&pos.x>=3328&&pos.x<=3391&&pos.z>=9664&&pos.z<=9727&&pos.level>=0&&pos.level<=2;
  }
  function coordResult(p,name,args=[]){
    const packed=intResult(p,name,args);
    const pos=CoordGrid.unpackCoord(packed);
    return inMazeBounds(pos)?pos:null;
  }
  function same(a,b){return a.x===b.x&&a.z===b.z&&a.level===b.level;}
  function key(pos){return `${pos.level}:${pos.x}:${pos.z}`;}
  // Original decorative mats mark player entries. Miniwall groups bound the actual interiors.
  const matType=id('LocType','magictraining_mini_mat'),wallType=id('LocType','magictraining_miniwall');
  const matTiles=new Set(),walls=[],locPacket=new Packet(World.gameMap.packed.get((52<<8)|151).l);
  let locType=-1,locDelta;
  while((locDelta=locPacket.gsmarts())!==0){
    locType+=locDelta;let coord=0,coordDelta;
    while((coordDelta=locPacket.gsmarts())!==0){
      coord+=coordDelta-1;locPacket.g1();
      const pos={x:3328+((coord>>6)&63),z:9664+(coord&63),level:coord>>12};
      if(locType===matType)matTiles.add(key(pos));
      if(locType===wallType)walls.push(pos);
    }
  }
  function playerPosition(p){return {x:p.x,z:p.z,level:p.level};}
  function setPlayerPosition(p,pos){p.x=pos.x;p.z=pos.z;p.level=pos.level;}
  function preparePlayer(){
    const p=player({x:3336,z:9718,level:0});
    give(p,'airrune',1000);
    give(p,'lawrune',1000);
    assert.equal(intResult(p,'[proc,mta_room]'),1,'player begins inside the Telekinetic Theatre');
    return p;
  }
  function startMaze(p,layout){
    assert.equal(intResult(p,'[proc,mta_telekinetic_start]',[layout]),1,`layout ${layout} starts inside its original maze`);
    assert.equal(intResult(p,'[proc,mta_telekinetic_layout]'),layout,'selected layout is held in the original temporary varp bits');
    assert.equal(p.getVarBit(mazeSolved),0,'a new maze clears only the solved flag');
    const start=coordResult(p,'[proc,mta_telekinetic_position]');
    assert(start,`layout ${layout} has a bounded starting statue`);
    const stand=coordResult(p,'[proc,mta_telekinetic_entry]',[layout]);
    assert(stand&&matTiles.has(key(stand)),`layout ${layout} uses an original exterior entry mat`);
    assert.deepEqual(playerPosition(p),stand,'entry places the player on its original exterior mat');
    const statue=World.getObjOfReceiver(start.x,start.z,start.level,statueType,p.hash64);
    assert(statue,`layout ${layout} has its real player-owned statue object`);
    return {start,stand};
  }
  const reachability=new Map();
  function reachable(from){
    const cacheKey=key(from);if(reachability.has(cacheKey))return reachability.get(cacheKey);
    const seen=new Set([cacheKey]),queue=[from];
    for(let at=0;at<queue.length;at++)for(const {dx,dz} of directions){
      const current=queue[at],next={x:current.x+dx,z:current.z+dz,level:from.level},nextKey=key(next);
      if(!inMazeBounds(next)||seen.has(nextKey)||!map.isLineOfWalk(from.level,current.x,current.z,next.x,next.z))continue;
      seen.add(nextKey);queue.push(next);
    }
    reachability.set(cacheKey,seen);return seen;
  }
  function canReach(from,to){return from.level===to.level&&reachable(from).has(key(to));}
  function slide(p,from,direction){
    let current=from;
    for(let step=0;step<64;step++){
      const next={x:current.x+direction.dx,z:current.z+direction.dz,level:from.level};
      if(!inMazeBounds(next)||map.isMapBlocked(next.x,next.z,next.level)||!map.isLineOfWalk(from.level,current.x,current.z,next.x,next.z))return current;
      current=next;
    }
    return current;
  }
  function deriveRoute(p,layout){
    const goal=coordResult(p,'[proc,mta_telekinetic_goal]',[layout]);
    const start=coordResult(p,'[proc,mta_telekinetic_position]');
    assert(goal&&start,`layout ${layout} has a bounded goal and start`);
    const group=walls.filter(pos=>pos.level===start.level&&(pos.x<3360)===(start.x<3360)&&(pos.z<9696)===(start.z<9696));
    const minX=Math.min(...group.map(pos=>pos.x)),maxX=Math.max(...group.map(pos=>pos.x)),minZ=Math.min(...group.map(pos=>pos.z)),maxZ=Math.max(...group.map(pos=>pos.z));
    assert.deepEqual([maxX-minX,maxZ-minZ],[11,11],'original miniwalls surround a ten-by-ten interior');
    for(const pos of [goal,start])assert(pos.x>minX&&pos.x<maxX&&pos.z>minZ&&pos.z<maxZ,'statue and goal stay inside the real maze');
    const firstStand=coordResult(p,'[proc,mta_telekinetic_entry]',[layout]);
    assert(firstStand&&same(playerPosition(p),firstStand),`layout ${layout} starts at its original exterior tile`);
    const outside=reachable(firstStand);
    const queue=[{statue:start,player:firstStand,standpoints:[],statuePath:[start],moves:[]}];
    const seen=new Set([`${key(start)}|${key(firstStand)}`]);
    for(let head=0;head<queue.length;head++){
      const current=queue[head];
      if(same(current.statue,goal))return {layout,start,goal,standpoints:current.standpoints,statuePath:current.statuePath,moves:current.moves};
      assert(head<30000,`layout ${layout} route search remains bounded`);
      for(const direction of directions){
        const next=slide(p,current.statue,direction);
        if(!next||same(current.statue,next))continue;
        const stand={x:direction.dx>0?maxX+1:direction.dx<0?minX-1:current.statue.x,z:direction.dz>0?maxZ+1:direction.dz<0?minZ-1:current.statue.z,level:start.level};
        if(!outside.has(key(stand)))continue;
        const nextKey=`${key(next)}|${key(stand)}`;
        if(seen.has(nextKey))continue;
        seen.add(nextKey);
        queue.push({
          statue:next,
          player:stand,
          standpoints:[...current.standpoints,stand],
          statuePath:[...current.statuePath,next],
          moves:[...current.moves,direction.name]
        });
      }
    }
    assert.fail(`layout ${layout} has no collision-derived route from ${JSON.stringify(start)} to ${JSON.stringify(goal)} using reachable exterior standpoints`);
  }
  function statueAt(p,pos){return World.getObjOfReceiver(pos.x,pos.z,pos.level,statueType,p.hash64);}
  function guardiansAt(pos){
    return [...World.gameMap.getZone(pos.x,pos.z,pos.level).getAllNpcsUnsafe()]
      .filter(npc=>npc.type===guardianType&&npc.x===pos.x&&npc.z===pos.z&&npc.level===pos.level);
  }
  function castFrom(p,stand){
    setPlayerPosition(p,stand);
    assert.equal(intResult(p,'[proc,mta_room]'),1,'every standpoint remains in the telekinetic room');
    const from=coordResult(p,'[proc,mta_telekinetic_position]');
    assert(from,'active maze keeps its original statue coordinate');
    const statue=statueAt(p,from);
    assert(statue,'Telekinetic Grab targets the actual current-player statue object');
    finish(p,run(p,grabScript,[],statue));
  }
  function playRoute(p,route,reward=2){
    const before=wallet(p);
    for(let i=0;i<route.moves.length;i++){
      const from=route.statuePath[i];
      const expected=route.statuePath[i+1];
      assert.deepEqual(coordResult(p,'[proc,mta_telekinetic_position]'),from,`layout ${route.layout} move ${i} starts at the expected statue tile`);
      const target=statueAt(p,from);
      assert(target,`layout ${route.layout} move ${i} has a live statue`);
      castFrom(p,route.standpoints[i]);
      if(same(expected,route.goal)){
        assert.equal(p.getVarBit(mazeSolved),1,'only the goal landing completes the maze');
        assert.equal(wallet(p),before+reward,'a completed maze awards its base points and any streak bonus');
        assert.equal(statueAt(p,from),null,'solving removes the player-owned statue');
        assert.equal(intResult(p,'[proc,mta_telekinetic_layout]'),route.layout,'a successful cast does not auto-advance the layout');
        return;
      }
      assert.deepEqual(coordResult(p,'[proc,mta_telekinetic_position]'),expected,`layout ${route.layout} move ${i} slides to the collision barrier`);
      assert.equal(wallet(p),before,'intermediate statue moves award no points');
      assert.equal(p.getVarBit(mazeSolved),0,'intermediate statue moves do not solve the maze');
    }
    assert.fail(`layout ${route.layout} route ended without reaching its goal`);
  }
  let guardianTalks=0;
  function talkToGuardian(p,goal){
    const guardians=guardiansAt(goal);
    assert.equal(guardians.length,1,`one global Maze Guardian stands at layout ${intResult(p,'[proc,mta_telekinetic_layout]')} goal`);
    const beforeWallet=wallet(p);
    finish(p,trigger(p,guardianTalks++%2===0?'APNPC1':'OPNPC1',guardians[0],'NpcType'));
    const next=intResult(p,'[proc,mta_telekinetic_layout]');
    assert(next>=0&&next<10,'talking to the Maze Guardian selects one of the ten layouts');
    assert.equal(p.getVarBit(mazeSolved),0,'the next maze begins unsolved');
    assert(coordResult(p,'[proc,mta_telekinetic_position]'),'the guardian starts a fresh statue');
    assert.equal(wallet(p),beforeWallet,'guardian transport preserves the wallet');
    return;
  }

  const nativeEntry=preparePlayer();
  finish(nativeEntry,run(nativeEntry,'[proc,mta_telekinetic_enter]'));
  const nativeLayout=intResult(nativeEntry,'[proc,mta_telekinetic_layout]');
  assert(nativeLayout>=0&&nativeLayout<10,'native room entry uses random(10) over all ten layouts');
  assert(statueAt(nativeEntry,coordResult(nativeEntry,'[proc,mta_telekinetic_position]')),'native entry creates the selected layout statue');
  finish(nativeEntry,run(nativeEntry,'[proc,mta_telekinetic_cleanup]'));
  scenarios++;

  const routes=[];
  for(let layout=0;layout<10;layout++){
    const p=preparePlayer();
    startMaze(p,layout);
    const route=deriveRoute(p,layout);
    assert(route.standpoints.length>0,`layout ${layout} needs at least one real Telekinetic Grab`);
    assert.equal(route.standpoints.length,route.moves.length,'each route move has one exterior player standpoint');
    let previousStand=playerPosition(p);
    for(let i=0;i<route.moves.length;i++){
      const from=route.statuePath[i],to=route.statuePath[i+1],stand=route.standpoints[i];
      const direction=directions.find(candidate=>candidate.name===route.moves[i]);
      assert(direction,`layout ${layout} move ${i} has a cardinal direction`);
      assert.equal(Math.sign(stand.x-from.x),direction.dx,`layout ${layout} move ${i} stands on the correct east/west side`);
      assert.equal(Math.sign(stand.z-from.z),direction.dz,`layout ${layout} move ${i} stands on the correct north/south side`);
      assert(canReach(previousStand,stand),`layout ${layout} move ${i} has a collision-reachable standpoint`);
      previousStand=stand;
    }
    playRoute(p,route);
    const guardians=guardiansAt(route.goal);
    assert.equal(guardians.length,1,`layout ${layout} completes into one global Maze Guardian`);
    routes.push(route);
    finish(p,run(p,'[proc,mta_telekinetic_cleanup]'));
    assert.equal(streak(p),1,'leaving the room cleanup does not erase the permanent maze streak');
    scenarios++;
  }

  const streakPlayer=preparePlayer();
  const completed=[];
  let routeForFifth=null;
  let ordinaryCastXpTenths;
  for(let maze=0;maze<5;maze++){
    if(maze===0)startMaze(streakPlayer,0);
    else if(maze===4){
      finish(streakPlayer,run(streakPlayer,'[proc,mta_leave]'));
      assert.equal(streak(streakPlayer),4,'leaving after four mazes preserves the saved streak');
      const restored=PlayerLoading.load(streakPlayer.username,new Packet(streakPlayer.save()),null);
      assert(restored,'saved player restores after logout');
      assert.equal(streak(restored),4,'logout preserves the permanent Telekinetic streak');
      setPlayerPosition(streakPlayer,{x:3336,z:9718,level:0});
      finish(streakPlayer,run(streakPlayer,'[proc,mta_telekinetic_enter]'));
      assert.equal(streak(streakPlayer),4,'re-entering starts a new maze without resetting the streak');
    }else{
      const previous=completed[maze-1];
      talkToGuardian(streakPlayer,previous.goal);
    }
    const layout=intResult(streakPlayer,'[proc,mta_telekinetic_layout]');
    const route=deriveRoute(streakPlayer,layout);
    if(maze===4)routeForFifth=route;
    const pointsBefore=wallet(streakPlayer);
    const magicBefore=streakPlayer.stats[6];
    const lawsBefore=count(streakPlayer,'lawrune');
    playRoute(streakPlayer,route,maze===4?10:2);
    completed.push(route);
    if(maze===0){ordinaryCastXpTenths=(streakPlayer.stats[6]-magicBefore)/route.moves.length;assert(Number.isInteger(ordinaryCastXpTenths)&&ordinaryCastXpTenths>0,'ordinary mazes supply the spell-XP control');}
    assert.equal(wallet(streakPlayer),pointsBefore+(maze===4?10:2),`maze ${maze+1} awards its base and fifth-maze bonus points`);
    assert.equal(streak(streakPlayer),maze===4?0:maze+1,`maze ${maze+1} updates the persistent streak`);
    if(maze===4){
      assert.equal(streakPlayer.stats[6]-magicBefore,10000+ordinaryCastXpTenths*route.moves.length,'the fifth maze adds exactly 1,000 Magic XP to its ordinary spell XP');
      assert.equal(count(streakPlayer,'lawrune'),lawsBefore-route.moves.length+10,'the fifth maze awards ten law runes after Telekinetic Grab costs');
    }
  }
  assert(routeForFifth,'fifth-maze route is available');
  scenarios++;

  const playerA=preparePlayer(),playerB=preparePlayer();
  const {start:startA}=startMaze(playerA,2);
  const {start:startB}=startMaze(playerB,2);
  assert.deepEqual(startA,startB,'players on the same layout use the same packed maze geometry');
  const routeA=deriveRoute(playerA,2),routeB=deriveRoute(playerB,2);
  playRoute(playerA,routeA);
  playRoute(playerB,routeB);
  assert.equal(guardiansAt(routeA.goal).length,1,'two completions share one global Maze Guardian');
  finish(playerA,run(playerA,'[proc,mta_leave]'));
  assert.equal(guardiansAt(routeA.goal).length,1,'one player leaving cannot delete another player’s global Guardian');
  talkToGuardian(playerB,routeB.goal);
  assert.equal(wallet(playerA),2);
  assert.equal(wallet(playerB),2);
  scenarios++;

  const output=process.env.MTA_ROUTES_OUTPUT;
  if(output){
    assert(path.isAbsolute(output),'MTA_ROUTES_OUTPUT must be an absolute evidence path');
    const contentHead=execFileSync('git',['-C',R.contentRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
    writeFileSync(output,`${JSON.stringify({contentHead,routes},null,2)}\n`,{flag:'wx'});
  }
  console.log(`RESULT PASS MTA telekinetic: ${scenarios} room scenarios; collision-derived routes for ${routes.length} layouts`);
}

export default async function testJailer(R) {
  const {
    assert, player, npc, id, obj, configs, World,
    ScriptProvider, ScriptRunner, ScriptState, ServerTriggerType, trigger
  } = R;
  const jailerId = id('NpcType', 'jailer');
  const jailerType = configs.NpcType.get(jailerId);
  const talk = ScriptProvider.getByTrigger(
    ServerTriggerType.OPNPC1, jailerId, jailerType.category
  );
  assert.equal(talk, undefined, 'the actual OPNPC1 dispatch has no Jailer Talk-to handler');

  const p = player({ x: 2933, z: 9693 });
  const jailer = npc('jailer', 2933, 9693);
  assert.throws(
    () => trigger(p, 'OPNPC1', jailer),
    /missing OPNPC1/,
    'the runtime dispatcher reports the unsupported Talk-to instead of inventing dialogue'
  );

  const death = ScriptProvider.getByTrigger(
    ServerTriggerType.AI_QUEUE3, jailerId, jailerType.category
  );
  assert.equal(death?.name, '[ai_queue3,jailer]', 'the real Jailer death trigger remains selected');

  const { NpcStat } = await R.load('engine/entity/NpcStat.ts');
  const attacker = id('VarNpcType', 'npc_aggressive_player');
  jailer.setVar(attacker, p.uid);
  jailer.heroPoints.addHero(p.hash64, 1);

  const state = ScriptRunner.init(death, jailer);
  assert.equal(state._activeNpc2, null, 'the death queue has no secondary NPC');
  const drops = [];
  const addObj = World.addObj;
  World.addObj = function (item, receiver, duration) {
    drops.push({
      id: item.type,
      count: item.count,
      duration,
      receiver: receiver?.toString() ?? null
    });
    return addObj.call(this, item, receiver, duration);
  };

  try {
    jailer.applyDamage(jailer.levels[NpcStat.HITPOINTS], 1);
    jailer.executeScript(state);
    for (let tick = 0; state.execution === ScriptState.NPC_SUSPENDED && tick < 20; tick++) {
      p.processQueues();
      World.currentTick = Math.max(World.currentTick + 1, jailer.delayedUntil);
      jailer.delayed = false;
      jailer.executeScript(state);
    }
    p.processQueues();
  } finally {
    World.addObj = addObj;
    if (World.players[p.slot] === p) {
      World.players[p.slot] = null;
      p.unlink();
    }
  }

  assert.equal(state.execution, ScriptState.FINISHED, 'the Jailer death handler completes');
  assert.equal(jailer.isActive, false, 'the native death procedure removes the Jailer');
  assert.deepEqual(
    drops.filter(drop => drop.id === obj('jail_key')).map(({ count, duration }) => ({ count, duration })),
    [{ count: 1, duration: 100 }],
    'the death handler still drops one jail key for 100 ticks'
  );
  console.log('PASS jailer: unsupported Talk-to stays silent; native death dispatch drops the jail key');
}

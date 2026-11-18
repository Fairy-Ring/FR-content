import assert from 'node:assert/strict';

// Independent 128-slot oracle for the labelled source tables, with later additions
// removed. Each row is [weight, original-cache item, minimum, optional maximum].
const tables = {
  melee: [
    [2,'vikinggloves',1],[2,'viking_top_darkbrown',1],[3,'viking_cloak_brown',1],
    [10,'steel_axe',1],[10,'mithril_javelin',3],[5,'steel_arrow',15],
    [3,'viking_shield',1],[3,'viking_helmet',1],[2,'viking_sword',1],
    [10,'waterrune',10],[10,'naturerune',1,10],[2,'bloodrune',1,10],[10,'lawrune',1,10],
    [4,'herb'],[1,'seed'],[4,'talisman'],[10,'dagganoth_hide',1],[10,'tinderbox',1],
    [5,'raw_lobster',1],[7,'smalloysterpearls',1],[2,'coins',3],[2,'coins',26],
    [2,'coins',38],[2,'coins',47],[2,'coins',81],[2,'keg_of_beer',1],[1,'gem'],[2,'helm']
  ],
  ranged: [
    [2,'vikinggloves',1],[2,'viking_top_darkbrown',1],[2,'viking_cloak_brown',1],
    [2,'mithril_javelin',1,3],[10,'steel_arrow',1,30],[2,'dagganoth_range_feet',1],
    [2,'dagganoth_range_gloves',1],[3,'viking_shield',1],[3,'viking_helmet',1],
    [3,'viking_sword',1],[8,'herb'],[1,'seed'],[5,'talisman'],[5,'casket',1],
    [5,'bigoysterpearls',1],[10,'opal_bolttips',1,20],[30,'seaweed',1,10],
    [8,'edible_seaweed',1,5],[5,'raw_bass',1],[10,'coins',1,140],
    [2,'dagganoth_range_head_part',1],[2,'dagganoth_range_body_part',1],
    [2,'dagganoth_range_leg_part',1],[2,'keg_of_beer',1],[1,'gem'],[1,'helm']
  ],
  magic: [
    [2,'dagganoth_mage_gloves',1],[2,'dagganoth_mage_feet',1],[10,'airrune',1,10],
    [10,'mindrune',1,10],[10,'waterrune',1,10],[10,'earthrune',1,10],[10,'chaosrune',1,10],
    [10,'deathrune',1,10],[10,'bloodrune',1,5],[10,'steel_arrow',1,10],[10,'herb'],
    [1,'seed'],[8,'talisman'],[10,'cert_blankrune_high',9],[2,'dagganoth_mage_leg_part',1],
    [2,'dagganoth_mage_body_part',1],[2,'dagganoth_mage_head_part',1],
    [2,'raw_herring',1,2],[3,'raw_mackerel',1,2],[2,'raw_tuna',1,2],[1,'gem'],[1,'empty']
  ]
};
const seeds = [[216,'toadflax_seed'],[148,'irit_seed'],[143,'belladonna_seed'],
  [103,'poisonivy_bush_seed'],[101,'avantoe_seed'],[96,'cactus_seed'],[69,'kwuarm_seed'],
  [46,'snapdragon_seed'],[32,'cadantine_seed'],[23,'lantadyme_seed'],[14,'dwarf_weed_seed'],[9,'torstol_seed']];
const talismans = [[10,'air_talisman'],[10,'body_talisman'],[10,'earth_talisman'],
  [10,'fire_talisman'],[10,'mind_talisman'],[10,'water_talisman'],[4,'cosmic_talisman'],[3,'chaos_talisman'],[3,'nature_talisman']];
const expand = rows => rows.flatMap(([weight, ...row]) => Array.from({ length: weight }, () => row));

export function assertLootTables(runLoot, objectId) {
  let assertions = 0;
  const pair = (name, quantity) => [name === null ? -1 : objectId(name), quantity];
  function expected([name, low, high], upper) {
    switch (name) {
      case 'herb': return pair(upper ? 'unidentified_dwarf_weed' : 'unidentified_guam', 1);
      case 'seed': return pair(upper ? 'torstol_seed' : 'toadflax_seed', 1);
      case 'talisman': return pair(upper ? 'nature_talisman' : 'air_talisman', 1);
      case 'gem': return upper ? [-1, 0] : pair('uncut_sapphire', 1);
      case 'helm': return upper ? [-1, 0] : pair('viking_helmet_crush', 1);
      case 'empty': return [-1, 0];
      default: return pair(name, upper ? high ?? low : low);
    }
  }
  for (const [family, table] of Object.entries(tables)) {
    const slots = expand(table);
    assert.equal(slots.length, 128, `${family}: 128 primary slots`);
    for (let roll = 0; roll < slots.length; roll++) {
      for (const upper of [false, true]) {
        assert.deepEqual(runLoot(`wbmon_${family}_loot`, [(roll + 0.5) / 128, upper ? 0.999999 : 0]),
          expected(slots[roll], upper), `${family}: slot ${roll}, upper=${upper}`);
        assertions++;
      }
    }
  }
  for (const [name, table, denominator] of [['wbmon_rare_seed', seeds, 1000], ['wbmon_talisman', talismans, 70]]) {
    const slots = expand(table);
    assert.equal(slots.length, denominator, `${name}: denominator`);
    for (let roll = 0; roll < slots.length; roll++) {
      assert.deepEqual(runLoot(name, [(roll + 0.5) / slots.length]), pair(slots[roll][0], 1), `${name}: slot ${roll}`);
      assertions++;
    }
  }
  const helms = ['viking_helmet_crush','viking_helmet_range','viking_helmet_magic','viking_helmet_slash'];
  for (const size of [16, 32]) {
    for (let roll = 0; roll < size; roll++) {
      assert.deepEqual(runLoot('wbmon_rare_helm', [(roll + 0.5) / size], [size]),
        roll < 4 ? pair(helms[roll], 1) : [-1, 0], `helm ${size}: slot ${roll}`);
      assertions++;
    }
  }
  assert.deepEqual(runLoot('wbmon_gem', [62.5 / 128]), pair('nature_talisman', 1), 'Waterbirth underground gem-table variant');
  return assertions + 1;
}

import assert from 'node:assert/strict';
import fs from 'node:fs';

// Independent item/quantity oracle: Rex Tip.It 27 April 2006; Prime/Supreme
// their own 27 June 2006 pages. No modern table supplies membership or quantities.
// Unstated singletons use the declared UNKNOWN quantity 1. Rex steel-bar and
// Prime essence certificates are CANDIDATE notation from their exact later King.
// UNKNOWN weights are not duplicated here: reading only each total lets this
// exercise every integer main-roll slot without treating any rarity as authentic.
const weights = fs.readFileSync(new URL('../../scripts/areas/area_waterbirth/configs/waterbirth_kings_loot.constant', import.meta.url), 'utf8');
const gems = ['uncut_sapphire', 'uncut_emerald', 'uncut_ruby', 'uncut_diamond'];
const halves = ['keyhalf1', 'keyhalf2'];
const herbSeeds = ['toadflax_seed', 'irit_seed', 'avantoe_seed', 'kwuarm_seed', 'snapdragon_seed', 'cadantine_seed', 'lantadyme_seed', 'dwarf_weed_seed', 'torstol_seed'];
const range = (min, max) => ({ min, max });

function expectedTable(king, objectId) {
  const expected = new Map();
  const add = (names, quantities = [1], group = null) => {
    for (const name of names.split(' ')) {
      const id = objectId(name);
      assert(!expected.has(id), `${king}: duplicate oracle object ${name}`);
      expected.set(id, { name, quantities, group: group ?? name });
    }
  };
  if (king === 'rex') {
    add('dragon_axe mud_battlestaff dragon_spear mithril_axe mithril_pickaxe mithril_warhammer adamant_axe rune_axe viking_sword daganoth_cave_magic_shortbow dragon_med_helm dagganoth_melee_legs dagganoth_melee_body adamant_platebody steel_kiteshield steel_platebody viking_helmet viking_shield unidentified_ranarr adamantite_bar 2dosepotionofzamorak 2doseprayerrestore 2dose2attack 2dose2defense 2dose1antidragon 2dose2strength warrior_ring berzerker_ring dragonshield_a');
    add('rune_javelin bass swordfish shark', [5]);
    add('steel_arrow', [93]);
    add('naturerune', [67]);
    add('cert_mithril_ore', [25]);
    add('cert_coal', [100]);
    add('cert_iron_ore', [150]);
    add('cert_steel_bar', [16]);
    add('willow_logs', [17]);
    add('cert_maple_logs', [59]);
    add('cert_yew_logs', [101]);
    add('coins', range(300, 7000));
  } else if (king === 'prime') {
    add('dragon_axe mud_battlestaff staff_of_air staff_of_earth water_battlestaff air_battlestaff earth_battlestaff dragon_spear daganoth_cave_magic_shortbow steel_kiteshield dagganoth_mage_body dagganoth_mage_legs rune_kiteshield dragon_med_helm unidentified_ranarr bigoysterpearls dragonshield_a seer_ring');
    add('cert_battlestaff', [9, 10]);
    add('airrune', [155]);
    add('earthrune naturerune', [67]);
    add('deathrune', [60, 77]);
    add('bloodrune', [97]);
    add('mudrune', [32]);
    add('cert_blankrune_high', [134, 188, 194]);
    add('cert_air_talisman', [29, 36, 38, 53, 54, 58, 66]);
    add('cert_earth_talisman', [46, 48, 68, 74]);
    add('cert_water_talisman', [12, 50]);
    add('shark', [5]);
    add('coins', [976, 1000]);
    add(herbSeeds.join(' '), [1], 'herb-seeds');
  } else {
    assert.equal(king, 'supreme');
    add('dragon_axe daganoth_cave_magic_shortbow rune_2h_sword rune_battleaxe viking_sword red_dragon_vambraces dagganoth_ranged_body dagganoth_ranged_legs dragon_med_helm viking_shield unidentified_ranarr ranger_ring nature_talisman ring_of_life bigoysterpearls dragonshield_a');
    add('iron_knife', [259, 275, 284, 343, 359, 492]);
    add('steel_knife', [141, 144, 145]);
    add('mithril_knife', [27, 34, 38, 48]);
    add('rune_thrownaxe', range(7, 9));
    add('rune_javelin shark', [5]);
    add('lawrune', [514]);
    add('iron_arrow', [417, 502]);
    add('steel_arrow', [123, 215, 221, 240]);
    add('adamant_dart', [11, 14, 18]);
    add('cert_yew_logs', [75, 77, 122]);
    add('cert_maple_logs', range(15, 25));
    add('opal_bolttips', [18]);
    add('coins', [972, 1040, 1172, 3000]);
  }
  add(gems.join(' '), [1], 'uncut-gems');
  add(halves.join(' '), [1], 'key-halves');
  return expected;
}

export function assertKingLootTables(runLoot, objectId) {
  for (const king of ['rex', 'prime', 'supreme']) {
    const expected = expectedTable(king, objectId);
    const totalMatch = weights.match(new RegExp(`^\\^wbk_${king}_loot_total_weight\\s*=\\s*(\\d+)$`, 'm'));
    assert(totalMatch, `${king}: complete named UNKNOWN weight total exists`);
    const total = Number(totalMatch[1]);
    const seen = new Map();
    const primaryByGroup = new Map();
    let clueSeen = false;
    const check = (slot, secondary) => {
      const tuple = runLoot(`waterbirth_${king}_loot`, [(slot + 0.5) / total, secondary]);
      assert.equal(tuple.length, 2, `${king}: selector returns only one object/quantity pair`);
      const [item, quantity] = tuple;
      if (item === -1 && quantity === -1) {
        clueSeen = true;
        primaryByGroup.set('hard-clue', slot);
        return;
      }
      const row = expected.get(item);
      assert(row, `${king}: object ${item} is outside this King's retained source list`);
      assert(Number.isInteger(quantity) && quantity > 0, `${king}/${row.name}: positive integer quantity`);
      if (Array.isArray(row.quantities)) {
        assert(row.quantities.includes(quantity), `${king}/${row.name}: ${quantity} is not a stated quantity or UNKNOWN singleton`);
      } else {
        assert(quantity >= row.quantities.min && quantity <= row.quantities.max, `${king}/${row.name}: ${quantity} is outside the stated interval`);
      }
      if (!seen.has(item)) seen.set(item, new Set());
      seen.get(item).add(quantity);
      if (!primaryByGroup.has(row.group)) primaryByGroup.set(row.group, slot);
    };
    // Every possible main-roll integer is checked; conditional categories are
    // then swept independently at a witnessed main slot, not as extra rolls.
    for (let slot = 0; slot < total; slot++) {
      check(slot, 0);
      check(slot, 0.999999);
    }
    for (const slot of primaryByGroup.values()) {
      for (let inner = 0; inner < 128; inner++) check(slot, inner / 128);
      check(slot, 0.999999);
    }
    assert(clueSeen, `${king}: the one main table contains the hard-clue sentinel`);
    assert.equal(seen.size, expected.size, `${king}: every retained source item/category member is reachable`);
    for (const [item, row] of expected) {
      const quantities = seen.get(item);
      assert(quantities, `${king}: missing retained source item ${row.name}`);
      if (Array.isArray(row.quantities)) {
        assert.deepEqual([...quantities].sort((a, b) => a - b), [...row.quantities].sort((a, b) => a - b), `${king}/${row.name}: every stated quantity remains reachable`);
      } else {
        assert(quantities.has(row.quantities.min) && quantities.has(row.quantities.max), `${king}/${row.name}: both stated interval bounds are reachable`);
        if (row.quantities.max - row.quantities.min < 128) {
          assert.equal(quantities.size, row.quantities.max - row.quantities.min + 1, `${king}/${row.name}: every short-interval quantity is reachable`);
        }
      }
    }
  }
}

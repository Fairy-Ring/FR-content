import fs from 'node:fs';
import path from 'node:path';

// Triage, not historical verification. Never turn these family inferences into gates.
function expectation(name) {
  if (/^cert_|^mm_helper$|^newbieshrimp$|^crystalshard_dagger$/.test(name)) {
    return ['NOT_EXPECTED', 'Cache dummy/placeholder; no player equipment requirement is inferred.'];
  }
  if (/^slayer_broad_arrows_/.test(name)) {
    return ['EXPECTED', 'Sibling slayer_broad_arrows is gated in tier50.'];
  }
  if (/^barrows_.*_100$/.test(name)) {
    return ['EXPECTED', 'Undegraded siblings in tier70 have equipment requirements.'];
  }
  if (/^roving_crystal_(bow|shield)_/.test(name)) {
    return ['EXPECTED', 'Same crystal equipment family as the tier70 crystal gates; charge/quest details need research.'];
  }
  if (/^(black_dart|black_spear|tbwt_black_spear)/.test(name)) {
    return ['EXPECTED', 'Black weapon siblings use tier10 requirements.'];
  }
  if (/^(bronze|iron|steel|black|mithril|adamant|rune|white)_armoured_boots$/.test(name)) {
    return ['EXPECTED', 'Metal armour siblings are tiered; exact boot requirements need research.'];
  }
  if (/^(white_|black_heraldic_kiteshield)/.test(name)) {
    return ['EXPECTED', 'Metal equipment family has published black/tier10 counterparts; white-item quest details need research.'];
  }
  if (/^(studded_(body|chaps)_trim|((blue_)?dragonhide_(body|chaps)_trim))/.test(name)) {
    return ['EXPECTED', 'Plain studded/dragonhide siblings have published equipment gates.'];
  }
  if (/^(mud_battlestaff|mystic_mud_staff|magictraining_.*wand|magictraining_wand_|magictraining_(adamant|rune)_|dragon_2h_sword|granite_legs)$/.test(name)) {
    return ['EXPECTED', 'Same staff/metal/granite family as gated equipment; exact requirements need research.'];
  }
  if (/^magictraining_wand_/.test(name)) {
    return ['EXPECTED', 'Magic weapon family; exact wand requirements need research.'];
  }
  if (/^(dagganoth_(melee|ranged|mage|range)_|broodoo_.*shield|tzhaar_(throwingring|staff)|daganoth_cave_magic_shortbow|burgh_rod_command_final_)/.test(name)) {
    return ['EXPECTED', 'Combat equipment with gated armour/ranged/staff counterparts; exact combined requirements need research.'];
  }
  if (/arrow|^zogre_brutal_|^barrows_karil_ammo$|(^|_)bolt/.test(name)) {
    return ['NOT_EXPECTED', 'Ordinary ammunition family: weapon requirements, not ammunition Wear gates (broad-arrow exceptions handled above).'];
  }
  if (/^((gnome|wolfen|viking)_(cloak|boots|robetop|robebottom|hat|top|gloves)|wilderness_cape_|flowers_|cbhat\d|snelm_|ham_|dwarf_(jumper|shirt|trousers|shorts|skirt)|tbw_villager_|roguetrader_(fez|carpetsller|menaphite)|win05_|pirate_(torso|bandan|legs|boots)|strawboater_|hundred_pirate_)/.test(name)) {
    return ['NOT_EXPECTED', 'Cosmetic/quest clothing family has no gated sibling implying a level requirement; not a period-proof claim.'];
  }
  if (/^(ring_of_|.*(necklace|amulet)|.*partyhat|halloweenmask_|.*_cape$|.*_apron$|berret_|cavalier_|headband_|blue_skirt|bluewizhat|wizards_robe|gold_ring|sapphire_ring|emerald_ring|ruby_ring|diamond_ring|dragonstone_ring|onyx_ring|bunnyears|santa_hat|rubber_chicken|tiara$)/.test(name)) {
    return ['NOT_EXPECTED', 'Jewellery/cosmetic family has no gated sibling implying a level requirement; acquisition conditions are distinct.'];
  }
  return ['UNKNOWN', 'No gated sibling establishes a requirement in this bounded triage; item-specific research is still needed.'];
}

export function ungatedWearReport(contentRoot, ObjType, ScriptProvider, ServerTriggerType) {
  const raw = fs.readFileSync(path.join(contentRoot, 'scripts/_unpack/377/all.obj'), 'utf8');
  const rows = [];
  // The current category handlers are mm_greegree (location) and runecraft_tiaras
  // (no-talisman state). Neither imposes a level or quest equipment requirement.
  for (const match of raw.matchAll(/^\[([^\]]+)\]\n([\s\S]*?)(?=^\[|$\s*(?![\s\S]))/gm)) {
    const [, name, body] = match;
    if (!/^iop\d+=(Wear|Wield)$/mi.test(body)) continue;
    const type = ObjType.getByName(name);
    if (!type) {
      rows.push({ name, id: null, displayName: body.match(/^name=(.*)$/m)?.[1] ?? null, expectation: 'UNKNOWN', basis: 'Raw 377 option exists but this debug name has no packed object identity.' });
      continue;
    }
    if (ScriptProvider.getByTriggerSpecific(ServerTriggerType.OPHELD2, type.id, -1)) continue;
    const categoryHandler = ScriptProvider.getByTriggerSpecific(ServerTriggerType.OPHELD2, -1, type.category);
    const [expected, basis] = expectation(name);
    rows.push({ name, id: type.id, displayName: type.name, expectation: expected, basis, categoryHandler: categoryHandler?.name ?? null });
  }
  return { kind: 'REPORT_ONLY', scope: 'Every raw revision-377 Wear/Wield option without a packed item-specific opheld2; no current category handler applies a level/quest requirement.', count: rows.length, rows };
}

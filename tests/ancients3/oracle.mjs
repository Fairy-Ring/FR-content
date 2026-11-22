// Cache-derived picker button numbers are kept separate from runtime handlers.
// Spell rows reuse the independent U1/U2 level, rune, XP and effect vectors.
import { spells as singleTargetSpells } from '../ancients1/oracle.mjs';
import { areaSpells } from '../ancients2/oracle.mjs';

export const ancientSpells = [...singleTargetSpells, ...areaSpells];

// Revision-377 questscroll_itgronigen IF_BUTTON widgets, read from the cache .if.
export const pickerButtons = [
  { widget: 7, spell: 'ice_rush' },
  { widget: 18, spell: 'ice_blitz' },
  { widget: 29, spell: 'ice_burst' },
  { widget: 40, spell: 'ice_barrage' },
  { widget: 51, spell: 'blood_rush' },
  { widget: 62, spell: 'blood_blitz' },
  { widget: 71, spell: 'blood_burst' },
  { widget: 82, spell: 'blood_barrage' },
  { widget: 93, spell: 'smoke_rush' },
  { widget: 106, spell: 'smoke_blitz' },
  { widget: 119, spell: 'smoke_burst' },
  { widget: 132, spell: 'smoke_barrage' },
  { widget: 145, spell: 'shadow_rush' },
  { widget: 158, spell: 'shadow_blitz' },
  { widget: 171, spell: 'shadow_burst' },
  { widget: 184, spell: 'shadow_barrage' },
];

// Named-source selector values used only to seed the compiled player fixture.
export const book = { standard: 0, ancient: 1 };
export const desertTreasure = { incomplete: 0, complete: 15 };
export const autoRetaliateOff = 1; // player_controls.constant; isolate the autocast loop.
export const standardProbe = { component: 'staff_spells:ssb0', spell: 'wind_strike' };
// The original 377 client row and separately sourced combat overlay.
export const zarosStaffClient = {
  name: 'Ancient staff',
  desc: 'A magical staff of ancient origin...',
  members: true,
  model: 'obj_staff_of_zaros',
  xof2d: -5,
  yof2d: 2,
  zoom2d: 1490,
  yan2d: 1400,
  xan2d: 148,
  wield: 'Wield',
  manwear: 'obj_staff_of_zaros_manwear',
  manwearOffset: 0,
  womanwear: 'obj_staff_of_zaros_manwear',
  womanwearOffset: 6,
  cost: 100000,
  wearpos: 'righthand',
  weightLb: 5,
};
export const zarosStaffCombat = {
  category: 'weapon_staff',
  params: {
    stabattack: 10,
    slashattack: -1,
    crushattack: 40,
    magicattack: 15,
    rangeattack: 0,
    stabdefence: 2,
    slashdefence: 3,
    crushdefence: 1,
    magicdefence: 15,
    rangedefence: 0,
    strengthbonus: 50,
    prayerbonus: -1,
  },
};

// CANDIDATE nearest tick count to Zybez's rounded 2.5 seconds; UNKNOWN sound row.
export const zarosStaffMelee = { ticks: 4, sound: 'staff_hit' };


// Observatory's completion message and reward model are the existing 377 quest
// queue inputs and cache model, not generated pack identifiers.
export const observatoryReward = {
  message: 'You have completed the Observatory Quest.',
  questPoints: 2,
  model: 1174,
};
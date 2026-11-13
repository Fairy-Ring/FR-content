#!/usr/bin/env python3
"""Offline source contract checks for the Desert Treasure S5 Ice slice."""

from __future__ import annotations

import os
from pathlib import Path
import re

ROOT = Path(os.environ.get("DT_S5_CONTENT_ROOT", Path(__file__).resolve().parents[2])).resolve()
QUEST = ROOT / "scripts/quests/quest_deserttreasure"
SCRIPTS = QUEST / "scripts"
CONFIGS = QUEST / "configs"
UNPACK = ROOT / "scripts/_unpack/377"
failures: list[str] = []


def require(ok: bool, message: str) -> None:
    if not ok:
        failures.append(message)


def text(path: Path) -> str:
    if not path.is_file():
        failures.append(f"missing S5 file: {path.relative_to(ROOT)}")
        return ""
    return path.read_text(encoding="utf-8")


def without_comments(source: str) -> str:
    return re.sub(r"//[^\n]*", "", source)


def block(source: str, kind: str, name: str) -> str:
    active = without_comments(source)
    header = f"[{kind},{name}]"
    if active.count(header) != 1:
        failures.append(f"expected one {header}, found {active.count(header)}")
        return ""
    return active.split(header, 1)[1].split("\n[", 1)[0]


def config_sections(source: str) -> dict[str, dict[str, list[str]]]:
    sections: dict[str, dict[str, list[str]]] = {}
    current: str | None = None
    for raw_line in source.splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("//", "#")):
            continue
        match = re.fullmatch(r"\[([^\]]+)\]", line)
        if match:
            current = match.group(1)
            if current in sections:
                require(False, f"duplicate configuration section [{current}]")
            else:
                sections[current] = {}
        elif current is not None and "=" in line:
            key, value = line.split("=", 1)
            sections[current].setdefault(key.strip(), []).append(value.strip())
    return sections


def check_script_definitions(sources: dict[str, str]) -> None:
    all_sources = "\n".join(sources.values())
    active = without_comments(all_sources)
    headers = re.findall(r"(?m)^\s*\[([^,\]]+),([^\]]+)\]", active)
    target_names = {
        "dt_ice_child_crying", "dt_ice_give_diamond", "dt_ice_family_reward",
        "dt_ice_cold_area", "dt_ice_enter_zone", "dt_ice_cold", "dt_ice_cold_damage",
        "dt_ice_slip", "dt_kamil_attackable", "dt_kamil_spawn", "dt_kamil_attack",
        "dt_kamil_freeze", "dt_kamil_defeated", "dt_ice_smash", "dt_ice_block_broken",
        "dt_ice_parent_talk", "dt_ice_gate", "dt_ice_enter_cave", "dt_ice_upper_gate",
        "dt_ice_troll_death", "dt_ice_journal",
    }
    for kind, name in headers:
        if name in target_names:
            require(sum(1 for k, n in headers if k == kind and n == name) == 1,
                    f"duplicate S5 section [{kind},{name}]")

    trigger_names = {
        "fourdiamonds_troll_child", "icediamond_icewarrior",
        "trollrescue_icetroll_melee1", "trollrescue_icetroll_melee2",
        "trollrescue_icetroll_melee3", "trollrescue_icetroll_melee4",
        "trollrescue_icetroll_melee5", "trollrescue_icetroll_melee6",
        "trollrescue_icetroll_melee7", "troll_block_1", "fd_trollblock1",
        "troll_block_2", "fd_trollblock2", "icegate_left", "icegate_right",
        "trollrescue_troll_cave_entrance", "trollrescue_troll_cave_entrance_multi",
        "trollrescue_troll_cave_entrance1", "trollrescue_troll_cave_entrance2",
        "trollrescue_troll_cave_entrance3", "trollrescue_troll_cave_entrance4",
        "trollrescue_troll_cave_entrance5", "trollrescue_troll_cave_exit",
        "trollrescue_blankmodel", "trollrescue_blankmodel2",
    }
    for name in trigger_names:
        matching_kinds = [kind for kind, section_name in headers if section_name == name]
        require(bool(matching_kinds) and len(matching_kinds) == len(set(matching_kinds)),
                f"S5 entity {name} must have handlers without duplicate trigger definitions")

    host_path = re.compile(r"(?:/(?:Volumes|Users|home)/|/private/var/|[A-Za-z]:\\(?:Users|Windows)\\)", re.I)
    for filename, source in sources.items():
        require(host_path.search(source) is None, f"host path leaked into {filename}")
    existing_ice_bits = {
        "fd_trollchild_intro", "fd_icewarrior_dead", "fd_icewarrior_trollskilled",
        "fd_icewarrior_bootshint", "fd_icewarrior_dadfree", "fd_icewarrior_mumfree",
        "fd_icewarrior_subquest", "fd_column_ice",
    }
    for filename, source in sources.items():
        if filename.startswith("dt_ice_") and filename.endswith(".rs2"):
            used_bits = set(re.findall(r"%([A-Za-z0-9_]+)", without_comments(source)))
            unknown_bits = {name for name in used_bits if name.startswith("fd_")} - existing_ice_bits
            require(not unknown_bits, f"{filename} uses only original Ice varbits; unexpected {sorted(unknown_bits)}")


def check_state_scope(constants: str, varp: str, varbit: str, varp_pack: str) -> None:
    values = dict((name, int(value)) for name, value in re.findall(r"(?m)^\s*\^([A-Za-z0-9_]+)\s*=\s*(-?\d+)\s*$", constants))
    expected_states = {
        "dt_ice_substate_crying": 0, "dt_ice_substate_agreed": 1,
        "dt_ice_substate_kamil_dead": 2, "dt_ice_substate_parents_freed": 3,
        "dt_ice_substate_family_returned": 4, "dt_ice_substate_awarded": 5,
        "dt_ice_trolls_required": 5,
    }
    for name, expected in expected_states.items():
        require(values.get(name) == expected, f"^{name} must equal {expected}")
    require(all(re.findall(r"(?m)^\s*\^([A-Za-z0-9_]+)\s*=", constants).count(name) == 1 for name in expected_states),
            "Ice state/count constants must each have one definition")

    varp_sections = config_sections(varp)
    expected_varps = {"deserttreasuremain": 440, "deserttreasurevarbit": 441, "deserttreasurevarbit2": 442}
    mappings = {int(number): name for number, name in re.findall(r"(?m)^\s*(\d+)=([A-Za-z0-9_]+)\s*$", varp_pack)}
    for name, number in expected_varps.items():
        require(name in varp_sections, f"original varp [{name}] remains present")
        require(mappings.get(number) == name, f"varp {number} remains [{name}]")
        require(varp_sections.get(name, {}).get("scope") == ["perm"], f"[{name}] remains permanent")
    require(not re.search(r"(?m)^\s*\[varp\d+\]", varp), "no added numbered varp configuration")

    expected_bits = {
        "fd_trollchild_intro": ("deserttreasurevarbit", 0, 0),
        "fd_icewarrior_dead": ("deserttreasurevarbit2", 10, 10),
        "fd_icewarrior_trollskilled": ("deserttreasurevarbit2", 11, 15),
        "fd_icewarrior_bootshint": ("deserttreasurevarbit2", 16, 16),
        "fd_icewarrior_dadfree": ("deserttreasurevarbit2", 17, 17),
        "fd_icewarrior_mumfree": ("deserttreasurevarbit2", 18, 18),
        "fd_icewarrior_subquest": ("deserttreasurevarbit2", 19, 23),
        "fd_column_ice": ("deserttreasuremain", 17, 17),
    }
    bit_sections = config_sections(varbit)
    for name, (basevar, start, end) in expected_bits.items():
        section = bit_sections.get(name, {})
        actual = (section.get("basevar", [None])[0], section.get("startbit", [None])[0], section.get("endbit", [None])[0])
        require(actual == (basevar, str(start), str(end)), f"original varbit [{name}] layout must be {(basevar, start, end)}")


def main() -> int:
    paths = {
        "dt_ice_child.rs2": SCRIPTS / "dt_ice_child.rs2",
        "dt_ice_cold.rs2": SCRIPTS / "dt_ice_cold.rs2",
        "dt_ice_kamil.rs2": SCRIPTS / "dt_ice_kamil.rs2",
        "dt_ice_parents.rs2": SCRIPTS / "dt_ice_parents.rs2",
        "dt_ice_route.rs2": SCRIPTS / "dt_ice_route.rs2",
        "dt_ice_trolls.rs2": SCRIPTS / "dt_ice_trolls.rs2",
        "dt_ice_journal.rs2": SCRIPTS / "dt_ice_journal.rs2",
        "dt_journal.rs2": SCRIPTS / "dt_journal.rs2",
        "quest_deserttreasure.constant": CONFIGS / "quest_deserttreasure.constant",
        "dt_ice.constant": CONFIGS / "dt_ice.constant",
        "npc_combat.rs2": ROOT / "scripts/skill_combat/scripts/npc/npc_combat.rs2",
    }
    sources = {name: text(path) for name, path in paths.items()}
    child = sources["dt_ice_child.rs2"]
    cold = sources["dt_ice_cold.rs2"]
    kamil = sources["dt_ice_kamil.rs2"]
    parents = sources["dt_ice_parents.rs2"]
    route = sources["dt_ice_route.rs2"]
    trolls = sources["dt_ice_trolls.rs2"]
    journal = sources["dt_ice_journal.rs2"]
    constants = sources["quest_deserttreasure.constant"]
    timing = sources["dt_ice.constant"]

    check_script_definitions(sources)
    check_state_scope(
        constants,
        text(UNPACK / "all.varp"),
        text(UNPACK / "all.varbit"),
        text(ROOT / "pack/varp.pack"),
    )

    offer = block(child, "opnpcu", "fourdiamonds_troll_child")
    require("%fd_icewarrior_subquest ! ^dt_ice_substate_crying" in offer, "sweet offer is limited to the crying substate")
    valid_foods = "cake, partial_cake, cake_slice, chocolate_cake, partial_chocolate_cake, chocolate_slice, chocolate_bar"
    require(valid_foods in offer, "offer accepts the sourced cake/chocolate portions only")
    require("def_obj $sweet = last_useitem;" in offer and offer.count("inv_del(inv, $sweet, 1)") == 1 and offer.index("inv_total(inv, $sweet) = 0") < offer.index("inv_del(inv, $sweet, 1)"),
            "valid sweet food is captured before dialogue and consumed exactly once after inventory confirmation")
    require(offer.index("inv_del(inv, $sweet, 1)") < offer.index("%fd_trollchild_intro = 1"), "intro flag follows the one-time food consume")
    choice = block(child, "opnpc1", "fourdiamonds_troll_child")
    require(choice.count("%fd_icewarrior_subquest = ^dt_ice_substate_agreed") == 1 and "if ($choice = 1)" in choice and "} else {" in choice,
            "only acceptance advances the child to agreed; decline leaves substate unchanged")
    require("%fd_icewarrior_subquest = ^dt_ice_substate_family_returned" in choice,
            "returned-family state enters award handling without bypassing the child")

    death = block(trolls, "proc", "dt_ice_troll_death")
    require("gosub(npc_default_death)" in death and "npc_findhero = ^false" in death, "native troll death handler credits only the native combat hero")
    require("%fd_icewarrior_subquest ! ^dt_ice_substate_agreed" in death and "%deserttreasure < ^dt_stage_hunts" in death,
            "troll kills require S5 hunt stage and an agreed child")
    require("inzone(0_44_58_23_0, 0_44_58_55_45, $killed_at) = false" in death, "kill credit is restricted to the Ice troll valley")
    credit = block(trolls, "queue", "dt_ice_troll_credit")
    require("queue(dt_ice_troll_credit, 0, 0)" in death and "min(^dt_ice_trolls_required, add(%fd_icewarrior_trollskilled, 1))" in credit,
            "native hero queues protected troll credit and saturates the count at five")
    troll_hooks = re.findall(r"(?m)^\[ai_queue3,(trollrescue_icetroll_melee\d+)\]", without_comments(trolls))
    require(troll_hooks == [f"trollrescue_icetroll_melee{i}" for i in range(1, 8)], "all seven native Ice trolls have one death hook")

    locs = config_sections(text(UNPACK / "all.loc"))
    cave = locs.get("trollrescue_troll_cave_entrance", {})
    require(cave.get("multivar") == ["fd_icewarrior_trollskilled"], "original cave multi-location follows the original troll count varbit")
    branches = [f"{i},{name}" for i, name in enumerate(("trollrescue_troll_cave_entrance5", "trollrescue_troll_cave_entrance4", "trollrescue_troll_cave_entrance3", "trollrescue_troll_cave_entrance2", "trollrescue_troll_cave_entrance1", "trollrescue_troll_cave_entrance_multi", "trollrescue_troll_cave_entrance_multi", "trollrescue_troll_cave_entrance_multi", "trollrescue_troll_cave_entrance_multi", "trollrescue_troll_cave_entrance_multi"))]
    require(cave.get("multiloc") == branches, "original 377 cave branches 6440/0-9 retain the five-icicle count mapping")
    for name in (
        "icegate_left", "icegate_right", "icegate_left_small", "icegate_right_small",
        "trollrescue_troll_cave_entrance", "trollrescue_troll_cave_entrance_multi",
        "trollrescue_troll_cave_entrance1", "trollrescue_troll_cave_entrance2",
        "trollrescue_troll_cave_entrance3", "trollrescue_troll_cave_entrance4",
        "trollrescue_troll_cave_entrance5", "trollrescue_troll_cave_exit",
        "trollrescue_blankmodel", "trollrescue_blankmodel2",
    ):
        require(name in locs, f"original 377 Ice location [{name}] remains defined")
    enter = block(route, "proc", "dt_ice_enter_cave")
    require("%fd_icewarrior_trollskilled < ^dt_ice_trolls_required" in enter, "cave remains blocked until all five icicles are cleared")
    require("[oploc1,trollrescue_troll_cave_entrance]" in without_comments(route) and "[oploc1,trollrescue_troll_cave_entrance5]" in without_comments(route),
            "original cave entrance variants use the local transit handler")

    attackable = block(kamil, "proc", "dt_kamil_attackable")
    npc_pack = text(ROOT / "pack/npc.pack")
    require(re.search(r"(?m)^1913=icediamond_icewarrior$", npc_pack) is not None,
            "Kamil retains original NPC identity 1913")
    block_config = config_sections(text(UNPACK / "all.npc"))
    for identifier, name in ((1943, "troll_block_1"), (1944, "fd_trollblock1"),
                             (1945, "troll_block_2"), (1946, "fd_trollblock2")):
        require(re.search(rf"(?m)^{identifier}={name}$", npc_pack) is not None,
                f"frozen parent retains original NPC identity {identifier} [{name}]")
        require(block_config.get(name, {}).get("hitpoints") == ["10"],
                f"original frozen parent block [{name}] remains 10 HP")
    require("%npc_macro_event_target ! uid" in attackable and "%fd_icewarrior_subquest ! ^dt_ice_substate_agreed" in attackable,
            "Kamil admission is restricted to his owned native instance and agreed hunt")
    require("[opnpc2,icediamond_icewarrior]" in kamil and "[apnpc2,icediamond_icewarrior]" in kamil,
            "Kamil retains native melee and magic attack triggers")
    require("[ai_opplayer2,icediamond_icewarrior] ~dt_kamil_attack;" in kamil and
            "[ai_applayer2,icediamond_icewarrior] ~dt_kamil_attack;" in kamil,
            "Kamil's own native AI drives attacks")
    shared = sources["npc_combat.rs2"]
    require("[ai_queue2,_] ~npc_default_damage(last_int);" in shared,
            "Kamil inherits real native queued damage after owner-only admission")
    for hook in ("npc_is_attackable", "npc_is_attackable_opt"):
        shared_hook = block(shared, "proc", hook)
        matches = re.findall(r"if \(npc_type = icediamond_icewarrior\) return\(~dt_kamil_attackable\);", shared_hook)
        require(len(matches) == 1, f"shared {hook} has exactly one approved Kamil owner hook")
    require(len(re.findall(r"if \(npc_type = icediamond_icewarrior\) return\(~dt_kamil_attackable\);", without_comments(shared))) == 2,
            "only the two approved shared attackability hooks dispatch Kamil")
    kamil_death = block(kamil, "ai_queue3", "icediamond_icewarrior")
    require("def_player_uid $owner = %npc_macro_event_target" in kamil_death and "npc_findhero = ^false" in kamil_death and "uid ! $owner" in kamil_death,
            "Kamil death credits only his owned hero")
    defeated = block(kamil, "queue", "dt_ice_kamil_defeated")
    require("queue(dt_ice_kamil_defeated, 0, 0)" in kamil_death and "%fd_icewarrior_subquest ! ^dt_ice_substate_agreed" in defeated and "%fd_icewarrior_dead = 1" in defeated and "%fd_icewarrior_subquest = ^dt_ice_substate_kamil_dead" in defeated,
            "Kamil progression is a protected agreed-only credit to substate 2")
    require("obj_add(npc_coord, chocolate_cake, 2, ^lootdrop_duration)" in kamil_death and "obj_add(npc_coord, 4dose2restore, 1, ^lootdrop_duration)" in kamil_death,
            "Kamil drops cake and restore potion")
    require("icediamond" not in kamil_death.lower() and "fd_icediamond" not in kamil_death, "Kamil does not drop the Ice diamond")
    require("npc_default_attack" in kamil and "npc_player_hit_roll(^magic_style)" in kamil and "Fire" not in kamil,
            "Kamil retains ordinary attack behavior without an elemental Fire allowlist")

    smash = block(parents, "proc", "dt_ice_smash")
    require("%fd_icewarrior_dead = 0" in smash and "%fd_icewarrior_subquest ! ^dt_ice_substate_kamil_dead" in smash,
            "parent blocks require Kamil defeated")
    broken = block(parents, "proc", "dt_ice_block_broken")
    freed = block(parents, "queue", "dt_ice_block_freed")
    require("npc_findhero = ^false" in broken and "queue*(dt_ice_block_freed, 0)($dad)" in broken and "%fd_icewarrior_dadfree = 1" in freed and "%fd_icewarrior_mumfree = 1" in freed,
            "parent death queues independent protected credit for the native hero")
    require("%fd_icewarrior_dadfree ! 0 & %fd_icewarrior_mumfree ! 0" in freed and "%fd_icewarrior_subquest = ^dt_ice_substate_parents_freed" in freed,
            "both parent flags are required for substate 3")
    talk = block(parents, "proc", "dt_ice_parent_talk")
    require("%fd_icewarrior_subquest ! ^dt_ice_substate_parents_freed" in talk and "%fd_icewarrior_subquest = ^dt_ice_substate_family_returned" in talk,
            "parent conversation advances only stage 3 to stage 4")
    reward = block(child, "proc", "dt_ice_family_reward")
    require("%fd_icewarrior_subquest ! ^dt_ice_substate_family_returned" in reward and "~dt_ice_give_diamond = false" in reward,
            "family award requires returned parents and successful diamond delivery")
    require(reward.count("%fd_icewarrior_subquest = ^dt_ice_substate_awarded") == 1 and "inv_add(inv, fd_icediamond, 1)" in child,
            "family child awards the Ice diamond once")
    give = block(child, "proc", "dt_ice_give_diamond")
    require("~obj_gettotal(fd_icediamond) > 0 | %fd_column_ice ! 0" in give and give.count("inv_add(inv, fd_icediamond, 1)") == 1,
            "banked or already-columned Ice diamond is not duplicated or lost")

    gate = block(route, "proc", "dt_ice_gate")
    require("%fd_icewarrior_subquest < ^dt_ice_substate_agreed" in gate and "agility_exactmove" in gate,
            "original lower gates require agreement and use only short local transit")
    cave_transit = enter.count("p_teleport(0_44_58_59_8)") == 1 and "p_teleport" not in enter.replace("p_teleport(0_44_58_59_8)", "")
    require(cave_transit, "cave transit is limited to its original short tunnel endpoint")
    ledge = block(route, "oploc1", "trollrescue_blankmodel")
    require("inv_getobj(worn, ^wearpos_feet) ! death_spikedboots" in ledge and "p_telejump(1_44_59_22_27)" in ledge and "p_telejump(0_44_59_22_27)" in ledge,
            "original ledge requires worn spiked boots and retains only its local height transition")
    require("113-tile ridge is walked" in route and "p_teleport" not in ledge, "natural ridge walk is retained")
    upper = block(route, "proc", "dt_ice_upper_gate")
    require("%fd_icewarrior_dead = 0" in upper and "p_telejump(2_44_59_35_33)" in upper,
            "original upper gate remains Kamil-gated and locally connected")

    area = block(cold, "proc", "dt_ice_cold_area")
    damage = block(cold, "queue", "dt_ice_cold_damage")
    require("stat($stat) > 1) stat_sub($stat, 1, 0)" in damage and "healenergy(-10000)" in damage,
            "cold drains non-HP stats by one to floor one and empties energy")
    require("min(add(random(2), 1), max(0, sub(stat(hitpoints), 1)))" in damage,
            "cold deals selected 1-2 damage but cannot reduce HP below one")
    require("random(^dt_ice_slip_chance)" in cold and "queue(dt_ice_slip, 0, 0)" in cold and "%fd_icewarrior" not in cold and "%fd_trollchild_intro" not in cold,
            "slips/freezes use existing timing only and add no saved Ice state")
    require("^dt_ice_cold_ticks = 17" in timing and "selected" in timing.lower(), "17-tick cadence is explicitly a selected product value")
    require(bool(area) and "settimer(dt_ice_cold, ^dt_ice_cold_ticks)" in cold, "cold cadence is zone-scoped and rescheduled")

    for field in (
        "%fd_icewarrior_trollskilled", "%fd_icewarrior_dead",
        "%fd_icewarrior_dadfree", "%fd_icewarrior_mumfree",
    ):
        require(field in journal, f"Ice journal reports {field}")
    require("sub(^dt_ice_trolls_required, %fd_icewarrior_trollskilled)" in journal and "Kamil is defeated" in journal,
            "journal reports remaining trolls and Kamil outcome")
    require("%fd_column_ice = ^dt_column_placed" in sources["dt_journal.rs2"], "main Desert Treasure journal retains the Ice column status")

    if failures:
        print("\n".join(f"FAIL: {failure}" for failure in failures))
        return 1
    print("PASS: Desert Treasure S5 Ice offer, native kills, Kamil, family, route, cold, state scope and journal contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

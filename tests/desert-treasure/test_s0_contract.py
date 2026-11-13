#!/usr/bin/env python3
"""Offline structural checks for the Desert Treasure S0 configuration slice."""

from __future__ import annotations

from pathlib import Path
import os
import re
import subprocess


REPO_ROOT = Path(__file__).resolve().parents[2]
ROOT = Path(os.environ.get("DT_S0_CONTENT_ROOT", REPO_ROOT)).resolve()
BASELINE_COMMIT = "208a5b7f734f8f2e2bd24fcde6a4abb237bb59a1"
UNPACK = ROOT / "scripts" / "_unpack" / "377"
VARP = UNPACK / "all.varp"
VARP_PACK = ROOT / "pack" / "varp.pack"
VARBIT = UNPACK / "all.varbit"
QUEST_CONSTANTS = ROOT / "scripts" / "general" / "configs" / "quest.constant"
LOCAL_CONSTANTS = (
    ROOT
    / "scripts"
    / "quests"
    / "quest_deserttreasure"
    / "configs"
    / "quest_deserttreasure.constant"
)
ANCIENT_INTERFACE = ROOT / "scripts" / "interfaces" / "inter_267.if"

failures: list[str] = []


def require(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def baseline_text(relative_path: str) -> str:
    baseline_root = os.environ.get("DT_S0_BASELINE_ROOT")
    if baseline_root:
        path = Path(baseline_root) / relative_path
        if not path.is_file():
            require(False, f"baseline file is missing: {path}")
            return ""
        return path.read_text(encoding="utf-8")

    result = subprocess.run(
        ["git", "show", f"{BASELINE_COMMIT}:{relative_path}"],
        cwd=REPO_ROOT,
        capture_output=True,
        check=False,
        text=True,
        encoding="utf-8",
    )
    if result.returncode != 0:
        require(False, f"cannot read baseline {BASELINE_COMMIT}:{relative_path}: {result.stderr.strip()}")
        return ""
    return result.stdout


def section_names(text: str) -> list[str]:
    names: list[str] = []
    for raw_line in text.splitlines():
        match = re.fullmatch(r"\[([^\]]+)\]", raw_line.strip())
        if match:
            names.append(match.group(1))
    return names


def parse_sections_text(text: str, source: str) -> tuple[dict[str, dict[str, list[str]]], list[str]]:
    sections: dict[str, dict[str, list[str]]] = {}
    duplicates: list[str] = []
    current: str | None = None
    for line_number, raw_line in enumerate(text.splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith(("//", "#")):
            continue
        section_match = re.fullmatch(r"\[([^\]]+)\]", line)
        if section_match:
            current = section_match.group(1)
            if current in sections:
                duplicates.append(f"{source}:{line_number}: [{current}]")
            else:
                sections[current] = {}
            continue
        if current is not None and "=" in line:
            key, value = line.split("=", 1)
            sections[current].setdefault(key.strip(), []).append(value.strip())
    return sections, duplicates


def parse_sections(path: Path) -> tuple[dict[str, dict[str, list[str]]], list[str]]:
    return parse_sections_text(path.read_text(encoding="utf-8"), str(path))


def parse_constants_text(text: str, source: str) -> tuple[dict[str, int], list[str]]:
    values: dict[str, int] = {}
    duplicates: list[str] = []
    pattern = re.compile(r"\^([A-Za-z0-9_]+)\s*=\s*(-?\d+)\s*$")
    for line_number, raw_line in enumerate(text.splitlines(), 1):
        match = pattern.fullmatch(raw_line.strip())
        if not match:
            continue
        name, raw_value = match.groups()
        if name in values:
            duplicates.append(f"{source}:{line_number}: ^{name}")
        else:
            values[name] = int(raw_value)
    return values, duplicates


def parse_constants(path: Path) -> tuple[dict[str, int], list[str]]:
    return parse_constants_text(path.read_text(encoding="utf-8"), str(path))


def one(sections: dict[str, dict[str, list[str]]], section: str, key: str) -> str | None:
    values = sections.get(section, {}).get(key, [])
    return values[0] if len(values) == 1 else None


def check_original_varps() -> None:
    varp_text = VARP.read_text(encoding="utf-8")
    sections, duplicates = parse_sections_text(varp_text, str(VARP))
    require(not duplicates, f"duplicate all.varp sections: {duplicates[:3]}")
    base_text = baseline_text("scripts/_unpack/377/all.varp")
    base_sections, base_duplicates = parse_sections_text(base_text, "baseline all.varp")
    require(not base_duplicates, f"duplicate baseline all.varp sections: {base_duplicates[:3]}")
    current_names = section_names(varp_text)
    baseline_names = section_names(base_text)
    require(current_names == baseline_names, "all.varp section order must match the 377 baseline")

    varp_pack_text = VARP_PACK.read_text(encoding="utf-8")
    require(
        varp_pack_text == baseline_text("pack/varp.pack"),
        "varp.pack must preserve the original ID-to-name mapping",
    )
    pack_ids: dict[int, str] = {}
    for raw_line in varp_pack_text.splitlines():
        match = re.fullmatch(r"(\d+)=([A-Za-z0-9_]+)", raw_line.strip())
        if match:
            pack_ids[int(match.group(1))] = match.group(2)
    expected_ids = {
        439: "alternate_spells",
        440: "deserttreasuremain",
        441: "deserttreasurevarbit",
        442: "deserttreasurevarbit2",
    }
    for slot, name in expected_ids.items():
        require(pack_ids.get(slot) == name, f"varp.pack slot {slot} must map to [{name}]")

    expected = {
        "alternate_spells": None,
        "deserttreasuremain": "yes",
        "deserttreasurevarbit": "yes",
        "deserttreasurevarbit2": "yes",
    }
    for name, base_values in base_sections.items():
        current_values = {key: list(values) for key, values in sections.get(name, {}).items()}
        if name in expected:
            require("scope" not in base_values, f"baseline [{name}] must not already set scope")
            current_values.pop("scope", None)
        require(
            current_values == base_values,
            f"[{name}] may only add the authorized permanent scope",
        )
    for name, transmit in expected.items():
        require(name in sections, f"all.varp missing [{name}]")
        require(one(sections, name, "scope") == "perm", f"[{name}] must be permanent")
        actual_transmit = one(sections, name, "transmit")
        require(actual_transmit == transmit, f"[{name}] transmit must be {transmit!r}, got {actual_transmit!r}")


def check_original_varbits() -> None:
    varbit_text = VARBIT.read_text(encoding="utf-8")
    require(
        varbit_text == baseline_text("scripts/_unpack/377/all.varbit"),
        "all.varbit must preserve every original layout",
    )
    sections, duplicates = parse_sections_text(varbit_text, str(VARBIT))
    require(not duplicates, f"duplicate all.varbit sections: {duplicates[:3]}")
    expected = {
        "alternate_spells_0_0": ("alternate_spells", 0, 0),
        "deserttreasure": ("deserttreasuremain", 0, 14),
        "fd_trollchild_intro": ("deserttreasurevarbit", 0, 0),
        "fd_torch_count1": ("deserttreasurevarbit", 1, 1),
        "fd_torch_count2": ("deserttreasurevarbit", 2, 2),
        "fd_torch_count3": ("deserttreasurevarbit", 3, 3),
        "fd_torch_count4": ("deserttreasurevarbit", 4, 4),
        "fd_firechest": ("deserttreasurevarbit", 5, 5),
        "fd_magiclog": ("deserttreasurevarbit", 6, 17),
        "fd_steelbar": ("deserttreasurevarbit", 18, 23),
        "fd_glass": ("deserttreasurevarbit", 24, 29),
        "fd_bones": ("deserttreasurevarbit", 30, 30),
        "fd_ash": ("deserttreasurevarbit", 31, 31),
        "fd_charcoal": ("deserttreasurevarbit2", 0, 0),
        "fd_bloodrune": ("deserttreasurevarbit2", 1, 1),
        "fdvw_cutscene": ("deserttreasurevarbit2", 2, 2),
        "fdvw_subquest": ("deserttreasurevarbit2", 3, 6),
        "fd_fw_warningspam": ("deserttreasurevarbit2", 7, 7),
        "fd_killed_ninja": ("deserttreasurevarbit2", 8, 8),
        "fd_killed_firewarrior": ("deserttreasurevarbit2", 9, 9),
        "fd_icewarrior_dead": ("deserttreasurevarbit2", 10, 10),
        "fd_icewarrior_trollskilled": ("deserttreasurevarbit2", 11, 15),
        "fd_icewarrior_bootshint": ("deserttreasurevarbit2", 16, 16),
        "fd_icewarrior_dadfree": ("deserttreasurevarbit2", 17, 17),
        "fd_icewarrior_mumfree": ("deserttreasurevarbit2", 18, 18),
        "fd_icewarrior_subquest": ("deserttreasurevarbit2", 19, 23),
        "fd_shadowwarrior_quest": ("deserttreasurevarbit2", 24, 28),
        "fd_banditchest_disarmed": ("deserttreasurevarbit2", 29, 29),
        "fd_shadowwar_intro": ("deserttreasurevarbit2", 30, 30),
        "fd_firewargate": ("deserttreasurevarbit2", 31, 31),
        "fd_column_fire": ("deserttreasuremain", 15, 15),
        "fd_column_shadow": ("deserttreasuremain", 16, 16),
        "fd_column_ice": ("deserttreasuremain", 17, 17),
        "fd_column_blood": ("deserttreasuremain", 18, 18),
        "fd_got_zaros_staff": ("deserttreasuremain", 19, 19),
        "fd_mirror_present": ("deserttreasuremain", 20, 20),
        "fd_ladder_present": ("deserttreasuremain", 21, 21),
        "fd_pyramid_timer": ("deserttreasuremain", 22, 31),
    }
    for name, (basevar, start, end) in expected.items():
        require(name in sections, f"all.varbit missing [{name}]")
        actual = (
            one(sections, name, "basevar"),
            one(sections, name, "startbit"),
            one(sections, name, "endbit"),
        )
        require(actual == (basevar, str(start), str(end)), f"[{name}] layout must be {(basevar, start, end)}, got {actual}")


def check_original_entity_configs() -> None:
    configs: dict[str, dict[str, dict[str, list[str]]]] = {}
    base_configs: dict[str, dict[str, dict[str, list[str]]]] = {}
    for filename in ("all.npc", "all.loc", "all.obj"):
        path = UNPACK / filename
        text = path.read_text(encoding="utf-8")
        sections, duplicates = parse_sections_text(text, str(path))
        require(not duplicates, f"duplicate {filename} sections: {duplicates[:3]}")
        base_text = baseline_text(f"scripts/_unpack/377/{filename}")
        base_sections, base_duplicates = parse_sections_text(base_text, f"baseline {filename}")
        require(not base_duplicates, f"duplicate baseline {filename} sections: {base_duplicates[:3]}")
        require(
            section_names(text) == section_names(base_text),
            f"{filename} section identities/order must match the 377 baseline",
        )
        if filename in ("all.loc", "all.obj"):
            require(text == base_text, f"{filename} must preserve original definitions and operations")
        configs[filename] = sections
        base_configs[filename] = base_sections

    for pack_name in ("npc.pack", "loc.pack", "obj.pack"):
        relative_path = f"pack/{pack_name}"
        require(
            (ROOT / relative_path).read_text(encoding="utf-8") == baseline_text(relative_path),
            f"{pack_name} must preserve original numeric identities",
        )

    npcs = configs["all.npc"]
    base_npcs = base_configs["all.npc"]
    expected_npcs = {
        "icediamond_icewarrior": (130, 190, 80, 135, 4, "obj_khazard_helmet_manwear", "154"),
        "blooddiamond_vampirewarrior": (200, 99, 99, 99, 3, "npc_1914", "139"),
        "blooddiamond_vampirewarrior_unkillable": (200, 99, 99, 99, 3, "npc_1914", "139"),
        "fd_damis_normal": (90, 90, 90, 90, 4, "obj_khazard_helmet_manwear", "103"),
        "fd_damis_tougher": (200, 160, 100, 160, 3, "obj_viking_helmet_manwear", "174"),
        "firediamond_firewarrior": (130, 190, 120, 135, 4, "npc_1977", "167"),
    }
    candidate_fields = ("hitpoints", "attack", "strength", "defence", "magic")
    for name, (hp, attack, strength, defence, rate, model, vislevel) in expected_npcs.items():
        expected_fields = {
            "hitpoints": str(hp),
            "attack": str(attack),
            "strength": str(strength),
            "defence": str(defence),
            "magic": "1",
            "model1": model,
            "op2": "Attack",
            "vislevel": vislevel,
        }
        for field, expected in expected_fields.items():
            require(one(npcs, name, field) == expected, f"[{name}] {field} must be {expected}")
        current_values = {key: list(values) for key, values in npcs.get(name, {}).items()}
        base_values = {key: list(values) for key, values in base_npcs.get(name, {}).items()}
        require(name in base_npcs, f"[{name}] must retain its original NPC identity")
        for field in candidate_fields:
            current_values.pop(field, None)
            base_values.pop(field, None)
        current_params = current_values.get("param", [])
        base_params = base_values.get("param", [])
        candidate_rate = f"attackrate,{rate}"
        require(current_params.count(candidate_rate) == 1, f"[{name}] must add exactly {candidate_rate}")
        require(
            not any(value.startswith("attackrate,") for value in base_params),
            f"[{name}] baseline must not already define an attack rate",
        )
        if name == "firediamond_firewarrior":
            # S2 exact additions only: CANDIDATE later Fareed bonuses/ashes;
            # UNKNOWN product-owned lifecycle fields. Preserve the comparison.
            for field, expected in {
                "defaultmode": "none",  # UNKNOWN owned spawn, not a static aggressor
                "wanderrange": "0",  # UNKNOWN owned encounter boundary
                "huntrange": "0",  # UNKNOWN no public target hunting
                "timer": "1",  # UNKNOWN owner-presence check interval
            }.items():
                require(current_values.pop(field, None) == [expected], f"[{name}] S2 {field} must be {expected}")
                require(field not in base_values, f"[{name}] baseline must not define S2 {field}")
            for expected in (
                "strengthbonus,120",  # CANDIDATE later Fareed equipment strength
                "stabdefence,100",  # CANDIDATE later Fareed stab defence
                "slashdefence,100",  # CANDIDATE later Fareed slash defence
                "crushdefence,100",  # CANDIDATE later Fareed crush defence
                "magicdefence,0",  # CANDIDATE later Fareed magic defence
                "rangedefence,0",  # CANDIDATE later Fareed ranged defence
                "damagetype,^slash_style",  # CANDIDATE later melee attack style
                "death_drop,ashes",  # CANDIDATE later Smoke transcript
            ):
                require(current_params.count(expected) == 1, f"[{name}] must add exactly {expected}")
                require(expected not in base_params, f"[{name}] baseline must not define {expected}")
                current_params = [value for value in current_params if value != expected]
        current_values["param"] = [value for value in current_params if value != candidate_rate]
        if not current_values["param"]:
            current_values.pop("param")
        require(
            current_values == base_values,
            f"[{name}] may change only the labelled candidate combat fields",
        )
    published_s1_bandits = {
        # S1 added these exact server fields (6086b0ff2 merge; published a87ed08f9).
        "fourdiamonds_sword_bandit_sitsouth": {"wanderrange": ["0"], "moverestrict": ["nomove"], "defaultmode": ["none"]},
        # S1 added these exact server fields (6086b0ff2 merge; published a87ed08f9).
        "fourdiamonds_sword_bandit_sitnorth": {"wanderrange": ["0"], "moverestrict": ["nomove"], "defaultmode": ["none"]},
        # S1 added these exact server fields (6086b0ff2 merge; published a87ed08f9).
        "fourdiamonds_sword_bandit_siteast": {"wanderrange": ["0"], "moverestrict": ["nomove"], "defaultmode": ["none"]},
        # S1 added these exact server fields (6086b0ff2 merge; published a87ed08f9).
        "fourdiamonds_sword_bandit_sitwest": {"wanderrange": ["0"], "moverestrict": ["nomove"], "defaultmode": ["none"]},
    }
    for name, base_values in base_npcs.items():
        if name in published_s1_bandits:
            additions = published_s1_bandits[name]
            require(not set(additions) & set(base_values), f"[{name}] S1 fields must be new to the baseline")
            require(npcs.get(name) == {**base_values, **additions}, f"[{name}] must retain exact published S1 values")
        elif name not in expected_npcs:
            require(npcs.get(name) == base_values, f"[{name}] non-candidate NPC data must remain unchanged")
    npc_text = (UNPACK / "all.npc").read_text(encoding="utf-8")
    for name, (hp, attack, strength, defence, rate, _, _) in expected_npcs.items():
        match = re.search(
            rf"(?ms)^\[{re.escape(name)}\]\r?\n(.*?)(?=^\[|\Z)",
            npc_text,
        )
        body = match.group(1) if match else ""
        marker = "// CANDIDATE: early-osrs-warrior-combat-r2"
        require(body.count(marker) == 1, f"[{name}] candidate label must be inside its original NPC section")
        candidate_lines = "\n".join(
            (
                f"hitpoints={hp}",
                f"attack={attack}",
                f"strength={strength}",
                f"defence={defence}",
                "magic=1",
                f"param=attackrate,{rate}",
            )
        )
        after_marker = (
            body.split(marker, 1)[1].partition("\n")[2].lstrip("\r\n")
            if marker in body
            else ""
        )
        require(after_marker.startswith(candidate_lines), f"[{name}] label must introduce its candidate fields")
    require(
        npc_text.count("// CANDIDATE: early-osrs-warrior-combat-r2") == 6,
        "all six warrior forms need candidate labels on injected combat fields",
    )

def check_constants() -> None:
    if not QUEST_CONSTANTS.is_file():
        require(False, f"missing shared quest constants: {QUEST_CONSTANTS}")
        return
    quest_text = QUEST_CONSTANTS.read_text(encoding="utf-8")
    quest, quest_duplicates = parse_constants_text(quest_text, str(QUEST_CONSTANTS))
    base_quest_text = baseline_text("scripts/general/configs/quest.constant")
    base_quest, base_quest_duplicates = parse_constants_text(base_quest_text, "baseline quest.constant")
    require(not quest_duplicates, f"duplicate shared quest constants: {quest_duplicates[:3]}")
    require(not base_quest_duplicates, f"duplicate baseline quest constants: {base_quest_duplicates[:3]}")
    missing = set(base_quest) - set(quest)
    changed = {name for name in base_quest.keys() & quest.keys() if base_quest[name] != quest[name]}
    added = set(quest) - set(base_quest)
    require(not missing, f"shared quest constants removed: {sorted(missing)[:3]}")
    require(not changed, f"shared quest constants changed: {sorted(changed)[:3]}")
    require(added == {"deserttreasure_questpoints"}, f"unexpected shared quest constants added: {sorted(added)}")
    require(quest.get("deserttreasure_complete") == 15, "shared completion state must remain 15")
    require(quest.get("deserttreasure_questpoints") == 3, "shared quest reward must be 3 QP")
    require(
        "// VERIFIED: period 3 QP reward (desert-treasure.period-requirements)." in quest_text,
        "shared QP reward needs its VERIFIED source label",
    )
    if not LOCAL_CONSTANTS.is_file():
        require(False, f"missing required Desert Treasure constants: {LOCAL_CONSTANTS}")
        return
    local, local_duplicates = parse_constants(LOCAL_CONSTANTS)
    require(not local_duplicates, f"duplicate Desert Treasure constants: {local_duplicates[:3]}")
    expected = {
        "dt_stage_not_started": 0,
        "dt_stage_etchings_received": 1,
        "dt_stage_translation_with_terry": 2,
        "dt_stage_translation_return": 3,
        "dt_stage_partnership_pending": 4,
        "dt_stage_partnership_accepted": 5,
        "dt_stage_brew_purchased": 6,
        "dt_stage_diamonds_requested": 7,
        "dt_stage_ingredients_pending": 8,
        "dt_stage_unused_9": 9,
        "dt_stage_hunts": 10,
        "dt_stage_placing_diamonds": 11,
        "dt_stage_four_columns": 12,
        "dt_stage_inside_pyramid": 13,
        "dt_stage_reward_pending": 14,
        "dt_stage_complete": 15,
        "dt_spellbook_standard": 0,
        "dt_spellbook_ancient": 1,
        "dt_flag_off": 0,
        "dt_flag_on": 1,
        "dt_column_unplaced": 0,
        "dt_column_placed": 1,
        "dt_ice_substate_crying": 0,
        "dt_ice_substate_agreed": 1,
        "dt_ice_substate_kamil_dead": 2,
        "dt_ice_substate_parents_freed": 3,
        "dt_ice_substate_family_returned": 4,
        "dt_ice_substate_awarded": 5,
        "dt_ice_trolls_required": 5,
        "dt_blood_substate_not_started": 0,
        "dt_blood_substate_malak_agreed": 1,
        "dt_blood_substate_silver_pot": 2,
        "dt_blood_substate_blood_drawn": 3,
        "dt_blood_substate_one_ingredient": 4,
        "dt_blood_substate_prepared": 5,
        "dt_blood_substate_dessous_active": 6,
        "dt_blood_substate_dessous_defeated": 7,
        "dt_blood_substate_diamond_claimed": 8,
        "dt_shadow_substate_not_started": 0,
        "dt_shadow_substate_rasolo_agreed": 1,
        "dt_shadow_substate_cross_returned_ring_awarded": 2,
        "dt_shadow_substate_damis_first_form": 3,
        "dt_shadow_substate_damis_second_form": 4,
        "dt_shadow_substate_damis_defeated": 5,
        "dt_shadow_substate_diamond_claimed": 6,
    }
    for name, value in expected.items():
        require(local.get(name) == value, f"^{name} must be {value}, got {local.get(name)!r}")
    local_text = LOCAL_CONSTANTS.read_text(encoding="utf-8")
    for label in ("CANDIDATE:", "VERIFIED:", "UNKNOWN:"):
        require(label in local_text, f"local constants must preserve {label} evidence labels")


def check_ancient_interface() -> None:
    interface_text = ANCIENT_INTERFACE.read_text(encoding="utf-8")
    require(
        interface_text == baseline_text("scripts/interfaces/inter_267.if"),
        "Ancient interface identity and widget data must remain unchanged",
    )
    sections, duplicates = parse_sections_text(interface_text, str(ANCIENT_INTERFACE))
    require(not duplicates, f"duplicate Ancient interface sections: {duplicates[:3]}")
    expected_spell_levels = {
        "Ice Rush": 58,
        "Ice Blitz": 82,
        "Ice Burst": 70,
        "Ice Barrage": 94,
        "Blood Rush": 56,
        "Blood Blitz": 80,
        "Blood Burst": 68,
        "Blood Barrage": 92,
        "Smoke Rush": 50,
        "Smoke Blitz": 74,
        "Smoke Burst": 62,
        "Smoke Barrage": 86,
        "Shadow Rush": 52,
        "Shadow Blitz": 76,
        "Shadow Burst": 64,
        "Shadow Barrage": 88,
    }
    expected_spell_buttons = {
        "Ice Rush": "com_5",
        "Ice Blitz": "com_15",
        "Ice Burst": "com_25",
        "Ice Barrage": "com_35",
        "Blood Rush": "com_45",
        "Blood Blitz": "com_55",
        "Blood Burst": "com_63",
        "Blood Barrage": "com_73",
        "Smoke Rush": "com_83",
        "Smoke Blitz": "com_95",
        "Smoke Burst": "com_107",
        "Smoke Barrage": "com_119",
        "Shadow Rush": "com_131",
        "Shadow Blitz": "com_143",
        "Shadow Burst": "com_155",
        "Shadow Barrage": "com_167",
    }
    spell_buttons: dict[str, str] = {}
    tooltip_titles: dict[str, str] = {}
    tooltip_buttons: dict[str, str] = {}
    for component, section in sections.items():
        if one(sections, component, "type") != "graphic":
            continue
        action = one(sections, component, "action")
        overlayer = one(sections, component, "overlayer")
        if action and re.fullmatch(r"(Ice|Blood|Smoke|Shadow) (Rush|Burst|Blitz|Barrage)", action):
            spell_buttons[action] = component
        if not overlayer:
            continue
        for child in sections:
            if one(sections, child, "layer") != overlayer:
                continue
            text = one(sections, child, "text")
            if text:
                match = re.fullmatch(r"Level (\d+) : (.+)", text)
                if match:
                    title = match.group(2)
                    tooltip_titles[title] = match.group(1)
                    tooltip_buttons[title] = component
    for name, level in expected_spell_levels.items():
        require(spell_buttons.get(name) == expected_spell_buttons[name], f"Ancient interface {name} button must be {expected_spell_buttons[name]}")
        require(tooltip_titles.get(name) == str(level), f"Ancient interface {name} level must be {level}")
        require(tooltip_buttons.get(name) == expected_spell_buttons[name], f"Ancient interface {name} tooltip must belong to its button")
    expected_teleports = {
        "Paddewwa Teleport": (54, "com_179"),
        "Senntisten Teleport": (60, "com_189"),
        "Kharyrll Teleport": (66, "com_197"),
        "Lassar Teleport": (72, "com_205"),
        "Dareeyak Teleport": (78, "com_213"),
        "Carrallangar Teleport": (84, "com_223"),
        "Annakarl Teleport": (90, "com_231"),
        "Ghorrock Teleport": (96, "com_239"),
    }
    for name, (level, button) in expected_teleports.items():
        require(tooltip_titles.get(name) == str(level), f"Ancient interface {name} level must be {level}")
        require(tooltip_buttons.get(name) == button, f"Ancient interface {name} button must be {button}")
    require(
        set(spell_buttons) == set(expected_spell_levels),
        "Ancient interface combat spell inventory must match the 16 named buttons",
    )
    actual_spell_buttons = [spell_buttons.get(name) for name in expected_spell_levels]
    require(len(set(actual_spell_buttons)) == 16, "Ancient spell button identities must be unique")
    actual_teleports = {title for title in tooltip_titles if title.endswith(" Teleport")}
    require(
        actual_teleports == set(expected_teleports),
        "Ancient teleport tooltip inventory must match the 8 named buttons",
    )
    actual_teleport_buttons = [tooltip_buttons.get(name) for name in expected_teleports]
    require(
        None not in actual_teleport_buttons and len(set(actual_teleport_buttons)) == 8,
        "Ancient teleport button identities must be unique",
    )


def main() -> int:
    check_original_varps()
    check_original_varbits()
    check_original_entity_configs()
    check_constants()
    check_ancient_interface()
    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1
    print("Desert Treasure S0 static contract: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Offline source contract for the Desert Treasure S4 Blood slice."""

from __future__ import annotations

import os
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
ROOT = Path(os.environ.get("DT_S4_CONTENT_ROOT", REPO_ROOT)).resolve()
QUEST = ROOT / "scripts" / "quests" / "quest_deserttreasure"
SCRIPTS = QUEST / "scripts"
CONSTANTS = QUEST / "configs" / "quest_deserttreasure.constant"

failures: list[str] = []


def require(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def read_text(path: Path) -> str:
    if not path.is_file():
        failures.append(f"missing required S4 source: {path.relative_to(ROOT)}")
        return ""
    return path.read_text(encoding="utf-8")


def active_code(source: str) -> str:
    """Remove RuneScript line comments before structural code comparisons."""
    return "\n".join(line.split("//", 1)[0] for line in source.splitlines())


def parse_sections(source: str) -> tuple[dict[str, dict[str, list[str]]], list[str]]:
    sections: dict[str, dict[str, list[str]]] = {}
    duplicates: list[str] = []
    current: str | None = None
    for line_number, raw_line in enumerate(source.splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith(("//", "#")):
            continue
        header = re.fullmatch(r"\[([^\]]+)\]", line)
        if header:
            current = header.group(1)
            if current in sections:
                duplicates.append(f"line {line_number}: [{current}]")
            else:
                sections[current] = {}
            continue
        if current is not None and "=" in line:
            key, value = line.split("=", 1)
            sections[current].setdefault(key.strip(), []).append(value.strip())
    return sections, duplicates


def parse_constants(source: str) -> tuple[dict[str, int], list[str]]:
    values: dict[str, int] = {}
    duplicates: list[str] = []
    pattern = re.compile(r"\^([A-Za-z0-9_]+)\s*=\s*(-?\d+)\s*$")
    for line_number, raw_line in enumerate(source.splitlines(), 1):
        match = pattern.fullmatch(raw_line.strip())
        if not match:
            continue
        name, raw_value = match.groups()
        if name in values:
            duplicates.append(f"line {line_number}: ^{name}")
        else:
            values[name] = int(raw_value)
    return values, duplicates


def check_config_identity() -> None:
    npc_pack = read_text(ROOT / "pack" / "npc.pack")
    obj_pack = read_text(ROOT / "pack" / "obj.pack")
    npc_text = read_text(ROOT / "scripts" / "_unpack" / "377" / "all.npc")
    obj_text = read_text(ROOT / "scripts" / "_unpack" / "377" / "all.obj")
    npcs, npc_duplicates = parse_sections(npc_text)
    objects, obj_duplicates = parse_sections(obj_text)
    require(not npc_duplicates, f"duplicate NPC sections: {npc_duplicates[:3]}")
    require(not obj_duplicates, f"duplicate object sections: {obj_duplicates[:3]}")

    expected_npcs = {
        1914: (
            "blooddiamond_vampirewarrior",
            {
                "model1": "npc_1914",
                "model2": "npc_1220i3",
                "model3": "npc_1914i2",
                "model4": "idk_man_legs_tatty",
                "model5": "idk_42",
            },
            {"op2": "Attack"},
        ),
        1915: (
            "blooddiamond_vampirewarrior_unkillable",
            {
                "model1": "npc_1914",
                "model2": "npc_1220i3",
                "model3": "npc_1914i2",
                "model4": "idk_man_legs_tatty",
                "model5": "idk_42",
            },
            {"op2": "Attack"},
        ),
        1916: (
            "malak",
            {
                "model1": "npc_1916",
                "model2": "npc_1916i2",
                "model3": "npc_1220i2",
                "model4": "idk_man_legs_tatty",
                "model5": "idk_42",
                "model6": "obj_cape_of_legends_manwear",
            },
            {"op1": "Talk-to"},
        ),
        1920: (
            "fourdiamonds_vampire_lord",
            {
                "model1": "npc_count_draynor",
                "model2": "obj_priest_gown_manwear",
                "model3": "obj_priest_gown_manwear2",
                "model4": "obj_gauntlets_of_cooking_manwear",
                "model5": "idk_man_legs_flares",
                "model6": "obj_ikov_bootsoflightness_manwear",
                "model7": "obj_cape_of_legends_manwear",
            },
            {"op1": "Talk-to"},
        ),
    }
    npc_lines = [line.strip() for line in npc_pack.splitlines()]
    for original_id, (name, expected_models, expected_ops) in expected_npcs.items():
        matching = [line for line in npc_lines if re.fullmatch(rf"{original_id}=[A-Za-z0-9_]+", line)]
        require(matching == [f"{original_id}={name}"], f"NPC original ID {original_id} must map exactly to {name}")
        fields = npcs.get(name, {})
        models = {key: values[0] for key, values in fields.items() if re.fullmatch(r"model\d+", key) and len(values) == 1}
        ops = {key: values[0] for key, values in fields.items() if re.fullmatch(r"op\d+", key) and len(values) == 1}
        require(models == expected_models, f"[{name}] must preserve its exact original model list")
        require(ops == expected_ops, f"[{name}] must preserve its exact original operation list")
        if original_id in (1914, 1915):
            require(
                fields.get("param", []).count("death_drop,null") == 1,
                f"[{name}] must not drop a Blood diamond or other boss reward",
            )
            require(
                fields.get("attackrange") == ["8"],
                f"[{name}] needs the published magic/ranged approach range 8, not the inert default 0 or the encounter leash",
            )
    expected_objects = {
        4658: "fd_silver_pot",
        4659: "fd_silver_pot_blessed",
        4660: "fd_silver_pot_blood",
        4661: "fd_silver_pot_blood_blessed",
        4662: "fd_silver_pot_blood_garlic",
        4663: "fd_silver_pot_blood_garlic_blessed",
        4664: "fd_silver_pot_blood_garlic_spiced",
        4665: "fd_silver_pot_blood_garlic_spiced_blessed",
        4666: "fd_silver_pot_blood_spiced",
        4667: "fd_silver_pot_blood_spiced_blessed",
        4668: "fd_crushed_garlic",
        4670: "fd_blood_diamond",
    }
    obj_lines = [line.strip() for line in obj_pack.splitlines()]
    for original_id, name in expected_objects.items():
        matching = [line for line in obj_lines if re.fullmatch(rf"{original_id}=[A-Za-z0-9_]+", line)]
        require(matching == [f"{original_id}={name}"], f"object original ID {original_id} must map exactly to {name}")

    expected_models = {
        "fd_silver_pot": "obj_pot_unfired",
        "fd_silver_pot_blessed": "obj_pot_unfired",
        "fd_silver_pot_blood": "obj_fd_silver_pot_blood",
        "fd_silver_pot_blood_blessed": "obj_fd_silver_pot_blood",
        "fd_silver_pot_blood_garlic": "obj_fd_silver_pot_blood",
        "fd_silver_pot_blood_garlic_blessed": "obj_fd_silver_pot_blood",
        "fd_silver_pot_blood_garlic_spiced": "obj_fd_silver_pot_blood",
        "fd_silver_pot_blood_garlic_spiced_blessed": "obj_fd_silver_pot_blood",
        "fd_silver_pot_blood_spiced": "obj_fd_silver_pot_blood",
        "fd_silver_pot_blood_spiced_blessed": "obj_fd_silver_pot_blood",
        "fd_crushed_garlic": "obj_unicorn_horn_dust",
        "fd_blood_diamond": "obj_diamond",
    }
    for name, expected_model in expected_models.items():
        model_values = objects.get(name, {}).get("model", [])
        require(model_values == [expected_model], f"[{name}] must preserve model {expected_model}")


def check_blood_constants() -> None:
    values, duplicates = parse_constants(read_text(CONSTANTS))
    expected = {
        "dt_stage_hunts": 10,
        "dt_blood_substate_not_started": 0,
        "dt_blood_substate_malak_agreed": 1,
        "dt_blood_substate_silver_pot": 2,
        "dt_blood_substate_blood_drawn": 3,
        "dt_blood_substate_one_ingredient": 4,
        "dt_blood_substate_prepared": 5,
        "dt_blood_substate_dessous_active": 6,
        "dt_blood_substate_dessous_defeated": 7,
        "dt_blood_substate_diamond_claimed": 8,
    }
    for name, value in expected.items():
        require(values.get(name) == value, f"^{name} must remain {value}")
    require(
        not any(any(f"^{name}" in duplicate for name in expected) for duplicate in duplicates),
        "Blood progression constants must be declared once",
    )

    # Both persistent Blood outputs share original varp 442, not temporary slots.
    player_vars, _ = parse_sections(read_text(ROOT / "scripts" / "_unpack" / "377" / "all.varp"))
    player_bits, _ = parse_sections(read_text(ROOT / "scripts" / "_unpack" / "377" / "all.varbit"))
    varp_rows = read_text(ROOT / "pack" / "varp.pack").splitlines()
    bit_rows = read_text(ROOT / "pack" / "varbit.pack").splitlines()
    require(varp_rows.count("442=deserttreasurevarbit2") == 1, "Blood retains original backing varp 442")
    require(
        player_vars.get("deserttreasurevarbit2", {}).get("scope") == ["perm"],
        "Blood agreement, preparation and valid-kill progress survive clean logout",
    )
    for name, original_id, startbit, endbit in (
        ("fdvw_cutscene", 372, 2, 2),
        ("fdvw_subquest", 373, 3, 6),
    ):
        require(bit_rows.count(f"{original_id}={name}") == 1, f"{name} retains original varbit {original_id}")
        fields = player_bits.get(name, {})
        require(
            fields.get("basevar") == ["deserttreasurevarbit2"]
            and fields.get("startbit") == [str(startbit)]
            and fields.get("endbit") == [str(endbit)],
            f"{name} retains its original permanent backing field",
        )

    combat_values, combat_duplicates = parse_constants(read_text(QUEST / "configs" / "dt_blood.constant"))
    expected_combat = {
        "dt_dessous_teleports_limit": 3,
        "dt_dessous_bat_first_delay": 1,
        "dt_dessous_bat_second_delay": 2,
        "dt_dessous_bat_damage": 5,
        "dt_malak_blood_damage": 5,
    }
    for name, value in expected_combat.items():
        require(combat_values.get(name) == value, f"^{name} must remain {value}")
    require(
        not any(any(f"^{name}" in duplicate for name in expected_combat) for duplicate in combat_duplicates),
        "Blood combat thresholds must be declared once",
    )

POTS = (
    "fd_silver_pot",
    "fd_silver_pot_blessed",
    "fd_silver_pot_blood",
    "fd_silver_pot_blood_blessed",
    "fd_silver_pot_blood_garlic",
    "fd_silver_pot_blood_garlic_blessed",
    "fd_silver_pot_blood_spiced",
    "fd_silver_pot_blood_spiced_blessed",
    "fd_silver_pot_blood_garlic_spiced",
    "fd_silver_pot_blood_garlic_spiced_blessed",
)


def code_blocks(source: str) -> list[tuple[str, str]]:
    code = active_code(source)
    headers = list(re.finditer(r"(?m)^\[([^\]\r\n]+)\]", code))
    blocks: list[tuple[str, str]] = []
    for index, header in enumerate(headers):
        end = headers[index + 1].start() if index + 1 < len(headers) else len(code)
        blocks.append((header.group(1), code[header.end() : end]))
    return blocks


def block(source: str, kind: str, name: str, label: str | None = None) -> str:
    expected = f"{kind},{name}"
    matches = [body for header, body in code_blocks(source) if header == expected]
    require(len(matches) == 1, f"{label or expected} must be defined exactly once")
    return matches[0] if len(matches) == 1 else ""


def compact(source: str) -> str:
    return re.sub(r"\s+", "", active_code(source))


def braced_body(source: str, condition: str, label: str) -> str | None:
    match = re.search(condition, source, flags=re.S)
    if match is None:
        require(False, f"{label} guard is present")
        return None
    opening = source.find("{", match.end())
    if opening < 0:
        require(False, f"{label} guard has a body")
        return None

    depth = 0
    quoted = False
    escaped = False
    for index in range(opening, len(source)):
        char = source[index]
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
            continue
        if char == '"':
            quoted = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[opening + 1 : index]
    require(False, f"{label} guard closes")
    return None


def require_order(source: str, tokens: tuple[str, ...], label: str) -> None:
    positions = [source.find(token) for token in tokens]
    require(all(position >= 0 for position in positions) and positions == sorted(positions), f"{label} occurs in the required order")


def check_blood_preparation(blood: str) -> None:
    code = active_code(blood)
    require("%deserttreasure =" not in code, "Blood preparation never writes the Desert Treasure main stage")
    require("$questpoints =" not in code, "Blood preparation never writes quest points")

    malak = block(blood, "opnpc1", "fourdiamonds_vampire_lord")
    for empty, blood_pot in (
        ("fd_silver_pot", "fd_silver_pot_blood"),
        ("fd_silver_pot_blessed", "fd_silver_pot_blood_blessed"),
    ):
        require(
            f"inv_total(inv, {empty}) > 0" in malak
            and f"~dt_malak_cut({empty}, {blood_pot});" in malak,
            f"Malak fills exactly the held {empty} into {blood_pot}",
        )
    require_order(
        malak,
        ("@dt_malak_award;", "if (%deserttreasure < ^dt_stage_hunts)"),
        "Malak reclaim dispatch before the stage-10 preparation gate",
    )

    decline = block(blood, "label", "dt_malak_intro_options")
    decline_body = braced_body(
        decline,
        r"if\s*\(\s*~p_choice2_header\([^)]*\)\s*=\s*2\s*\)",
        "Malak decline",
    )
    if decline_body is not None:
        require("return;" in decline_body, "declining Malak's bargain returns")
        require("%fdvw_cutscene =" not in decline_body and "%fdvw_subquest =" not in decline_body, "declining leaves Blood progress untouched")
    require(
        "%fdvw_cutscene = ^dt_flag_on;" in decline
        and "%fdvw_subquest = ^dt_blood_substate_malak_agreed;" in decline,
        "only the accepted Malak bargain turns on the intro flag and agreed substate",
    )

    ruantun = block(blood, "opnpc1", "malak")
    require(
        "if (%deserttreasure < ^dt_stage_hunts | %fdvw_subquest < ^dt_blood_substate_malak_agreed) {\n    return;\n}" in ruantun,
        "Ruantun requires the active main stage and Malak's agreement",
    )
    no_bar = braced_body(
        ruantun,
        r"if\s*\(\s*inv_total\s*\(\s*inv\s*,\s*silver_bar\s*\)\s*=\s*0\s*\)",
        "Ruantun no-silver-bar refusal",
    )
    if no_bar is not None:
        require("return;" in no_bar, "Ruantun's no-bar branch returns")
        require(
            not any(effect in no_bar for effect in ("inv_del(", "inv_add(", "%fdvw_subquest =", "%fdvw_cutscene =")),
            "Ruantun's no-bar branch consumes, grants and writes nothing",
        )
    require(ruantun.count("inv_del(inv, silver_bar, 1);") == 1, "Ruantun consumes exactly one silver bar per pot")
    require(ruantun.count("inv_add(inv, fd_silver_pot, 1);") == 1, "Ruantun grants exactly one ordinary empty pot")
    require_order(
        ruantun,
        ("inv_del(inv, silver_bar, 1);", "inv_add(inv, fd_silver_pot, 1);", "%fdvw_subquest = ^dt_blood_substate_silver_pot;"),
        "silver-bar pot transaction",
    )
    require(
        "if (%fdvw_subquest < ^dt_blood_substate_silver_pot) %fdvw_subquest = ^dt_blood_substate_silver_pot;" in ruantun,
        "repeated pot preparation preserves any later Blood substate",
    )

    cut = block(blood, "proc", "dt_malak_cut")
    require(
        "if (inv_total(inv, $empty) = 0) return;" in cut,
        "a missing selected pot returns immediately without damage, item or state effects",
    )
    require(
        re.search(
            r"~damage_self\s*\(\s*min\s*\(\s*\^dt_malak_blood_damage\s*,\s*max\s*\(\s*0\s*,\s*sub\s*\(\s*stat\s*\(\s*hitpoints\s*\)\s*,\s*1\s*\)\s*\)\s*\)\s*\)\s*;",
            cut,
        )
        is not None,
        "blood cut is five damage clamped to leave at least one HP (including starting HP 5 or 1)",
    )
    require_order(
        cut,
        ("if (inv_total(inv, $empty) = 0) return;", "~damage_self(", "inv_del(inv, $empty, 1);", "inv_add(inv, $blood, 1);", "%fdvw_subquest = ^dt_blood_substate_blood_drawn;"),
        "blood-cut transaction",
    )
    require(cut.count("inv_del(inv, $empty, 1);") == 1 and cut.count("inv_add(inv, $blood, 1);") == 1, "a blood cut transforms one pot once")
    require(
        "if (%fdvw_subquest < ^dt_blood_substate_blood_drawn) %fdvw_subquest = ^dt_blood_substate_blood_drawn;" in cut,
        "blood drawing never regresses a later Blood substate",
    )


def check_blood_blessing(blood: str, priest: str, monk: str) -> None:
    blessable = block(blood, "proc", "dt_blood_blessable")
    unblessed_inputs = (
        "fd_silver_pot",
        "fd_silver_pot_blood",
        "fd_silver_pot_blood_garlic",
        "fd_silver_pot_blood_spiced",
        "fd_silver_pot_blood_garlic_spiced",
    )
    for item in unblessed_inputs:
        require(f"inv_total(inv, {item}) > 0" in blessable, f"the High Priest may bless {item}")
    blessed_inputs = tuple(item for item in POTS if item not in unblessed_inputs)
    require(not any(item in blessable for item in blessed_inputs), "already blessed pots are not blessable again")

    blessing_pairs = (
        ("fd_silver_pot", "fd_silver_pot_blessed"),
        ("fd_silver_pot_blood", "fd_silver_pot_blood_blessed"),
        ("fd_silver_pot_blood_garlic", "fd_silver_pot_blood_garlic_blessed"),
        ("fd_silver_pot_blood_spiced", "fd_silver_pot_blood_spiced_blessed"),
        ("fd_silver_pot_blood_garlic_spiced", "fd_silver_pot_blood_garlic_spiced_blessed"),
    )
    blessed = block(blood, "proc", "dt_blood_blessed")
    actual_blessings = re.findall(
        r"case\s+([A-Za-z0-9_]+)\s*:\s*return\s*\(\s*([A-Za-z0-9_]+)\s*\)\s*;",
        blessed,
    )
    require(actual_blessings == list(blessing_pairs), "blessing preserves the original ingredient identity for every pot stage")

    bless = block(blood, "proc", "dt_blood_bless")
    require(
        re.search(
            r"if\s*\(\s*\$blessed\s*=\s*fd_silver_pot_blood_garlic_spiced_blessed\s*&\s*%fdvw_subquest\s*<\s*\^dt_blood_substate_prepared\s*\)\s*%fdvw_subquest\s*=\s*\^dt_blood_substate_prepared\s*;",
            bless,
        )
        is not None,
        "blessing a fully mixed pot advances to Prepared monotonically, including when blessing happens last",
    )
    require(
        "inv_setslot(inv, $slot, $blessed, 1);" in bless
        and "inv_del(" not in bless
        and "inv_add(" not in bless,
        "blessing replaces exactly the held pot slot without consuming or duplicating items",
    )
    require_order(
        bless,
        ("~dt_blood_blessed($pot)", "inv_setslot(inv, $slot, $blessed, 1);", "%fdvw_subquest = ^dt_blood_substate_prepared;"),
        "late-blessing transaction",
    )

    priest_talk = block(priest, "opnpc1", "high_priest_of_entrana")
    priest_bless_guard = braced_body(
        priest_talk,
        r"if\s*\(\s*%deserttreasure\s*>=\s*\^dt_stage_hunts\s*&\s*%fdvw_subquest\s*>=\s*\^dt_blood_substate_malak_agreed\s*&\s*%fdvw_subquest\s*<\s*\^dt_blood_substate_dessous_defeated\s*&\s*~dt_blood_blessable\s*=\s*true\s*\)",
        "Entrana High Priest blessing service",
    )
    if priest_bless_guard is not None:
        require(compact(priest_bless_guard) == "~dt_blood_bless;return;", "the priest has one guarded Blood-blessing call and returns")
    require(priest_talk.count("~dt_blood_bless;") == 1, "the ordinary High Priest exposes exactly one Blood-blessing hook")
    require_order(
        priest_talk,
        ("@devious_high_priest_return;", "@devious_high_priest_surprise;", "~dt_blood_bless;", "@grail_crone;"),
        "Devious Minds precedence, single Blood service, and existing Grail service",
    )
    for existing in (
        "if (%devious_monk >= 1)",
        "if (%devious_altar >= 1)",
        "if(%grail < ^grail_finding_percival & %grail >= ^grail_spoken_merlin)",
        "if (%heroquest = ^hero_started)",
        "Many greetings. Welcome to our fair island.",
        "Enjoy your stay here.|May it be spiritually uplifting!",
    ):
        require(existing in priest_talk, f"existing High Priest service remains: {existing}")
    priest_item_use = block(priest, "opnpcu", "high_priest_of_entrana")
    require(
        priest_item_use.strip() == '~chatnpc("<p,confused>No thank you, I am not accepting donations for the church at this time.");',
        "High Priest item-use fallback remains the original donation refusal",
    )

    shipmonk = block(monk, "opnpc1", "shipmonk")
    refusal = braced_body(
        shipmonk,
        r"if\s*\(\s*~has_entrana_restricted_items\s*=\s*true\s*\)",
        "Entrana travel restriction",
    )
    if refusal is not None:
        require("return;" in refusal, "restricted inventory returns before boarding")
    gate_match = re.search(r"if\s*\(\s*~has_entrana_restricted_items\s*=\s*true\s*\)", shipmonk)
    sail_match = re.search(r'~set_sail\s*\(\s*"Entrana"', shipmonk)
    require(
        gate_match is not None
        and sail_match is not None
        and gate_match.start() < sail_match.start()
        and refusal is not None
        and "return;" in refusal,
        "Entrana travel refusal returns before the existing sail operation",
    )
    restrictions = block(monk, "proc", "has_entrana_restricted_items")
    restriction_categories = {
        "armour_hands",
        "weapon_staff",
        "armour_helmet",
        "armour_body",
        "armour_legs",
        "armour_shield",
        "armour_cape",
        "armour_godcape",
        "weapon_slash",
        "weapon_blunt",
        "weapon_stab",
        "weapon_crossbow",
        "weapon_axe",
        "weapon_pickaxe",
        "weapon_javelin",
        "weapon_2h_sword",
        "weapon_spear",
        "weapon_spiked",
        "weapon_thrown",
        "weapon_scythe",
        "weapon_bow",
        "weapon_claws",
        "cannon_parts",
    }
    actual_restrictions = re.findall(r"inv_totalcat\s*\(\s*inv\s*,\s*([A-Za-z0-9_]+)\s*\)", restrictions)
    worn_restrictions = re.findall(r"inv_totalcat\s*\(\s*worn\s*,\s*([A-Za-z0-9_]+)\s*\)", restrictions)
    require(set(actual_restrictions) == restriction_categories, "Entrana retains every restricted inventory category")
    require(set(worn_restrictions) == restriction_categories - {"cannon_parts"}, "Entrana retains every original restricted worn category (cannon parts are inventory-only)")
    require("return(true);" in restrictions and "return(false);" in restrictions, "Entrana's restriction helper still reports both outcomes")

    stew_path = ROOT / "scripts" / "skill_cooking" / "scripts" / "cooking_inv" / "scripts" / "stew" / "stew.rs2"
    stew = read_text(stew_path)
    spice_route = block(stew, "opheldu", "spicespot")
    require(
        compact(spice_route)
        == "if(~dt_blood_pot(last_useitem)=true){~dt_blood_mix(last_useitem,last_item);return;}switch_obj(last_useitem){caseuncooked_stew:@make_curry;};",
        "spice-on-pot dispatch is narrowly guarded and preserves the exact original curry switch",
    )
    require(spice_route.count("~dt_blood_pot(") == 1 and spice_route.count("~dt_blood_mix(") == 1, "spice dispatch has one pot guard and one mixing call")


def check_blood_mixing(blood: str) -> None:
    expected_handlers = [f"opheldu,{pot}" for pot in POTS]
    actual_handlers = [header for header, _ in code_blocks(blood) if header.startswith("opheldu,fd_silver_pot")]
    require(actual_handlers == expected_handlers, "each of the ten original pot identities has one item-use handler in order")
    for header, body in code_blocks(blood):
        if header in expected_handlers:
            require(compact(body) == "~dt_blood_mix(last_item,last_useitem);", f"[{header}] dispatches exactly one mix attempt")

    pot_proc = block(blood, "proc", "dt_blood_pot")
    actual_pots = re.findall(r"case\s+([^:]+)\s*:\s*return\s*\(\s*true\s*\)\s*;", pot_proc)
    parsed_pots = [item.strip() for item in actual_pots[0].split(",")] if len(actual_pots) == 1 else []
    require(parsed_pots == list(POTS), "the tomb-recognition helper recognizes exactly the ten original pot identities")

    grind = block(blood, "opheldu", "garlic")
    wrong_tool = braced_body(grind, r"if\s*\(\s*last_useitem\s*!\s*pestle_and_mortar\s*\)", "garlic grinding tool")
    if wrong_tool is not None:
        require("return;" in wrong_tool and "inv_setslot(" not in wrong_tool, "wrong tool returns before transforming garlic")
    require(grind.count("inv_setslot(inv, last_slot, fd_crushed_garlic, 1);") == 1, "one garlic becomes one crushed-garlic ingredient")
    require_order(grind, ("return;", "inv_setslot(inv, last_slot, fd_crushed_garlic, 1);"), "garlic tool guard")

    mix = block(blood, "proc", "dt_blood_mix")
    invalid_mix = braced_body(mix, r"if\s*\(\s*\$result\s*=\s*null\s*\)", "invalid pot/ingredient mix")
    if invalid_mix is not None:
        require("return;" in invalid_mix, "invalid mixing combination returns")
        require(
            not any(effect in invalid_mix for effect in ("inv_del(", "inv_add(", "%fdvw_subquest =")),
            "invalid mixing combination consumes and writes nothing",
        )
    for statement in (
        "inv_del(inv, $pot, 1);",
        "inv_del(inv, $ingredient, 1);",
        "inv_add(inv, $result, 1);",
    ):
        require(mix.count(statement) == 1, f"mix transaction performs exactly one {statement}")
    require_order(
        mix,
        ("~dt_blood_mixture($pot, $ingredient)", "if ($result = null)", "inv_del(inv, $pot, 1);", "inv_del(inv, $ingredient, 1);", "inv_add(inv, $result, 1);"),
        "one-pot/one-ingredient mix transaction",
    )
    require(
        "if (%fdvw_subquest < ^dt_blood_substate_one_ingredient) %fdvw_subquest = ^dt_blood_substate_one_ingredient;" in mix,
        "the first ingredient advances once without regressing any later substate",
    )
    require(
        "if ($result = fd_silver_pot_blood_garlic_spiced_blessed & %fdvw_subquest < ^dt_blood_substate_prepared) %fdvw_subquest = ^dt_blood_substate_prepared;" in mix,
        "the second ingredient completes preparation only for the fully blessed result",
    )

    mixture = block(blood, "proc", "dt_blood_mixture")
    garlic_body = braced_body(mixture, r"if\s*\(\s*\$ingredient\s*=\s*fd_crushed_garlic\s*\)", "garlic-to-pot combinations")
    spice_body = braced_body(mixture, r"if\s*\(\s*\$ingredient\s*=\s*spicespot\s*\)", "spice-to-pot combinations")
    garlic_pairs = [
        ("fd_silver_pot_blood", "fd_silver_pot_blood_garlic"),
        ("fd_silver_pot_blood_blessed", "fd_silver_pot_blood_garlic_blessed"),
        ("fd_silver_pot_blood_spiced", "fd_silver_pot_blood_garlic_spiced"),
        ("fd_silver_pot_blood_spiced_blessed", "fd_silver_pot_blood_garlic_spiced_blessed"),
    ]
    spice_pairs = [
        ("fd_silver_pot_blood", "fd_silver_pot_blood_spiced"),
        ("fd_silver_pot_blood_blessed", "fd_silver_pot_blood_spiced_blessed"),
        ("fd_silver_pot_blood_garlic", "fd_silver_pot_blood_garlic_spiced"),
        ("fd_silver_pot_blood_garlic_blessed", "fd_silver_pot_blood_garlic_spiced_blessed"),
    ]
    for label, branch, expected in (("garlic-first or spice-first garlic branch", garlic_body, garlic_pairs), ("spice-first or garlic-first spice branch", spice_body, spice_pairs)):
        actual = re.findall(
            r"case\s+([A-Za-z0-9_]+)\s*:\s*return\s*\(\s*([A-Za-z0-9_]+)\s*\)\s*;",
            branch or "",
        )
        require(actual == expected, f"{label} preserves blessed and unblessed item transitions")
    require("return(null);" in mixture, "unsupported/repeated ingredient combinations produce no result")


def check_dessous_combat(dessous: str, shared_combat: str) -> None:
    code = active_code(dessous)
    require("%deserttreasure =" not in code, "Dessous never writes the Desert Treasure main stage")
    require("$questpoints =" not in code, "Dessous never writes quest points")
    require("fd_blood_diamond" not in code, "Dessous has no Blood diamond drop or award")

    expected_tomb_handlers = [
        "oplocu,vampire_big_grave_noblood",
        "oplocu,vampire_big_grave_withblood",
    ]
    actual_tomb_handlers = [header for header, _ in code_blocks(dessous) if header.startswith("oplocu,")]
    require(actual_tomb_handlers == expected_tomb_handlers, "both original tomb states route to the same guarded offering procedure")
    for header, body in code_blocks(dessous):
        if header in expected_tomb_handlers:
            require(
                compact(body) == "~dt_dessous_pour(last_useitem,last_useslot);",
                f"[{header}] forwards the used item and its slot to the guarded tomb procedure",
            )
    pour = block(dessous, "proc", "dt_dessous_pour")
    invalid_item = braced_body(pour, r"if\s*\(\s*~dt_blood_pot\s*\(\s*\$pot\s*\)\s*=\s*false\s*\)", "tomb non-pot refusal")
    if invalid_item is not None:
        require("return;" in invalid_item, "non-pot use on the tomb returns")
        require(not any(effect in invalid_item for effect in ("inv_setslot(", "npc_add(", "%fdvw_subquest =")), "non-pot tomb refusal has no item, NPC or progress effect")
    empty_pot = braced_body(
        pour,
        r"if\s*\(\s*\$pot\s*=\s*fd_silver_pot\s*\|\s*\$pot\s*=\s*fd_silver_pot_blessed\s*\)",
        "empty-pot tomb refusal",
    )
    if empty_pot is not None:
        require("return;" in empty_pot, "either empty pot returns without summoning Dessous")
        require(not any(effect in empty_pot for effect in ("inv_setslot(", "npc_add(", "%fdvw_subquest =")), "empty-pot refusal has no item, NPC or progress effect")
    tomb_gate = braced_body(
        pour,
        r"if\s*\(\s*%deserttreasure\s*<\s*\^dt_stage_hunts.*?~dt_dessous_find\s*=\s*true\s*\)",
        "tomb stage, substate and existing-boss gate",
    )
    if tomb_gate is not None:
        require("return;" in tomb_gate, "tomb refuses an out-of-stage or already-active encounter")
        require(not any(effect in tomb_gate for effect in ("inv_setslot(", "npc_add(", "%fdvw_subquest =")), "failed tomb admission has no item, NPC or progress effect")
    require_order(
        pour,
        ("if (~dt_blood_pot($pot) = false)", "if ($pot = fd_silver_pot | $pot = fd_silver_pot_blessed)", "if (%deserttreasure < ^dt_stage_hunts", "inv_setslot(inv, $slot, $empty, 1);", "npc_add(", "%npc_attacking_uid = uid"),
        "tomb refusal and spawn sequence",
    )
    require(
        "$dessous = blooddiamond_vampirewarrior_unkillable;" in pour
        and re.search(
            r"case\s+fd_silver_pot_blood_garlic_spiced_blessed\s*:\s*\$empty\s*=\s*fd_silver_pot_blessed\s*;\s*\$dessous\s*=\s*blooddiamond_vampirewarrior\s*;",
            pour,
        )
        is not None,
        "only the fully blessed blood/garlic/spice identity summons killable Dessous; all other blood mixtures default unkillable",
    )
    require(pour.count("$dessous = blooddiamond_vampirewarrior;") == 1, "the prepared-pot branch is the sole killable Dessous selector")
    require(
        "if ($dessous = blooddiamond_vampirewarrior) %fdvw_subquest = ^dt_blood_substate_dessous_active;" in pour,
        "only the real killable Dessous spawn enters the active substate",
    )
    require_order(
        pour,
        ("npc_add(^dt_dessous_spawn, $dessous, ^dt_dessous_lifetime);", "%npc_attacking_uid = uid;", "npc_setmode(applayer2);", "npc_settimer(1);", "%fdvw_subquest = ^dt_blood_substate_dessous_active;"),
        "owner-bound prepared Dessous spawn",
    )

    find = block(dessous, "proc", "dt_dessous_find")
    require(
        find.count("npc_findall(^dt_dessous_grave, blooddiamond_vampirewarrior, ^dt_dessous_leash, 0);") == 1
        and find.count("npc_findall(^dt_dessous_grave, blooddiamond_vampirewarrior_unkillable, ^dt_dessous_leash, 0);") == 1
        and find.count("if (%npc_attacking_uid = uid) return(true);") == 2,
        "active-encounter lookup recognizes each Dessous form only for its recorded owner",
    )
    require("return(false);" in find, "a spectator cannot treat another player's Dessous as their own encounter")

    attackable = block(dessous, "proc", "dt_dessous_attackable")
    require(
        "if (npc_type ! blooddiamond_vampirewarrior & npc_type ! blooddiamond_vampirewarrior_unkillable) return(true);" in attackable
        and "if (%npc_attacking_uid = uid) return(true);" in attackable
        and "Someone else is fighting that." in attackable
        and "return(false);" in attackable,
        "both Dessous forms are attackable only by their owner while unrelated NPCs keep the shared default",
    )
    require_order(attackable, ("if (%npc_attacking_uid = uid) return(true);", "Someone else is fighting that.", "return(false);"), "spectator refusal")

    expected_ai_headers = [
        "ai_timer,blooddiamond_vampirewarrior",
        "ai_timer,blooddiamond_vampirewarrior_unkillable",
        "ai_queue1,blooddiamond_vampirewarrior",
        "ai_queue1,blooddiamond_vampirewarrior_unkillable",
        "ai_applayer2,blooddiamond_vampirewarrior",
        "ai_applayer2,blooddiamond_vampirewarrior_unkillable",
        "ai_opplayer2,blooddiamond_vampirewarrior",
        "ai_opplayer2,blooddiamond_vampirewarrior_unkillable",
        "ai_queue2,blooddiamond_vampirewarrior",
        "ai_queue2,blooddiamond_vampirewarrior_unkillable",
        "ai_queue3,blooddiamond_vampirewarrior",
    ]
    actual_ai_headers = [header for header, _ in code_blocks(dessous) if header.startswith(("ai_timer,", "ai_queue1,", "ai_applayer2,", "ai_opplayer2,", "ai_queue2,", "ai_queue3,"))]
    require(actual_ai_headers == expected_ai_headers, "both Dessous forms have owner-bound combat timers and only the normal form has quest death credit")

    retaliation = block(dessous, "proc", "dt_dessous_retaliate")
    require(
        "%npc_aggressive_player ! %npc_attacking_uid" in retaliation
        and "finduid(%npc_attacking_uid) = false" in retaliation,
        "Dessous retaliation remains bound to the original attacker",
    )
    attack = block(dessous, "proc", "dt_dessous_attack")
    require(
        "if (%npc_attacking_uid ! uid | %npc_action_delay > map_clock) return;" in attack
        and "~npc_check_notcombat = false | ~npc_check_notcombat_self = false" in attack,
        "Dessous attack checks the encounter owner and both combat participants before acting",
    )
    chase = braced_body(attack, r"if\s*\(\s*distance\s*\(\s*npc_coord\s*,\s*coord\s*\)\s*>\s*\^dt_dessous_chase_distance\s*\)", "Dessous teleport chase")
    if chase is not None:
        require_order(
            chase,
            ("npc_tele(", "%npc_int = add(%npc_int, 1);", "if (%npc_int >= ^dt_dessous_teleports_limit)", "npc_del;", "return;"),
            "Dessous returns after the third successful chase teleport",
        )
    bat_queues = re.findall(
        r"queue\s*\(\s*combat_damage_player\s*,\s*\^([A-Za-z0-9_]+)\s*,\s*\^([A-Za-z0-9_]+)\s*\)\s*;",
        attack,
    )
    require(
        bat_queues
        == [
            ("dt_dessous_bat_first_delay", "dt_dessous_bat_damage"),
            ("dt_dessous_bat_second_delay", "dt_dessous_bat_damage"),
        ],
        "Dessous uses two separate bat hits, each with its own delay and shared five-damage amount",
    )

    failed = block(dessous, "ai_queue2", "blooddiamond_vampirewarrior_unkillable")
    require(
        "if (npc_stat(hitpoints) = 0) return;" in failed
        and "npc_statheal(hitpoints, npc_basestat(hitpoints), 0);" in failed
        and "%fdvw_subquest =" not in failed
        and "fd_blood_diamond" not in failed,
        "an incomplete or unblessed summon regenerates at zero HP without valid-kill progress or a diamond",
    )
    require_order(
        failed,
        ("if (npc_stat(hitpoints) = 0) return;", "npc_damage(", "if (npc_stat(hitpoints) = 0) {", "npc_statheal(hitpoints, npc_basestat(hitpoints), 0);"),
        "unkillable Dessous zero-HP regeneration",
    )
    death = block(dessous, "ai_queue3", "blooddiamond_vampirewarrior")
    hero_death = braced_body(
        death,
        r"if\s*\(\s*npc_findhero\s*=\s*\^true\s*\)",
        "normal Dessous hero death",
    )
    if hero_death is not None:
        owned_active_death = braced_body(
            hero_death,
            r"if\s*\(\s*uid\s*=\s*%npc_attacking_uid\s*&\s*%fdvw_subquest\s*=\s*\^dt_blood_substate_dessous_active\s*\)",
            "active owner Dessous death",
        )
        if owned_active_death is not None:
            require(
                compact(owned_active_death) == "queue(dt_dessous_defeated,0,0);",
                "only the active owner receives queued defeated credit for a real Dessous kill",
            )
    require(
        "queue(dt_dessous_defeated,0,0);" in compact(death),
        "normal Dessous death queues the guarded defeated-state update",
    )
    defeated_queue = block(dessous, "queue", "dt_dessous_defeated")
    require(
        compact(defeated_queue)
        == "if(%fdvw_subquest=^dt_blood_substate_dessous_active)%fdvw_subquest=^dt_blood_substate_dessous_defeated;",
        "queued kill credit advances only from active to defeated",
    )
    require(code.count("%fdvw_subquest = ^dt_blood_substate_dessous_defeated;") == 1, "Dessous has exactly one defeated-state writer, in the protected player queue")
    require("blooddiamond_vampirewarrior_unkillable" not in [header.split(",", 1)[1] for header, _ in code_blocks(dessous) if header.startswith("ai_queue3,")], "unkillable Dessous has no quest death-credit handler")

    attack_checks = shared_combat
    for name in ("npc_is_attackable", "npc_is_attackable_opt"):
        shared_check = block(attack_checks, "proc", name, f"shared {name} attack check")
        guard = "if (~dt_dessous_attackable = false) return(false);"
        require(shared_check.count(guard) == 1, f"{name} invokes the Dessous owner guard exactly once")
        require_order(shared_check, (guard, "npc_hasop(2)"), f"{name} owner guard before attack-option return")


def check_award_and_journal(blood: str, journal: str) -> None:
    code = active_code(blood)
    require("%deserttreasure =" not in code, "Blood state never writes the Desert Treasure main stage")
    require("$questpoints =" not in code, "Blood state never awards or recounts quest points")

    malak = block(blood, "opnpc1", "fourdiamonds_vampire_lord")
    require(
        re.search(r"if\s*\(\s*%fdvw_subquest\s*>=\s*\^dt_blood_substate_dessous_defeated\s*\)\s*\{\s*@dt_malak_award;", malak, flags=re.S)
        is not None,
        "Malak's award and reclaim path is reachable only after a recorded valid Dessous kill",
    )
    award = block(blood, "label", "dt_malak_award")
    duplicate_guard = braced_body(
        award,
        r"if\s*\(\s*inv_total\s*\(\s*inv\s*,\s*fd_blood_diamond\s*\)\s*>\s*0\s*\|\s*inv_total\s*\(\s*bank\s*,\s*fd_blood_diamond\s*\)\s*>\s*0\s*\|\s*%fd_column_blood\s*=\s*\^dt_column_placed\s*\)",
        "held/banked/placed Blood diamond duplicate guard",
    )
    if duplicate_guard is not None:
        require("return;" in duplicate_guard, "existing held/banked or already-placed Blood diamond returns")
        require(
            not any(effect in duplicate_guard for effect in ("inv_del(", "inv_add(", "~dt_blood_take_pots", "%fdvw_subquest =")),
            "duplicate Blood diamond guard performs no item removal, grant or state write",
        )
    require(
        "if (inv_total(inv, fd_blood_diamond) > 0 | inv_total(bank, fd_blood_diamond) > 0 | %fd_column_blood = ^dt_column_placed) return;" in award,
        "the pre-commit reread also blocks a held, banked or placed duplicate after dialogue",
    )
    require_order(
        award,
        (
            "if (inv_total(inv, fd_blood_diamond) > 0 | inv_total(bank, fd_blood_diamond) > 0 | %fd_column_blood = ^dt_column_placed) return;",
            "~dt_blood_take_pots;",
            "inv_add(inv, fd_blood_diamond, 1);",
            "%fdvw_subquest = ^dt_blood_substate_diamond_claimed;",
        ),
        "Malak diamond handover and claimed-state transaction",
    )
    space_guard = braced_body(
        award,
        r"if\s*\(\s*inv_itemspace\s*\(\s*inv\s*,\s*fd_blood_diamond\s*,\s*1\s*,\s*inv_size\s*\(\s*inv\s*\)\s*\)\s*=\s*false\s*&\s*~dt_blood_held_pot\s*=\s*false\s*\)",
        "Malak award inventory-space guard",
    )
    if space_guard is not None:
        require("return;" in space_guard, "Malak waits for inventory space when no held pot slot can be reclaimed")
        require(not any(effect in space_guard for effect in ("~dt_blood_take_pots", "inv_add(", "%fdvw_subquest =")), "inventory-space refusal does not consume pots or claim a diamond")

    take_pots = block(blood, "proc", "dt_blood_take_pots")
    removed_pots = re.findall(r"~dt_blood_take_pot\s*\(\s*([A-Za-z0-9_]+)\s*\)\s*;", take_pots)
    require(sorted(removed_pots) == sorted(POTS) and len(removed_pots) == len(POTS), "award and reclaim remove each of the ten original pot variants exactly once")
    take_pot = block(blood, "proc", "dt_blood_take_pot")
    require(
        take_pot.count("inv_del(inv, $pot, inv_total(inv, $pot));") == 1
        and take_pot.count("inv_del(bank, $pot, inv_total(bank, $pot));") == 1,
        "each pot-removal operation drains every held and banked copy",
    )

    journal_proc = block(blood, "proc", "dt_blood_journal")
    claimed = braced_body(
        journal_proc,
        r"if\s*\(\s*%fdvw_subquest\s*=\s*\^dt_blood_substate_diamond_claimed\s*\)",
        "claimed Blood diamond journal state",
    )
    require_order(
        journal_proc,
        ("if (%fdvw_subquest = ^dt_blood_substate_diamond_claimed)", "if (%fdvw_subquest >= ^dt_blood_substate_dessous_defeated)"),
        "claimed-journal case before defeated/unclaimed case",
    )
    if claimed is not None:
        for summary in (
            "Blood diamond claimed and placed",
            "Blood diamond claimed and banked",
            "Blood diamond claimed.| ",
            "I should ask Malak to replace the lost diamond.",
            "inv_total(inv, fd_blood_diamond)",
            "inv_total(bank, fd_blood_diamond)",
            "%fd_column_blood = ^dt_column_placed",
        ):
            require(summary in claimed, f"claimed journal distinguishes held, banked, placed and lost state: {summary}")
    require(
        "Malak holds the Blood diamond until I claim it." in journal_proc
        and "Dessous defeated." in journal_proc
        and "I have prepared the Blood offering. I should defeat Dessous." in journal_proc
        and "I am preparing the Blood offering:" in journal_proc
        and "I agreed to Malak's bargain. Ruantun can make the silver pot." in journal_proc
        and "I should find the Blood diamond." in journal_proc,
        "authored Blood journal describes the agreement, preparation, valid kill and claim accurately",
    )
    require(
        "inv_del(" not in journal_proc
        and "inv_add(" not in journal_proc
        and re.search(r"(?:^|[;{})])\s*%fdvw_subquest\s*=", journal_proc, flags=re.M) is None,
        "Blood journal reporting is read-only",
    )
    journal_code = active_code(journal)
    require(journal_code.count("~dt_blood_journal") == 2, "main stage 10 and the later diamond-placement journal both include Blood status")
    require(
        "~dt_blood_journal" in block(journal, "if_button", "questlist:deserttreasure")
        and "^dt_stage_hunts" in block(journal, "if_button", "questlist:deserttreasure"),
        "Blood journal is attached to the stage-10 hunt row without a new main stage",
    )


def main() -> int:
    blood = read_text(SCRIPTS / "dt_blood.rs2")
    dessous = read_text(SCRIPTS / "dt_dessous.rs2")
    journal = read_text(SCRIPTS / "dt_journal.rs2")
    priest = read_text(ROOT / "scripts" / "areas" / "area_entrana" / "scripts" / "high_priest_of_entrana.rs2")
    monk = read_text(ROOT / "scripts" / "areas" / "area_port_sarim" / "scripts" / "monk_of_entrana.rs2")
    shared_combat = read_text(ROOT / "scripts" / "skill_combat" / "scripts" / "npc" / "npc_combat.rs2")

    check_config_identity()
    check_blood_constants()
    check_blood_preparation(blood)
    check_blood_blessing(blood, priest, monk)
    check_blood_mixing(blood)
    check_dessous_combat(dessous, shared_combat)
    check_award_and_journal(blood, journal)

    if failures:
        print("\n".join(f"FAIL: {failure}" for failure in failures))
        return 1
    print("PASS: Desert Treasure S4 Blood config, preparation, blessing, combat, award and journal contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

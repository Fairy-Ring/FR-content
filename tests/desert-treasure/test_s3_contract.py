#!/usr/bin/env python3
"""Offline source and packed-NPC tripwires for the Desert Treasure S3 shadow slice."""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

ROOT = Path(os.environ.get("DT_S3_CONTENT_ROOT", Path(__file__).resolve().parents[2])).resolve()
QUEST = ROOT / "scripts" / "quests" / "quest_deserttreasure"
COMBAT = ROOT / "scripts" / "skill_combat" / "scripts" / "npc" / "npc_combat.rs2"
SCRIPTS = QUEST / "scripts"
UNPACK = ROOT / "scripts" / "_unpack" / "377"
failures: list[str] = []


def require(ok: bool, message: str) -> None:
    if not ok:
        failures.append(message)


def text(path: Path) -> str:
    if not path.is_file():
        failures.append(f"missing S3 file: {path.relative_to(ROOT)}")
        return ""
    return path.read_text(encoding="utf-8")


def active(source: str) -> str:
    return "\n".join(line.split("//", 1)[0] for line in source.splitlines())


def sections(source: str) -> dict[tuple[str, str], str]:
    """Return each RuneScript section up to the next section header."""
    source = active(source)
    found = list(re.finditer(r"(?m)^\[([^,\]]+),([^\]]+)\](?:\([^\n]*\))?", source))
    return {
        (match.group(1).strip(), match.group(2).strip()): source[
            match.end(): found[index + 1].start() if index + 1 < len(found) else len(source)
        ]
        for index, match in enumerate(found)
    }


def npc_configs(source: str) -> dict[str, dict[str, list[str]]]:
    configs: dict[str, dict[str, list[str]]] = {}
    current: dict[str, list[str]] | None = None
    for raw_line in source.splitlines():
        line = raw_line.strip()
        match = re.fullmatch(r"\[([^\],]+)\]", line)
        if match:
            current = configs.setdefault(match.group(1), {})
        elif current is not None and line and not line.startswith("//") and "=" in line:
            key, value = line.split("=", 1)
            current.setdefault(key.strip(), []).append(value.strip())
    return configs


def require_section(parts: dict[tuple[str, str], str], kind: str, name: str) -> str:
    body = parts.get((kind, name), "")
    require(bool(body), f"missing [{kind},{name}] section")
    return body


def constants(text_value: str) -> dict[str, str]:
    return dict(re.findall(r"(?m)^\s*\^([A-Za-z0-9_]+)\s*=\s*([^\s/]+)", active(text_value)))


def branch(body: str, condition: str) -> str:
    """Read one braced branch, including nested braces, without matching dead comments."""
    marker = f"if ({condition}) {{"
    start = body.find(marker)
    if start < 0:
        return ""
    start += len(marker)
    depth = 1
    for end in range(start, len(body)):
        depth += (body[end] == "{") - (body[end] == "}")
        if depth == 0:
            return body[start:end].strip()
    return ""


def check_ring_dialogue(shadow: str, shared_constants: str) -> None:
    """Execute the small dialogue/control-flow subset reached by these ring cases.

    This is a source tripwire, not a packed-engine or historical proof. Unknown
    statements fail rather than being skipped. The live cell covers real packets.
    """
    parts = sections(shadow)
    values = constants(shared_constants)
    lost = [
        "I lost that ring you gave me...",
        "Then by all means, take another. Only a foolish merchant would give away his only stock!",
    ]
    opening = [
        "So how goes your quest? Did you manage to find the Diamond you were looking for yet?",
        "Not yet...",
    ]
    standard = ["Greetings friend. I am Rasolo, the famous merchant. Would you care to see my wares?"]

    def talk(stage: int, substate: int, held: list[int], free: int) -> tuple[list[str], int]:
        pages: list[str] = []
        state = {"deserttreasure": stage, "fd_shadowwarrior_quest": substate}

        def condition(source: str) -> bool:
            source = source.replace("~obj_gettotal(fd_ring_visibility)", str(sum(held)))
            source = source.replace("inv_freespace(inv)", str(free))
            source = source.replace('~p_choice2("Yes", 1, "No", 2)', "2")
            source = re.sub(r"%(\w+)", lambda m: str(state[m[1]]), source)
            source = re.sub(r"\^(\w+)", lambda m: values[m[1]], source)
            source = source.replace("|", " or ").replace("&", " and ")
            source = re.sub(r"(?<![<>=!])=(?!=)", "==", source)
            source = re.sub(r"(?<![<>=])!(?!=)", "!=", source)
            if not re.fullmatch(r"(?:\d+|\s+|[<>=!()]|and\b|or\b)+", source):
                raise ValueError(f"unsupported ring condition: {source}")
            return bool(eval(source, {"__builtins__": {}}, {}))

        def execute(body: str, depth: int = 0) -> bool:
            if depth > 12:
                raise ValueError("ring dialogue control-flow cycle")
            while body.strip():
                body = body.lstrip()
                if body.startswith("if ("):
                    level, end, quoted = 1, 4, False
                    while level:
                        char = body[end]
                        if char == '"':
                            quoted = not quoted
                        if not quoted:
                            level += (char == "(") - (char == ")")
                        end += 1
                    test, tail = body[4:end - 1], body[end:].lstrip()
                    if tail.startswith("{"):
                        level, end = 1, 1
                        while level:
                            level += (tail[end] == "{") - (tail[end] == "}")
                            end += 1
                        statement, body = tail[1:end - 1], tail[end:]
                    else:
                        statement, _, body = tail.partition(";")
                        statement += ";"
                    if condition(test) and execute(statement, depth + 1):
                        return True
                    continue
                speech = re.match(r'~chat(?:npc|player)\("([^"]*)"\);', body)
                if speech:
                    pages.append(speech[1])
                    body = body[speech.end():]
                    continue
                statement, separator, body = body.partition(";")
                if not separator:
                    raise ValueError(f"unterminated ring statement: {statement}")
                if statement.startswith("@"):
                    execute(parts[("label", statement[1:])], depth + 1)
                    return True
                if statement == "return":
                    return True
                if statement == "inv_add(inv, fd_ring_visibility, 1)":
                    held[0] += 1
                    continue
                raise ValueError(f"unsupported ring statement: {statement}")
            return False

        execute(parts[("opnpc1", "shadow_warrior_rasool")])
        return pages, held[0]

    for stage in (10, 15):
        for location, held in (("inventory", [1, 0, 0]), ("bank", [0, 1, 0]), ("worn", [0, 0, 1])):
            require(talk(stage, 6, held.copy(), 27) == (standard, held[0]),
                    f"state 6 stage {stage} ring in {location}: standard talk and no new ring")
        require(talk(stage, 6, [0, 0, 0], 28) == (lost, 1),
                f"state 6 stage {stage} lost ring: exactly the two pages and one ring")
        held = [0, 0, 0]
        require(talk(stage, 6, held, 0) == (lost, 0),
                f"state 6 stage {stage} full inventory: pages but no ring")
        require(talk(stage, 6, held, 1) == (lost, 1),
                f"state 6 stage {stage} next talk with a slot: one ring")
    require(talk(10, 2, [0, 0, 0], 28) == (opening + lost, 1),
            "hunt-stage lost ring retains its opening, replacement pages and grant")
    require(talk(10, 2, [0, 1, 0], 28) ==
            (opening + ["Well, his lair is very close to here. I suggest you look around for it."], 0),
            "hunt-stage banked ring retains its opening and lair page without a grant")


def check_shadow(shadow: str, shadow_constants: str, shared_constants: str) -> None:
    parts = sections(shadow)
    values = constants(shadow_constants)
    shared = constants(shared_constants)
    rasolo = require_section(parts, "opnpc1", "shadow_warrior_rasool")
    decline = require_section(parts, "label", "dt_rasolo_decline")
    accept = require_section(parts, "label", "dt_rasolo_accept")
    intro = require_section(parts, "label", "dt_rasolo_diamonds")
    exchange = require_section(parts, "label", "dt_rasolo_cross")
    after = require_section(parts, "label", "dt_rasolo_after")
    chest = require_section(parts, "label", "dt_shadow_chest")
    pick = require_section(parts, "label", "dt_shadow_pick")
    cross = require_section(parts, "proc", "dt_shadow_cross")
    entry = require_section(parts, "label", "dt_shadow_enter")
    primary = require_section(parts, "proc", "dt_shadow_visibility")
    secondary = require_section(parts, "proc", ".dt_shadow_visibility")

    require("fd_shadowwar_intro" in intro and "^dt_flag_on" in intro, "Rasolo intro sets the original shadow-intro bit")
    require("fd_shadowwarrior_quest" in accept and "^dt_shadow_substate_rasolo_agreed" in accept, "Rasolo acceptance starts substate 1")
    require(not re.search(r"%\w+\s*=(?!=)", decline), "Rasolo decline writes no quest progress")
    offer = require_section(parts, "label", "dt_rasolo_directions")
    require("dt_rasolo_decline" in offer and "dt_rasolo_accept" in offer, "Rasolo offers both explicit accept and decline responses")
    require("fd_shadowwarrior_quest" in exchange and "^dt_shadow_substate_rasolo_agreed" in exchange, "cross exchange rechecks substate 1 after dialogue")
    require("inv_total(inv, fd_sword_cross)" in exchange and "= 0" in exchange, "cross exchange rechecks the held cross after dialogue")
    require(exchange.count("inv_del(inv, fd_sword_cross, 1)") == 1, "cross exchange consumes exactly one held cross")
    require(exchange.count("inv_add(inv, fd_ring_visibility, 1)") == 1, "cross exchange gives exactly one ring")
    require("^dt_shadow_substate_cross_returned_ring_awarded" in exchange, "cross exchange advances to substate 2")
    require(exchange.index("~chatnpc") < exchange.index("inv_del") < exchange.index("inv_add") < exchange.index("^dt_shadow_substate_cross_returned_ring_awarded"), "exchange rechecks and updates state after its dialogue")

    ring_total = "obj_gettotal(fd_ring_visibility)"
    replacement = require_section(parts, "label", "dt_rasolo_replace_ring")
    require(ring_total in after and "@dt_rasolo_replace_ring" in after, "hunt-stage Rasolo shares missing-ring replacement")
    require("inv_freespace(inv)" in replacement, "ring reissue checks inventory capacity")
    require(replacement.count("inv_add(inv, fd_ring_visibility, 1)") == 1, "shared replacement has exactly one grant")
    require("bank" in shadow.lower() and "worn" in shadow.lower(), "ring total includes inventory, bank and worn storage")
    require("his lair" not in replacement, "lost-ring replacement ends without the extra lair page")
    standard = require_section(parts, "label", "dt_rasolo_standard")
    require(
        bool(branch(rasolo, "%fd_shadowwarrior_quest >= ^dt_shadow_substate_diamond_claimed")),
        "diamond-claimed Rasolo talk checks for a lost ring before the standard greeting",
    )
    require(
        '~p_choice2("Yes", 1, "No", 2)' in standard and "@dt_rasolo_shop" in standard
        and "Diamonds of Azzanadra" not in standard and "Not yet" not in standard,
        "standard Rasolo dialogue retains only the existing greeting and shop menu",
    )
    require("obj_gettotal(fd_sword_cross)" in cross and "fd_sword_cross" in cross, "chest refuses a cross already held or banked")
    require("inv_add(inv, fd_sword_cross, 1)" in cross, "chest awards the cross only after the duplicate check")

    require(values.get("dt_shadow_thieving_required") == "53", "shadow chest Thieving gate is exactly 53")
    require("stat(thieving) < ^dt_shadow_thieving_required" in chest, "below-53 chest attempt returns silently")
    require("~mesbox" not in chest.split("stat(thieving)", 1)[0], "Thieving refusal has no message")
    require(not re.search(r"(?m)^\s*%\w+\s*=(?!=)", chest), "below-53 refusal writes no quest or chest progress")
    require("inv_total(inv, lockpick) = 0" in pick, "chest refuses to proceed without a lockpick")
    require("inv_add" not in pick and "obj_add" not in pick, "missing-lockpick branch grants no item")
    require(values.get("dt_shadow_locks_required") == "3", "chest has exactly three locks")
    require(
        '~p_choice2_header("Yes", 1, "No", 2, "Try to open the chest?")' in chest,
        "chest confirmation uses the transcript menu title, not the default header",
    )
    for body, message, name in (
        (pick, "You will need a lockpick for this lock.", "missing-lockpick"),
        (cross, "You find nothing of interest inside the chest.", "already-held-cross"),
        (cross, "Inside the chest, hidden under some rags, you find a Gilded Cross.", "cross-found"),
    ):
        require(
            f'mes("{message}");' in body and f'~mesbox("{message}");' not in body,
            f"{name} uses a game message, not a textbox",
        )
    require(
        '~mesbox("Your skill as a thief allows you to see some kind of elaborate booby trapped locking mechanism on this chest.");' in chest,
        "only the chest trap introduction retains its transcript textbox",
    )
    require(values.get("dt_shadow_lock_low") == "52" and values.get("dt_shadow_lock_high") == "128", "each lock uses the 52-128 Thieving roll")
    require("while ($lock < ^dt_shadow_locks_required)" in pick and "stat_random(thieving, ^dt_shadow_lock_low, ^dt_shadow_lock_high)" in pick, "explicit three-iteration loop makes independent lock rolls")
    require("$lock = add($lock, 1)" in pick, "each successful lock advances the independent roll counter")
    require("inv_del(inv, lockpick, 1)" in pick and "damage_self" in pick and "poison_player" in pick and "reset itself" in pick, "failed roll resets, snaps the pick, poisons and aborts")
    failure_path = pick.split("if (stat_random(thieving, ^dt_shadow_lock_low, ^dt_shadow_lock_high) = false)", 1)[-1]
    require("poison_player" in failure_path and failure_path.index("return;") < failure_path.index("%fd_banditchest_disarmed = ^dt_flag_on"), "poison failure returns before permanent disarm")
    require(pick.index("%fd_banditchest_disarmed = ^dt_flag_on") > pick.index("while ($lock"), "permanent disarm occurs only after all three locks succeed")

    require("fd_ladder_present" in primary and "inv_total(worn, fd_ring_visibility)" in primary, "primary visibility hook mirrors worn ring state")
    require("fd_ladder_present" in secondary and ".inv_total(worn, fd_ring_visibility)" in secondary, "secondary visibility hook mirrors worn ring state")
    require("inv_total(worn, fd_ring_visibility) = 0" in entry and "return" in entry, "surface ladder requires the worn ring")
    require("climb_ladder(^dt_shadow_inside_arrival, true)" in entry, "surface ladder enters the underground child")
    for ladder in ("fd_shadowladder1", "fd_shadow_ladder_there"):
        ladder_op = require_section(parts, "oploc1", ladder)
        require("@dt_shadow_enter" in ladder_op, f"{ladder} surface parent/child dispatches to the guarded entrance")
    exit_body = require_section(parts, "oploc1", "fd_shadowladder")
    require("climb_ladder(^dt_shadow_outside_arrival, true)" in exit_body and "fd_ring_visibility" not in exit_body, "underground exit works without the ring")
    require(values.get("dt_shadow_inside_arrival") and values.get("dt_shadow_outside_arrival"), "both surface and underground arrival points are configured")
    require(shared.get("dt_shadow_substate_rasolo_agreed") == "1" and shared.get("dt_shadow_substate_cross_returned_ring_awarded") == "2", "shared constants pin shadow substates 1 and 2")
    active_source = active(shadow)
    require(not re.search(r"%deserttreasure(?:main|varbit2?)?\s*=(?!=)", active_source), "S3 never assigns a whole-word quest varp")
    check_ring_dialogue(shadow, shared_constants)
    require(not re.search(r"(?m)^\s*varp\s*=", active_source), "S3 never appends a varp declaration")

def check_damis(damis: str, shared_constants: str, shadow_constants: str, npc_source: str, combat_source: str) -> None:
    parts = sections(damis)
    active_source = active(damis)
    attackable = require_section(parts, "proc", "dt_damis_attackable")
    spawn = require_section(parts, "proc", "dt_damis_spawn")
    hit = require_section(parts, "proc", "dt_damis_hit")
    first_death = require_section(parts, "label", "dt_damis_first_death")
    second_queue = require_section(parts, "queue", "dt_damis_second")
    second_death = require_section(parts, "label", "dt_damis_second_death")
    award_queue = require_section(parts, "queue", "dt_damis_award")
    pickup = require_section(parts, "opobj3", "fd_dark_diamond")
    combat_parts = sections(combat_source)
    normal_attackable = require_section(combat_parts, "proc", "npc_is_attackable")
    optional_attackable = require_section(combat_parts, "proc", "npc_is_attackable_opt")
    shared = constants(shared_constants)
    values = constants(shadow_constants)
    npcs = npc_configs(npc_source)
    approach = require_section(parts, "queue", "dt_damis_approach")
    recovery = branch(approach, "%fd_shadowwarrior_quest >= ^dt_shadow_substate_damis_defeated")
    require(bool(recovery), "defeated and claimed states have a dedicated loss-recovery branch")
    require(
        "if (~obj_gettotal(fd_dark_diamond) > 0 | %fd_column_shadow = ^dt_column_placed) return;" in recovery,
        "loss recovery keeps held, banked and column-placed diamond guards",
    )
    require(
        "if (~dt_damis_ground = true) return;" in recovery
        and "%fd_shadowwarrior_quest = ^dt_shadow_substate_damis_defeated" not in recovery,
        "both defeated and claimed recovery preserve a visible owner ground diamond",
    )
    require(
        "obj_add(^dt_damis_spawn, fd_dark_diamond, 1, ^lootdrop_duration);" in recovery
        and recovery.count("obj_add(") == 1,
        "loss recovery recreates exactly one owner-only ground diamond",
    )
    require(
        not re.search(r"%fd_shadowwarrior_quest\s*=(?!=)", recovery)
        and "dt_damis_spawn;" not in recovery and "inv_add" not in recovery
        and recovery.endswith("return;"),
        "loss recovery preserves state 5 or 6 and returns without a Damis re-fight or inventory grant",
    )

    server_fields = {
        "fd_damis_normal": {
            "wanderrange": "0", "maxrange": "64",
            "attackrange": "1", "defaultmode": "none", "timer": "1", "ranged": "1",
        },
        "fd_damis_tougher": {
            "wanderrange": "0", "maxrange": "64",
            "attackrange": "1", "defaultmode": "none", "timer": "1", "ranged": "1",
        },
    }
    server_params = {
        "fd_damis_normal": (
            "damagetype,^crush_style", "attack_anim,human_dhsword_chop",
            "defend_anim,human_dhsword_def", "death_anim,human_death",
            "attack_sound,2H_slash", "defend_sound,steel", "death_sound,human_death",
            "death_drop,null", "strengthbonus,80", "stabdefence,60",
            "slashdefence,60", "crushdefence,60", "magicdefence,60", "rangedefence,60",
        ),
        "fd_damis_tougher": (
            "damagetype,^crush_style", "attack_anim,human_dhsword_chop",
            "defend_anim,human_dhsword_def", "death_anim,human_death",
            "attack_sound,2H_slash", "defend_sound,steel", "death_sound,human_death",
            "death_drop,null", "strengthbonus,100", "stabdefence,100",
            "slashdefence,100", "crushdefence,100", "magicdefence,80", "rangedefence,120",
        ),
    }
    for npc, fields in server_fields.items():
        require("size" not in npcs.get(npc, {}), f"[{npc}] must inherit size 1 without changing client bytes")
        for field, expected in fields.items():
            require(npcs.get(npc, {}).get(field) == [expected], f"[{npc}] {field} pins server behavior to {expected}")
        for param in server_params[npc]:
            require(npcs.get(npc, {}).get("param", []).count(param) == 1, f"[{npc}] pins server param {param}")

    alive = require_section(parts, "proc", "dt_damis_alive")
    require("npc_findall(^dt_damis_spawn, fd_damis_normal" in alive and "npc_findall(^dt_damis_spawn, fd_damis_tougher" in alive, "owned Damis presence checks both forms")
    require(alive.count("%npc_aggressive_player = uid") == 2, "both Damis form scans enforce the initiating player's ownership")
    for proc_name, body in (
        ("npc_is_attackable", normal_attackable),
        ("npc_is_attackable_opt", optional_attackable),
    ):
        require(
            "npc_type = fd_damis_normal | npc_type = fd_damis_tougher" in body
            and "return(~dt_damis_attackable)" in body,
            f"shared {proc_name} applies the Damis owner/progression guard to both forms",
        )
    require("%npc_aggressive_player ! uid" in attackable and "^dt_stage_hunts" in attackable, "shared Damis guard enforces owner and quest stage")
    require("^dt_shadow_substate_damis_first_form" in attackable and "^dt_shadow_substate_damis_second_form" in attackable, "shared Damis guard admits only substates 3 and 4")
    for hook in (
        "[opnpc2,fd_damis_normal]", "[apnpc2,fd_damis_normal]",
        "[opnpc2,fd_damis_tougher]", "[apnpc2,fd_damis_tougher]",
    ):
        require(f"{hook}\nif (~dt_damis_attackable = false) return;" in active_source, f"{hook} uses the shared owner/progression guard")
    require("^dt_damis_spawn" in spawn and "npc_add" in spawn, "owned Damis spawn creates the selected form")
    require("gosub(npc_death)" in first_death and "npc_findhero" in first_death, "first form dies before protected transition checks")
    require(first_death.index("gosub(npc_death)") < first_death.index("npc_findhero") < first_death.index("uid = %npc_aggressive_player") < first_death.index("queue(dt_damis_second"), "first-form transition is ordered after death and owner proof")
    require(second_death.index("gosub(npc_death)") < second_death.index("npc_findhero") < second_death.index("uid = %npc_aggressive_player") < second_death.index("queue*(dt_damis_award"), "second-form reward is ordered after death and owner proof")
    require("uid = %npc_aggressive_player" in first_death and "^dt_shadow_substate_damis_first_form" in first_death and "queue(dt_damis_second" in first_death, "only the owning player queues the first-to-second-form transition")
    require("^dt_shadow_substate_damis_first_form" in second_queue and "^dt_shadow_substate_damis_second_form" in second_queue, "protected second-form queue advances state 3 to 4")
    require(second_queue.index("^dt_shadow_substate_damis_second_form") < second_queue.index("dt_damis_spawn"), "second form spawns after protected substate 4")
    require("gosub(npc_death)" in second_death and "npc_findhero" in second_death, "second form dies before protected reward checks")
    require("uid = %npc_aggressive_player" in second_death and "^dt_shadow_substate_damis_second_form" in second_death and "queue*(dt_damis_award" in second_death, "only the owning player queues the second-form reward")
    require("^dt_shadow_substate_damis_second_form" in award_queue and "^dt_shadow_substate_damis_defeated" in award_queue, "protected reward queue advances state 4 to 5")
    require("obj_add" in award_queue and "fd_dark_diamond" in award_queue, "second-form reward queue drops its owned ground diamond")
    require("~obj_gettotal(fd_dark_diamond) = 0" in award_queue and "%fd_column_shadow ! ^dt_column_placed" in award_queue, "ground drop is unique and suppressed after placement")
    require(award_queue.index("^dt_shadow_substate_damis_defeated") < award_queue.index("obj_add"), "state 5 is written before the owned ground drop")
    require("inv_add" not in award_queue, "second-form reward never adds the diamond to inventory")
    require(
        "if (%fd_shadowwarrior_quest < ^dt_shadow_substate_damis_defeated | %fd_shadowwarrior_quest > ^dt_shadow_substate_diamond_claimed) return;" in pickup
        and "obj_takeitem" in pickup,
        "native Take accepts original or recovered ground diamonds at states 5 and 6 only",
    )
    require("%fd_shadowwarrior_quest = ^dt_shadow_substate_diamond_claimed;" in pickup, "pickup advances to state 6 after taking the diamond")
    require(pickup.index("obj_takeitem") < pickup.index("%fd_shadowwarrior_quest = ^dt_shadow_substate_diamond_claimed;"), "state 6 is written only after obj_takeitem")

    require("stat_sub(prayer, add(^dt_damis_prayer_min, random(^dt_damis_prayer_spread)), 0)" in hit, "each tougher hit drains a random 4-6 Prayer points, including zero damage")
    require("npc_default_attack" in hit and "%npc_action_delay <= $before" in hit and "npc_stat(hitpoints) = 0" in hit, "Prayer drain follows a live actual-hit path, even for zero damage")
    require("npc_type = fd_damis_tougher" in hit, "only the tougher form drains Prayer")
    require("ai_queue3" not in hit and "timer" not in hit.lower(), "Prayer drain is not replaced by a per-tick drain or cap")
    require(values.get("dt_damis_prayer_min") == "4" and values.get("dt_damis_prayer_spread") == "3", "Prayer roll bounds encode 4 through 6")
    require(not re.search(r"%deserttreasure(?:main|varbit2?)?\s*=(?!=)", active_source), "Damis never assigns a whole-word quest varp")
    require(not re.search(r"(?m)^\s*varp\s*=", active_source), "Damis does not append a varp declaration")
    for state, value in (
        ("dt_shadow_substate_damis_first_form", "3"),
        ("dt_shadow_substate_damis_second_form", "4"),
        ("dt_shadow_substate_damis_defeated", "5"),
        ("dt_shadow_substate_diamond_claimed", "6"),
    ):
        require(shared.get(state) == value, f"shared constant {state} is {value}")


def check_packed_damis_sizes() -> None:
    engine = Path(os.environ.get("HARNESS_ENGINE_DIR", ROOT.parent / "engine")).resolve()
    result = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", """
import assert from 'node:assert/strict';
import NpcType from './src/cache/config/NpcType.ts';
NpcType.load('data/pack');
for (const name of ['fd_damis_normal', 'fd_damis_tougher']) {
    const npc = NpcType.getByName(name);
    assert(npc, `Packed ${name} must exist`);
    assert.equal(npc.size, 1, `Packed ${name} must retain engine-default size 1`);
    console.log(`PASS: packed ${name} size=${npc.size}`);
}
"""],
        cwd=engine, text=True, capture_output=True, check=False,
    )
    print(result.stdout, end="")
    require(result.returncode == 0, f"packed Damis size check failed: {result.stderr.strip()}")


def main() -> int:
    shadow = text(SCRIPTS / "dt_shadow.rs2")
    damis = text(SCRIPTS / "dt_damis.rs2")
    shadow_constants = text(QUEST / "configs" / "dt_shadow.constant")
    shared_constants = text(QUEST / "configs" / "quest_deserttreasure.constant")
    npc_source = text(UNPACK / "all.npc")
    combat_source = text(ROOT / "scripts" / "skill_combat" / "scripts" / "npc" / "npc_combat.rs2")
    check_shadow(shadow, shadow_constants, shared_constants)
    check_damis(damis, shared_constants, shadow_constants, npc_source, combat_source)
    check_packed_damis_sizes()
    if failures:
        print("\n".join(f"FAIL: {failure}" for failure in failures))
        return 1
    print("PASS: Desert Treasure S3 shadow progression, climb, Damis combat and reward contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

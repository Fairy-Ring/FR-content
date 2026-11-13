#!/usr/bin/env python3
"""DT S2 source/config contract; live cases separately prove product writes."""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

ROOT = Path(os.environ.get("DT_S2_CONTENT_ROOT", Path(__file__).resolve().parents[2])).resolve()
QUEST = ROOT / "scripts/quests/quest_deserttreasure"
failures: list[str] = []


def require(ok: bool, message: str) -> None:
    if not ok:
        failures.append(message)


def text(path: Path) -> str:
    if not path.is_file():
        failures.append(f"missing S2 file: {path.relative_to(ROOT)}")
        return ""
    return path.read_text(encoding="utf-8")


def block(source: str, kind: str, name: str) -> str:
    source = re.sub(r"//[^\n]*", "", source)
    header = f"[{kind},{name}]"
    if header not in source:
        failures.append(f"missing {header}")
        return ""
    return source.split(header, 1)[1].split("\n[", 1)[0]


def main() -> int:
    smoke = text(QUEST / "scripts/dt_smoke.rs2")
    fareed = text(QUEST / "scripts/dt_fareed.rs2")
    constants = text(QUEST / "configs/dt_smoke.constant")
    active = re.sub(r"//[^\n]*", "", smoke + fareed)
    require(not re.search(r"%deserttreasure(?:main|varbit|varbit2)?\s*=(?!=)", active), "S2 never writes main stage or an entire original packed word")
    require("quest_points" not in active and "questpoints" not in active, "hunt awards no quest points")
    for name, value in (("dt_smoke_mask_slayer", "10"), ("dt_smoke_torch_firemaking", "50"), ("dt_smoke_damage", "20"), ("dt_smoke_damage_interval", "20")):
        require(f"^{name} = {value}" in constants, f"named action/hazard constant {name}={value}")
    for label in ("VERIFIED", "CANDIDATE", "UNKNOWN"):
        require(label in constants, f"constants retain {label} evidence labels")
    for loc in ("sword_haunted_well", "sword_haunted_well_go_up", "4d_ladder1", "4d_ladder2", "fd_firedungeon_shutchest", "fd_fw_metalgateclosed_l", "fd_fw_metalgateclosed_r"):
        require(f"[oploc1,{loc}]" in active, f"mapped route for {loc}")
    mask = block(smoke, "proc", "dt_smoke_mask_allowed")
    require("stat_base(slayer) < ^dt_smoke_mask_slayer" in mask and "return(false)" in mask, "wear gate checks base Slayer before equipment changes")
    equip = text(ROOT / "scripts/player/scripts/equip.rs2")
    require("if ($obj = slayer_facemask & ~dt_smoke_mask_allowed = false) return;" in equip, "shared equip path invokes only the guarded mask admission")
    hazard = block(smoke, "timer", "dt_smoke_damage")
    for needle in ("~dt_smoke_inside(coord) = false", "cleartimer(dt_smoke_damage)", "inv_getobj(worn, ^wearpos_hat) = slayer_facemask", "stat(hitpoints) > 1", "min(^dt_smoke_damage, sub(stat(hitpoints), 1))"):
        require(needle in hazard, f"nonlethal facemask hazard contains {needle}")
    start = block(smoke, "proc", "dt_smoke_start")
    require("gettimer(dt_smoke_damage) = -1" in start, "native absent sentinel arms smoke without resetting an existing timer")
    light = block(smoke, "label", "dt_smoke_light")
    for needle in ("last_useitem ! tinderbox", "inv_total(inv, tinderbox) < 1", "stat(firemaking) < ^dt_smoke_torch_firemaking", "~dt_smoke_torch_lit($torch) = true"):
        require(needle in light, f"torch admission contains {needle}")
    for index, direction in enumerate(("ne", "se", "sw", "nw"), 1):
        for suffix in ("", "_unlit", "_lit"):
            require(f"[oplocu,4d_standing_torch{index}{suffix}] @dt_smoke_light({index});" in smoke, f"torch {index}{suffix} resolves its original parent/child action")
        timer = block(smoke, "timer", f"dt_smoke_torch_{direction}")
        require(f"cleartimer(dt_smoke_torch_{direction})" in timer and f"~dt_smoke_extinguish({index})" in timer, f"torch {direction} expires once without relighting")
        require(f"%fd_torch_count{index} = 0;" in smoke and f"%fd_torch_count{index} = 1;" in smoke, f"torch {index} owns only its original masked bit")
    chest = block(smoke, "oploc1", "fd_firedungeon_shutchest")
    for needle in ("~dt_smoke_all_lit = false", "%fd_firewargate = ^dt_flag_on", "~obj_gettotal(fd_firekey) > 0", "inv_freespace(inv) < 1", "inv_add(inv, fd_firekey, 1)", "%fd_firechest = ^dt_flag_on"):
        require(needle in chest, f"chest route contains {needle}")
    gate = block(fareed, "label", "dt_smoke_gate")
    require(gate.count("inv_del(inv, fd_firekey, 1)") == 1 and gate.count("%fd_firewargate = ^dt_flag_on;") == 1, "first gate opening consumes one key and writes one permanent bit")
    require("%fd_firewargate = ^dt_flag_off" in gate and "@dt_smoke_reclaim;" in gate, "permanent unlock and lost-diamond reentry are separate branches")
    guard = block(fareed, "proc", "dt_fareed_attackable")
    for needle in ("%npc_attacking_uid ! uid", "~dt_fareed_inside(coord) = false", "%fd_killed_firewarrior = ^dt_flag_on"):
        require(needle in guard, f"actor admission contains {needle}")
    shared = text(ROOT / "scripts/skill_combat/scripts/npc/npc_combat.rs2")
    for proc in ("npc_is_attackable", "npc_is_attackable_opt"):
        body = block(shared, "proc", proc)
        needle = "if (npc_type = firediamond_firewarrior & ~dt_fareed_attackable = false) return(false);"
        require(needle in body and body.index(needle) < body.index("npc_hasop(2)"), f"{proc} rejects a spectator before generic Attack admission")
    death = block(fareed, "ai_queue3", "firediamond_firewarrior")
    require("finduid(%npc_attacking_uid) = true" in death and "npc_findhero = ^true" in death and "queue*(dt_fareed_death, 0)(%npc_attacking_uid)" in death and "~npc_default_death;" in death, "owned hero credit queues the hunt write and preserves generic NPC death")
    credit = block(fareed, "queue", "dt_fareed_death")
    require("uid ! $owner" in credit and "%fd_killed_firewarrior = ^dt_flag_on;" in credit and "~dt_smoke_give_diamond;" in credit, "only the owning account writes the kill flag and receives its diamond")
    drop = block(fareed, "proc", "dt_fareed_disarm")
    require("inv_getobj(worn, ^wearpos_hands) = ice_gloves" in drop and "inv_dropslot(worn, coord, ^wearpos_rhand, ^dropslot_duration)" in drop and "~update_all($weapon)" in drop and "~on_unequip($weapon)" in drop, "gloves protect; otherwise the actual weapon becomes owned ground loot and equipment updates")
    diamond = block(fareed, "proc", "dt_smoke_diamond_owned")
    require("~obj_gettotal(fd_diamond_fire) > 0" in diamond and "%fd_column_fire = ^dt_column_placed" in diamond, "held/banked/worn/placed diamond prevents duplicate reclaims")
    require("skill_magic" not in active and "npc_max_dealt" not in active and "rune_payment" not in active, "S2 uses shared spell resolution and payment without a new player-damage or elemental rule")
    journal = text(QUEST / "scripts/dt_journal.rs2")
    require(journal.count("$x = append($x, ~dt_smoke_journal);") == 2, "one Smoke journal call in each shared stage block")
    for path, ids in (("pack/npc.pack", {1977: "firediamond_firewarrior"}), ("pack/obj.pack", {1580: "ice_gloves", 4164: "slayer_facemask", 4656: "fd_firekey", 4672: "fd_diamond_fire"}), ("pack/loc.pack", {6279: "sword_haunted_well", 6439: "sword_haunted_well_go_up", 6420: "fd_firedungeon_shutchest", 6451: "fd_fw_metalgateclosed_l", 6452: "fd_fw_metalgateclosed_r"})):
        packed = dict(line.split("=", 1) for line in text(ROOT / path).splitlines() if "=" in line)
        for index, name in ids.items():
            require(packed.get(str(index)) == name, f"original 377 identity {index}={name}")
    if failures:
        print("\n".join(f"FAIL: {failure}" for failure in failures))
        return 1
    for script in ("test_s2_topology.mjs", "test_s2_timer.mjs", "test_s2_room.mjs"):
        result = subprocess.run(
            ["node", "--import", "tsx", str(ROOT / "tests/desert-treasure" / script)],
            cwd=ROOT.parent / "engine",
            check=False,
        )
        if result.returncode != 0:
            return result.returncode
    print("PASS: Desert Treasure S2 original configs, smoke, torch/key/gate, owned Fareed, masked credit and journal source contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Offline contract for DT S6; historical labels are not runtime proofs."""
from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(os.environ.get("DT_S6_CONTENT_ROOT", Path(__file__).resolve().parents[2])).resolve()
QUEST = ROOT / "scripts/quests/quest_deserttreasure"
failures: list[str] = []


def require(ok: bool, message: str) -> None:
    if not ok:
        failures.append(message)


def text(path: Path) -> str:
    if not path.is_file():
        failures.append(f"missing S6 file: {path.relative_to(ROOT)}")
        return ""
    return path.read_text(encoding="utf-8")


def block(source: str, kind: str, name: str) -> str:
    header = f"[{kind},{name}]"
    if header not in source:
        failures.append(f"missing {header}")
        return ""
    return source.split(header, 1)[1].split("\n[", 1)[0]


def main() -> int:
    columns = text(QUEST / "scripts/dt_columns.rs2")
    hill = text(QUEST / "scripts/dt_eblis_hill.rs2")
    stranger = text(QUEST / "scripts/dt_stranger.rs2")
    journal = text(QUEST / "scripts/dt_journal.rs2")
    constants = text(QUEST / "configs/quest_deserttreasure.constant")
    locs = text(ROOT / "scripts/_unpack/377/all.loc")
    npcs = text(ROOT / "scripts/_unpack/377/all.npc")
    varbits = text(ROOT / "scripts/_unpack/377/all.varbit")
    pack = text(ROOT / "pack/loc.pack")
    for parent, idle, placed, bit, gem, label, parent_id in (
        ("desert_treasure_oblix1", "desert_treasure_oblix_a", "fd_blood_column", "fd_column_blood", "fd_blood_diamond", "blood", 6482),
        ("desert_treasure_oblix2", "desert_treasure_oblix_b", "fd_smoke_column", "fd_column_fire", "fd_diamond_fire", "fire", 6485),
        ("desert_treasure_oblix3", "desert_treasure_oblix_c", "fd_ice_column", "fd_column_ice", "fd_icediamond", "ice", 6488),
        ("desert_treasure_oblix4", "desert_treasure_oblix_d", "fd_shadow_column", "fd_column_shadow", "fd_dark_diamond", "shadow", 6491),
    ):
        for offset, name in enumerate((parent, idle, placed)):
            require(locs.count(f"[{name}]") == 1, f"exactly one loc config {name}")
            require(f"{parent_id + offset}={name}\n" in pack, f"cache ID {parent_id + offset} remains {name}")
            require(f"[oplocu,{name}] @dt_column_{label};" in columns, f"bind original form {name}")
        config = locs.split(f"[{parent}]", 1)[1].split("\n[", 1)[0]
        require(f"multivar={bit}" in config and f"multiloc=0,{idle}" in config and f"multiloc=1,{placed}" in config, f"preserve {parent} original multi")
        require(varbits.count(f"[{bit}]") == 1, f"one original varbit {bit}")
        action = block(columns, "label", f"dt_column_{label}")
        accept = f"~dt_column_accept({gem}, %{bit})"
        delete = f"inv_del(inv, {gem}, 1);"
        write = f"%{bit} = ^dt_column_placed;"
        require(accept in action and delete in action and write in action and action.index(accept) < action.index(delete) < action.index(write), f"{label}: check before consuming exactly one matching gem and masked bit write")
    admission = block(columns, "proc", "dt_column_accept")
    for needle in ("last_useitem ! $gem", "$placed = ^dt_column_placed", "inv_total(inv, $gem) < 1", "^dt_stage_hunts", "^dt_stage_placing_diamonds", "stat_base(magic) < ^dt_column_magic_required", "~displaymessage(^dm_default)"):
        require(needle in admission, f"column admission contains {needle}")
    require("inv_del" not in admission and not re.search(r"%\w+\s*=(?!=)", admission), "refusals consume and write nothing")
    require("^dt_column_magic_required = 50" in constants, "named candidate Magic 50 action gate")
    for message in ("You are not a powerful enough mage to breach the protective aura.", "You need a magic level of at least 50 to enter the Pyramid.", "The diamond is absorbed into the pillar...", "The force preventing access to the Pyramid has now vanished.", "This passage doesn't seem to lead anywhere..."):
        require(message in columns, f"retain candidate message {message}")
    full = block(columns, "proc", "dt_columns_full")
    for bit in ("blood", "fire", "ice", "shadow"):
        require(f"%fd_column_{bit} = ^dt_column_placed" in full, f"all-four gate tests actual {bit} bit")
    finish = block(columns, "label", "dt_column_placed")
    require("~dt_columns_full = true" in finish and "%deserttreasure = ^dt_stage_four_columns;" in finish and "%deserttreasure = ^dt_stage_placing_diamonds;" in finish, "first placement writes 11, fourth writes 12")
    for writer in re.finditer(r"%deserttreasure = [^;]+;", finish):
        require("~send_quest_progress(questlist:deserttreasure" in finish[writer.end():].split("}", 1)[0], "each stage writer recolours quest progress")
    entry = block(columns, "label", "dt_column_top_entry")
    require("~dt_columns_full = false" in entry, "top refusal uses actual four bits, not stage")
    active = "\n".join(line.split("//", 1)[0] for line in columns.splitlines())
    require(not re.search(r"%deserttreasure(?:main|varbit|varbit2)\s*=", active), "never write a whole 440-442 word")
    require("p_tele" not in entry and not re.search(r"%\w+\s*=", entry) and "loc_add" not in entry, "S6 all-four attempt stays outside stage 12; S7 owns opening")
    require("dt_eblis_four_diamonds" in hill and "$held = 3" in hill and "dt_eblis_after_place" in hill, "hill dispatch has partial, all-four and after-place advice")
    require("inv_del" not in hill and "%deserttreasure =" not in hill and "inv_total(bank" not in hill, "advice neither takes diamonds, counts bank nor writes stage")
    for stage in ("^dt_stage_placing_diamonds", "^dt_stage_four_columns"):
        require(stage in journal, f"journal covers {stage}")
    for colour in ("Blood", "Smoke", "Ice", "Shadow"):
        require(f"{colour} diamond placed." in journal and f"{colour} diamond not placed." in journal, f"journal reports {colour} bit truthfully")
    eligibility = block(stranger, "proc", "dt_stranger_eligible")
    for gem in ("fd_blood_diamond", "fd_icediamond", "fd_diamond_fire", "fd_dark_diamond", "fd_sword_cross"):
        require(f"inv_total(inv, {gem}) > 0" in eligibility, f"Stranger held-item eligibility {gem}")
    require("bank" not in eligibility, "banked-only items do not qualify")
    require("$owner ! null & $owner = uid" in block(stranger, "proc", "dt_stranger_is_owner"), "owner dispatch rejects null and spectator")
    for kind in ("opnpc2", "ai_opplayer2"):
        require("~dt_stranger_is_owner(%npc_macro_event_target) = false" in block(stranger, kind, "fourdiamonds_assasin"), f"{kind} is owner guarded")
    require(npcs.count("[fourdiamonds_assasin]") == 1 and "1919=fourdiamonds_assasin" in text(ROOT / "pack/npc.pack"), "Stranger retains one cache NPC 1919 config")
    require("npc_add(" not in stranger and "random(" not in stranger and "inv_add(" not in stranger and "%deserttreasure =" not in stranger, "no invented spawn rate, reward or quest credit")
    if failures:
        print("\n".join(f"FAIL: {failure}" for failure in failures))
        return 1
    print("PASS: Desert Treasure S6 matching columns, masked stages, advice, top gate and bounded Stranger contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

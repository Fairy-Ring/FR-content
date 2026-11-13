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
    source = re.sub(r"//[^\n]*", "", source)
    header = f"[{kind},{name}]"
    if header not in source:
        failures.append(f"missing {header}")
        return ""
    return source.split(header, 1)[1].split("\n[", 1)[0]


def main() -> int:
    columns = text(QUEST / "scripts/dt_columns.rs2")
    hill = text(QUEST / "scripts/dt_eblis_hill.rs2")
    journal = text(QUEST / "scripts/dt_journal.rs2")
    archaeologist = text(QUEST / "scripts/dt_archaeologist.rs2")
    constants = text(QUEST / "configs/quest_deserttreasure.constant")
    locs = text(ROOT / "scripts/_unpack/377/all.loc")
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
        require(f"if ({accept} = false) return;" in action and action.count(delete) == 1 and action.count("inv_del(") == 1 and action.count(write) == 1 and action.index(accept) < action.index(delete) < action.index(write), f"{label}: failed admission returns before exactly one matching consume and masked bit write")
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
    require(re.search(r"if \(~dt_columns_full = true\) \{\s*%deserttreasure = \^dt_stage_four_columns;", finish) is not None and re.search(r"else if \(%deserttreasure = \^dt_stage_hunts\) \{\s*%deserttreasure = \^dt_stage_placing_diamonds;", finish) is not None, "first placement writes 11, fourth writes 12 in their matching branches")
    require(re.findall(r"%deserttreasure = (\^\w+);", finish) == ["^dt_stage_four_columns", "^dt_stage_placing_diamonds"], "placement has only the two scoped stage writers")
    for writer in re.finditer(r"%deserttreasure = \^\w+;", finish):
        require("~send_quest_progress(questlist:deserttreasure" in finish[writer.end():].split("}", 1)[0], "each stage writer recolours quest progress")
    entry = block(columns, "label", "dt_column_top_entry")
    require("~dt_columns_full = false" in entry, "top refusal uses actual four bits, not stage")
    active = "\n".join(line.split("//", 1)[0] for line in columns.splitlines())
    require(not re.search(r"%deserttreasure(?:main|varbit|varbit2)\s*=", active), "never write a whole 440-442 word")
    require("p_tele" not in entry and not re.search(r"%\w+\s*=", entry) and "loc_add" not in entry, "S6 all-four attempt stays outside stage 12; S7 owns opening")
    require("dt_eblis_four_diamonds" in hill and "$held = 3" in hill and "dt_eblis_after_place" in hill, "hill dispatch has partial, all-four and after-place advice")
    # A stage write is an assignment statement. Drop comments, string literals and every parenthesised group
    # (conditions and call arguments), so an equality test such as `if (%deserttreasure = ^x)` does not count.
    hill_code = re.sub(r'"[^"\n]*"', '""', "\n".join(line.split("//", 1)[0] for line in hill.splitlines()))
    previous = None
    while previous != hill_code:
        previous = hill_code
        hill_code = re.sub(r"\([^()]*\)", "", hill_code)
    require("inv_del" not in hill and re.search(r"%deserttreasure\s*=", hill_code) is None and "inv_total(bank" not in hill, "advice neither takes diamonds, counts bank nor writes stage")
    advice = block(hill, "opnpc1", "fd_elder_by_mirrors")
    placed_gate = advice.split("def_int $held", 1)[0]
    require("@dt_eblis_after_place;" in placed_gate and "inv_total" not in placed_gate and all(f"%fd_column_{bit} = ^dt_column_placed" in placed_gate for bit in ("blood", "fire", "ice", "shadow")), "all placed bits select after-placement advice before held-diamond counts")
    for stage in ("^dt_stage_placing_diamonds", "^dt_stage_four_columns"):
        require(stage in journal, f"journal covers {stage}")
    column_journal = block(journal, "proc", "dt_column_journal")
    for colour, bit in (("Blood", "blood"), ("Smoke", "fire"), ("Ice", "ice"), ("Shadow", "shadow")):
        pattern = rf'if \(%fd_column_{bit} = \^dt_column_placed\) \{{\s*\$columns = append\(\$columns, "@str@{colour} diamond placed\.\|"\);\s*\}} else \{{\s*\$columns = append\(\$columns, "@dbl@{colour} diamond not placed\.\|"\);'
        require(re.search(pattern, column_journal) is not None, f"journal ties {colour} sentences to its matching bit")
    require('"@dbl@I have placed all four diamonds.|"' in journal and "The pyramid is ready to enter." not in journal, "stage12 journal reports placement without claiming S7 entry")
    after_place = block(archaeologist, "label", "dt_arch_after_place")
    require('~chatplayer("<p,neutral>Um... sorry, I can\'t.");' in after_place and "chatnpc_specific" not in after_place, "Archaeologist refusal follows the newest retained Player attribution")
    if failures:
        print("\n".join(f"FAIL: {failure}" for failure in failures))
        return 1
    print("PASS: Desert Treasure S6 matching columns, masked stages, advice, top gate and journal contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Static server-state contract checks for the Fenkenstrain S1 slice.

These checks inspect the product RuneScript, not a live engine or historical
server. They protect the state transitions and ownership boundaries that the
S1 live cell must read back independently.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FENK = ROOT / "scripts/quests/quest_creatureoffenkenstrain/scripts"

failures: list[str] = []


def fail(message: str) -> None:
    failures.append(message)


def read(path: Path) -> str:
    if not path.is_file():
        fail(f"missing source: {path}")
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def body(source: str, header: str, label: str) -> str:
    match = re.search(
        rf"(?m)^{re.escape(header)}\s*$([\s\S]*?)(?=^\[|\Z)", source
    )
    if not match:
        fail(f"missing RuneScript block {header} ({label})")
        return ""
    return match.group(1)


def require(source: str, pattern: str, label: str) -> None:
    if not re.search(pattern, source, re.MULTILINE):
        fail(f"{label}: expected /{pattern}/")


def forbid(source: str, pattern: str, label: str) -> None:
    if re.search(pattern, source, re.MULTILINE):
        fail(f"{label}: must not match /{pattern}/")


def main() -> int:
    gardener = read(FENK / "fenk_gardener.rs2")
    graves = read(FENK / "fenk_graves.rs2")

    talk = body(gardener, "[opnpc1,fenk_gardener]", "owned Talk-to")
    start = body(gardener, "[proc,fenk_start_gardener_follow]", "hire")
    arrival = body(
        gardener, "[label,fenk_gardener_following_talk]", "grave arrival Talk-to"
    )
    clear = body(gardener, "[proc,fenk_clear_gardener_follow]", "cleanup")
    dig = body(graves, "[oploc2,fenk_grave_poor]", "Dig")
    head = body(graves, "[proc,fenk_try_dig_head]", "head result")

    # Hiring creates and records one dynamic actor owned by this player.
    require(talk, r"npc_uid\s*=\s*%fenk_follower_uid", "same-UID Talk guard")
    require(talk, r"%npc_attacking_uid\s*=\s*uid", "owner-bound Talk guard")
    require(talk, r"@fenk_gardener_following_talk", "owned Talk dispatch")
    require(start, r"%fenk_gardener_directions\s*=\s*1", "hide courtyard multi")
    require(
        start,
        r"npc_add\s*\(\s*\$spawn\s*,\s*fenk_gardener\s*,\s*\^fenk_follow_ticks\s*\)",
        "dynamic gardener spawn",
    )
    require(start, r"%npc_attacking_uid\s*=\s*uid", "NPC owner write")
    require(start, r"%fenk_follower_uid\s*=\s*npc_uid", "owned UID write")

    # Proximity is an observation-only Talk behavior, not an arrival/dig gate.
    require(
        arrival,
        r"inzone\s*\(\s*0_56_54_23_34\s*,\s*0_56_54_25_36\s*,\s*coord\s*\)",
        "inclusive 3x3 grave-talk area",
    )
    require(arrival, r"npc_say\(\"This is the place where I met me' maker\.\"\)", "sourced arrival overhead")
    require(arrival, r"queue\s*\(\s*fenk_gardener_clear_follow\s*,\s*1\s*,\s*0\s*\)", "departure after overhead")
    forbid(arrival, r"%fenk_quest\s*=|inv_(?:add|del)|%fenk_head\s*=", "arrival Talk must not advance quest/items")

    # Wrong graves and repeated digs remain empty; the real Dig is follower-independent.
    require(dig, r"loc_coord\s*=\s*0_56_54_24_35", "true-head tile selection")
    require(dig, r"~fenk_try_dig_head\s*;", "true-head result dispatch")
    require(dig, r"\.\.\.but the grave is empty\.", "wrong/repeated Dig refusal")
    forbid(dig, r"fenk_follower_uid|fenk_gardener_directions|fenk_spoken_to_gardener", "Dig must not require follower/proximity state")
    require(head, r"inv_total\s*\(\s*inv\s*,\s*fenk_head_empty\s*\)\s*>\s*0", "no duplicate empty head")
    require(head, r"inv_total\s*\(\s*inv\s*,\s*fenk_head_full\s*\)\s*>\s*0", "no duplicate full head")
    require(head, r"%fenk_head\s*=\s*1", "no duplicate after hand-in")
    require(head, r"inv_freespace\s*\(\s*inv\s*\)\s*=\s*0", "inventory-space refusal")
    require(head, r"inv_add\s*\(\s*inv\s*,\s*fenk_head_empty\s*,\s*1\s*\)", "exactly one head on success")
    forbid(head, r"^\s*%fenk_(?:quest|head)\s*=|fenk_digresult", "Dig must not advance stage, hand-in, or discovery state")

    # The optional Dig overhead must resolve this player's stored UID and owner;
    # a reused UID belonging to another actor cannot speak as the escort.
    require(
        head,
        r"if\s*\(\s*%fenk_follower_uid\s*!\s*null\s*&\s*npc_finduid\s*\(\s*%fenk_follower_uid\s*\)\s*=\s*true\s*\)\s*\{[\s\S]*?if\s*\(\s*%npc_attacking_uid\s*=\s*uid\s*\)\s*\{[\s\S]*?npc_say\s*\(\"This is the place where I met me' maker\.\"\)",
        "Dig overhead requires the same owned follower",
    )

    # Cleanup is scoped to the exact actor and restores only the product visibility bit.
    require(clear, r"npc_finduid\s*\(\s*%fenk_follower_uid\s*\)", "cleanup UID lookup")
    require(clear, r"%npc_attacking_uid\s*=\s*uid", "cleanup owner guard")
    require(clear, r"%fenk_follower_uid\s*=\s*null", "cleanup clears UID")
    require(clear, r"%fenk_gardener_directions\s*=\s*0", "cleanup restores courtyard")

    if failures:
        for message in failures:
            print(f"FAIL: {message}")
        print("RESULT FAIL (static S1 source contract)")
        return 1
    print("PASS: S1 source asserts owned dynamic follower, observation-only proximity, and follower-independent 0/+1/0 Dig state")
    print("RESULT PASS (static S1 source contract; no live or historical claim)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

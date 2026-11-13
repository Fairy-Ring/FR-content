#!/usr/bin/env python3
"""Offline source contract checks for the Desert Treasure S1 slice."""

from __future__ import annotations

import os
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
ROOT = Path(os.environ.get("DT_S1_CONTENT_ROOT", REPO_ROOT)).resolve()
QUEST = ROOT / "scripts" / "quests" / "quest_deserttreasure" / "scripts"
JOURNAL = QUEST / "dt_journal.rs2"
QUESTS = ROOT / "scripts" / "general" / "scripts" / "quests.rs2"

failures: list[str] = []


def require(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def main() -> int:
    journal = JOURNAL.read_text(encoding="utf-8")
    quests = QUESTS.read_text(encoding="utf-8")
    archaeologist = (QUEST / "dt_archaeologist.rs2").read_text(encoding="utf-8")
    terry = (QUEST / "dt_terry.rs2").read_text(encoding="utf-8")
    book = (ROOT / "scripts" / "general" / "scripts" / "book.rs2").read_text(encoding="utf-8")

    require("[if_button,questlist:deserttreasure]" in journal, "S1 journal must handle the Desert Treasure quest-list button")
    require(
        "~send_quest_progress(questlist:deserttreasure, %deserttreasure, ^deserttreasure_complete);" in journal,
        "S1 journal must restore the quest row colour from the saved quest stage",
    )
    for needle in (
        "^itexam_complete",
        "^desertrescue_complete",
        "^ikov_completed_armadyl",
        "^ikov_completed_lucien",
        "^priestperil_complete",
        "^waterfall_complete",
        "^troll_complete",
        "stat_base(slayer) >= 10",
        "stat_base(firemaking) >= 50",
        "stat_base(magic) >= 50",
        "stat_base(thieving) >= 53",
    ):
        require(needle in journal, f"S1 stage-zero journal must reflect period requirement {needle}")


    for needle in (
        "I should take the etchings to Terry Balando",
        "I should speak to Terry again",
        "I should take the translation to the Archaeologist",
        "I should discuss a partnership",
        "I should buy a drink at the bandit camp",
    ):
        require(needle in journal, f"S1 journal must report the current opening objective {needle}")

    require("[opheld1,four_diamonds_translation_primer]" in archaeologist, "Translation 4655 Read must be implemented")
    read_branch = archaeologist.split("if ($read = 1) {", 1)[1].split("}", 1)[0]
    require(
        "@dt_translation_read;" in read_branch
        and "inv_del" not in read_branch
        and "%deserttreasure" not in read_branch,
        "choosing Read must send the candidate book text without consuming the book or advancing the stage",
    )
    for needle in (
        "This is a rough translation of the stone tablet brought to me by courier earlier today.",
        "The cuneiforms of this particular tablet are far different to anything I have previously seen in my career as an archaeological expert.",
        "Terry Balando",
        "There seems to be some further missing information continued onto a further tablet",
    ):
        require(needle in archaeologist, f"Read must send candidate Translation text: {needle}")
    require(
        "%book_page = 0;" in archaeologist
        and "%open_book = four_diamonds_translation_primer;" in archaeologist
        and "@book_flip_page(0, 0, 5, dt_translation_book_page);" in archaeologist,
        "Read must open the candidate Translation at page zero with page navigation initialized",
    )
    translation_page_proc = archaeologist.split("[proc,dt_translation_book_page]", 1)[1].split("\n[", 1)[0]
    require(
        translation_page_proc.count('~book("Translation", "') == 6
        and all(f"case {page} : ~book(\"Translation\", \"" in translation_page_proc for page in range(6)),
        "the candidate Translation must render each of its six pages separately",
    )
    require(
        "case four_diamonds_translation_primer : @book_flip_page(^book_direction_backward, 0, 5, dt_translation_book_page);" in book
        and "case four_diamonds_translation_primer : @book_flip_page(^book_direction_forward, 0, 5, dt_translation_book_page);" in book,
        "both book controls must navigate the Translation pages",
    )
    require(
        "inv_del(inv, four_diamonds_translation_primer, 1);" in archaeologist
        and "%deserttreasure = 4;" in archaeologist,
        "Don't read must consume exactly one held Translation and advance 3 to 4",
    )
    require(
        archaeologist.count("~send_quest_progress(questlist:deserttreasure") >= 3
        and terry.count("~send_quest_progress(questlist:deserttreasure") >= 2,
        "opening stage writers must recolour the quest row from the new stage",
    )

    require(
        "if (%deserttreasure = ^deserttreasure_complete) {\n    $questpoints = add($questpoints, ^deserttreasure_questpoints);\n}" in quests,
        "Desert Treasure QP must enter the shared recount only at the complete stage",
    )

    eblis = (QUEST / "dt_eblis.rs2").read_text(encoding="utf-8")
    take = (QUEST / "dt_eblis_take.rs2").read_text(encoding="utf-8")
    hill = (QUEST / "dt_eblis_hill.rs2").read_text(encoding="utf-8")
    mirrors = (QUEST / "dt_mirrors.rs2").read_text(encoding="utf-8")

    for needle in (
        "^dt_stage_brew_purchased",
        "I should ask him about the four diamonds",
        "^dt_stage_diamonds_requested",
        "I should speak to Eblis at the Bandit Camp",
        "^dt_stage_ingredients_pending",
        "I should use them to find the four diamonds",
        "%fd_magiclog >= 12",
        "%fd_steelbar >= 6",
        "%fd_glass >= 6",
        "%fd_bones >= 1",
        "%fd_ash >= 1",
        "%fd_charcoal >= 1",
        "%fd_bloodrune >= 1",
    ):
        require(needle in journal, f"S1 journal must retain its stage objective or ingredient {needle}")

    require(
        "if (~itexam_progress() < ^itexam_complete" in archaeologist
        and "%desertrescue < ^desertrescue_complete" in archaeologist
        and "%ikov < ^ikov_completed_armadyl" in archaeologist
        and "%priestperil < ^priestperil_complete" in archaeologist
        and "%waterfall_quest < ^waterfall_complete" in archaeologist
        and "%troll_quest < ^troll_complete" in archaeologist
        and '~mesbox("He seems to be lost in his own thoughts...");' in archaeologist
        and "stat_base(" not in archaeologist,
        "start must refuse each missing quest with the existing line, but not enforce the listed skill levels",
    )
    require(
        "if (inv_total(inv, four_diamonds_etchings) < 1)" in terry
        and "@dt_terry_no_etchings;" in terry
        and "if (inv_total(inv, four_diamonds_translation_primer) < 1)" in archaeologist,
        "banked-only hand-ins must follow the no-held-item branches",
    )
    require(
        "inv_del(inv, four_diamonds_etchings, inv_total(inv, four_diamonds_etchings));" in terry
        and "%deserttreasure = 2;" in terry
        and "inv_add(inv, four_diamonds_translation_primer, 1);" in terry
        and "%deserttreasure = 3;" in terry,
        "Terry must consume the hand-in before writing 2 and grant the book before writing 3",
    )

    require(
        "if (%deserttreasure = 7)" in eblis
        and "%deserttreasure = 8;" in eblis
        and "~send_quest_progress(questlist:deserttreasure" in eblis,
        "accepting Eblis's ingredient list must write stage 8 and recolour the quest row",
    )
    for item, counter, cap in (
        ("magic_logs", "fd_magiclog", "12"),
        ("steel_bar", "fd_steelbar", "6"),
        ("molten_glass", "fd_glass", "6"),
        ("bones", "fd_bones", "1"),
        ("ashes", "fd_ash", "1"),
        ("charcoal", "fd_charcoal", "1"),
        ("bloodrune", "fd_bloodrune", "1"),
    ):
        require(item in take and f"%{counter}" in take, f"Eblis ingredient writer must handle {item} via {counter}")
        require(f"inv_del(inv, $used, 1);" in take and f"%{counter} = " in take, f"{counter} must consume one item and write one counter")
        require(f"%{counter} >= {cap}" in take or f"%{counter} = {cap}" in take, f"{counter} must stop at cap {cap}")
    take_code = "\n".join(line.split("//", 1)[0] for line in take.splitlines())
    require("%deserttreasure =" not in take_code, "ingredient hand-ins must leave stage 8 unchanged")
    eblis_code = "\n".join(line.split("//", 1)[0] for line in eblis.splitlines())
    gate = eblis_code.split("[label,dt_eblis_excellent]", 1)[1].split("[label,dt_eblis_east]", 1)[0]
    require(
        "oc_param($worn, zamorakitem) = ^true" in gate
        and gate.index("return;") < gate.index("~chatnpc(")
        and "inv_del(" not in gate,
        "the labelled Zamorak gate must return before Excellent and consume no items",
    )
    require(
        "%deserttreasure = 10;" in gate
        and "%fd_mirror_present = 1;" in gate
        and "~send_quest_progress(questlist:deserttreasure" in gate,
        "Excellent must write stage 10, mirror-present, and progress colour",
    )
    hill_code = "\n".join(line.split("//", 1)[0] for line in hill.splitlines())
    mirror_code = "\n".join(line.split("//", 1)[0] for line in mirrors.splitlines())
    require(
        __import__("re").search(r"(?m)(?:^|[;{}])\s*%deserttreasure\s*=\s*[^;{}]+;", hill_code) is None,
        "hill dialogue must not add quest progress",
    )
    require("%deserttreasure =" not in mirror_code, "mirror Look-into must not add quest progress")
    for index in range(1, 7):
        require(f"[oploc1,fd_mirror{index}]" in mirror_code, f"mirror child {index} must have Look-into")
    require(
        'mes("You gaze into the mirror...");' in mirror_code
        and "The image is unclear." not in mirror_code,
        "mirror text must keep the sourced gaze message without an unsupported second sentence",
    )
    partnership = archaeologist.split("[label,dt_arch_partners_yes]", 1)[1].split("\n[label,", 1)[0]
    require(
        '~chatnpc("<p,neutral>You head due South, see what you can find out about this tablet.");' in partnership
        and partnership.index("You head due South, see what you can find out") < partnership.index("%deserttreasure = 5;"),
        "partnership must retain the sourced final direction before writing stage 5",
    )
    require(
        "I should speak to Eblis at the Bedabin Camp" not in journal,
        "stage 7 must direct players to village Eblis at the Bandit Camp",
    )
    require(
        '"@dbl@Requirements:|"' in journal and "The period requirements" not in journal,
        "the stage-zero requirement heading must use player-facing journal wording",
    )

    for label in ("dt_arch_with_diamonds", "dt_arch_after_place"):
        block = archaeologist.split(f"[label,{label}]", 1)[1].split("\n[label,", 1)[0]
        require("inv_del(" not in block and "%deserttreasure =" not in block, f"{label} must not consume items or change stage")
    require(
        "inv_total(inv, fd_blood_diamond) > 0" in archaeologist
        and "%fd_column_blood = ^dt_column_placed" in archaeologist
        and "inv_total(inv, fd_blood_diamond) = 0" in archaeologist
        and '~chatplayer("<p,neutral>Um... sorry, I can\'t.");' in archaeologist,
        "late Archaeologist scenes distinguish held diamonds from placed columns and use Player for the refusal (transcript revision 15343078, 2026-09-13)",
    )

    require(
        "questlist:deserttreasure" in journal
        and "questlist:deserttreasure" in archaeologist
        and "questlist:deserttreasure" in terry
        and "questlist:deserttreasure" in eblis,
        "each opening stage write must use the shared quest-row progress colour helper",
    )

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1
    print("PASS: Desert Treasure S1 journal, opening, ingredient, creation-gate and late-return contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

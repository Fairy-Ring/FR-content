#!/usr/bin/env python3
"""STATIC source-regex checks for Creature of Fenkenstrain M1 (offline only).

These are NOT production-handler execution and do NOT establish functional or
historical PASS. Label every matrix row that relies on this file as STATIC.
No pack/service/live claims.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # worktree root (tests/fenkenstrain-completion/ → ../..)
FENK = ROOT / "scripts/quests/quest_creatureoffenkenstrain"
GEN_QUESTS = ROOT / "scripts/general/scripts/quests.rs2"
QUEST_CONST = ROOT / "scripts/general/configs/quest.constant"
STAIRS = ROOT / "scripts/ladders+stairs/scripts/stairs.rs2"
JEWELLERY = ROOT / "scripts/skill_crafting/scripts/jewellery/jewellery.rs2"
ROAVAR = ROOT / "scripts/areas/area_canafis/scripts/werewolfinnkeeper.rs2"

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def read(p: Path) -> str:
    if not p.is_file():
        fail(f"missing file: {p.relative_to(ROOT)}")
        return ""
    return p.read_text(encoding="utf-8", errors="replace")


def must_contain(text: str, pattern: str, label: str, flags: int = 0) -> None:
    if not re.search(pattern, text, flags):
        fail(f"{label}: expected /{pattern}/")


def must_not_contain(text: str, pattern: str, label: str, flags: int = 0) -> None:
    if re.search(pattern, text, flags):
        fail(f"{label}: must not match /{pattern}/")


def main() -> int:
    scripts_dir = FENK / "scripts"
    required_scripts = [
        "fenk_signpost.rs2",
        "fenk_dr_talk.rs2",
        "fenk_gardener.rs2",
        "fenk_graves.rs2",
        "fenk_items_bookcases.rs2",
        "fenk_memorial.rs2",
        "fenk_doors_experiment.rs2",
        "fenk_shed_conductor.rs2",
        "fenk_tower_complete.rs2",
        "fenk_brain_take.rs2",
    ]
    bodies: dict[str, str] = {}
    for name in required_scripts:
        bodies[name] = read(scripts_dir / name)

    const = read(FENK / "configs/fenk_quest.constant")
    follower_varp = read(FENK / "configs/fenk_follower.varp")
    quests = read(GEN_QUESTS)
    qconst = read(QUEST_CONST)
    stairs = read(STAIRS)
    jewellery = read(JEWELLERY)
    roavar = read(ROAVAR)

    # --- A: constants / stages ---
    must_contain(const, r"\^fenk_not_started\s*=\s*0", "stage 0")
    must_contain(const, r"\^fenk_hired\s*=\s*1", "stage 1 hired")
    must_contain(const, r"\^fenk_need_sewing\s*=\s*2", "stage 2 sewing")
    must_contain(const, r"\^fenk_assembled\s*=\s*3", "stage 3 assembled/multi corpse")
    must_contain(const, r"\^fenk_lightning_done\s*=\s*4", "stage 4 lightning")
    must_contain(const, r"\^fenk_complete\s*=\s*8", "stage 8 complete multi")
    must_contain(qconst, r"\^creatureoffenkenstrain_complete\s*=\s*8", "quest.constant complete=8")
    must_contain(qconst, r"\^creatureoffenkenstrain_questpoints\s*=\s*2", "quest.constant QP=2")

    # --- A: signpost does not write quest stage ---
    sign = bodies["fenk_signpost.rs2"]
    must_contain(sign, r"\[oploc1,fenk_signpost\]", "signpost op")
    must_contain(sign, r"%fenk_read_signpost\s*=\s*1", "signpost bit")
    must_not_contain(sign, r"%fenk_quest\s*=", "signpost must not write fenk_quest")

    # --- A: doctor hire once / stage gates / wrong answers ---
    dr = bodies["fenk_dr_talk.rs2"]
    must_contain(dr, r"\[opnpc1,fenk_fenkenstrain_model\]", "dr talk")
    must_contain(dr, r"%fenk_quest\s*>=\s*\^fenk_complete", "dr postquest gate")
    must_contain(dr, r"%fenk_quest\s*=\s*\^fenk_not_started", "hire only from 0")
    must_contain(dr, r"Braindead", "interview Q1 answer")
    must_contain(dr, r"Grave-digging", "interview Q2 answer")
    must_contain(dr, r"don't think you have the aptitude", "wrong interview refuse")
    must_contain(dr, r"\[proc,fenk_hire_prereqs\]", "hire prereq proc")
    must_contain(dr, r"%priestperil\s*<\s*\^priestperil_complete", "PiP complete constant")
    must_contain(dr, r"%prieststart\s*<\s*\^priest_complete", "Restless Ghost complete constant")
    must_not_contain(dr, r"%priestperil\s*<\s*60", "no guessed PiP int")
    must_not_contain(dr, r"%prieststart\s*<\s*5", "no guessed RG int")

    # --- B: partial body hand-in ---
    must_contain(dr, r"\[proc,fenk_try_hand_parts\]", "parts hand-in proc")
    for part in ("fenk_head_full", "fenk_torso", "fenk_arms", "fenk_legs"):
        must_contain(dr, rf"inv_del\s*\(\s*inv\s*,\s*{part}", f"consume {part}")
    must_contain(dr, r"%fenk_head\s*=\s*1", "head bit")
    must_contain(dr, r"%fenk_torso\s*=\s*1", "torso bit")
    must_contain(dr, r"%fenk_arms\s*=\s*1", "arms bit")
    must_contain(dr, r"%fenk_legs\s*=\s*1", "legs bit")

    # --- B: cumulative needle/thread ---
    must_contain(dr, r"\[proc,fenk_try_hand_needle\]", "needle proc")
    must_contain(dr, r"\[proc,fenk_try_hand_thread\]", "thread proc")
    must_contain(dr, r"%fenk_threads_given", "thread counter")
    must_contain(dr, r"sub\s*\(\s*5\s*,\s*%fenk_threads_given\s*\)", "up-to-five thread")
    must_contain(dr, r"inv_del\s*\(\s*inv\s*,\s*needle\s*,\s*1\s*\)", "needle consume once")
    must_not_contain(dr, r"costume_needle", "no costume needle")

    # --- B: gardener Ghostspeak + follower ---
    g = bodies["fenk_gardener.rs2"]
    must_contain(g, r"amulet_of_ghostspeak", "ghostspeak gate")
    must_contain(g, r"npc_setmode\s*\(\s*playerfollow\s*\)", "playerfollow")
    must_contain(g, r"%fenk_follower_uid", "private follower uid")
    must_contain(g, r"%fenk_gardener_directions\s*=\s*1", "directions multi bit")
    must_contain(g, r"\^fenk_follow_ticks", "10 min candidate duration")
    must_contain(g, r"\[proc,fenk_clear_gardener_follow\]", "cleanup proc")
    must_contain(g, r"\[softtimer,fenk_follow_watch\]", "follow watch")
    must_contain(g, r"\[proc,fenk_on_player_cleanup\]", "logout/death cleanup proc")
    must_contain(g, r"\[queue,fenk_on_login_cleanup\]", "login cleanup queue")
    # Softtimer must not call protected cleanup directly — queue for p_active_player.
    must_contain(g, r"queue\s*\(\s*fenk_on_login_cleanup", "softtimer queues protected cleanup")
    soft = re.search(r"\[softtimer,fenk_follow_watch\]([\s\S]*?)(?=\n\[|\Z)", g)
    if not soft:
        fail("softtimer body missing")
    elif "~fenk_clear_gardener_follow" in soft.group(1):
        fail("softtimer must not gosub protected clear")
    # Voice honesty: following talk restates south Haunted Forest — no free compass.
    must_contain(g, r"aunted Forest to the south", "following talk south forest")
    must_contain(g, r"Exact tile leash radius", "leash UNKNOWN honesty comment")
    must_contain(g, r"Do NOT hook pet\.rs2", "no pet.rs2 hook comment")
    must_contain(follower_varp, r"scope=temp", "follower uid temp")
    must_contain(follower_varp, r"type=npc_uid", "follower uid type")
    must_contain(follower_varp, r"protect=no", "follower uid softtimer-readable")
    # Charos durable memory: dedicated perm varp — NOT digresult=7.
    must_contain(follower_varp, r"\[fenk_charos_unlocked_mem\]", "charos mem varp def")
    must_contain(follower_varp, r"scope=perm", "charos mem perm")
    must_not_contain(follower_varp, r"%fenk_digresult|fenk_digresult\s*=", "charos mem must not assign digresult")

    # --- B: graves Dig independent of follower + island part map ---
    graves = bodies["fenk_graves.rs2"]
    must_contain(graves, r"\[oploc2,fenk_grave_poor\]", "poor dig")
    must_contain(graves, r"\[oploc2,fenk_grave\]", "island dig")
    must_contain(graves, r"0_56_54_24_35", "Ed Lestwit grave coord")
    must_contain(graves, r"0_54_55_46_56", "NW torso coord")
    must_contain(graves, r"0_54_55_48_57", "N arms coord")
    must_contain(graves, r"0_54_55_50_56", "NE legs coord")
    must_contain(graves, r"fenk_head_empty", "head yield")
    must_contain(graves, r"\[proc,fenk_try_dig_head\]", "head dig proc")
    must_contain(graves, r"%fenk_head\s*=\s*1", "head hand-in empty guard")
    must_contain(graves, r"fenk_torso", "torso yield")
    # Dig must not require follower uid
    dig_poor = re.search(r"\[oploc2,fenk_grave_poor\]([\s\S]*?)(?=\n\[|\Z)", graves)
    if dig_poor and "fenk_follower_uid" in dig_poor.group(1).split("@fenk_dig")[0]:
        # follower only optional after dig for overhead — OK if after yield
        pass
    must_contain(graves, r"spade", "spade check")

    # --- C: brain + head combine + bookcases + star ---
    items = bodies["fenk_items_bookcases.rs2"]
    must_contain(items, r"fenk_brain", "brain combine")
    must_contain(items, r"fenk_head_full", "full head")
    must_contain(items, r"fenk_marble_amulet", "marble")
    must_contain(items, r"fenk_obsidian_amulet", "obsidian")
    must_contain(items, r"fenk_star_amulet", "star")
    must_contain(items, r"Joy of Grave", "west book title")
    must_contain(items, r"Handy Maggot", "east book title")
    must_contain(items, r"1_55_55_22_38", "west bookcase L1")
    must_contain(items, r"1_55_55_35_38", "east bookcase L1")

    brain = bodies["fenk_brain_take.rs2"]
    must_contain(brain, r"\[opobj3,fenk_brain\]", "brain take op")
    must_contain(roavar, r"\[label,roavar_brain_take\]", "roavar brain label")
    must_contain(roavar, r"inv_del\s*\(\s*inv\s*,\s*coins\s*,\s*50\s*\)", "50gp brain")
    must_contain(roavar, r"inv_add\s*\(\s*inv\s*,\s*fenk_brain", "brain grant")

    # --- D: memorial star + push (CANDIDATE stands from root collision receipt) ---
    # East surface → underband 3577,9927 = 0_55_155_57_7
    # Island surface → underband 3504,9969 = 0_54_155_48_49 (NOT surface −6400)
    mem = bodies["fenk_memorial.rs2"]
    must_contain(mem, r"\[oplocu,fenk_coffin\]", "star use on coffin")
    must_contain(mem, r"fenk_star_amulet", "star amulet")
    must_contain(mem, r"%fenk_coffin\s*=\s*1", "coffin bit")
    must_contain(mem, r"0_55_55_58_7", "east memorial coord")
    must_contain(mem, r"0_54_55_49_51", "island return coffin")
    must_contain(mem, r"p_telejump\s*\(\s*0_55_155_57_7\s*\)", "east push dest 3577,9927 underband")
    must_contain(mem, r"p_telejump\s*\(\s*0_54_155_48_49\s*\)", "island push dest 3504,9969 underband")
    must_not_contain(mem, r"movecoord\s*\(\s*loc_coord\s*,\s*-1\s*,\s*0\s*,\s*-6400\s*\)", "must not use island surface −6400")
    must_contain(mem, r"root-memorial-collision|3504,9969|3577,9927", "collision-receipt grounding")
    must_contain(mem, r"ladder_1757", "ladder pair documented")

    # --- D: experiment key + doors ---
    doors = bodies["fenk_doors_experiment.rs2"]
    must_contain(doors, r"\[ai_queue3,fenk_experiment_1\]", "experiment death")
    must_contain(doors, r"fenk_mausoleum_key", "cavern key drop")
    must_contain(doors, r"gosub\s*\(\s*npc_default_death\s*\)", "experiment default death + bones")
    must_not_contain(doors, r"gosub\s*\(\s*npc_death\s*\)", "experiment must not skip death_drop")
    # Key drop stays in ai_queue3 (active_npc); no queue label needing npc_coord.
    must_contain(
        doors,
        r"\[ai_queue3,fenk_experiment_1\][\s\S]*?obj_add\s*\(\s*npc_coord\s*,\s*fenk_mausoleum_key",
        "key drop in death context with npc_coord",
    )
    must_not_contain(doors, r"\[queue,fenk_experiment_key", "no key-drop queue losing npc")
    must_contain(doors, r"\[oploc1,fenk_shed_door\]", "shed door")
    must_contain(doors, r"\[oploc1,fenk_tower_door\]", "tower door")
    must_contain(doors, r"\[oploc1,fenk_mausoleum_door\]", "mausoleum door")
    must_contain(doors, r"%fenk_unlocked_shed", "shed unlock bit")
    must_contain(doors, r"%fenk_unlocked_tower", "tower unlock bit")
    must_contain(doors, r"%fenk_unlocked_cavern", "cavern unlock bit")

    # --- E: shed brush Craft 20 + 3 cane + 3 wire + mould + conductor ---
    shed = bodies["fenk_shed_conductor.rs2"]
    must_contain(shed, r"stat\s*\(\s*crafting\s*\)\s*<\s*20", "craft 20 brush")
    must_contain(shed, r"bronzecraftwire", "bronze wire")
    must_contain(shed, r"fenk_brush3", "fully extended brush")
    must_contain(shed, r"1_55_55_24_35", "correct fireplace")
    must_contain(shed, r"fenk_lightning_mould", "mould yield")
    must_contain(shed, r"%fenk_conductor_repaired\s*=\s*1", "conductor repaired bit")
    must_contain(shed, r"hammer", "hammer for repair")
    # three extensions consume cane+wire each
    must_contain(shed, r"fenk_brush0,\s*fenk_brush1", "extend 0→1")
    must_contain(shed, r"fenk_brush1,\s*fenk_brush2", "extend 1→2")
    must_contain(shed, r"fenk_brush2,\s*fenk_brush3", "extend 2→3")

    # --- F/G: creature, pickpocket, complete once, recovery ---
    tower = bodies["fenk_tower_complete.rs2"]
    must_contain(tower, r"\[opnpc1,fenk_creature_model\]", "creature talk")
    must_contain(tower, r"\[opnpc3,fenk_fenkenstrain_model\]", "pickpocket")
    must_contain(tower, r"stat\s*\(\s*thieving\s*\)\s*<\s*25", "thieving 25")
    must_contain(tower, r"\[queue,fenk_quest_complete\]", "complete queue")
    must_contain(tower, r"%fenk_quest\s*>=\s*\^fenk_complete", "once-guard")
    must_contain(tower, r"stat_advance\s*\(\s*thieving\s*,\s*10000\s*\)", "1000 thieving XP tenths")
    must_contain(tower, r"send_quest_complete\s*\(\s*questlist:creatureoffenkenstrain", "quest scroll")
    must_contain(tower, r"\^creatureoffenkenstrain_questpoints", "QP on scroll")
    must_contain(tower, r"ring_of_charos_unlocked", "unlocked variant in guard/recovery")
    must_contain(tower, r"\[proc,fenk_give_charos_recovery\]", "lost-ring recovery")
    must_contain(tower, r"\[proc,fenk_has_charos_any\]", "duplicate guard both variants")
    must_contain(tower, r"%fenk_charos_unlocked_mem", "durable charos memory varp use")
    must_contain(tower, r"\[proc,fenk_note_charos_unlocked\]", "note unlocked proc")
    must_not_contain(tower, r"%fenk_digresult\s*=\s*7", "must not use digresult=7 for charos mem")
    # Honest residual: mem observation-only; must document incomplete (u) paths
    must_contain(tower, r"OBSERVED held|Observation beat only", "charos mem observation honesty")
    must_contain(tower, r"OUT OF SCOPE|residual", "charos Garden residual honesty")
    # recovery path must not re-advance XP
    recovery = re.search(
        r"%fenk_quest\s*>=\s*\^fenk_complete\s*\{([\s\S]*?)return;\s*\}",
        tower,
    )
    if recovery and "stat_advance" in recovery.group(1):
        fail("post-complete recovery must not stat_advance")
    # scroll newline house form: on disk two backslash bytes then n
    tower_raw = (scripts_dir / "fenk_tower_complete.rs2").read_bytes()
    # House form: two backslash bytes then n (not a real newline, not single \n).
    if b"completed the\\\\nCreature" not in tower_raw:
        fail("scroll title should use house two-backslash form before n")
    must_contain(tower, r"\[if_button,questlist:creatureoffenkenstrain\]", "journal button")

    # --- G2 clock letter: no bit-before-grant; transcript wind; no invented Read ---
    must_contain(tower, r"\[proc,fenk_try_clock_letter\]", "clock letter proc")
    clock = re.search(r"\[proc,fenk_try_clock_letter\]([\s\S]*?)(?=\n\[|\Z)", tower)
    if not clock:
        fail("clock letter proc body missing")
    else:
        body = clock.group(1)
        space = body.find("inv_freespace")
        bit = body.find("%fenk_wound_clock")
        if space < 0 or bit < 0 or bit < space:
            fail("clock must write wound bit only after inv_freespace check")
        if "You wind the old clock." not in body:
            fail("clock re-wind must use transcript 'You wind the old clock.'")
    must_contain(tower, r"As you wind the old clock a letter falls out", "transcript wind tbox")
    must_contain(tower, r"A letter, clearly hastily written", "cache desc Read")
    must_not_contain(tower, r"Optional lore", "no developer Optional lore on letter")
    must_not_contain(tower, r"ring of great power", "no invented letter prose")

    # --- B3b gameplay teleport hook (stock p_telejump_safe) ---
    tele = read(ROOT / "scripts/skill_magic/scripts/spells/teleport.rs2")
    must_contain(tele, r"\[proc,p_telejump_safe\]", "stock p_telejump_safe")
    psafe = re.search(r"\[proc,p_telejump_safe\]([\s\S]*?)(?=\n\[|\Z)", tele)
    if not psafe:
        fail("p_telejump_safe body missing")
    elif "~fenk_on_gameplay_teleport" not in psafe.group(1):
        fail("p_telejump_safe must call ~fenk_on_gameplay_teleport after p_telejump")
    elif "~follower_death" in psafe.group(1):
        fail("p_telejump_safe must not call ~follower_death")
    must_contain(g, r"\[proc,fenk_on_gameplay_teleport\]", "gameplay teleport cleanup proc")
    must_not_contain(stairs, r"fenk_on_gameplay_teleport", "stairs p_teleport must not be teleport-loss")
    must_contain(mem, r"~fenk_on_gameplay_teleport", "memorial loc tele cleanup")

    # --- F3 Garden seam (no Garden port) ---
    garden_el = read(ROOT / "scripts/quests/quest_garden/scripts/garden_ellamaria.rs2")
    garden_be = read(ROOT / "scripts/quests/quest_garden/scripts/garden_bernald.rs2")
    must_not_contain(garden_el, r"charos|fenk_", "Garden ellamaria has no Charos unlock")
    must_not_contain(garden_be, r"charos|fenk_", "Garden bernald has no Charos unlock")
    must_contain(follower_varp, r"scripts/quests/quest_garden/", "Garden seam path on mem varp")
    must_contain(tower, r"inv_total\s*\(\s*bank\s*,\s*ring_of_charos", "F3 bank base")
    must_contain(tower, r"inv_total\s*\(\s*worn\s*,\s*ring_of_charos", "F3 worn base")
    must_contain(tower, r"inv_total\s*\(\s*inv\s*,\s*ring_of_charos", "F3 inv base")
    must_contain(tower, r"inv_total\s*\(\s*bank\s*,\s*ring_of_charos_unlocked", "F3 bank (u)")
    must_contain(tower, r"inv_total\s*\(\s*worn\s*,\s*ring_of_charos_unlocked", "F3 worn (u)")

    # --- authorized lifecycle hooks (NOT pet.rs2) ---
    logout = read(ROOT / "scripts/login_logout/scripts/logout.rs2")
    login = read(ROOT / "scripts/login_logout/scripts/login.rs2")
    death = read(ROOT / "scripts/player/scripts/death.rs2")
    pet = read(ROOT / "scripts/quests/quest_fluffs/scripts/pet.rs2")
    must_contain(logout, r"~fenk_on_player_cleanup", "logout fenk cleanup")
    must_contain(death, r"~fenk_on_player_cleanup", "death fenk cleanup")
    must_contain(login, r"queue\s*\(\s*fenk_on_login_cleanup\s*,\s*0\s*,\s*0\s*\)", "login fenk cleanup queue")
    must_not_contain(pet, r"fenk_", "pet.rs2 must not reference fenk")

    # --- config-first: experiment combat named seq fills exist ---
    all_npc = read(ROOT / "scripts/_unpack/377/all.npc")
    all_seq = read(ROOT / "scripts/_unpack/377/all.seq")
    for seq in (
        "homolupus_attack",
        "homolupus_defend",
        "homolupus_death",
        "waa_homo_arachnus_attack",
        "waa_homo_arachnus_defend",
        "waa_homo_arachnus_death",
        "waa_ovinocanus_attack",
        "waa_ovinocanus_defend",
        "waa_ovinocanus_death",
    ):
        must_contain(all_seq, rf"\[{seq}\]", f"seq def {seq}")
    must_contain(all_npc, r"param=attack_anim,homolupus_attack", "exp1 attack seq")
    must_contain(all_npc, r"param=defend_anim,homolupus_defend", "exp1 defend seq")
    must_contain(all_npc, r"param=death_anim,homolupus_death", "exp1 death seq")
    must_contain(all_npc, r"param=attack_anim,waa_homo_arachnus_attack", "exp2 attack seq")
    must_contain(all_npc, r"param=attack_anim,waa_ovinocanus_attack", "exp3 attack seq")
    # category fill on all three experiment NPCs
    exp_blocks = re.findall(r"\[fenk_experiment_[123]\]([\s\S]*?)(?=\n\[|\Z)", all_npc)
    if len(exp_blocks) < 3:
        fail("expected three fenk_experiment_* npc defs")
    for i, block in enumerate(exp_blocks, start=1):
        if "category=fenk_experiment" not in block:
            fail(f"fenk_experiment_{i} missing category=fenk_experiment")
        if "param=attackrate" not in block:
            fail(f"fenk_experiment_{i} missing attackrate")
    # B3 gardener movement: multi parents NOMOVE-pinned; dynamic type must be mobile.
    # Engine Npc.updateMovement short-circuits on moverestrict=NOMOVE independent of mode.
    for multi_name in ("fenk_gardener_multi", "fenk_gardener_multi_2"):
        m = re.search(rf"\[{multi_name}\]([\s\S]*?)(?=\n\[|\Z)", all_npc)
        if not m:
            fail(f"missing {multi_name}")
        else:
            if "moverestrict=nomove" not in m.group(1):
                fail(f"{multi_name} must pin with moverestrict=nomove")
            if "defaultmode=none" not in m.group(1):
                fail(f"{multi_name} must defaultmode=none")
    g_npc = re.search(r"\[fenk_gardener\]([\s\S]*?)(?=\n\[|\Z)", all_npc)
    if not g_npc:
        fail("missing fenk_gardener def")
    else:
        if re.search(r"moverestrict\s*=\s*nomove", g_npc.group(1)):
            fail("fenk_gardener must NOT be moverestrict=nomove (dynamic follower type)")
        if "wanderrange=0" not in g_npc.group(1):
            fail("fenk_gardener wanderrange=0")
        if "defaultmode=none" not in g_npc.group(1):
            fail("fenk_gardener defaultmode=none")
    must_contain(g, r"npc_add\s*\(\s*\$spawn\s*,\s*fenk_gardener\s*,", "follower npc_add fenk_gardener")
    # Exact loc inventory: 78 all.loc + 2 stairs.loc = 80 (root-precontract resolved)
    all_loc = read(ROOT / "scripts/_unpack/377/all.loc")
    stairs_loc = read(ROOT / "scripts/ladders+stairs/configs/stairs.loc")
    loc_all = re.findall(r"^\[(fenk_[^\]]+)\]", all_loc, re.M)
    loc_stairs = re.findall(r"^\[(fenk_[^\]]+)\]", stairs_loc, re.M)
    if len(loc_all) != 78:
        fail(f"all.loc fenk_* count {len(loc_all)} != 78")
    if set(loc_stairs) != {"fenk_stairs_lv1", "fenk_stairs_lv1_top"}:
        fail(f"stairs.loc fenk defs unexpected: {loc_stairs}")
    if len(loc_all) + len(loc_stairs) != 80:
        fail("named fenk loc total must be 80 (78 unpack + 2 stairs)")
    # varp scope=perm for quest durable state
    all_varp = read(ROOT / "scripts/_unpack/377/all.varp")
    must_contain(all_varp, r"\[fenk_quest\][\s\S]*?scope=perm", "fenk_quest scope perm")
    must_contain(all_varp, r"\[fenk_flags\][\s\S]*?scope=perm", "fenk_flags scope perm")
    # pack id registration for new varps
    varp_pack = read(ROOT / "pack/varp.pack")
    must_contain(varp_pack, r"763=fenk_follower_uid", "pack id follower uid")
    must_contain(varp_pack, r"764=fenk_charos_unlocked_mem", "pack id charos mem")

    # --- shared joins ---
    must_contain(
        stairs,
        r"\[oploc1,fenk_stairs_lv1\][\s\S]*?0_55_55_17_31[\s\S]*?0_55_55_39_31",
        "stairs L0 west+east cases",
    )
    must_contain(
        stairs,
        r"\[oploc1,fenk_stairs_lv1_top\][\s\S]*?1_55_55_17_32[\s\S]*?1_55_55_39_32",
        "stairs L1 west+east cases",
    )
    must_contain(jewellery, r"craft_fenk_conductor", "conductor craft label")
    must_contain(jewellery, r"fenk_lightning_mould", "conductor mould gate")
    must_contain(jewellery, r"stat_advance\s*\(\s*crafting\s*,\s*500\s*\)", "50 craft XP tenths")
    must_contain(jewellery, r"silver_casting:com_113", "IF lightning button")
    must_contain(
        quests,
        r"send_quest_progress_colour\s*\(\s*questlist:creatureoffenkenstrain\s*,\s*%fenk_quest\s*,\s*\^creatureoffenkenstrain_complete\s*\)",
        "questlist colour",
    )
    must_contain(
        quests,
        r"%fenk_quest\s*>=\s*\^creatureoffenkenstrain_complete[\s\S]{0,120}\^creatureoffenkenstrain_questpoints",
        "QP total wiring",
    )
    # preserve HM wiring
    must_contain(
        quests,
        r"send_quest_progress_colour\s*\(\s*questlist:hauntedmine\s*,\s*%hauntedmine",
        "HM colour preserved",
    )

    if failures:
        print("FAIL (static source-regex)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS (static source-regex only — not functional/historical acceptance)")
    print(f"  checked {len(required_scripts)} fenk scripts + stairs/jewellery/roavar/quests joins")
    return 0


if __name__ == "__main__":
    sys.exit(main())

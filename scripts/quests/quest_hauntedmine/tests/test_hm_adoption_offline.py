#!/usr/bin/env python3
"""Source-contract checks only. These do not replace the in-game check plan."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[4]
HM = ROOT / "scripts/quests/quest_hauntedmine"


def source(name):
    return (HM / "scripts" / name).read_text()


def block(text, heading):
    return text.split(heading, 1)[1].split("\n[", 1)[0]


class AdoptionContracts(unittest.TestCase):
    def test_all_256_cart_routes(self):
        """Interpret the actual product decision tree, not a second routing table."""
        constants = dict(re.findall(r"\^(\w+)\s*=\s*(\d+)", (HM / "configs/hauntedmine.constant").read_text()))
        code = block(source("hauntedmine_points.rs2"), "[if_button,hauntedmine_controls:com_222]")
        code = re.sub(r"//[^\n]*", "", code).replace("~hauntedmine_animate_start;", "")
        token = re.compile(r"\s*(?:if\s*\(testbit\(%hauntedmine_bits,\s*\^(\w+)\)\s*=\s*\^(true|false)\)|([{}])|(else)|~hauntedmine_animate_(sink|returned|success)(?:\(([^;]*)\))?;)")
        tokens = []
        while code.strip():
            match = token.match(code)
            self.assertIsNotNone(match, code)
            tokens.append(match.groups())
            code = code[match.end():]

        def statement(index):
            name, truth, brace, otherwise, action, arguments = tokens[index]
            if name:
                yes, end = statement(index + 1)
                self.assertEqual(tokens[end][3], "else")
                no, end = statement(end + 1)
                return ("if", int(constants[name]), truth == "true", yes, no), end
            if brace == "{":
                result, end = statement(index + 1)
                self.assertEqual(tokens[end][2], "}")
                return result, end + 1
            self.assertIsNotNone(action)
            return (action, arguments), index + 1

        tree, end = statement(0)
        self.assertEqual(end, len(tokens))

        def route(node, bits):
            if node[0] == "if":
                _, bit, truth, yes, no = node
                return route(yes if bool(bits & (1 << bit)) == truth else no, bits)
            return node[0]

        successes = []
        for setting in range(256):
            bits = setting << 1
            result = route(tree, bits)
            expected = bits & 158 == 6  # B,A set; C,D,J clear; E,I,K free.
            self.assertEqual(result == "success", expected, bits)
            if result == "success":
                successes.append(bits)
        self.assertEqual(successes, [6, 38, 70, 102, 262, 294, 326, 358])
        self.assertEqual(route(tree, 102), "success")  # 2006-01-14 screenshot, not a discriminator between rules.

    def test_377_interface_and_permanent_varp(self):
        varps = (ROOT / "scripts/_unpack/377/all.varp").read_text()
        stage = block(varps, "[hauntedmine]")
        self.assertIn("scope=perm", stage)
        self.assertNotIn("transmit=yes", stage)  # Quest colour and journal read server state.
        bits = block(varps, "[hauntedmine_bits]")
        self.assertIn("scope=perm", bits)
        self.assertIn("transmit=yes", bits)
        interface = (ROOT / "scripts/interfaces/hauntedmine_controls.if").read_text()
        self.assertIn("script1op1=testbit,hauntedmine_bits,1", block(interface, "[com_209]"))
        self.assertNotIn("if_setmodel", source("hauntedmine_points.rs2"))
        self.assertNotIn("hauntedmine_points_store", (ROOT / "pack/varp.pack").read_text())

    def test_npc_behavior_fields_match_donor(self):
        hunt = (HM / "configs/hauntedmine.hunt").read_text()
        self.assertIn("[aggressive_hauntedmine]", hunt)
        npcs = (ROOT / "scripts/_unpack/377/all.npc").read_text()
        for npc in ("possessed_pickaxe_stationary", "skeletal_miner_sitting", "hauntedmine_suprise_ghost_hidden"):
            for field in ("huntrange=2", "attackrange=2", "huntmode=aggressive_hauntedmine", "timer=50"):
                self.assertIn(field, block(npcs, f"[{npc}]"))
        for npc in ("hauntedmine_boss_ghost", "hauntedmine_boss_ghost_faded"):
            self.assertIn("timer=1", block(npcs, f"[{npc}]"))
        puzzle_cart = block(npcs, "[puzzle_cart]")
        self.assertIn("moverestrict=blocked", puzzle_cart)
        self.assertNotIn("blockwalk=all", puzzle_cart)
        self.assertNotIn("moverestrict=nomove", block(npcs, "[hauntedmine_boss_cart]"))
        for cart in range(1, 5):
            config = block(npcs, f"[hauntedmine_cart{cart}]")
            for field in ("timer=1", "category=hauntedmine_cart", "defaultmode=patrol"):
                self.assertIn(field, config)
            self.assertNotIn("moverestrict=nomove", config)
            self.assertIn("patrol1=", config)
            self.assertIn("patrol2=", config)

    def test_treus_ownership_precedes_attack_permission(self):
        combat = (ROOT / "scripts/skill_combat/scripts/npc/npc_combat.rs2").read_text()
        guard = "if ((npc_type = hauntedmine_boss_ghost | npc_type = hauntedmine_boss_ghost_faded) & %npc_attacking_uid ! uid) {"
        for proc in ("npc_is_attackable", "npc_is_attackable_opt"):
            attackable = block(combat, f"[proc,{proc}]")
            self.assertIn(guard, attackable)
            refusal = attackable.split(guard, 1)[1].split("}", 1)[0]
            self.assertIn('mes("Someone else is fighting that.");', refusal)
            self.assertIn("return(false);", refusal)
            self.assertLess(attackable.index(guard), attackable.index("if (npc_hasop(2)"))

    def test_west_cart_search_includes_mapped_spawn(self):
        self.assertIn("0 33 40: 1544", (ROOT / "maps/m43_69.jm2").read_text())
        timer = block(source("hauntedmine_boss_ghost.rs2"), "[label,hauntedmine_boss_timer]")
        self.assertIn(
            "if (inzone(0_43_69_30_40, 0_43_69_32_40, coord) = true) "
            "~hauntedmine_boss_minecart_attack(0_43_69_30_40, 0_43_69_33_40, 0_43_69_31_40, 0_43_69_32_40)",
            timer,
        )

    def test_fungus_death_precedes_keep_drop(self):
        death = (ROOT / "scripts/player/scripts/death.rs2").read_text()
        self.assertRegex(death, r"@player_death_duel;\s*return;")
        duel_return = death.index("return;", death.index("@player_death_duel;"))
        conversion_call = death.index("~hauntedmine_fungus_crumble;")
        self.assertLess(duel_return, conversion_call)
        for allocation in ("~pvp_death_lose_items;", "~player_death_lose_items;"):
            self.assertLess(conversion_call, death.index(allocation))
        crumble = block(source("hauntedmine_fungus.rs2"), "[proc,hauntedmine_fungus_crumble]")
        self.assertIn("~hm_fungus_convert_carried_to_ashes;", crumble)
        self.assertNotIn("obj_add", crumble)  # Normal death owns the ashes, no duplicate drop.
        conversion = block(source("hauntedmine_lifecycle.rs2"), "[proc,hm_fungus_convert_carried_to_ashes]")
        self.assertIn("inv_setslot(inv, $i, ashes, inv_getnum(inv, $i))", conversion)

    def test_lift_and_stair_contracts(self):
        self.assertIn("longqueue(hauntedmine_clearvalve, 25, 0, ^accelerate)", source("hauntedmine_lift.rs2"))
        stairs = source("hauntedmine_darkstairs.rs2")
        for tile in ("0_42_71_24_49", "0_42_71_42_19", "0_43_69_6_38", "0_43_69_59_38"):
            self.assertIn(f"p_teleport({tile})", stairs)
        self.assertIn("%hauntedmine <= ^hauntedmine_lightstairsfound", stairs)
        self.assertIn("~crawl_through(0_53_50_49_32)", source("hauntedmine_locs.rs2"))

    def test_directional_keyring_door_and_journal(self):
        door = source("hm_reward_door.rs2")
        self.assertIn("$entering = true & inv_total(inv, hauntedmine_reward_key) < 1", door)
        self.assertIn("~osf_key_ring_has(hauntedmine_reward_key)", door)
        self.assertIn("%hauntedmine = ^hauntedmine_rewarddoor_found", door)
        writer = re.search(r"if \(([^{}\n]+)\) \{\s*%hauntedmine = \^hauntedmine_rewarddoor_found;", door)
        self.assertIsNotNone(writer)
        self.assertTrue(writer.group(1).startswith("$entering = true & "))
        self.assertIn("%hauntedmine = ^hauntedmine_boss_defeated", writer.group(1))
        self.assertIn("inzone(0_43_69_20_33, 0_43_69_21_34, coord)", writer.group(1))
        journal = source("hauntedmine_journal.rs2")
        self.assertNotIn("Tarn", journal)
        self.assertIn("Access to Morytania", journal)


if __name__ == "__main__":
    unittest.main(verbosity=2)

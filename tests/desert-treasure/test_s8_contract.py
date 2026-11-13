#!/usr/bin/env python3
"""Offline source contract for the Desert Treasure S8 rewards and Ancient teleports."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
import re


REPO_ROOT = Path(__file__).resolve().parents[2]
CANONICAL_TELEPORTS = (
    "paddewwa",
    "senntisten",
    "kharyrll",
    "lassar",
    "dareeyak",
    "carrallangar",
    "annakarl",
    "ghorrock",
)


@dataclass(frozen=True)
class Definition:
    tag: str
    body: str

    @property
    def name(self) -> str | None:
        kind, separator, remainder = self.tag.partition(",")
        if not separator or kind not in {"label", "proc"}:
            return None
        return remainder.strip()


@dataclass(frozen=True)
class IfBlock:
    start: int
    condition: str
    then_start: int
    then_end: int
    then_body: str
    else_start: int | None
    else_end: int | None
    else_body: str
    end: int


@dataclass(frozen=True)
class TeleportFact:
    slug: str
    name: str
    component: int
    level: int
    runes: dict[str, int]
    xp_tenths: int
    x: int
    z: int
    level_plane: int
    region: dict[str, int]


def require(failures: list[str], condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def content_root() -> Path:
    return Path(os.environ.get("DT_S8_CONTENT_ROOT", REPO_ROOT)).resolve()


def facts_path(root: Path) -> Path:
    raw = os.environ.get("DT_S8_FACTS_PATH")
    path = Path(raw) if raw else Path("tests/desert-treasure/s8-facts.json")
    if not path.is_absolute():
        path = root / path
    return path.resolve()


def read_text(root: Path, relative_path: str, failures: list[str]) -> str:
    path = root / relative_path
    try:
        return path.read_text(encoding="utf-8")
    except OSError as error:
        require(failures, False, f"required source file is missing or unreadable: {path}: {error}")
        return ""


def read_facts(path: Path, failures: list[str]) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        require(failures, False, f"cannot read S8 facts from {path}: {error}")
        return {}
    if not isinstance(value, dict):
        require(failures, False, "S8 facts must be a JSON object")
        return {}
    return value


def strip_comments(text: str) -> str:
    lines: list[str] = []
    for line in text.splitlines():
        quote: str | None = None
        escaped = False
        end = len(line)
        for index, char in enumerate(line):
            if quote is not None:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == quote:
                    quote = None
            elif char in {"\"", "'"}:
                quote = char
            elif char == "/" and index + 1 < len(line) and line[index + 1] == "/":
                end = index
                break
        lines.append(line[:end])
    return "\n".join(lines)


def code_only(text: str) -> str:
    source = strip_comments(text)
    lines: list[str] = []
    for line in source.splitlines():
        quote: str | None = None
        escaped = False
        output: list[str] = []
        for char in line:
            if quote is not None:
                output.append(" ")
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == quote:
                    quote = None
            elif char in {"\"", "'"}:
                quote = char
                output.append(" ")
            else:
                output.append(char)
        lines.append("".join(output))
    return "\n".join(lines)


def parse_sections(text: str, source: str) -> tuple[dict[str, dict[str, list[str]]], list[str]]:
    sections: dict[str, dict[str, list[str]]] = {}
    duplicates: list[str] = []
    current: str | None = None
    for line_number, raw_line in enumerate(strip_comments(text).splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
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


def parse_definitions(text: str) -> list[Definition]:
    source = code_only(text)
    matches = list(re.finditer(r"(?m)^[ \t]*\[([^\]\r\n]+)\]", source))
    result: list[Definition] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(source)
        result.append(Definition(match.group(1).strip(), source[match.end() : end]))
    return result


def matching_delimiter(text: str, opening: int, left: str, right: str) -> int | None:
    depth = 0
    for index in range(opening, len(text)):
        if text[index] == left:
            depth += 1
        elif text[index] == right:
            depth -= 1
            if depth == 0:
                return index
    return None


def parse_if_blocks(text: str) -> list[IfBlock]:
    source = code_only(text)
    result: list[IfBlock] = []
    for match in re.finditer(r"\bif\s*\(", source):
        opening_paren = source.find("(", match.start())
        closing_paren = matching_delimiter(source, opening_paren, "(", ")")
        if closing_paren is None:
            continue
        opening_brace = closing_paren + 1
        while opening_brace < len(source) and source[opening_brace].isspace():
            opening_brace += 1
        if opening_brace >= len(source) or source[opening_brace] != "{":
            continue
        closing_brace = matching_delimiter(source, opening_brace, "{", "}")
        if closing_brace is None:
            continue
        else_start: int | None = None
        else_end: int | None = None
        else_body = ""
        after = closing_brace + 1
        while after < len(source) and source[after].isspace():
            after += 1
        end = closing_brace + 1
        if source.startswith("else", after):
            else_brace = after + len("else")
            while else_brace < len(source) and source[else_brace].isspace():
                else_brace += 1
            if else_brace < len(source) and source[else_brace] == "{":
                else_close = matching_delimiter(source, else_brace, "{", "}")
                if else_close is not None:
                    else_start = else_brace + 1
                    else_end = else_close
                    else_body = source[else_start:else_end]
                    end = else_close + 1
        result.append(
            IfBlock(
                start=match.start(),
                condition=source[opening_paren + 1 : closing_paren],
                then_start=opening_brace + 1,
                then_end=closing_brace,
                then_body=source[opening_brace + 1 : closing_brace],
                else_start=else_start,
                else_end=else_end,
                else_body=else_body,
                end=end,
            )
        )
    return result


def compact(text: str) -> str:
    return re.sub(r"\s+", "", text).lower()


def has_return(text: str) -> bool:
    return re.search(r"\breturn\s*;", text) is not None


def condition_state(condition: str, flag: str) -> tuple[bool, bool]:
    """Return (reject condition, accepted condition) for one purchase/action guard."""
    value = compact(condition)
    if flag == "complete":
        match = re.search(
            r"%deserttreasure(!=|!|>=|>|<|=)(?:\^dt_stage_complete|\^deserttreasure_complete)",
            value,
        )
        if not match:
            return False, False
        return match.group(1) in {"<", "!", "!="}, match.group(1) in {"=", ">", ">="}
    if flag == "bought":
        match = re.search(
            r"%fd_got_zaros_staff(!=|!|>=|<=|>|<|=)(\^true|\^false|\^dt_flag_on|\^dt_flag_off|[0-9]+)",
            value,
        )
        if not match:
            return False, False
        operator, right = match.groups()
        truthy = right in {"^true", "^dt_flag_on", "1"}
        if operator in {"=", "!="}:
            return operator == "=" and truthy, operator == "=" and not truthy
        if operator == "!":
            return right in {"0", "^false", "^dt_flag_off"}, False
        if operator == ">":
            return right == "0", False
        if operator in {"<", "<="}:
            return False, right in {"1", "^true", "^dt_flag_on"}
        return False, False
    if flag == "money":
        match = re.search(
            r"inv_total\(inv,coins\)(>=|<=|>|<|=)(?:80000|\^dt_ancient_staff_price)",
            value,
        )
        if not match:
            return False, False
        operator = match.group(1)
        return operator in {"<", "<="}, operator in {">", ">="}
    if flag == "capacity":
        match = re.search(r"inv_freespace\(inv\)(>=|<=|>|<|=)([0-9]+)", value)
        if not match:
            return False, False
        operator, raw_limit = match.groups()
        limit = int(raw_limit)
        return (operator in {"<", "<="} and limit >= 1) or (operator == "=" and limit == 0), (
            operator in {">", ">="} and limit <= 1
        )
    return False, False


def guard_flags_before(text: str, position: int) -> set[str]:
    flags: set[str] = set()
    for block in parse_if_blocks(text):
        for flag in ("complete", "bought", "money", "capacity"):
            bad_state, good_state = condition_state(block.condition, flag)
            if bad_state and has_return(block.then_body):
                if position >= block.end:
                    flags.add(flag)
                elif block.then_start <= position < block.then_end and has_return(
                    block.then_body[: position - block.then_start]
                ):
                    flags.add(flag)
            if good_state:
                if block.else_start is not None and has_return(block.else_body) and position >= block.end:
                    flags.add(flag)
                elif block.then_start <= position < block.then_end:
                    flags.add(flag)
                elif block.else_start is not None and block.else_start <= position < (block.else_end or 0):
                    flags.add(flag)
    return flags




def definitions_by_name(definitions: list[Definition]) -> dict[str, list[Definition]]:
    result: dict[str, list[Definition]] = {}
    for definition in definitions:
        if definition.name is not None:
            result.setdefault(definition.name, []).append(definition)
    return result


CALL_RE = re.compile(r"[@~]\s*([A-Za-z_][A-Za-z0-9_]*)")
MUTATION_RE = re.compile(
    r"%(?:alternate_spells|fd_got_zaros_staff)\s*=\s*[^;{}]+;|"
    r"\b(?:inv_del|inv_add|p_telejump|p_route|p_walk|p_walkto|p_walkbound|p_move|"
    r"player_teleport_normal|if_settab|if_openfull|if_openoverlay|loc_add|loc_del)\s*\(",
    re.IGNORECASE,
)


def reachable_definitions(root: Definition, by_name: dict[str, list[Definition]]) -> list[Definition]:
    result: list[Definition] = []
    seen: set[int] = set()
    pending = [root]
    while pending:
        current = pending.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        result.append(current)
        for call in CALL_RE.finditer(current.body):
            for target in by_name.get(call.group(1), []):
                pending.append(target)
    return result


def validate_guarded_mutations(
    root_definition: Definition,
    by_name: dict[str, list[Definition]],
    failures: list[str],
    action_name: str,
) -> int:
    visited: set[tuple[int, tuple[str, ...]]] = set()
    mutation_count = 0

    def visit(definition: Definition, inherited: set[str]) -> None:
        nonlocal mutation_count
        key = (id(definition), tuple(sorted(inherited)))
        if key in visited:
            return
        visited.add(key)
        code = definition.body
        for mutation in MUTATION_RE.finditer(code):
            mutation_count += 1
            available = inherited | guard_flags_before(code, mutation.start())
            require(
                failures,
                "complete" in available,
                f"{action_name} mutation in [{definition.tag}] must be behind the Desert Treasure completion gate",
            )
        for call in CALL_RE.finditer(code):
            local_targets = by_name.get(call.group(1), [])
            if not local_targets:
                continue
            available = inherited | guard_flags_before(code, call.start())
            for target in local_targets:
                visit(target, available)

    visit(root_definition, set())
    return mutation_count


def parse_constants(text: str, source: str) -> tuple[dict[str, str], list[str]]:
    values: dict[str, str] = {}
    duplicates: list[str] = []
    for line_number, raw_line in enumerate(strip_comments(text).splitlines(), 1):
        match = re.fullmatch(r"\s*\^([A-Za-z0-9_]+)\s*=\s*(\S+)\s*", raw_line)
        if not match:
            continue
        name, raw_value = match.groups()
        if name in values:
            duplicates.append(f"{source}:{line_number}: ^{name}")
        else:
            values[name] = raw_value
    return values, duplicates


def parse_dbrows(text: str, source: str) -> tuple[dict[str, dict[str, list[str]]], list[str]]:
    sections, duplicates = parse_sections(text, source)
    rows: dict[str, dict[str, list[str]]] = {}
    for name, fields in sections.items():
        parsed: dict[str, list[str]] = {}
        for raw_value in fields.get("data", []):
            key, separator, value = raw_value.partition(",")
            if separator:
                parsed.setdefault(key.strip(), []).append(value.strip())
        rows[name] = {"table": fields.get("table", []), **parsed}
    return rows, duplicates


def one(values: list[str] | None) -> str | None:
    return values[0] if values is not None and len(values) == 1 else None


def integer(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.fullmatch(r"-?\d+", value.strip()):
        return int(value.strip())
    return None


def component_number(value: object) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, str):
        match = re.fullmatch(r"(?:inter_267:)?com_(\d+)", value.strip())
        if match:
            return int(match.group(1))
    return None


def fact_slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return re.sub(r"_teleport$", "", slug)


def load_teleports(facts: dict[str, object], failures: list[str]) -> list[TeleportFact]:
    raw_teleports = facts.get("teleports")
    if not isinstance(raw_teleports, list):
        require(failures, False, "S8 facts must contain a top-level teleports array")
        return []
    require(failures, len(raw_teleports) == 8, f"S8 facts must contain eight teleports, got {len(raw_teleports)}")

    result: list[TeleportFact] = []
    slugs: set[str] = set()
    components: set[int] = set()
    for index, raw in enumerate(raw_teleports):
        prefix = f"S8 facts teleports[{index}]"
        if not isinstance(raw, dict):
            require(failures, False, f"{prefix} must be an object")
            continue
        name_value = raw.get("name")
        name = name_value.strip() if isinstance(name_value, str) else ""
        slug = fact_slug(name)
        component = component_number(raw.get("component"))
        level = integer(raw.get("level"))
        xp = raw.get("xp")
        try:
            xp_tenths_decimal = Decimal(str(xp)) * 10
            xp_tenths = int(xp_tenths_decimal)
            if xp_tenths_decimal != xp_tenths:
                raise InvalidOperation
        except (InvalidOperation, ValueError, TypeError):
            xp_tenths = -1
        runes_value = raw.get("runes")
        runes: dict[str, int] = {}
        if isinstance(runes_value, dict):
            for rune, count_value in runes_value.items():
                count = integer(count_value)
                if not isinstance(rune, str) or count is None or count < 1:
                    require(failures, False, f"{prefix} has an invalid rune requirement {rune!r}: {count_value!r}")
                    continue
                runes[rune.strip().lower()] = count
        else:
            require(failures, False, f"{prefix} must contain a runes object")
        destination = raw.get("destination")
        region = raw.get("region")
        if not isinstance(destination, dict):
            destination = {}
            require(failures, False, f"{prefix} must contain a destination object")
        if not isinstance(region, dict):
            region = {}
            require(failures, False, f"{prefix} must contain a region object")
        destination_values = {key: integer(destination.get(key)) for key in ("x", "z", "level")}
        region_values = {key: integer(region.get(key)) for key in ("minX", "maxX", "minZ", "maxZ", "level")}
        require(failures, bool(name), f"{prefix} is missing its name")
        require(failures, bool(slug), f"{prefix} has an invalid name {name!r}")
        require(failures, component is not None, f"{prefix} has an invalid component {raw.get('component')!r}")
        require(failures, level is not None, f"{prefix} has an invalid level {raw.get('level')!r}")
        require(failures, xp_tenths >= 0, f"{prefix} has an invalid XP value {xp!r}")
        for key, value in destination_values.items():
            require(failures, value is not None, f"{prefix} destination.{key} must be an integer")
        for key, value in region_values.items():
            require(failures, value is not None, f"{prefix} region.{key} must be an integer")
        if slug in slugs:
            require(failures, False, f"S8 facts contain duplicate teleport {slug}")
        slugs.add(slug)
        if component is not None:
            if component in components:
                require(failures, False, f"S8 facts reuse Ancient interface component {component}")
            components.add(component)
        if (
            component is None
            or level is None
            or xp_tenths < 0
            or any(value is None for value in destination_values.values())
            or any(value is None for value in region_values.values())
        ):
            continue
        destination_x = destination_values["x"]
        destination_z = destination_values["z"]
        destination_level = destination_values["level"]
        region_level = region_values["level"]
        bounds_valid = (
            region_values["minX"] <= region_values["maxX"]
            and region_values["minZ"] <= region_values["maxZ"]
        )
        require(failures, bounds_valid, f"{prefix} has inverted region bounds")
        require(
            failures,
            destination_level == region_level
            and region_values["minX"] <= destination_x <= region_values["maxX"]
            and region_values["minZ"] <= destination_z <= region_values["maxZ"],
            f"{prefix} destination must lie inside its recorded region and plane",
        )
        result.append(
            TeleportFact(
                slug=slug,
                name=name,
                component=component,
                level=level,
                runes=runes,
                xp_tenths=xp_tenths,
                x=destination_x,
                z=destination_z,
                level_plane=destination_level,
                region=region_values,
            )
        )
    require(
        failures,
        set(slugs) == set(CANONICAL_TELEPORTS),
        f"S8 facts teleport inventory must be {list(CANONICAL_TELEPORTS)}, got {sorted(slugs)}",
    )
    return result


def check_selector_and_login(root: Path, rewards: str, login: str, failures: list[str]) -> None:
    local_constants_path = "scripts/quests/quest_deserttreasure/configs/quest_deserttreasure.constant"
    local_constants_text = read_text(root, local_constants_path, failures)
    local_constants, duplicates = parse_constants(local_constants_text, local_constants_path)
    require(failures, not duplicates, f"duplicate Desert Treasure selector constants: {duplicates}")
    require(
        failures,
        integer(local_constants.get("dt_spellbook_standard")) == 0
        and integer(local_constants.get("dt_spellbook_ancient")) == 1,
        "the permanent spellbook selector constants must remain standard=0 and Ancient=1",
    )
    varp_path = "scripts/_unpack/377/all.varp"
    varp_text = read_text(root, varp_path, failures)
    varps, duplicates = parse_sections(varp_text, varp_path)
    require(failures, not duplicates, f"duplicate selector varp declarations: {duplicates}")
    require(
        failures,
        one(varps.get("alternate_spells", {}).get("scope")) == "perm",
        "alternate_spells must remain a permanent saved varp",
    )
    varbit_path = "scripts/_unpack/377/all.varbit"
    varbit_text = read_text(root, varbit_path, failures)
    varbits, duplicates = parse_sections(varbit_text, varbit_path)
    require(failures, not duplicates, f"duplicate selector varbit declarations: {duplicates}")
    selector = varbits.get("alternate_spells_0_0", {})
    require(
        failures,
        one(selector.get("basevar")) == "alternate_spells"
        and one(selector.get("startbit")) == "0"
        and one(selector.get("endbit")) == "0",
        "the selector must use the original alternate_spells bit 0 varbit",
    )

    reward_definitions = parse_definitions(rewards)
    by_name = definitions_by_name(reward_definitions)
    location_handlers = [definition for definition in reward_definitions if definition.tag.lower().startswith("oploc")]
    require(failures, bool(location_handlers), "S8 rewards must bind the altar, portal, and shortcut location actions")
    toggle_roots: list[Definition] = []
    for handler in location_handlers:
        reachable = reachable_definitions(handler, by_name)
        if any(re.search(r"%alternate_spells\s*=", definition.body) for definition in reachable):
            toggle_roots.append(handler)
    require(failures, bool(toggle_roots), "an altar location action must reach the persistent spellbook toggle")

    toggle_definitions: list[Definition] = []
    toggle_restore = False
    for root_definition in toggle_roots:
        for definition in reachable_definitions(root_definition, by_name):
            assignments = re.findall(r"%alternate_spells\s*=\s*\^dt_spellbook_(ancient|standard)", definition.body)
            if {"ancient", "standard"}.issubset(set(assignments)):
                toggle_definitions.append(definition)
            if re.search(r"[@~]dt_restore_spellbook\b", definition.body):
                toggle_restore = True
    require(
        failures,
        any(two_way_toggle(definition.body) for definition in toggle_definitions),
        "the altar must toggle the saved selector in both directions from its current value",
    )
    require(
        failures,
        toggle_restore,
        "the altar toggle must restore the selected spellbook interface after either write",
    )

    login_definitions = parse_definitions(login)
    init_tabs = [definition for definition in login_definitions if definition.name == "initalltabs"]
    require(failures, len(init_tabs) == 1, "login must define one initalltabs procedure")
    if len(init_tabs) == 1:
        init_code = init_tabs[0].body
        restore_match = re.search(r"[@~]dt_restore_spellbook\b", init_code)
        require(failures, restore_match is not None, "login initalltabs must call dt_restore_spellbook")
        if restore_match is not None:
            call_position = restore_match.start()
            prayer_position = init_code.find("if_settab(prayer")
            friends_position = init_code.find("if_settab(friends")
            require(
                failures,
                prayer_position >= 0 and friends_position > call_position > prayer_position,
                "login must restore the selected magic tab after prayer and before friends",
            )
            require(
                failures,
                not re.search(r"if_settab\s*\(\s*magic\b", init_code[call_position + len(restore_match.group(0)) :]),
                "login must not overwrite the restored magic tab with a later fixed tab selection",
            )

    restore_definitions = [definition for definition in reward_definitions if definition.name == "dt_restore_spellbook"]
    require(failures, len(restore_definitions) == 1, "S8 rewards must define one dt_restore_spellbook procedure")
    if len(restore_definitions) == 1:
        restore_code = restore_definitions[0].body
        ancient_branches = [
            block
            for block in parse_if_blocks(restore_code)
            if compact(block.condition) == "%deserttreasure=^dt_stage_complete&%alternate_spells=^dt_spellbook_ancient"
        ]
        require(
            failures,
            bool(ancient_branches)
            and any(
                re.search(r"\bif_settab\s*\(\s*inter_267\s*,", block.then_body)
                and re.search(r"\bif_settab\s*\(\s*magic\s*,", block.else_body)
                for block in ancient_branches
            ),
            "dt_restore_spellbook must require completion AND Ancient selection, otherwise select standard",
        )


def two_way_toggle(text: str) -> bool:
    assignment = re.compile(r"%alternate_spells\s*=\s*\^dt_spellbook_(ancient|standard)")
    for block in parse_if_blocks(text):
        condition = compact(block.condition)
        if "%alternate_spells" not in condition or "^dt_spellbook_" not in condition or not block.else_body:
            continue
        state_match = re.search(r"%alternate_spells(?:=|!)(\^dt_spellbook_(?:ancient|standard))", condition)
        if not state_match:
            continue
        current = state_match.group(1).split("_")[-1]
        condition_is_equal = "!" not in condition.split("%alternate_spells", 1)[1].split("^dt_spellbook_", 1)[0]
        if not condition_is_equal:
            current = "standard" if current == "ancient" else "ancient"
        then_targets = assignment.findall(block.then_body)
        else_targets = assignment.findall(block.else_body)
        expected_then = "standard" if current == "ancient" else "ancient"
        return expected_then in then_targets and current in else_targets
    return False


def check_altar_messages(rewards: str, facts: dict[str, object], failures: list[str]) -> None:
    messages = facts.get("altar_messages", {})
    require(failures, isinstance(messages, dict), "S8 facts must record both altar message directions")
    if not isinstance(messages, dict):
        return
    source = strip_comments(rewards)
    handler = re.search(r"\[oploc1,dt_zaros_altar\]([\s\S]*?)(?=\n\[|\Z)", source)
    require(failures, handler is not None, "altar message checks must reach the bound altar handler")
    if handler is None:
        return
    body = handler.group(1)
    toggles = [
        block for block in parse_if_blocks(body)
        if compact(block.condition) == "%alternate_spells=^dt_spellbook_ancient"
    ]
    require(failures, len(toggles) == 1, "altar messages must follow the actual two-way selector branch")
    if len(toggles) != 1:
        return
    toggle = toggles[0]
    for direction, branch in (
        ("standard", body[toggle.then_start:toggle.then_end]),
        ("ancient", body[toggle.else_start:toggle.else_end] if toggle.else_start is not None else ""),
    ):
        message = messages.get(direction)
        require(failures, isinstance(message, str) and bool(message), f"missing {direction} altar message fact")
        if not isinstance(message, str) or not message:
            continue
        pattern = rf'%alternate_spells\s*=\s*\^dt_spellbook_{direction}\s*;\s*mes\("{re.escape(message)}"\)\s*;'
        require(
            failures,
            re.search(pattern, branch) is not None and source.count(f'mes("{message}")') == 1,
            f"altar must emit the sourced {direction} message after selecting {direction}, once",
        )


def check_reward_action_gates(rewards: str, failures: list[str]) -> None:
    definitions = parse_definitions(rewards)
    by_name = definitions_by_name(definitions)
    handlers = [definition for definition in definitions if definition.tag.lower().startswith("oploc")]
    require(failures, len(handlers) >= 3, "S8 rewards must expose altar, portal, and shortcut location handlers")
    roles: set[str] = set()
    for handler in handlers:
        reachable = reachable_definitions(handler, by_name)
        all_code = "\n".join(f"{definition.tag}\n{definition.body}" for definition in reachable).lower()
        if re.search(r"%alternate_spells\s*=", all_code):
            roles.add("altar")
        if "portal" in all_code or re.search(r"\b(?:p_telejump|player_teleport_normal)\s*\(", all_code):
            roles.add("portal")
        if "shortcut" in all_code or re.search(r"\b(?:p_route|p_walk|p_walkto|p_walkbound)\s*\(", all_code):
            roles.add("shortcut")
        mutation_count = validate_guarded_mutations(handler, by_name, failures, handler.tag)
        require(
            failures,
            mutation_count > 0,
            f"location action [{handler.tag}] must reach an observable world or selector mutation",
        )
    require(
        failures,
        roles == {"altar", "portal", "shortcut"},
        f"completion-gated location handlers must cover altar, portal, and shortcut, found {sorted(roles)}",
    )


def check_postquest_staff(root: Path, rewards: str, hill: str, tier50: str, failures: list[str]) -> None:
    constants_path = "scripts/quests/quest_deserttreasure/configs/quest_deserttreasure.constant"
    constants_text = read_text(root, constants_path, failures)
    constants, duplicates = parse_constants(constants_text, constants_path)
    require(failures, not duplicates, f"duplicate Desert Treasure constants: {duplicates}")
    require(
        failures,
        integer(constants.get("dt_ancient_staff_price")) == 80000,
        "the ancient staff price constant must remain 80000",
    )

    reward_definitions = parse_definitions(rewards)
    hill_definitions = parse_definitions(hill)
    by_name = definitions_by_name(reward_definitions + hill_definitions)
    require(
        failures,
        sum(definition.name == "dt_eblis_postquest" for definition in reward_definitions) == 1,
        "S8 rewards must define dt_eblis_postquest",
    )
    postquest_hooks = [
        definition
        for definition in hill_definitions
        if definition.tag.lower().startswith("opnpc")
        and re.search(r"[@~]dt_eblis_postquest\b", definition.body)
    ]
    require(failures, bool(postquest_hooks), "Eblis Hill must route completed-quest dialogue to dt_eblis_postquest")
    for hook in postquest_hooks:
        first_if = next(iter(parse_if_blocks(hook.body)), None)
        require(
            failures,
            first_if is not None
            and not hook.body[: first_if.start].strip()
            and "%deserttreasure" in compact(first_if.condition)
            and "^dt_stage_complete" in compact(first_if.condition)
            and re.search(r"[@~]dt_eblis_postquest\b", first_if.then_body) is not None,
            "the completed-quest Eblis hook must be the first statement and call dt_eblis_postquest",
        )

    price = r"\^dt_ancient_staff_price"
    transaction_pattern = re.compile(
        rf"\binv_del\s*\(\s*inv\s*,\s*coins\s*,\s*{price}\s*\)",
        re.IGNORECASE,
    )
    transactions = [definition for definition in reward_definitions if transaction_pattern.search(definition.body)]
    require(failures, len(transactions) == 1, "staff purchase must debit its 80000-coin price in one source block")
    if len(transactions) == 1:
        transaction = transactions[0]
        code = transaction.body
        del_pattern = rf"inv_del\s*\(\s*inv\s*,\s*coins\s*,\s*{price}\s*\)\s*;"
        add_pattern = r"inv_add\s*\(\s*inv\s*,\s*staff_of_zaros\s*,\s*1\s*\)\s*;"
        bought_pattern = r"%fd_got_zaros_staff\s*=\s*\^dt_flag_on\s*;"
        del_match = re.search(del_pattern, code, re.IGNORECASE)
        add_match = re.search(add_pattern, code, re.IGNORECASE)
        bought_match = re.search(bought_pattern, code, re.IGNORECASE)
        require(failures, del_match is not None, "staff purchase must debit exactly 80000 coins")
        require(failures, add_match is not None, "staff purchase must grant one staff_of_zaros")
        require(failures, bought_match is not None, "staff purchase must set fd_got_zaros_staff")
        if del_match and add_match and bought_match:
            statements = [
                re.sub(r"^[\s{}]+|[\s{}]+$", "", part).strip()
                for part in code.split(";")
                if part.strip()
            ]
            del_statement = re.compile(rf"inv_del\s*\(\s*inv\s*,\s*coins\s*,\s*{price}\s*\)", re.IGNORECASE)
            add_statement = re.compile(r"inv_add\s*\(\s*inv\s*,\s*staff_of_zaros\s*,\s*1\s*\)", re.IGNORECASE)
            bought_statement = re.compile(r"%fd_got_zaros_staff\s*=\s*\^dt_flag_on", re.IGNORECASE)
            del_indexes = [index for index, statement in enumerate(statements) if del_statement.fullmatch(statement)]
            add_indexes = [index for index, statement in enumerate(statements) if add_statement.fullmatch(statement)]
            bought_indexes = [index for index, statement in enumerate(statements) if bought_statement.fullmatch(statement)]
            contiguous = (
                len(del_indexes) == len(add_indexes) == len(bought_indexes) == 1
                and del_indexes[0] + 1 == add_indexes[0]
                and add_indexes[0] + 1 == bought_indexes[0]
            )
            require(
                failures,
                del_match.start() < add_match.start() < bought_match.start() and contiguous,
                "staff purchase must use contiguous nonyielding inv_del, inv_add, and bought-bit statements",
            )
            require(
                failures,
                not re.search(r"\b(?:inv_del|inv_add)\s*\(|%fd_got_zaros_staff\s*=\s*[^;{}]+;", code[: del_match.start()]),
                "staff purchase must not change money, inventory, or the repeat flag before its transaction",
            )

        capacity_guard = any(
            re.search(r"inv_freespace\(inv\)=0", compact(block.condition))
            and re.search(r"inv_total\(inv,coins\)>\^dt_ancient_staff_price", compact(block.condition))
            and has_return(block.then_body)
            and block.start < del_match.start()
            for block in parse_if_blocks(code)
        ) if del_match else False
        require(
            failures,
            capacity_guard,
            "a full inventory must refuse the sale only when spending 80000 coins leaves the coin stack",
        )

        if del_match is not None:
            blocks = parse_if_blocks(code)
            rechecks = [
                block for block in blocks
                if compact(block.condition) == "%deserttreasure!^dt_stage_complete|%fd_got_zaros_staff=^dt_flag_on"
                and has_return(block.then_body) and block.end < del_match.start()
            ]
            require(failures, len(rechecks) == 1, "staff transaction must recheck completion and purchase after the offer")
            if len(rechecks) == 1:
                recheck = rechecks[0]
                success_path = code[recheck.end:del_match.start()]
                for block in sorted(blocks, key=lambda item: item.start, reverse=True):
                    if recheck.end <= block.start < block.end <= del_match.start() and has_return(block.then_body) and not block.else_body:
                        start, end = block.start - recheck.end, block.end - recheck.end
                        success_path = success_path[:start] + success_path[end:]
                require(
                    failures,
                    not success_path.strip(),
                    "staff success path must not suspend or execute other statements between guard recheck and transaction",
                )

        paths: list[set[str]] = []
        for hook in postquest_hooks:
            paths.extend(guard_paths_to_transaction(hook, by_name, transaction, set()))
        require(failures, bool(paths), "the Eblis postquest route must reach the staff purchase transaction")
        for flags in paths:
            missing = {"complete", "bought", "money", "capacity"} - flags
            require(
                failures,
                not missing,
                f"staff purchase path must guard completion, repeat purchase, 80000 coins, and inventory space; missing {sorted(missing)}",
            )

    tier_definitions = parse_definitions(tier50)
    staff_gate = [definition for definition in tier_definitions if definition.tag.lower().startswith("opheld2,staff_of_zaros")]
    require(failures, len(staff_gate) == 1, "tier50.rs2 must retain the staff_of_zaros hold handler")
    if len(staff_gate) == 1:
        code = staff_gate[0].body
        quest_check = re.search(r"%deserttreasure\s*<\s*\^deserttreasure_complete", code)
        magic_attack = re.search(r"@levelrequire_magic_and_attack\s*\(\s*50\s*,\s*50\s*,\s*last_slot\s*\)\s*;", code)
        return_position = code.find("return;")
        require(
            failures,
            quest_check is not None
            and magic_attack is not None
            and return_position >= 0
            and quest_check.start() < return_position < magic_attack.start(),
            "staff_of_zaros must retain its quest completion guard and Magic 50 / Attack 50 gates",
        )


def guard_paths_to_transaction(
    root_definition: Definition,
    by_name: dict[str, list[Definition]],
    transaction: Definition,
    inherited: set[str],
    stack: frozenset[int] = frozenset(),
) -> list[set[str]]:
    if id(root_definition) in stack:
        return []
    code = root_definition.body
    if root_definition is transaction:
        match = re.search(
            r"\binv_del\s*\(\s*inv\s*,\s*coins\s*,\s*\^dt_ancient_staff_price\s*\)",
            code,
            re.IGNORECASE,
        )
        return [inherited | guard_flags_before(code, match.start())] if match else []
    next_stack = stack | {id(root_definition)}
    paths: list[set[str]] = []
    for call in CALL_RE.finditer(code):
        for target in by_name.get(call.group(1), []):
            flags = inherited | guard_flags_before(code, call.start())
            paths.extend(guard_paths_to_transaction(target, by_name, transaction, flags, next_stack))
    return paths


def check_teleports(root: Path, facts: list[TeleportFact], failures: list[str]) -> None:
    spells_path = "scripts/skill_magic/configs/magic_spells.dbrow"
    constants_path = "scripts/skill_magic/configs/ancient_teleports.constant"
    script_path = "scripts/skill_magic/scripts/spells/ancient_teleport.rs2"
    interface_path = "scripts/interfaces/inter_267.if"
    pack_path = "pack/interface.pack"
    spells_text = read_text(root, spells_path, failures)
    constants_text = read_text(root, constants_path, failures)
    script_text = read_text(root, script_path, failures)
    interface_text = read_text(root, interface_path, failures)
    pack_text = read_text(root, pack_path, failures)

    rows, duplicates = parse_dbrows(spells_text, spells_path)
    require(failures, not duplicates, f"duplicate magic spell dbrow sections: {duplicates}")
    teleport_rows = {name for name in rows if name.startswith("magic_spell_teleport_")}
    expected_rows = {f"magic_spell_teleport_{fact.slug}" for fact in facts}
    require(
        failures,
        teleport_rows == expected_rows | {
            "magic_spell_teleport_varrock", "magic_spell_teleport_lumbridge",
            "magic_spell_teleport_falador", "magic_spell_teleport_camelot",
            "magic_spell_teleport_ardougne", "magic_spell_teleport_watchtower",
        },
        f"shared teleport dbrow inventory must retain the six standard spells and exactly eight Ancient spells: got {sorted(teleport_rows)}",
    )
    row_order = [name for name in re.findall(r"(?m)^\s*\[([^\]\r\n]+)\]\s*$", strip_comments(spells_text))]
    require(
        failures,
        len(row_order) >= 8 and set(row_order[-8:]) == expected_rows,
        "the eight magic_spell_teleport rows must be appended at the end of magic_spells.dbrow",
    )

    constants, duplicates = parse_constants(constants_text, constants_path)
    require(failures, not duplicates, f"duplicate Ancient teleport constants: {duplicates}")
    for fact in facts:
        constant = f"{fact.slug}_teleport"
        require(
            failures,
            integer(constants.get(constant)) == fact.component,
            f"ancient_teleports.constant must define ^{constant} with db key {fact.component}",
        )

    interface_sections, duplicates = parse_sections(interface_text, interface_path)
    require(failures, not duplicates, f"duplicate Ancient interface components: {duplicates[:5]}")
    interface_pack_values = [
        line.split("=", 1)[1].strip()
        for line in strip_comments(pack_text).splitlines()
        if "=" in line
    ]
    require(failures, interface_pack_values.count("inter_267") == 1, "interface.pack must retain the inter_267 interface")

    script_code = code_only(script_text)
    bindings = re.findall(
        r"\[if_button\s*,\s*inter_267:com_(\d+)\s*\]\s*[@~][A-Za-z_][A-Za-z0-9_]*\s*\(\s*\^([A-Za-z0-9_]+)\s*\)\s*;",
        script_code,
        re.IGNORECASE,
    )
    binding_map: dict[int, list[str]] = {}
    for raw_component, spell in bindings:
        binding_map.setdefault(int(raw_component), []).append(spell.lower())
    expected_components = {fact.component for fact in facts}
    require(
        failures,
        set(binding_map) == expected_components
        and all(len(spells) == 1 for spells in binding_map.values()),
        "each fact-backed Ancient teleport button must have exactly one live script binding",
    )

    for fact in facts:
        context = f"{fact.name}"
        row_name = f"magic_spell_teleport_{fact.slug}"
        row = rows.get(row_name, {})
        require(failures, one(row.get("table")) == "magic_spell_table", f"[{row_name}] must use magic_spell_table")
        spell_values = row.get("spell", [])
        require(
            failures,
            len(spell_values) == 1 and spell_values[0].strip() == f"^{fact.slug}_teleport",
            f"[{row_name}] must resolve ^{fact.slug}_teleport",
        )
        level_value = one(row.get("levelrequired"))
        require(
            failures,
            integer(level_value) == fact.level,
            f"{context} dbrow level must be {fact.level}, got {level_value!r}",
        )
        rune_fields = row.get("runesrequired", [])
        actual_runes: dict[str, int] = {}
        if len(rune_fields) == 1:
            parts = [part.strip().lower() for part in rune_fields[0].split(",")]
            if len(parts) % 2 != 0:
                require(failures, False, f"[{row_name}] runesrequired must contain rune/count pairs")
            else:
                for rune, raw_count in zip(parts[::2], parts[1::2]):
                    if rune == "null":
                        continue
                    count = integer(raw_count)
                    if count is None or count < 1:
                        require(failures, False, f"[{row_name}] has invalid rune count {raw_count!r}")
                        continue
                    actual_runes[rune] = actual_runes.get(rune, 0) + count
        else:
            require(failures, False, f"[{row_name}] must contain exactly one runesrequired field")
        require(
            failures,
            actual_runes == fact.runes,
            f"{context} dbrow runes must be {fact.runes}, got {actual_runes}",
        )
        xp_value = one(row.get("experience"))
        require(
            failures,
            integer(xp_value) == fact.xp_tenths,
            f"{context} dbrow XP must be {fact.xp_tenths} tenths ({fact.xp_tenths / 10:g} real XP), got {xp_value!r}",
        )
        coord_value = one(row.get("tele_coord"))
        coordinate = parse_coord(coord_value, constants)
        require(
            failures,
            coordinate == (fact.level_plane, fact.x, fact.z),
            f"{context} tele_coord must resolve to {(fact.level_plane, fact.x, fact.z)}, got {coordinate}",
        )

        component = fact.component
        section_name = f"com_{component}"
        button = interface_sections.get(section_name, {})
        require(
            failures,
            one(button.get("type")) == "graphic",
            f"{context} Ancient interface component {section_name} must be a graphic button",
        )
        overlayer = one(button.get("overlayer"))
        tooltip_levels: list[int] = []
        tooltip_names: list[str] = []
        if overlayer is not None:
            for child in interface_sections.values():
                if one(child.get("layer")) != overlayer:
                    continue
                text_value = one(child.get("text"))
                if text_value is None:
                    continue
                tooltip = re.fullmatch(r"Level\s+(\d+)\s*:\s*(.+)", text_value)
                if tooltip:
                    tooltip_levels.append(int(tooltip.group(1)))
                    tooltip_names.append(tooltip.group(2).strip())
        expected_display_name = fact.name if fact.name.lower().endswith(" teleport") else f"{fact.name} Teleport"
        require(
            failures,
            tooltip_levels == [fact.level]
            and len(tooltip_names) == 1
            and tooltip_names[0].casefold() == expected_display_name.casefold(),
            f"{context} interface tooltip must show level {fact.level} and {expected_display_name}",
        )
        pack_component = f"inter_267:{section_name}"
        require(
            failures,
            interface_pack_values.count(pack_component) == 1,
            f"{context} interface component {pack_component} must be present exactly once in interface.pack",
        )
        require(
            failures,
            binding_map.get(component) == [f"{fact.slug}_teleport"],
            f"{context} interface button {section_name} must bind to ^{fact.slug}_teleport",
        )

    definitions = parse_definitions(script_text)
    executor_candidates = [
        definition
        for definition in definitions
        if "check_spell_requirements" in definition.body
        and "delete_spell_runes" in definition.body
        and "give_spell_xp" in definition.body
    ]
    require(failures, len(executor_candidates) == 1, "Ancient teleport script must have one shared-routine executor")
    if len(executor_candidates) == 1:
        check_ancient_executor(executor_candidates[0].body, failures)
    movement_procs = [definition for definition in definitions if definition.name == "player_teleport_ancient"]
    require(failures, len(movement_procs) == 1, "Ancient teleport must define one player_teleport_ancient procedure")
    if len(movement_procs) == 1:
        require(
            failures,
            re.search(r"~p_telejump_safe\s*\(\s*\$coord\s*\)", movement_procs[0].body) is not None,
            "Ancient teleport movement must use the shared safe-teleport routine",
        )
    check_standard_teleport_guard(root, failures)


def check_standard_teleport_guard(root: Path, failures: list[str]) -> None:
    path = "scripts/skill_magic/scripts/spells/teleport.rs2"
    definitions = parse_definitions(read_text(root, path, failures))
    handlers = [definition for definition in definitions if definition.name == "magic_teleport"]
    require(failures, len(handlers) == 1, "standard magic_teleport must remain defined")
    if len(handlers) != 1:
        return
    code = handlers[0].body
    lookup = re.search(r"~get_spell_data\s*\(\s*\$spell\s*\)", code)
    require(
        failures,
        lookup is not None
        and any(
            "%alternate_spells!^dt_spellbook_standard" in compact(block.condition)
            and has_return(block.then_body)
            and block.end < lookup.start()
            for block in parse_if_blocks(code)
        ),
        "standard teleports must reject a nonstandard spellbook before spell lookup or payment",
    )


def parse_coord(value: str | None, constants: dict[str, str]) -> tuple[int, int, int] | None:
    if value is None:
        return None
    value = value.strip()
    if value.startswith("^"):
        value = constants.get(value[1:], "")
    parts = value.split("_")
    if len(parts) != 5 or any(not re.fullmatch(r"-?\d+", part.strip()) for part in parts):
        return None
    level, region_x, region_z, local_x, local_z = (int(part.strip()) for part in parts)
    return level, region_x * 64 + local_x, region_z * 64 + local_z


def check_ancient_executor(code: str, failures: list[str]) -> None:
    executor = code_only(code)
    spell_data = re.search(r"~get_spell_data\s*\(\s*\$spell\s*\)", executor)
    requirement = re.search(r"~check_spell_requirements\s*\(\s*\$spell_data\s*\)", executor)
    wilderness = re.search(r"~wilderness_level\s*\(\s*coord\s*\)\s*>\s*20", executor)
    pre_tele = re.search(r"~pre_tele_checks\s*\(\s*coord\s*\)", executor)
    payment = re.search(r"~delete_spell_runes\s*\(\s*\$spell_data\s*\)", executor)
    xp = re.search(r"~give_spell_xp\s*\(\s*\$spell_data\s*\)", executor)
    movement = re.search(r"~player_teleport_ancient\s*\(", executor)
    require(
        failures,
        all(match is not None for match in (spell_data, requirement, wilderness, pre_tele, payment, xp, movement)),
        "Ancient executor must use the shared spell, requirement, Wilderness, pre-teleport, rune, XP, and movement routines",
    )
    if all(match is not None for match in (spell_data, requirement, wilderness, pre_tele, payment, xp, movement)):
        require(
            failures,
            spell_data.start() < requirement.start()
            and requirement.start() < wilderness.start()
            and requirement.start() < pre_tele.start()
            and max(wilderness.start(), pre_tele.start()) < payment.start() < xp.start() < movement.start(),
            "Ancient executor order must be spell lookup, requirements, Wilderness and pre-tele checks, rune payment, XP, then movement",
        )
        require(
            failures,
            any(
                "wilderness_level" in compact(block.condition)
                and re.search(r">20", compact(block.condition)) is not None
                and has_return(block.then_body)
                and block.end < payment.start()
                for block in parse_if_blocks(executor)
            ),
            "Ancient teleports must refuse origins above Wilderness level 20 before rune payment",
        )
        require(
            failures,
            any(
                "pre_tele_checks" in compact(block.condition)
                and "false" in compact(block.condition)
                and has_return(block.then_body)
                and block.end < payment.start()
                for block in parse_if_blocks(executor)
            ),
            "Ancient teleports must return when shared pre_tele_checks refuses before rune payment",
        )
        require(
            failures,
            any(
                "check_spell_requirements" in compact(block.condition)
                and "false" in compact(block.condition)
                and has_return(block.then_body)
                and block.end < wilderness.start()
                for block in parse_if_blocks(executor)
            ),
            "Ancient spell requirements must stop casting before origin checks",
        )
        require(
            failures,
            any(
                "%alternate_spells!^dt_spellbook_ancient" in compact(block.condition)
                and "%deserttreasure!^dt_stage_complete" in compact(block.condition)
                and has_return(block.then_body)
                and block.end < spell_data.start()
                for block in parse_if_blocks(executor)
            ),
            "Ancient-only executor must reject the wrong spellbook and incomplete quest before spell lookup",
        )


def main() -> int:
    root = content_root()
    failures: list[str] = []
    facts_file = facts_path(root)
    raw_facts = read_facts(facts_file, failures)
    facts = load_teleports(raw_facts, failures)
    sources = {
        "rewards": read_text(root, "scripts/quests/quest_deserttreasure/scripts/dt_rewards.rs2", failures),
        "hill": read_text(root, "scripts/quests/quest_deserttreasure/scripts/dt_eblis_hill.rs2", failures),
        "login": read_text(root, "scripts/login_logout/scripts/login.rs2", failures),
        "tier50": read_text(root, "scripts/levelrequire/scripts/tier50.rs2", failures),
    }
    check_selector_and_login(root, sources["rewards"], sources["login"], failures)
    check_reward_action_gates(sources["rewards"], failures)
    check_altar_messages(sources["rewards"], raw_facts, failures)
    check_postquest_staff(root, sources["rewards"], sources["hill"], sources["tier50"], failures)
    check_teleports(root, facts, failures)

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1
    print("PASS: Desert Treasure S8 offline rewards, spellbook, and Ancient teleport contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

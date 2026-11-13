#!/usr/bin/env python3
"""Extract spell CS1 programs from the original 377 interface archive's data file.

Usage: python3 tests/combo-runes/extract-client.py interface-data.bin obj.dat obj.idx > client-377.json
The input is index 0, archive 3, Jagfile member `data` of OpenRS2 cache 657.
Decode follows Client-Java 377 Component.unpack, not the authored server interfaces.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

SOURCE_SHA256 = "88e882e48de5d2e7c4a103fae5f46db149ccfc88b327b4f6f0d287b36e7ba441"
ROOTS = {1151: "standard", 12855: "ancient", 1829: "standard-autocast",
         1689: "ancient-autocast", 12050: "special-autocast"}


class Packet:
    def __init__(self, data):
        self.data = data
        self.pos = 0

    def u1(self):
        value = self.data[self.pos]
        self.pos += 1
        return value

    def u2(self):
        value = struct.unpack_from(">H", self.data, self.pos)[0]
        self.pos += 2
        return value

    def skip(self, count):
        self.pos += count
        assert self.pos <= len(self.data)

    def string(self):
        end = self.data.index(10, self.pos)
        value = self.data[self.pos:end].decode("latin1")
        self.pos = end + 1
        return value


def decode(data):
    p = Packet(data)
    slots = p.u2()
    root = -1
    components = []
    while p.pos < len(data):
        offset = p.pos
        cid = p.u2()
        if cid == 65535:
            root, cid = p.u2(), p.u2()
        kind, button, code = p.u1(), p.u1(), p.u2()
        width, height, alpha = p.u2(), p.u2(), p.u1()
        high = p.u1()
        overlayer = -1 if high == 0 else ((high - 1) << 8) + p.u1()
        comparisons = [[p.u1(), p.u2()] for _ in range(p.u1())]
        scripts, script_offsets = [], []
        for _ in range(p.u1()):
            length = p.u2()
            start = p.pos
            scripts.append([p.u2() for _ in range(length)])
            script_offsets.append([start, p.pos])
        text = graphic = active_graphic = ""
        children = []
        if kind == 0:
            p.skip(3)
            for _ in range(p.u2()):
                children.append(p.u2())
                p.skip(4)
        if kind == 1:
            p.skip(3)
        if kind == 2:
            p.skip(6)
            for _ in range(20):
                if p.u1():
                    p.skip(4)
                    p.string()
            for _ in range(5):
                p.string()
        if kind == 3:
            p.skip(1)
        if kind in (1, 4):
            p.skip(3)
        if kind == 4:
            text = p.string()
            p.string()
        if kind in (1, 3, 4):
            p.skip(4)
        if kind in (3, 4):
            p.skip(12)
        if kind == 5:
            graphic, active_graphic = p.string(), p.string()
        if kind == 6:
            for _ in range(4):
                if p.u1():
                    p.skip(1)
            p.skip(6)
        if kind == 7:
            p.skip(12)
            for _ in range(5):
                p.string()
        if kind == 8:
            text = p.string()
        target = ""
        if button == 2 or kind == 2:
            p.string()
            target = p.string()
            p.skip(2)
        if button in (1, 4, 5, 6):
            p.string()
        components.append(dict(id=cid, root=root, type=kind, button=button,
                               offset=offset, end=p.pos, text=text, target=target,
                               overlayer=overlayer, children=children,
                               graphic=graphic, activeGraphic=active_graphic,
                               comparisons=comparisons, scripts=scripts, scriptOffsets=script_offsets))
    assert p.pos == len(data)
    return slots, components


def terms(script):
    out = []
    pos = 0
    while True:
        op = script[pos]
        pos += 1
        if op == 0:
            assert pos == len(script)
            return out
        if op in (4, 10):
            out.append([op, script[pos], script[pos + 1]])
            pos += 2
        elif op == 1:
            out.append([op, script[pos]])
            pos += 1
        else:
            raise ValueError(f"Unexpected spell CS1 opcode {op}")


def objects(data, index, ids):
    assert hashlib.sha256(data).hexdigest() == "726066353ba225f5d507a079fe8bc8aba4162e90c8ec6a4009ba1ee3e2c76cbc"
    p = Packet(index)
    count, offset, out = p.u2(), 2, {}
    for oid in range(count):
        size = p.u2()
        if oid in ids:
            record = Packet(data[offset:offset + size])
            obj = dict(name="", members=False, offset=offset, bytes=size)
            while True:
                op = record.u1()
                if op == 0:
                    break
                if op == 2:
                    obj["name"] = record.string()
                elif op == 3 or 30 <= op < 40:
                    record.string()
                elif op == 11:
                    pass
                elif op == 16:
                    obj["members"] = True
                elif op == 12:
                    record.skip(4)
                elif op in (23, 25):
                    record.skip(3)
                elif op == 40:
                    record.skip(record.u1() * 4)
                elif 100 <= op < 110:
                    record.skip(4)
                elif op in (113, 114, 115):
                    record.skip(1)
                elif op in (1, 4, 5, 6, 7, 8, 10, 24, 26, 78, 79, 90, 91, 92, 93, 95, 97, 98, 110, 111, 112):
                    record.skip(2)
                else:
                    raise ValueError(f"Unexpected object opcode {op} for {oid}")
            assert record.pos == size, (oid, record.pos, size)
            out[oid] = obj
        offset += size
    assert offset == len(data) and set(out) == ids
    return out


def main():
    data = Path(sys.argv[1]).read_bytes()
    assert hashlib.sha256(data).hexdigest() == SOURCE_SHA256, "Not the original 377 interface data"
    slots, components = decode(data)
    by_id = {c["id"]: c for c in components}
    buttons = [c for c in components if c["root"] in ROOTS and c["type"] == 5 and c["scripts"]]
    assert len(buttons) == 122
    for c in buttons:
        c["book"] = ROOTS[c["root"]]
        c["requirements"] = []
        c["skills"] = []
        c["worn"] = []
        c["items"] = []
        assert len(c["comparisons"]) == len(c["scripts"])
        for (cmp, operand), script in zip(c["comparisons"], c["scripts"]):
            assert cmp == 3, (c["id"], cmp)
            decoded = terms(script)
            if decoded[0][0] == 1:
                assert len(decoded) == 1
                c["skills"].append([decoded[0][1], operand + 1])
            elif decoded[0][1] == 1688:
                assert len(decoded) == 1 and decoded[0][0] == 4
                c["worn"].append([decoded[0][2], operand + 1])
            else:
                assert decoded[0][0:2] == [4, 3214]
                inventory = [t[2] for t in decoded if t[0] == 4]
                staves = [t[2] for t in decoded if t[0] == 10]
                assert all(t[1] == (3214 if t[0] == 4 else 1688) for t in decoded)
                requirement = dict(rune=inventory[0], count=operand + 1,
                                   inventory=inventory, staves=staves)
                c["requirements" if 554 <= inventory[0] <= 566 else "items"].append(requirement)
        if not c["target"]:
            todo = [c["overlayer"]]
            while todo:
                v = by_id.get(todo.pop())
                if v:
                    if v["text"].startswith("Level "):
                        c["target"] = v["text"]
                        break
                    todo.extend(v["children"])
            c["target"] = c["target"] or f"{c['book']}:{c['id']}"
        for key in ("type", "text", "graphic", "activeGraphic", "children", "overlayer"):
            del c[key]
        assert 1 <= len(c["requirements"]) <= 4
    ids = set()
    for c in buttons:
        ids.update(oid for r in c["requirements"] + c["items"] for oid in r["inventory"] + r["staves"])
        ids.update(oid for oid, _ in c["worn"])
    objdata = Path(sys.argv[2]).read_bytes()
    objindex = Path(sys.argv[3]).read_bytes()
    result = dict(source=dict(cache=657, revision=377, archive="index0/archive3/data",
                              url="https://archive.openrs2.org/caches/runescape/657",
                              sha256=SOURCE_SHA256, bytes=len(data), slots=slots,
                              records=len(components),
                              objectSha256=hashlib.sha256(objdata).hexdigest(),
                              objectIndexSha256=hashlib.sha256(objindex).hexdigest()),
                  objects=objects(objdata, objindex, ids), buttons=buttons)
    json.dump(result, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()

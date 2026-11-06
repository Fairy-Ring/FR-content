# Fairy Ring — Content

**Period game content** (RuneScript configs, scripts, maps, interfaces) for **RuneScape revision 377** (~2 May 2006).

| | |
|--|--|
| **Public brand** | **Fairy Ring** (content tree) |
| **Branch** | `rs2-r377` |
| **Upstream lineage** | [LostCityRS/Content](https://github.com/LostCityRS/Content) **`377-wip`** @ `7d7719693100cc45ff187c12139e5b63b3ab21df` |
| **Provenance** | [PROVENANCE.md](PROVENANCE.md) — full SHA pin + history note |
| **Companion workspace** | [Fairy Ring workspace](https://github.com/Fairy-Ring/fairy-ring-workspace) (docs, harness, process) |

## Derived from Lost City — not Lost City

This repository is a **derivation** of open **Lost City / LostCityRS Content** work and related community ports. We build on those trees under their licenses, with our own residual bar and process.

**Derivation does not mean official.** This is **not** official Lost City / LostCityRS and is **not** endorsed by Jagex Ltd. rs2b0t/rs2b2t patterns may be used as tools; this fork is not their product layer.

Do **not** present this repo as “Lost City,” “LC Content,” or official LostCityRS.  
See [NOTICE.md](NOTICE.md) and the workspace Decision 009 (branding & attribution).

## AI use (explicit)

Development of this fork **uses AI tools and coding agents** (research, thrash, draft patches, residual smokes). Humans own product judgment, authenticity claims, and what ships. Soft thrash and prep cheats live in the **workspace harness**, not as authenticity claims here.

## What this tree is

| Included | Not included |
|----------|----------------|
| Configs, RuneScript (`.rs2`), maps/interfaces for the 377 era | Full engine runtime (`Engine-TS` / this project’s engine fork) |
| Content-side residual fixes for rs2-r377 mid-gates | Browser client source (see client-ts fork) |
| MIT-licensed **source layout** as upstream | A license to Jagex’s game **assets** (see below) |

Jagex assets that appear in content distributions remain **Jagex IP**. They are **not** covered by MIT. Upstream Lost City includes them for historical preservation; redistributors must follow their own counsel and upstream notices.

## Companion repos

Public under **Fairy Ring** (separate remotes; **not** a content-complete claim):

| Repo | Role |
|------|------|
| [fairy-ring-workspace](https://github.com/Fairy-Ring/fairy-ring-workspace) | Process, harness toys, residual bar docs |
| [FR-engine](https://github.com/Fairy-Ring/FR-engine) | Server / protocol / pack tools |
| [FR-client-ts](https://github.com/Fairy-Ring/FR-client-ts) | Pure 1:1 Java 377 → TypeScript browser client |

## Run

You need a matching **engine** (and usually a client). Prefer the workspace runbooks when using the full rs2-r377 stack:

```text
workspace docs/runbooks/  +  vendor/engine  +  this content tree
```

Bare Lost City-style layout (for reference):

```sh
# parent folder
git clone <this-fork> -b rs2-r377 content
git clone <engine-fork> -b rs2-r377 engine
cd engine && npm start   # packs content, serves world
```

Isolation ports and pack policy for the experiment live in the **workspace** (not assumed identical to Lost City defaults).

### Fletching choice regression

Knife-on-logs uses the revision-377 `skillmulti2` and `skillmulti3` interfaces.
They offer Make 1, Make 5, Make 10 and Make X. They do not offer Make All.
The quantity UI is a period-cache-backed **CANDIDATE** for fletching, not a dated server transcript.
Normal logs offer shafts, shortbow and longbow. Other supported logs offer the two bows.
Glass, dragonhide and pre-potlid pottery choices now use the same quantity interface.
The obsolete single-item wrappers are removed, not hidden from the client menu.
Jagex's [27 September 2004 news](https://secure.runescape.com/m=news/skills-duels-and-the-kalphite)
verifies Make 5/10/X for glass, leather crafting and pottery wheels on that date.
May 2006 continuity and the dragonhide-specific binding remain **CANDIDATE**.
Original crafting batch timing remains **UNKNOWN**. Queue values follow Lost City,
not a measured period-server timing claim. Existing recipes and XP are retained.
Log cuts use an interruptible weak queue with a uniform three-tick repeat interval.
The first cut runs in the selection tick. Its original 377 delay remains unknown.
The repeat interval adapts Lost City 289's queue pattern and remains **CANDIDATE**.

After building the matching isolated engine, run the packed-script regressions:

```sh
bash tests/fletching-choice/runtime.sh /absolute/path/to/engine
```

The suite runs the real script interpreter and input handlers without starting a world server.
Cadence scenarios process queues once per world tick, after the selection input.
They check the first repeat and every later repeat for all thirteen products.
Research labels and the headed live-check list are in evidence request `FLETCH-CHOICE-1106`.
The suite also checks menu reachability using packed component geometry and
Java 377's hit-test rules. It exercises the three crafting callers' quantities,
exhaustion, refusals and interruption. It tests both karambwan choices through
the real cooking script, plus the pre-teaching default, consumption and recipe XP.
It also checks every cooking recipe's forward/reverse row lookup and unchanged
raw-oomlie refusal on ranges and fires.
Research labels and the follow-up LIVE CHECK list are in evidence request `PRODUCT-FOLLOWUP-1106`.

### Multinpc trigger regression

NPC interaction triggers bind to the player's resolved visible form, not the placed multinpc root.
Shared handlers retain one dialogue body. Sheep Herder wrappers pass the canonical sheep identity
to the existing data-table lookups because the engine's `npc_type` returns the visible child.
Dialogue, quest stages and rewards are unchanged.

After building the matching isolated engine, run:

```sh
bash tests/multinpc-triggers/runtime.sh /absolute/path/to/engine
```

The suite checks every non-null form slot of the thirteen repaired roots through the real
player trigger lookup. It executes Juliet's stage-10 dialogue through stage 20 and the message reward.
It also executes prodding and poisoning for both forms of all four diseased sheep.
Mourning's sheep have no client Prod option. Their direct-script cases test binding, not menu reachability.
The source decisions and unexecuted LIVE CHECK list are in evidence request `MULTINPC-TRIGGERS-1106`.



## Completeness disclaimer

We do **not** claim this tree **is** authentic, original, or complete. Work is ongoing under an accuracy bar; humans and agents make mistakes. **Good-faith contributions from all** are welcome and will not be dismissed without clear rationale (see companion workspace `CONTRIBUTING.md`).

## License

- **Source layout / scripts in this repo:** [MIT](LICENSE) (as upstream).  
- **Do not relicense** Lost City–originated code as original work of this project.  
- **Jagex assets:** not MIT; see [NOTICE.md](NOTICE.md).

## Upstream

- Lost City Content: https://github.com/LostCityRS/Content  
- Lost City forum / ethos (upstream): https://lostcity.rs/  

**Never push experiment work to `LostCityRS/*` without explicit permission.**  
Push remote (operator): `private` → [Fairy-Ring/FR-content](https://github.com/Fairy-Ring/FR-content).

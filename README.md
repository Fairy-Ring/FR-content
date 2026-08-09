# Fairy Ring — Content

**Period game content** (RuneScript configs, scripts, maps, interfaces) for **RuneScape revision 377** (~2 May 2006).

| | |
|--|--|
| **Public brand** | **Fairy Ring** (content tree) |
| **Branch** | `rs2-r377` |
| **Upstream lineage** | [LostCityRS/Content](https://github.com/LostCityRS/Content) **`377-wip`** @ `7d7719693100cc45ff187c12139e5b63b3ab21df` |
| **Provenance** | [PROVENANCE.md](PROVENANCE.md) — full SHA pin + history note |
| **Companion workspace** | [Fairy Ring workspace](https://github.com/acfrazier/fairy-ring-workspace) (docs, harness, process) |

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

## Launch-together

Intended to go **public with** the matching engine, client-ts, and workspace repos under the **Fairy Ring** brand (`FR-content` / `FR-engine` / `FR-client-ts` / `fairy-ring-workspace`). Visibility flips only on operator call — **not** a content-complete claim.

| Companion | Role |
|-----------|------|
| **Workspace** | Process, research, harness toys, residual bar docs |
| **Engine** | Server / protocol / pack tools |
| **Client-TS** | Pure 1:1 Java 377 → TypeScript browser client |

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
Private backup remote (operator): `private` → `acfrazier/FR-content`.

# Contributing to Fairy Ring — Content

Thank you for helping improve **Fairy Ring** (`FR-content`, RuneScape 2 revision **377**, ~2 May 2006).

Fairy Ring is an independent open-source project derived from Lost City / LostCityRS (`NOTICE.md`). It is **not** official Lost City and is **not** endorsed by Jagex Ltd. Never push or open pull requests against `LostCityRS/*`.

## Who can contribute

Everyone — players, researchers, RuneScript developers, and coding agents acting in good faith. We evaluate changes by **evidence, correctness, and testability**, not by whether a human or an agent drafted the diff.

If you are pointing a coding agent at this repository, start by having it read **[`AGENTS.md`](AGENTS.md)**.

## Maintainer review policy (honest expectations)

- **Issues** (especially in-game `::bug` reports, 2006 historical sources, and 377 cache/interface observations) are always welcome.
- **Pull requests** are welcome as concrete proposals. Review and merge are **best-effort** — small, well-evidenced PRs with a failing-before/passing-after compiled test are much faster to merge than broad rewrites.
- **Beta saves will be wiped** before anything is final, so do not add save-migration logic for existing saves.

## What kind of contributions help most

1. **In-game bug reports (`content-bug` template):** paste the output of `::bug` (or your coordinates, active quest stage, and exact steps) when an interaction is missing, stuck, or behaves unexpectedly.
2. **2006 historical evidence (`accuracy-evidence` template):** no coding required. If you have a pre-2 May 2006 guide capture, video timestamp, screenshot, or clear recollection that upgrades an `UNKNOWN` or `CANDIDATE` detail (dialogue, rates, rooms, rewards, drops), file an evidence issue so anyone — human or agent — can turn it into a verified PR.
3. **377 cache & presentation polish (`cache-polish` template):** upgrading functional beta fallbacks to authentic 377 interfaces, map rooms, models, or stationary NPC `wanderrange=0` configs already present in the cache (for example, native quest quiz interfaces or seated NPCs that currently wander).
4. **Targeted RuneScript PRs:** pick one issue or accuracy gap, cite your source/label, add a falsifiable compiled test under `tests/`, and verify all local checks in [`AGENTS.md`](AGENTS.md).

## Which repository?

| Change | Repository |
|---|---|
| Quests, NPCs, items, dialogues, skills, minigames, interfaces, maps, content tests | **This repo (`FR-content`)** |
| Server cycle, protocol packets, RuneScript compiler/opcodes, packer, region/collision | [FR-engine](https://github.com/Fairy-Ring/FR-engine) |
| Pure 1:1 Java 377 → TypeScript browser client (no bot/harness hooks) | [FR-client-ts](https://github.com/Fairy-Ring/FR-client-ts) |
| Process docs, research methodology, scoped context requests | [fairy-ring-workspace](https://github.com/Fairy-Ring/fairy-ring-workspace) |

## Quick local verification

Pair this checkout with a sibling `engine/` directory at the commit pinned in `.github/fr-engine-ref`:

```sh
cd ../engine
npm ci
BUILD_SRC_DIR=../content BUILD_VERIFY=false npm run build
npx tsx tools/rs2check.ts --content ../content
shasum -a 256 data/pack/client/config data/pack/client/versionlist
node --import tsx ../content/tests/<suite>/<test>.mjs
cd ../content
node tests/check-varp-transmit.mjs
```

Both client cache SHA-256s must match the pins in [`AGENTS.md`](AGENTS.md). Remove generated packs (`git clean -fdXq -- pack`) before opening your PR.

## License

Source scripts and tests in this repository are licensed under [MIT](LICENSE) (as upstream Lost City). Do not commit downloaded OpenRS2 cache blobs, `.env` files, keys, or machine-specific paths.

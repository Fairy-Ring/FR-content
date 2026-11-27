# Agent & Contributor Rules — Fairy Ring Content (Revision 377)

Fairy Ring preserves RuneScape 2 **revision 377** (about **2 May 2006**). It is an independent fork derived from Lost City / LostCityRS open-source work (`NOTICE.md`). Never present Fairy Ring as official Lost City, and never push or open PRs against `LostCityRS/*`.

Both humans and coding agents are welcome to contribute. The same evidence and verification bar applies to everyone.

## 1. Accuracy ladder (do not invent 2006 behavior)

Every gameplay change must state its evidence label clearly in the PR and in any added code comment or research note:

| Label | Meaning |
|---|---|
| **VERIFIED** | Directly supported by a pre-2 May 2006 source (period guides/captures, official 2006 Knowledge Base, or authentic revision-377 cache/map/interface files). |
| **CANDIDATE** | Source-backed inference: an era-checked Lost City implementation with a citation, or earliest Old School RuneScape behavior (checked for post-2007 rewrites). |
| **UNKNOWN** | No adequate source survives. Keep the gap explicit with a named constant and comment; never present an engineering value or guess as authentic. |
| **DEVIATION** | Deliberate departure from a known 2006 source. Requires explicit maintainer approval. |

Hard accuracy rules:
- **Never invent 2006 dialogue** or copy post-rewrite OSRS/RS3 dialogue verbatim. Check page history when using wiki sources; a history starting after a dated rewrite does not prove 2006 text.
- **Never "fix" a documented original 2006 fault** without maintainer approval. Period bugs are intentionally preserved when sourced.
- **Quest-specific items** default to `tradeable=no` in their `.obj` config (server-only field) unless a source + 377 cert shows an ordinary tradeable item. Never enforce tradeability in RuneScript logic.
- **Never alter client-visible config fields** (`name`, `desc`, `models`, `op1..5`, `multiloc`, `multinpc`, interfaces, maps) unless explicitly authorized. Server-only fields (`tradeable=no`, `scope=perm/temp`, `param=`, `category=`, `wanderrange=`, `defaultmode=`, NPC combat stats) do not change the client cache.

## 2. Hard CI invariants (PRs that break these fail automatically)

1. **Exact 377 client cache SHA-256s** after a clean pack build (`BUILD_SRC_DIR=../content BUILD_VERIFY=false npm run build` from the matching `FR-engine` checkout pinned in `.github/fr-engine-ref`):
   - `data/pack/client/config`: `b6ec704421650ee5527e77c635b8b3a8036f6eb042c572516ac0696cfbce19a8`
   - `data/pack/client/versionlist`: `18f6effb30302b8a27704e2d53154b44676d0befc7a1163edf59e7850b011bf4`
2. **Script compilation:** `npx tsx tools/rs2check.ts --content ../content` exits `0` with `0` errors and no new warnings.
3. **Transmitted varps:** `node tests/check-varp-transmit.mjs` (from `content/`) exits `0`. Do not add `transmit=yes` to a varp unless the revision-377 client reads it.
4. **Varp scope policy:** `node --import tsx ../content/tests/varp-scope/test_varp_scope.mjs` (from `engine/`) exits `0`. Every new or reclassified server-only varp must be declared in `tests/varp-scope/scope-policy.json`.
5. **Repo hygiene:** never commit generated `pack/` artifacts, local machine or home-directory paths, secrets, account data, IP addresses, or wiki-API `user`/`comment` metadata.

## 3. Local setup and verification loop

Clone the sibling engine at the exact commit pinned in `.github/fr-engine-ref`:

```sh
# inside a shared parent directory holding content/ and engine/
cd engine
npm ci
BUILD_SRC_DIR=../content BUILD_VERIFY=false npm run build
npx tsx tools/rs2check.ts --content ../content
shasum -a 256 data/pack/client/config data/pack/client/versionlist
node --import tsx ../content/tests/<your-suite>/<test>.mjs
cd ../content
node tests/check-varp-transmit.mjs
```

## 4. Writing tests that get merged

- **Falsifiable proof:** every bugfix or accuracy upgrade must include a compiled test in `tests/` that **fails on the old code and passes with your fix**.
- **Real dispatch, not string calls:** dispatch real client packets (`OpLoc`, `OpNpc`, `OpHeld`, `IfButton`) and check real state transitions (varps, varbits, inventory, coordinates, messages) rather than calling helper labels by name.
- **No weakening existing tests:** never loosen an existing assertion or patch gameplay just to satisfy a test. If a newly built feature intentionally replaces an older "not yet implemented" assertion, explain why in the PR.
- **Keep scope tight:** one bug, one accuracy gap, or one interface/presentation fix per PR. Clean generated packs (`git clean -fdXq -- pack`) before committing.

## Summary
<!-- One concise paragraph: what changed and why. Link the issue or accuracy gap ID. -->
Fixes #

## Evidence & accuracy label
- **Label:** `VERIFIED` / `CANDIDATE` / `UNKNOWN` / `DEVIATION` (delete others)
- **Source(s):** <!-- Pre-2 May 2006 URL+date, 377 cache/map/interface file, OSRS wiki oldid + history check, or "engineering default (UNKNOWN)". -->
- **What this does NOT claim:** <!-- State any remaining UNKNOWN values, rates, or wording explicitly. -->

## Verification (run locally against the pinned FR-engine commit in `.github/fr-engine-ref`)
Paste exact command results (do not summarize without running):
- [ ] Clean build: `BUILD_SRC_DIR=../content BUILD_VERIFY=false npm run build` (exit 0)
- [ ] Exact 377 client cache SHA-256s unchanged:
  - `data/pack/client/config` = `b6ec704421650ee5527e77c635b8b3a8036f6eb042c572516ac0696cfbce19a8`
  - `data/pack/client/versionlist` = `18f6effb30302b8a27704e2d53154b44676d0befc7a1163edf59e7850b011bf4`
- [ ] `npx tsx tools/rs2check.ts --content ../content` (0 errors, no new warnings)
- [ ] `node tests/check-varp-transmit.mjs` (exit 0)
- [ ] `node --import tsx ../content/tests/varp-scope/test_varp_scope.mjs` (exit 0, if any varp changed)
- [ ] Falsifiable compiled test added/updated under `tests/` — **failed before the fix, passes after** (command + result below)

```text
<!-- Paste exact verification commands and summary lines here -->
```

## Hygiene & attribution
- [ ] Generated `pack/` artifacts removed (`git clean -fdXq -- pack`)
- [ ] No local machine paths, secrets, account data, IP addresses, or wiki-API `user`/`comment` metadata added
- [ ] No existing test assertions weakened; no documented period fault silently "repaired"
- [ ] Authored by: Human / Human + Coding agent (specify if desired)

# Fairy Ring — Content

**Period game content for RuneScape revision 377 (~2 May 2006).** This tree holds the RuneScript configs, scripts, maps, and assets. The engine packs it into the revision-377 client cache.

| | |
|--|--|
| **Public beta** | [www.fairyring.rs](https://www.fairyring.rs/) |
| **Progress & gaps** | [Progress Chronicle](https://fairy-ring.github.io/) · [Open Accuracy Gaps](https://fairy-ring.github.io/gaps.html) |
| **Branch** | `rs2-r377` |
| **Upstream** | [LostCityRS/Content](https://github.com/LostCityRS/Content) |
| **Engine pin** | [`.github/fr-engine-ref`](.github/fr-engine-ref) |
| **Provenance** | [PROVENANCE.md](PROVENANCE.md) |
| **Notices** | [NOTICE.md](NOTICE.md) |
| **Contributing** | [CONTRIBUTING.md](CONTRIBUTING.md) |
| **Agent brief** | [AGENTS.md](AGENTS.md) |

## Derived from Lost City — not Lost City

Fairy Ring is a fork of [LostCityRS/Content](https://github.com/LostCityRS/Content). It keeps the upstream licenses and attribution described in [NOTICE.md](NOTICE.md).

This repository is **not** official Lost City or LostCityRS content, and it is **not** endorsed by Jagex Ltd. Do not present it as official Lost City content.

## AI-assisted development

We use AI tools and coding agents openly, alongside human review, compiled tests, and live verification. AI does not lower the authenticity bar:

- Period-accuracy labels (`VERIFIED`, `CANDIDATE`, `UNKNOWN`, `DEVIATION`) mark how each fact is sourced. See [AGENTS.md](AGENTS.md).
- Humans review and ship every change.

## Companion repositories

| Repository | Role |
|------------|------|
| [FR-engine](https://github.com/Fairy-Ring/FR-engine) | Server, protocol, and pack tool. Pair it with this tree at the commit in `.github/fr-engine-ref`. |
| [FR-content](https://github.com/Fairy-Ring/FR-content) | This repository: period game content. |
| [FR-client-ts](https://github.com/Fairy-Ring/FR-client-ts) | Browser client, a TypeScript port of Client-Java 377. |
| [fairy-ring-workspace](https://github.com/Fairy-Ring/fairy-ring-workspace) | Project overview, documentation index, and public status. |
| [Fairy-Ring.github.io](https://github.com/Fairy-Ring/Fairy-Ring.github.io) | Public Progress Chronicle and open accuracy-gap tracker. |

## Getting started

Content runs only with the engine commit it is pinned to. Clone the two repositories side by side in one parent folder, then check out the pinned engine commit:

```sh
git clone -b rs2-r377 https://github.com/Fairy-Ring/FR-content.git content
git clone -b rs2-r377 https://github.com/Fairy-Ring/FR-engine.git engine
git -C engine checkout "$(tr -d '\r\n' < content/.github/fr-engine-ref)"
```

This tree has no build tooling of its own. The engine reads it, so run the build from the engine checkout.

## Running checks

```sh
cd engine
npm ci
npx tsx tools/rs2check.ts --content ../content
npm run build
cd ../content
node tests/check-varp-transmit.mjs
node tests/test_chathead_animations.mjs
```

- `npx tsx tools/rs2check.ts --content ../content` checks all RuneScript files without writing packs.
- `npm run build` in the engine reads this tree through its default `BUILD_SRC_DIR` (`../content`).
- CI for this repository is [`.github/workflows/content.yml`](.github/workflows/content.yml).

## Accuracy & completeness

We do **not** claim this tree is authentic, original, or complete. Work continues under an accuracy bar, and people and agents make mistakes.

- Read [AGENTS.md](AGENTS.md) for the labels and the working rules.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) for contribution templates and review expectations.
- Browse [open accuracy gaps](https://fairy-ring.github.io/gaps.html), use `::bug <message>` in the public beta, or open an issue for period-source questions and 377 cache or interface observations.

## License & IP

- **Scripts, tests, and other source authored here:** [MIT](LICENSE). See the `LICENSE` file for the full text.
- **Lost City–originated material:** keeps its upstream attribution. Do not relicense it as original work of this project. See [NOTICE.md](NOTICE.md).
- **Jagex material:** game assets in this tree are derived from the period client. They are Jagex's, are not covered by MIT, and are described in [NOTICE.md](NOTICE.md). RuneScape is a trademark of Jagex Ltd.

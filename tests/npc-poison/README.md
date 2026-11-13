# NPC poison timer checks

From the sibling engine, after building its content pack:

```sh
node --import tsx ../content/tests/npc-poison/test_poison.mjs
```

The packed checks compare the default 30-tick poison cadence with the shared counted timer through natural expiry, including the published damage formula and lethal queue3. They also cover stronger poison, explicit clear and timer repair. `--case default`, `--case count` and `--case integrity` select individual checks.

An NPC type with its own one-tick timer sets `npc_owned_timer_interval` to 1 before poison can start. Its timer handler calls `npc_poison_counted_timer(1)` once per run. The shared helper reasserts that interval and uses `npc_poison_timer_runs` to run the unchanged poison step every 30 callbacks. Poison start and clear preserve the marked interval and reset that counter. Both variables are server-only. An unmarked NPC keeps the published default timer path.

The counted cadence is engineering. Poison damage and countdown are the published combat rule, not a new activity-specific mechanic.

# Splitbark service packed test

After building the full content pack, run this from the sibling engine directory:

```sh
node --import tsx ../content/tests/splitbark-service/test_splitbark_service.mjs
```

The test starts no world server. It loads the built configuration and server-script packs, dispatches the wizard's Talk-to trigger through `Player.getOpTrigger`, then drives the compiled dialogue, selector, count-dialog handler, and exchange with production `ScriptRunner` execution.

Coverage includes all ten packed dialogue labels and the Talk-to trigger; member-world and free-world entry paths; the explanation, good-luck, go, how-much and no-thanks branches; the `skill_multi5_header` title and five donor-order labels; each model's runtime-resolved product, scale 175 and position `(0, -5)`; and each of the five products with Make X, Make 10, Make 5 and Make 1. Quantity and item IDs are resolved from packed names at runtime. Normal-inventory-limited preset batches assert the exact affordable output and donor stop line.

For every product, it checks exact one-piece payment, each independent one-item initial shortage with no inventory change, and bark-, cloth- and coin-limited batches that complete two exchanges before the donor stop line. It also submits zero through Make X and verifies that an exchange from a full inventory frees room for the product without losing any other item. Exact post-exchange balances make a one-coin price mutation fail.

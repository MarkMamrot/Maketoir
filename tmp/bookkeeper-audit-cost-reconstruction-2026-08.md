# Monsterthreads August 2026 zero-COGS reconstruction review

Generated 24 September 2026 from `readyedu_MonsterthreadsIMS` after converting Gift Wrapping to non-stock.

## Findings

- 37 variants, 56 movements, and 59 units remain with zero captured August POS COGS.
- Every variant existed before the first Solvantis POS movement on 28 July 2026.
- 36 variants have never had a Solvantis `po_received` movement. `HJX031AU` was first received on 3 September, after its affected August sale.
- All 37 variants currently have positive `cost_aud`; only `HJX031AU` currently has positive `avg_cost`.
- Proposed reconstruction using `cost_aud`: AUD 674.4306.
- 26 variants / 42 movements / AUD 427.2490 match the latest migrated pre-sale PO cost.
- Six variants / six movements / AUD 198.3200 differ from the latest migrated pre-sale PO cost and require review.
- Five variants / eight movements / AUD 48.8616 have `cost_aud` evidence only.

`cost_aud` is current catalogue evidence, not a timestamped historical cost. Migrated PO comparisons are corroboration only because those old POs do not have Solvantis receipt movements.

## Proposed reconstruction

| SKU | Product | Movements | Qty | cost_aud | Receipt timing | Evidence | Proposed COGS |
|---|---|---:|---:|---:|---|---|---:|
| 47C0120426 | BAG CHARM KANGAROO | 4 | 5 | 10.0000 | No Solvantis receipt | Matches migrated PO | 50.0000 |
| 47C0124411 | BAG CHARM KOALA | 4 | 5 | 10.0000 | No Solvantis receipt | Matches migrated PO | 50.0000 |
| GEN951AU | Cowboy Boot - Bottle Opener | 3 | 3 | 6.8000 | No Solvantis receipt | Matches migrated PO | 20.4000 |
| EH-023 | Eugy 3D Paper Model: Parrot | 1 | 1 | 8.5000 | No Solvantis receipt | Matches migrated PO | 8.5000 |
| EH-102 | Eugy 3D Paper Model: Stingray | 1 | 1 | 8.5000 | No Solvantis receipt | Matches migrated PO | 8.5000 |
| EH-087 | EUGY: Cat - Pumpkin | 1 | 1 | 8.5000 | No Solvantis receipt | Matches migrated PO | 8.5000 |
| GEN750AU | Fish Hip Flask | 1 | 1 | 18.1590 | No Solvantis receipt | Matches migrated PO | 18.1590 |
| GEN884AU | Fish shaped Waiter's Corkscrew | 1 | 1 | 11.3400 | No Solvantis receipt | Matches migrated PO | 11.3400 |
| KJB-ZOO | Fluffy Knit Baby Blanket / ZooCrew | 1 | 1 | 44.5000 | No Solvantis receipt | Differs from PO 38.4318 | 44.5000 |
| KJP-ZOO-3 | Fluffy Knit Jumper / ZooCrew | 1 | 1 | 44.5000 | No Solvantis receipt | Differs from PO 38.4318 | 44.5000 |
| JB86-1117AU | FSC Mix Credit JB86 Framed Floral - Iris | 1 | 1 | 11.3400 | No Solvantis receipt | Matches migrated PO | 11.3400 |
| DRJ-1002AU | FSC Self Help Reading Journal - Page Turners Anonymous | 1 | 1 | 11.3400 | No Solvantis receipt | Matches migrated PO | 11.3400 |
| DRJ-1001AU | FSC Self Help Reading Journal - What Happens In Book Club | 1 | 1 | 11.3400 | No Solvantis receipt | Matches migrated PO | 11.3400 |
| cMTGB0000 | Gift Box Monsterthreads | 2 | 2 | 0.3900 | No Solvantis receipt | cost_aud only | 0.7800 |
| GEN751AU | Gin Stones | 3 | 3 | 9.0700 | No Solvantis receipt | Matches migrated PO | 27.2100 |
| GEN953AU | Guitar - Bottle Opener | 3 | 3 | 6.8000 | No Solvantis receipt | Matches migrated PO | 20.4000 |
| SC-KDS2300202X00 | Izipizi Sun Child Sunglasses (5-7y) Collection D - Tortoise | 1 | 1 | 27.2500 | No Solvantis receipt | Differs from PO 25.8875 | 27.2500 |
| SC-SUN4306901X00 | Izipizi Sun Road Sunglasses - Light Tortoise | 1 | 1 | 50.0000 | No Solvantis receipt | Differs from PO 47.5000 | 50.0000 |
| cMT-PL0041 | Melamine Plate: Min Pin Australiana | 1 | 2 | 2.1500 | No Solvantis receipt | cost_aud only | 4.3000 |
| GEN826AU | Mini Tool Kit | 1 | 1 | 15.8900 | No Solvantis receipt | Matches migrated PO | 15.8900 |
| HJX031AU | Mug Feeling Vine | 1 | 1 | 6.8000 | Received after sale (3 Sep) | Matches migrated PO | 6.8000 |
| HJX042AU | Mug Main Character Energy | 3 | 3 | 6.8000 | No Solvantis receipt | Matches migrated PO | 20.4000 |
| HJX032AU | Mug Meow | 2 | 2 | 6.8000 | No Solvantis receipt | Matches migrated PO | 13.6000 |
| HJX037AU | Mug No Riff Raff | 1 | 1 | 6.8000 | No Solvantis receipt | Matches migrated PO | 6.8000 |
| HJX033AU | Mug Sardines | 1 | 1 | 6.8000 | No Solvantis receipt | Matches migrated PO | 6.8000 |
| GEN291AU | Pocket Bicycle Multi-Tool | 1 | 1 | 9.0700 | No Solvantis receipt | Differs from PO 10.4300 | 9.0700 |
| GEN167AU | Pocket Multi-Tool Pliers, Titanium | 2 | 2 | 10.4300 | No Solvantis receipt | Matches migrated PO | 20.8600 |
| GEN144AU | Rocking Whisky Glasses Set of 2 | 1 | 1 | 13.6100 | No Solvantis receipt | Matches migrated PO | 13.6100 |
| GEN938AU | Shoe Shine Kit in a Tin | 1 | 1 | 15.8900 | No Solvantis receipt | Matches migrated PO | 15.8900 |
| TLSB-ZOC-6 to 12 months | Terry Long Sleeve Bodysuit / Zoo Crew Cream | 1 | 1 | 23.0000 | No Solvantis receipt | Differs from PO 19.8640 | 23.0000 |
| GEN851AU | Travel Backgammon | 1 | 1 | 9.0700 | No Solvantis receipt | Matches migrated PO | 9.0700 |
| UB408246 | Urban Products Frog Rattle - Sage Green | 1 | 1 | 12.1500 | No Solvantis receipt | Matches migrated PO | 12.1500 |
| UA951842 | Urban Products Pooch Scarf - Sage | 1 | 1 | 12.1500 | No Solvantis receipt | Matches migrated PO | 12.1500 |
| UA951918 | Urban Products Strawberry Scarf - Red 180cm | 1 | 1 | 16.2000 | No Solvantis receipt | Matches migrated PO | 16.2000 |
| cMT-TM0265-M | Vinyl Owl Black Mens Tee | 3 | 3 | 8.7379 | No Solvantis receipt | cost_aud only | 26.2137 |
| cMT-TM0265-XL | Vinyl Owl Black Mens Tee | 1 | 1 | 8.7379 | No Solvantis receipt | cost_aud only | 8.7379 |
| cMT-WB0020 | Water Bottle: Ants 300ml | 1 | 1 | 8.8300 | No Solvantis receipt | cost_aud only | 8.8300 |

## Review recommendation

1. Use `cost_aud` for the 26 exact migrated-PO matches and for `HJX031AU`, whose later Solvantis receipt confirms the same AUD 6.80 cost.
2. Review the six disagreements before choosing catalogue or migrated PO cost: `KJB-ZOO`, `KJP-ZOO-3`, `SC-KDS2300202X00`, `SC-SUN4306901X00`, `GEN291AU`, and `TLSB-ZOC-6 to 12 months`.
3. Use `cost_aud` only with explicit bookkeeper approval for `cMTGB0000`, `cMT-PL0041`, `cMT-TM0265-M`, `cMT-TM0265-XL`, and `cMT-WB0020`; no migrated PO cost corroborates them.
4. Apply any approved correction only to the 56 identified zero-cost movement rows, stamp the chosen evidence in each movement note, and re-run the August COGS calculation before posting or adjusting Xero.
# Monsterthreads August 2026 zero-COGS reconstruction review

Generated 24 September 2026 from `readyedu_MonsterthreadsIMS` after converting Gift Wrapping to non-stock.

## Findings

- 37 variants, 56 movements, and 59 units remain with zero captured August POS COGS.
- Every variant existed before the first Solvantis POS movement on 28 July 2026.
- 32 variants have completed POs with positive received quantities dated 7-21 July, before their affected August sales. Receipt stock movements were not yet written at that time; the first `po_received` movement in this tenant is 11 August.
- Five variants have no received PO and rely on migrated catalogue `cost_aud`. `HJX031AU` was also received again on 3 September at the same AUD 6.80 cost.
- All 37 variants currently have positive `cost_aud`; only `HJX031AU` currently has positive `avg_cost`.
- Proposed reconstruction using effective July receipt cost where available, then `cost_aud`: AUD 656.6557.
- 26 variants / 42 movements / AUD 427.2490 have `cost_aud` equal to effective July receipt cost.
- Six variants / six movements / AUD 180.5451 use effective July receipt cost instead of current `cost_aud` because of GST extraction, receipt discount, or a different received unit cost.
- Five variants / eight movements / AUD 48.8616 have `cost_aud` evidence only.

`cost_aud` is current catalogue evidence, not a timestamped historical cost. The July POs have received quantities and receipt dates but predate stock-movement receipt logging, so their effective line costs are the strongest available historical evidence.

## Proposed reconstruction

| SKU | Product | Movements | Qty | cost_aud | Receipt timing | Evidence | Proposed COGS |
|---|---|---:|---:|---:|---|---|---:|
| 47C0120426 | BAG CHARM KANGAROO | 4 | 5 | 10.0000 | July received PO | Matches receipt | 50.0000 |
| 47C0124411 | BAG CHARM KOALA | 4 | 5 | 10.0000 | July received PO | Matches receipt | 50.0000 |
| GEN951AU | Cowboy Boot - Bottle Opener | 3 | 3 | 6.8000 | July received PO | Matches receipt | 20.4000 |
| EH-023 | Eugy 3D Paper Model: Parrot | 1 | 1 | 8.5000 | July received PO | Matches receipt | 8.5000 |
| EH-102 | Eugy 3D Paper Model: Stingray | 1 | 1 | 8.5000 | July received PO | Matches receipt | 8.5000 |
| EH-087 | EUGY: Cat - Pumpkin | 1 | 1 | 8.5000 | July received PO | Matches receipt | 8.5000 |
| GEN750AU | Fish Hip Flask | 1 | 1 | 18.1590 | July received PO | Matches receipt | 18.1590 |
| GEN884AU | Fish shaped Waiter's Corkscrew | 1 | 1 | 11.3400 | July received PO | Matches receipt | 11.3400 |
| KJB-ZOO | Fluffy Knit Baby Blanket / ZooCrew | 1 | 1 | 44.5000 | July received PO | Receipt ex-GST 38.4318 | 38.4318 |
| KJP-ZOO-3 | Fluffy Knit Jumper / ZooCrew | 1 | 1 | 44.5000 | July received PO | Receipt ex-GST 38.4318 | 38.4318 |
| JB86-1117AU | FSC Mix Credit JB86 Framed Floral - Iris | 1 | 1 | 11.3400 | July received PO | Matches receipt | 11.3400 |
| DRJ-1002AU | FSC Self Help Reading Journal - Page Turners Anonymous | 1 | 1 | 11.3400 | July received PO | Matches receipt | 11.3400 |
| DRJ-1001AU | FSC Self Help Reading Journal - What Happens In Book Club | 1 | 1 | 11.3400 | July received PO | Matches receipt | 11.3400 |
| cMTGB0000 | Gift Box Monsterthreads | 2 | 2 | 0.3900 | No received PO | cost_aud only | 0.7800 |
| GEN751AU | Gin Stones | 3 | 3 | 9.0700 | July received PO | Matches receipt | 27.2100 |
| GEN953AU | Guitar - Bottle Opener | 3 | 3 | 6.8000 | July received PO | Matches receipt | 20.4000 |
| SC-KDS2300202X00 | Izipizi Sun Child Sunglasses (5-7y) Collection D - Tortoise | 1 | 1 | 27.2500 | July received PO | Receipt after 5% discount | 25.8875 |
| SC-SUN4306901X00 | Izipizi Sun Road Sunglasses - Light Tortoise | 1 | 1 | 50.0000 | July received PO | Receipt after 5% discount | 47.5000 |
| cMT-PL0041 | Melamine Plate: Min Pin Australiana | 1 | 2 | 2.1500 | No received PO | cost_aud only | 4.3000 |
| GEN826AU | Mini Tool Kit | 1 | 1 | 15.8900 | July received PO | Matches receipt | 15.8900 |
| HJX031AU | Mug Feeling Vine | 1 | 1 | 6.8000 | July PO; received again 3 Sep | Matches receipt | 6.8000 |
| HJX042AU | Mug Main Character Energy | 3 | 3 | 6.8000 | July received PO | Matches receipt | 20.4000 |
| HJX032AU | Mug Meow | 2 | 2 | 6.8000 | July received PO | Matches receipt | 13.6000 |
| HJX037AU | Mug No Riff Raff | 1 | 1 | 6.8000 | July received PO | Matches receipt | 6.8000 |
| HJX033AU | Mug Sardines | 1 | 1 | 6.8000 | July received PO | Matches receipt | 6.8000 |
| GEN291AU | Pocket Bicycle Multi-Tool | 1 | 1 | 9.0700 | July received PO | Receipt cost 10.4300 | 10.4300 |
| GEN167AU | Pocket Multi-Tool Pliers, Titanium | 2 | 2 | 10.4300 | July received PO | Matches receipt | 20.8600 |
| GEN144AU | Rocking Whisky Glasses Set of 2 | 1 | 1 | 13.6100 | July received PO | Matches receipt | 13.6100 |
| GEN938AU | Shoe Shine Kit in a Tin | 1 | 1 | 15.8900 | July received PO | Matches receipt | 15.8900 |
| TLSB-ZOC-6 to 12 months | Terry Long Sleeve Bodysuit / Zoo Crew Cream | 1 | 1 | 23.0000 | July received PO | Receipt cost 19.8640 | 19.8640 |
| GEN851AU | Travel Backgammon | 1 | 1 | 9.0700 | July received PO | Matches receipt | 9.0700 |
| UB408246 | Urban Products Frog Rattle - Sage Green | 1 | 1 | 12.1500 | July received PO | Matches receipt | 12.1500 |
| UA951842 | Urban Products Pooch Scarf - Sage | 1 | 1 | 12.1500 | July received PO | Matches receipt | 12.1500 |
| UA951918 | Urban Products Strawberry Scarf - Red 180cm | 1 | 1 | 16.2000 | July received PO | Matches receipt | 16.2000 |
| cMT-TM0265-M | Vinyl Owl Black Mens Tee | 3 | 3 | 8.7379 | No received PO | cost_aud only | 26.2137 |
| cMT-TM0265-XL | Vinyl Owl Black Mens Tee | 1 | 1 | 8.7379 | No received PO | cost_aud only | 8.7379 |
| cMT-WB0020 | Water Bottle: Ants 300ml | 1 | 1 | 8.8300 | No received PO | cost_aud only | 8.8300 |

## Review recommendation

1. Use effective July received-PO cost for all 32 PO-backed variants. This equals `cost_aud` for 26 variants.
2. For the six differences, use the received value: GST-exclusive cost for `KJB-ZOO` and `KJP-ZOO-3`; discounted receipt cost for `SC-KDS2300202X00` and `SC-SUN4306901X00`; and the received unit cost for `GEN291AU` and `TLSB-ZOC-6 to 12 months`.
3. Use `cost_aud` only with explicit bookkeeper approval for `cMTGB0000`, `cMT-PL0041`, `cMT-TM0265-M`, `cMT-TM0265-XL`, and `cMT-WB0020`; no migrated PO cost corroborates them.
4. Apply any approved correction only to the 56 identified zero-cost movement rows, stamp the chosen evidence in each movement note, and re-run the August COGS calculation before posting or adjusting Xero.
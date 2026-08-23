---
{"id":"ims-location-stock-operations","title":"Locations, Transfers, and Stocktakes","audiences":["ims"],"capability":"inventory","screen":"Locations and Stock","product":"ims","parentId":"ims-stock","contexts":["locations","branch-transfers","smart-device-receive","receive-transfers","stocktakes"],"contextSections":{"locations":"Locations","branch-transfers":"Branch transfers","smart-device-receive":"Receive transfers","receive-transfers":"Receive transfers","stocktakes":"Stocktakes"},"order":50,"summary":"Configure locations and move, receive, count, and correct physical stock with traceable operations.","lastReviewed":"2026-08-23","owner":"inventory"}
---
# Locations, Transfers, and Stocktakes

## Main operations

- Maintain active operating locations and their applicable POS, stock, tracking, and integration settings.
- Send Branch Transfers from the source and receive them separately at the destination.
- Confirm physically arrived transfer quantities before completing receipt.
- Start, count, review, and complete Stocktakes against the locked snapshot.

## Locations

Locations define operating branches used by inventory, POS, transfers, tracking, and reports. Review downstream mappings and open work before deactivation or configuration changes. A location setting can change where activity appears without moving existing stock.

## Branch transfers

A transfer has explicit source and destination stages. Sending records the source stock movement. Receiving records destination stock. Keep an in-transit transfer open while goods are moving and use its supported discrepancy process when physical quantities differ.

## Receive transfers

At the destination, open or scan the incoming transfer, compare the shipment to the physical goods, enter supported received quantities, and complete only after review. Do not create a separate positive adjustment for the same shipment.

## Stocktakes

A Stocktake compares counted quantities with the application snapshot locked for that count. Completion applies the exact difference. If a completed stocktake was mistaken, use the supported reversal so its original delta is compensated without erasing valid movements that happened later.

## Troubleshooting

- If a transfer is unavailable, check source, destination, status, and the active user location.
- If destination stock is missing, confirm the transfer was received rather than only sent.
- If a stocktake variance is surprising, verify the counted variant, unit, locked snapshot, and movements around the count.
- Never imitate an in-progress transfer or completed stocktake with generic adjustments.

## Worked examples

### Move stock between branches

Create the transfer at the source, add the correct variants and quantities, review the destination, and send it. At the destination, open Receive Transfers, count the physical goods, enter any supported discrepancy, and complete receipt.

### Correct a mistaken completed stocktake

Open the completed Stocktake and review its applied difference. Use the offered reversal action, confirm the scope, and then start a fresh count if needed. The reversal compensates the stocktake without deleting intervening sales, receipts, or transfers.
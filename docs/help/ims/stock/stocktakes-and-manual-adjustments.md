---
{"id":"ims-stocktakes-adjustments","title":"Stocktakes and Manual Adjustments","audiences":["ims"],"capability":"inventory","screen":"Stocktakes and Stock","product":"ims","format":"task","parentId":"ims-location-stock-operations","relatedTopics":["ims-branch-transfers","ims-inventory-costing"],"contexts":["stocktakes"],"contextSections":{"stocktakes":"Step-by-step"},"order":52,"summary":"Count physical stock, understand the applied variance, reverse a mistaken count, and choose a manual adjustment only for a known isolated correction.","lastReviewed":"2026-08-23","owner":"inventory"}
---
# Stocktakes and Manual Adjustments

Use a stocktake for a controlled physical count and a manual quantity adjustment for one verified correction that is not already explained by another workflow.

## Main operations

- Create a filtered or blank stocktake for one location.
- Enter counts manually or from scanned barcode lists.
- Decide whether uncounted items stay unchanged or count as zero.
- Complete the count and review quantity and value differences.
- Reverse a mistaken supported stocktake without deleting later movements.
- Use a manual adjustment only for a known isolated discrepancy.

## At a glance

| Situation | Use | Quantity result |
|---|---|---|
| Periodic count of a range, brand, supplier, or product type | Stocktake | Each counted item is set to the physical quantity at completion |
| Blank spot count built item by item | Stocktake | Only added and counted items can change |
| One verified damaged, lost, or data-entry quantity | Stock adjustment | Increase or decrease that item by the reviewed amount |
| Goods moving between branches | Branch transfer | Source and destination changes remain linked |
| Uncounted line left blank | Leave uncounted | Its quantity remains unchanged |
| Uncounted line explicitly set to 0 | Apply 0 to uncounted | Its full current quantity is removed at completion |

## Before you begin

- [ ] Choose the exact location and count scope.
- [ ] Finish or identify open receipts, transfers, sales, and returns that could change the counted products.
- [ ] Tell staff when the count starts and how movements during counting will be handled.
- [ ] Confirm whether a blank field means “not counted” or should truly be zero.
- [ ] For a manual adjustment, record a clear reason and verify no other workflow already owns the movement.

> **Warning:** Do not use a manual adjustment to imitate a transfer, receipt, return, or completed stocktake. That creates an unlinked second stock movement.

## Step-by-step

### Run a stocktake

1. Open **Stocktakes** and choose **New Stocktake**.
2. Choose the location and reference. Use **Pre-populate from filters** for a defined range, or **Blank** to add items manually.
3. Review the number of included variants, then start the stocktake.
4. Count physical units and enter each quantity. You can save and continue later.
5. Review blank lines. Leave them blank to keep their quantities unchanged, or choose **Apply 0 to uncounted** only when zero was physically verified.
6. Complete the stocktake. Each counted line is compared with stock on hand at completion and adjusted to the count.
7. Review variances and any separate accounting status. If accounting fails, retry that action without completing the count again.

### Make a manual adjustment

1. Open the stock view for the correct location and product variant.
2. Check recent sales, receipts, transfers, returns, and stocktakes for an unfinished or duplicate movement.
3. Enter the positive or negative correction offered by the stock adjustment action.
4. Record a specific reason, such as “1 damaged mug removed after recount”.
5. Save once and confirm the resulting stock on hand.

### Reverse a mistaken stocktake

1. Open the completed stocktake and select **Revert Mistaken Stocktake** when available.
2. Enter a clear reason and review the confirmation.
3. Complete the reversal. It compensates the original stocktake adjustments while preserving valid sales, receipts, or transfers recorded later.
4. Start a new stocktake if a fresh physical count is still required.

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| Variance is unexpectedly large | Wrong location or variant, incorrect count, or a movement occurred during counting | Recount and review movement timing before completion |
| Blank lines did not change | Uncounted items are deliberately ignored | Use zero only when zero stock was physically confirmed |
| Reversal is unavailable | The record is not completed or an older count lacks the required detail | Review the offered correction path and use a controlled adjustment only if directed |
| Accounting status failed | Stock completion succeeded but the separate journal did not | Retry the accounting action; do not complete or adjust stock again |
| Manual adjustment would duplicate another record | A transfer, receipt, return, or stocktake already explains the quantity | Finish or correct that original workflow instead |

## Worked examples

### Counted-versus-current stock math

A stocktake started when the snapshot showed 20 candles. During the count, a valid sale reduces current stock to 19. Staff physically count 18. At completion, the applied adjustment is $18 - 19 = -1$, leaving stock on hand at 18. The earlier sale is preserved rather than removed a second time.

### Count a missing item as zero

The current quantity is 7 scarves and staff confirm none are present. Enter 0, not a blank. Completion applies $0 - 7 = -7$. At an average cost of $12, the inventory variance value is $84.

### Correct one damaged unit

The stock view shows 15 mugs and a recount confirms 14 because one was broken. No open return, transfer, or stocktake covers it. Enter a manual adjustment of -1 with the damage reason. Do not start a broad stocktake or make a second accounting quantity correction.
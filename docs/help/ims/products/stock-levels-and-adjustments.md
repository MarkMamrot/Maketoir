---
{"id":"ims-stock-levels-adjustments","title":"Stock Levels and Adjustments","audiences":["ims"],"capability":"inventory","screen":"Products > Stock Levels","product":"ims","format":"task","parentId":"ims-catalogue-stock","contexts":["stock"],"contextSections":{"stock":"Step-by-step"},"relatedTopics":["ims-catalogue-stock","ims-inventory-costing","ims-po-receiving-resolution"],"order":17,"summary":"Read on-hand, available, incoming and committed stock, then choose the correct workflow when a quantity needs correction.","lastReviewed":"2026-08-31","owner":"inventory"}
---
# Stock Levels and Adjustments

Use Stock Levels to explain a quantity before changing it, then use the operational workflow that matches what physically happened.

## Main operations

- Search by SKU, product, variant, barcode or location.
- Filter by brand, supplier or **Low stock only**.
- Compare on hand, available, incoming and committed quantities.
- Review average cost and stock value without changing them.
- Correct a physical count through Stocktakes, not through the read-only Stock Levels table.

## At a glance

| Column | Plain meaning | Example |
|---|---|---:|
| On Hand | Units currently recorded at the location | 12 |
| Committed | Units promised to customer demand | 5 |
| Available | On Hand minus Committed | 7 |
| Incoming | Units expected from confirmed purchasing | 8 |
| Min Qty | The low-stock comparison point | 4 |
| Reorder Qty | The saved replenishment quantity | 10 |
| Avg Cost | Current shared tax-exclusive cost per unit | $18.00 |
| Stock Value | On Hand multiplied by Avg Cost | $216.00 |

> **Important:** Incoming stock is not on hand. Committed stock is still physically present but already promised. Do not add incoming to on hand or subtract committed with a manual count correction.

## Before you begin

- [ ] Select or identify the correct location.
- [ ] Search the exact variant, not only the product name.
- [ ] Check for open POs, customer orders, transfers and returns.
- [ ] Count the physical units if you suspect an on-hand error.
- [ ] Use an account permitted to complete the required stock workflow.

Stock Levels is a read-only investigation view. The quantity changes when staff receive a PO, fulfil a sale, send or receive a transfer, complete a return, or complete a stocktake.

Products with **Tracks Inventory** off are not governed by on-hand, available, committed, incoming, minimum or reorder quantities. Sales of those products do not create stock movements. Turn tracking on only when the item should participate in these physical-stock workflows.

## Step-by-step

1. Open **Products > Stock Levels**.
2. Search the SKU or product and find the row for the correct location.
3. Compare **On Hand**, **Committed**, **Available** and **Incoming**.
4. If committed is unexpected, inspect the related Sales Orders or Stock Allocation work.
5. If incoming is unexpected, inspect confirmed or partially received Purchase Orders.
6. If on hand differs from the shelf count, check for an unfinished receipt, transfer, sale or return.
7. When no missing transaction explains the difference, create a Stocktake for the location and affected products.
8. Enter the physical count, review the variance, then use **Complete & Apply Count** when authorised.
9. Return to Stock Levels and confirm the new on-hand quantity.

## Choose the correct adjustment

| What happened | Correct workflow | Why |
|---|---|---|
| Supplier delivery arrived | Receive the Purchase Order | Adds stock and keeps supplier cost with the receipt |
| Stock moved between stores | Branch Transfer | Records source and destination separately |
| Customer returned an item | Customer return or credit note | Keeps customer value and stock together |
| Goods went back to a supplier | Supplier Return / Credit | Reduces stock only for lines marked Return stock |
| Shelf count differs with no missing transaction | Stocktake | Records counted quantity and exact variance |
| A stocktake itself was completed by mistake | Revert Mistaken Stocktake, when offered | Applies a compensating correction while preserving later movements |

## Count and value example

| Measure | Quantity | Calculation |
|---|---:|---|
| System on hand when applied | 14 | Existing record |
| Physical count | 11 | Staff count |
| Applied adjustment | -3 | `11 - 14` |
| Average cost | $20.00 | Tax-exclusive unit cost |
| Value of reduction | $60.00 | `3 × $20` |

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Available is lower than on hand | Units are committed | Check customer orders and allocation before changing stock |
| Incoming remains after a delivery | The PO may not have been received or fully resolved | Open the PO and check received and outstanding quantities |
| Low stock includes a zero minimum | Zero means flag the item when it is out of stock | Review the row rather than assuming the filter is wrong |
| A completed count is still wrong | A movement may have occurred after counting, or the wrong location was counted | Review Stock History and the stocktake's applied adjustment |
| Two locations show the same average cost | Average cost is shared for the variant | Compare location quantities and values separately |

## Worked examples

### Explain available stock

Melbourne has 12 travel mugs on hand, 5 committed to customer orders and 8 incoming. Available is `12 - 5 = 7`. The 8 incoming units do not become available on hand until they are received.

### Correct a shelf count

Stock Levels shows 14 candles, but staff count 11 and find no missing sale, receipt, transfer or return. They create a focused Stocktake, enter 11 and complete it. The applied adjustment is -3. At an average cost of $20, stock value falls by $60 before any separate accounting posting.
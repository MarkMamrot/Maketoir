---
{"id":"ims-inventory-costing","title":"Inventory Costing and Stock Value","audiences":["ims"],"capability":"inventory","screen":"Products > Stock Levels","product":"ims","format":"reference","parentId":"ims-products","contexts":["inventory-costing","average-cost","stock-value"],"relatedTopics":["ims-stock-levels-adjustments","ims-purchase-orders","ims-supplier-returns-credit-notes"],"order":20,"summary":"Understand average cost, stock value, margin, and the cost saved on past stock movements.","lastReviewed":"2026-08-23","owner":"inventory"}
---
# Inventory Costing and Stock Value

Solvantis keeps one current weighted-average cost for each variant across the business. Every location uses that same unit cost, while each location has its own quantity and stock value.

## Main operations

Solvantis uses one organisation-wide weighted-average cost for each variant, not separate FIFO or LIFO cost layers. That current average feeds today's inventory valuation. Completed sales and other past stock movements keep the cost recorded at the time, which supports historical margin and cost of goods sold (COGS).

| To answer... | Use |
|---|---|
| What is this variant's current average cost? | Enable **Average Cost** in All Products, or open Stock Levels |
| What is the current stock value at a location? | **Products > Stock Levels** |
| What cost was attached to an earlier receipt, sale or return? | **Stock History** |
| How does selling price compare with cost? | **Reports > Product Margin** |
| Does the accounting value agree with IMS? | **Xero > COGS Reconciliation** and Inventory Valuation |

## Cost terms in plain language

| Term | Meaning |
|---|---|
| Average cost | The current blended tax-exclusive AUD cost for one variant |
| Stock value | On-hand quantity multiplied by current average cost |
| Historical movement cost | The cost saved when a receipt, sale, return or adjustment was completed |
| Landed cost | An extra purchasing cost, such as duty or inbound handling, allocated to stock |

Solvantis does not use a separate average cost for each store. It also does not treat the oldest or newest unit as a separate cost layer.

## Tax and currency

Retail and POS selling prices are tax-inclusive. For example, a $110 selling price contains $10 GST.

Supplier costs used for inventory value are tax-exclusive. If a GST-registered Australian supplier quotes $55 including 10% GST, the inventory cost before other adjustments is $50 and the GST is $5. If the supplier form is set to **Tax exclusive**, entering $50 produces a $55 total. If it is set to **Tax inclusive**, entering $55 still leaves $50 as the cost basis.

For a foreign-currency order, the cost is converted to AUD using the recorded exchange rate. Line discounts and configured freight or landed-cost allocation can also change the final received cost.

> **Important:** Check the supplier's tax treatment and currency before receiving. Correcting a draft is simpler than explaining an incorrect average cost after stock has moved.

## How a receipt changes average cost

For positive existing and received quantities:

`new average cost = (existing quantity × existing average cost + received quantity × received unit cost) ÷ total quantity`

| Stage | Quantity | Unit cost | Value |
|---|---:|---:|---:|
| Existing stock | 10 | $20.00 | $200.00 |
| New receipt | 5 | $26.00 | $130.00 |
| Combined | 15 | $22.00 average | $330.00 |

If there is no positive stock before the receipt, the final tax-exclusive AUD receipt cost becomes the new average cost.

## Current cost and past cost

A new receipt changes the current average cost. It does not rewrite the cost saved on earlier completed movements.

This distinction matters when investigating margin. A jacket sold last month can keep its $40 historical sale cost even if a new delivery moves the current average to $44. Current stock value uses $44; the earlier sale remains recorded at $40.

## Troubleshooting

| Symptom | Check | Action |
|---|---|---|
| Average cost jumped after a receipt | Tax treatment, currency, exchange rate, discount and landed costs | Correct the source through the supported PO or supplier-credit action; do not overwrite history casually |
| Two stores show the same average cost | This is expected for the same variant | Compare each store's quantity to understand its different stock value |
| A past sale has a different cost from today's average | The sale kept its completion-time cost | Use Stock History for the past movement and Stock Levels for current value |
| Stock value looks wrong | Quantity or current average cost may be wrong | Check the physical quantity path first, then review the most recent receipts and returns |

## Worked examples

### GST-inclusive supplier invoice

A local supplier invoice shows 8 mugs at $22 each including GST. The tax-exclusive unit cost is `$22 ÷ 1.1 = $20`. Inventory value added before freight is `8 × $20 = $160`; the $16 GST is not part of stock value.

### Value by location

The same scarf variant has an average cost of $18. Brisbane holds 12, so its stock value is $216. Sydney holds 5, so its value is $90. The unit cost is shared, but the location values differ because the quantities differ.
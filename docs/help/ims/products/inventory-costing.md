---
{"id":"ims-inventory-costing","title":"Inventory Costing and Stock Value","audiences":["ims"],"capability":"inventory","screen":"Settings > General > Inventory Costing","product":"ims","format":"reference","parentId":"ims-products","contexts":["settings-general","inventory-costing","average-cost","stock-value"],"contextSections":{"settings-general":"Choose or change the costing method"},"relatedTopics":["ims-stock-levels-adjustments","ims-purchase-orders","ims-supplier-returns-credit-notes"],"order":20,"summary":"Understand Average Cost and FIFO, current stock value, historical movement cost, and controlled method changes.","lastReviewed":"2026-09-14","owner":"inventory","quickSections":["Main operations","Cost terms in plain language","Tax and currency"]}
---
# Inventory Costing and Stock Value

Solvantis supports Average Cost and first in, first out (FIFO) inventory costing. One method applies to the whole business at a time. Current valuation follows that method, while completed movements keep their recorded costs for historical margin and cost of goods sold (COGS).

## Main operations

Check the active method under **Settings > General > Inventory Costing**. Only an Administrator can change it. Review and resolve every blocker before switching, then enter a reason and the displayed confirmation phrase.

| To answer... | Use |
|---|---|
| Which method is active? | **Settings > General > Inventory Costing** |
| What is the current stock value at a location? | **Products > Stock Levels** |
| What cost was attached to an earlier receipt, sale or return? | **Stock History** |
| How does selling price compare with cost? | **Reports > Product Margin** |
| Does the accounting value agree with IMS? | **Xero > COGS Reconciliation** and Inventory Valuation |

## Cost terms in plain language

| Term | Meaning |
|---|---|
| Average Cost | One current blended tax-exclusive AUD cost for a variant across the business |
| FIFO | Location-specific receipt layers consumed oldest first |
| FIFO layer | A dated quantity at its recorded tax-exclusive AUD unit cost |
| Approved zero cost | Stock received at no cost with an immutable workflow reason recorded on its FIFO layer |
| Stock value | Average Cost value or the value of remaining FIFO layers, according to the active method |
| Historical movement cost | The cost saved when a receipt, sale, return or adjustment was completed |
| Landed cost | An extra purchasing cost, such as duty or inbound handling, allocated to stock |

Under Average Cost, locations share the variant's current unit cost. Under FIFO, layers belong to a location because stock received and consumed there has its own sequence.

## Tax and currency

Retail and POS selling prices are tax-inclusive. For example, a $110 selling price contains $10 GST.

Supplier costs used for inventory value are tax-exclusive. If a GST-registered Australian supplier quotes $55 including 10% GST, the inventory cost before other adjustments is $50 and the GST is $5. If the supplier form is set to **Tax exclusive**, entering $50 produces a $55 total. If it is set to **Tax inclusive**, entering $55 still leaves $50 as the cost basis.

For a foreign-currency order, the cost is converted to AUD using the recorded exchange rate. Line discounts and configured freight or landed-cost allocation can also change the final received cost.

> **Important:** Check the supplier's tax treatment and currency before receiving. Correcting a draft is simpler than explaining an incorrect average cost after stock has moved.

## How receipts are costed

### Average Cost

For positive existing and received quantities:

`new average cost = (existing quantity × existing average cost + received quantity × received unit cost) ÷ total quantity`

| Stage | Quantity | Unit cost | Value |
|---|---:|---:|---:|
| Existing stock | 10 | $20.00 | $200.00 |
| New receipt | 5 | $26.00 | $130.00 |
| Combined | 15 | $22.00 average | $330.00 |

If there is no positive stock before the receipt, the final tax-exclusive AUD receipt cost becomes the new average cost.

### FIFO

Each receipt creates a layer at the receiving location using its final tax-exclusive AUD cost. A sale, fulfilment, supplier return, build, or negative adjustment consumes the oldest available layer first. Transfers preserve cost from the source location when creating layers at the destination.

FIFO does not accept unexplained zero-cost stock. A genuine no-charge supplier receipt, zero-cost build output, stocktake gain, return, or transfer records a controlled reason on the layer. COGS Reconciliation shows these as **Approved zero cost**; they remain postable at $0, while missing or unexplained zero costs continue to block posting.

For example, 10 units received at $20 followed by 5 at $26 are worth $330. Selling 12 consumes all 10 units from the $20 layer and 2 units from the $26 layer, so attached COGS is $252 and 3 units worth $78 remain.

## Current cost and past cost

A new receipt changes current valuation under Average Cost or adds a new layer under FIFO. It does not rewrite the cost saved on earlier completed movements.

This distinction matters when investigating margin. A jacket sold last month keeps its captured cost even if a later delivery changes the cost of remaining stock.

## Choose or change the costing method

1. Open **Settings > General > Inventory Costing** as an Administrator.
2. Review the current method, on-hand quantity, opening value, warnings, and blockers.
3. Resolve negative stock or missing positive costs before enabling FIFO. Resolve any stock-to-layer mismatch before leaving FIFO.
4. Enter the business reason for the change.
5. Type the displayed method name exactly and select **Switch to FIFO** or **Switch to Average Cost**.
6. Reopen Inventory Valuation and review the current value.

The change is prospective. Switching to FIFO creates opening layers for positive stock at its current Average Cost. Switching to Average Cost calculates each variant's new average from its remaining FIFO layers. Historical movements, completed-document costs, and posted Xero journals are preserved.

> **Warning:** Do not switch methods to repair a quantity or source-document error. Correct the source workflow first. The reviewed switch is an accounting policy change and its reason is retained.

## Troubleshooting

| Symptom | Check | Action |
|---|---|---|
| Current cost changed after a receipt | The receipt updated Average Cost or added a FIFO layer | Check tax, currency, discount, freight and landed costs on the receipt |
| Two stores show the same Average Cost | This is expected under Average Cost | Compare each store's quantity and value separately |
| A past sale differs from today's stock cost | The sale kept its completion-time cost | Use Stock History for the movement and Inventory Valuation for current value |
| The method switch is blocked | Negative stock, missing costs, or FIFO layers do not reconcile | Correct the named rows through their operational workflows, then review again |
| FIFO valuation looks wrong | A quantity, receipt layer, or later movement may need investigation | Compare Inventory Valuation, Stock Levels, Stock History, and source documents |

## Worked examples

### GST-inclusive supplier invoice

A local supplier invoice shows 8 mugs at $22 each including GST. The tax-exclusive unit cost is `$22 ÷ 1.1 = $20`. Inventory value added before freight is `8 × $20 = $160`; the $16 GST is not part of stock value.

### Value by location

Under Average Cost, the same scarf variant has a shared cost of $18. Brisbane holds 12, so its stock value is $216. Sydney holds 5, so its value is $90. Under FIFO, each location's value instead comes from the layers remaining there.
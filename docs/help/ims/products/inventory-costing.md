---
{"id":"ims-inventory-costing","title":"Inventory Costing and Stock Value","audiences":["ims"],"capability":"inventory","screen":"Products > Stock Levels","product":"ims","parentId":"ims-products","contexts":["inventory-costing","average-cost","stock-value"],"order":20,"summary":"Understand weighted-average cost, stock value, margin, and historical movement cost.","lastReviewed":"2026-08-23","owner":"inventory"}
---
# Inventory Costing and Stock Value

Solvantis uses one organisation-wide weighted-average cost for each product variant. This is also called weighted average cost, average cost, moving average cost, or WAC. It is not FIFO or LIFO and does not maintain a different average cost for each location.

## Main operations

- View Average Cost from **Products > All Products** by enabling the Average Cost column.
- View average cost and stock value by location from **Products > Stock Levels**.
- Review Product Margin to compare selling values with recorded costs.
- Review Stock History when investigating the cost recorded on completed movements.

## Before you begin

POS and product prices are tax-inclusive, while inventory cost calculations use the appropriate tax-exclusive AUD cost. Confirm purchase tax, currency, discount, freight, and landed-cost settings before relying on a new receipt cost.

## Step-by-step workflows

### Cost a receipt

1. Start with the variant's total existing organisation-wide stock quantity and current average cost.
2. Determine the received tax-exclusive unit cost after line discount.
3. Convert foreign currency to AUD when applicable.
4. Include allocated landed costs and freight according to the saved costing settings.
5. Combine existing stock value and received stock value, then divide by the combined positive quantity.

If there is no existing positive stock quantity, the received unit cost becomes the new average cost.

## Statuses, calculations, and permissions

For positive existing and received quantities, the conceptual calculation is:

`new average = (existing quantity × existing average + received quantity × received unit cost) ÷ (existing quantity + received quantity)`

The shared average cost supports current inventory valuation, product margin analysis, and fallback cost of goods sold. Location stock rows mirror the same variant average; location value differs because quantity differs.

Completed stock movements retain the unit cost recorded when they were completed. A later purchase receipt updates current average cost but does not rewrite historical movement cost.

## Troubleshooting

- Check whether the receipt cost included tax and whether Solvantis correctly removed included purchase tax.
- Check currency and exchange rate for foreign purchases.
- Review line discount, freight allocation, and landed-cost settings.
- Do not expect separate average costs for two locations; the model is organisation-wide per variant.

## Related tasks

Related Help topics include Purchase Orders, Supplier Credit Notes, Stocktakes, Inventory Valuation, Product Margin, and Xero COGS Reconciliation.

## Worked examples

### Weighted receipt

A variant has 10 units at an average cost of $20, giving existing value of $200. Five more units are received at a final tax-exclusive AUD cost of $26, adding $130. The new average is `$330 ÷ 15 = $22` per unit across every location.

### Receipt after stock reaches zero

A variant has no positive stock and 8 units are received at a final cost of $17.50 each. The new organisation-wide average becomes $17.50 because there is no positive existing quantity to blend.
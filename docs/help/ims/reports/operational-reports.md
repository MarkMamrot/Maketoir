---
{"id":"ims-operational-reports","title":"IMS Reports","audiences":["ims"],"capability":"navigation","screen":"Reports","product":"ims","parentId":"ims-reports","contexts":["reports","report-sales-detail","report-sales-by-branch","report-sales-summary","report-sales-search","report-inventory-valuation","report-product-margin","report-pos-price-changes","report-pos-registers","report-cash-banking","report-stock-availability"],"order":60,"summary":"Filter, interpret, and reconcile sales, inventory, margin, register, cash, and availability reports.","lastReviewed":"2026-08-23","owner":"reporting"}
---
# IMS Reports

## Main operations

- Choose the report that owns the question before comparing totals.
- Apply the shared preset or custom date range and any branch, status, or search filters.
- Use Sales Detail or Sales Search to trace summary values back to transactions.
- Use inventory and availability reports with the selected location and costing definition in mind.
- Export only after confirming the filtered results shown on screen.

## Sales reports

Sales Detail provides transaction-level analysis. Sales by Branch compares location performance. Sales Summary aggregates the selected period. Sales Search locates individual source activity. Confirm whether a report uses transaction, completion, fulfilment, or another displayed date definition before comparing it with an external system.

## Inventory and margin

Inventory Valuation applies current shared average cost to location quantities. Product Margin compares supported sales and cost values. Stock Availability separates on-hand, committed, incoming, and available quantities. Historical stock movements retain their recorded unit cost even when the current average later changes.

## POS controls

POS Price Changes records applicable selling-price changes. POS Registers and Cash Banking support register and banking review. Use transaction and session references to investigate a difference; these reports do not change completed sales or register sessions.

## Filters and exports

Date-based IMS reports use common preset windows or a custom from/to range. Check local reporting dates, selected locations, statuses, and search text before exporting. An export reflects its active filters.

## Troubleshooting

- If a total differs, align date definition, range, timezone, location, status, tax treatment, and included transaction types.
- If no rows appear, clear search text and verify the custom range is valid.
- If inventory value differs by branch, compare quantities; the variant average cost is shared.
- If a summary looks wrong, trace representative records in a detail report before changing source data.

## Worked examples

### Reconcile a branch sales total

Open Sales by Branch and set the required date range. Select the branch, then open Sales Detail with the same range and filters. Trace any difference to individual transactions, returns, or statuses before comparing with accounting data.

### Explain inventory value

Open Inventory Valuation for the location and note each variant's quantity and current average cost. Compare quantity in Stock Availability and review recent receipts when the current average needs explanation.
---
{"id":"ims-cogs-traceability","title":"Sales and COGS Traceability","audiences":["ims"],"capability":"navigation","screen":"Reports > Sales & COGS Traceability","product":"ims","format":"task","parentId":"ims-operational-reports","contexts":["report-cogs-traceability"],"contextSections":{"report-cogs-traceability":"Main operations"},"relatedTopics":["ims-operational-reports","ims-report-guide","ims-inventory-costing","ims-bookkeeper-audit"],"order":62,"summary":"Trace sales, returns and captured COGS by channel, product and stock location, inspect FIFO receipt evidence, and reconcile accounting-period differences.","lastReviewed":"2026-10-07","owner":"reporting","quickSections":["Main operations","At a glance","Before you begin"]}
---
# Sales and COGS Traceability

## Main operations

Open **Reports > Sales & COGS Traceability**. Start with **Summary** grouped by Sales Channel, then use **Detail** to inspect individual sales and stock events. **Reconciliation** compares recorded stock costs with the accounting COGS period.

- Choose the shared date preset or custom range and the date basis.
- Add filters for the required channel, customer, product, brand, location, reference, status, date or financial amount.
- In Summary, choose up to four grouping fields. Numeric filters apply to grouped totals in Summary and individual records in Detail.
- Group values have separate columns from summed financial figures, including when grouping by an exact monetary amount.
- Use the column chooser in Detail to reveal additional requested fields.
- Inspect transaction evidence for source references and recorded FIFO allocations.
- Export CSV after checking the filters. CSV includes every matching record or group and all report fields, not only the current page or visible columns.

## At a glance

| Figure or field | Meaning |
|---|---|
| Qty Sold | Signed sold, fulfilled or credited quantity according to the date basis |
| Sales | Merchandise selling value before recorded discounts, excluding GST |
| Discount | Sales less Net Sales; signed consistently with returns |
| Net Sales | Selling value after discounts, excluding GST |
| COGS | Tax-exclusive AUD cost captured on matched stock movements |
| GP | Net Sales minus COGS; unavailable when either figure is incomplete |
| GP % | Total GP divided by total Net Sales; blank when Net Sales is zero |
| Tax/GST | GST shown separately from Net Sales |
| Warehouse Location | Location attached to the stock event, or document location in sale-date results |
| Receipt Layer / Batch | Internal FIFO cost-layer reference and purchase-order reference where directly recorded |
| Invoice Status | Last verified accounting invoice status when available; not payment or sync status |

All primary financial totals are AUD. Original document-currency Net Sales and GST are separate columns. Foreign sales use the recorded exchange rate, never today's rate. Original-currency totals are unavailable when a group mixes currencies.

## Before you begin

- Confirm whether the question concerns sales dates or the period when stock costs were recorded.
- Use matching date ranges and scopes when comparing another report or accounting export.
- Check incomplete-cost and incomplete-revenue counts before relying on GP.
- Distinguish a FIFO costing allocation from proof of a physical supplier lot.

> **Important:** Missing cost is not zero cost. A historical catalogue price or today's Average Cost is not substituted for missing recorded COGS.

## Step-by-step

### Compare sales channels

1. Open the report and keep **Summary** active.
2. Choose a date range and date basis.
3. Keep **Sales Channel** as the first grouping, adding **Channel Instance** to distinguish online storefronts or seller accounts.
4. Add customer, brand, SKU or location filters as required.
5. Review Net Sales, captured COGS and the evidence status before interpreting GP.
6. Open Detail with the same filters to inspect the contributing records, then export CSV.

### Understand the date basis

**Stock movement date** is the default. Each stock event shows its recorded COGS and the attributable portion of the source line's revenue. Partial shipments therefore divide revenue across their fulfilled quantities; this is attributed fulfilment revenue, not necessarily invoiced revenue in that period. Completed non-stock and no-restock credit events appear as financial-only records without a stock COGS change.

**Invoice / sale date** uses the recorded invoice date for imported history and completion/order date for live sales where invoice date is not recorded. It shows the source line's revenue and matched costs across stock dates. An incompletely fulfilled line has incomplete COGS rather than an assumed cost for outstanding units. Credit reversals appear on their recorded reversal date.

### Trace the recorded cost

1. Open Detail and find the source reference or SKU.
2. Inspect its transaction evidence and source record.
3. Check the stock movement reference, date, location and cost method.
4. Under FIFO, review the allocated quantities, recorded unit costs, layer dates and available purchase-order references.
5. Check evidence warnings for aggregated POS SKU lines, legacy ambiguous matches, historical imports or cost-only corrections.

Grouping or filtering by FIFO receipt layer attributes revenue by recorded quantity and COGS by recorded layer value, preserving the captured movement-cost total and recalculating each layer's margin. Incomplete allocation coverage remains unattributed rather than assigning all revenue to the known layers. Ordinary Detail does not repeat the full selling amount for each layer.

### Reconcile accounting COGS

Reconciliation shows the **full unfiltered movement period** used by accounting alongside the selected report movement figure. It separately identifies historical exclusions, orphaned movements, non-stock costs, missing/unexplained zero costs, corrections outside accounting movement types, stock events outside the selected sale period and allocation rounding differences. Report filters do not change the displayed full accounting-period total.

This report does not post accounting entries or change inventory.

## Data availability

All requested columns are available for inspection and filtering, but **Not recorded** means there is no verified value to display. Live invoice dates, sales-rep assignments, dispatch dates and confirmed delivery dates are not inferred. POS cashier is separate from sales rep; POS references are not individual accounting invoices. Shipment date identifies the recorded stock fulfilment timestamp, not a delivery confirmation. Brand is current catalogue metadata.

Imported history lacks captured tax, currency and cost evidence needed for verified financial margin. It remains visible in Invoice / sale date results with its recorded quantity and invoice date, but incomplete financial figures.

Supplier batch/lot labels are not recorded. FIFO layer references are internal costing evidence, not physical-lot or recall guarantees. Average Cost does not identify which purchasing receipt supplied a sale. Transfers may show a parent layer rather than a direct purchase reference.

Legacy duplicate POS SKU lines can be combined into one document/SKU record. Ambiguous historical line matches stay unresolved. When a manager edit or stock correction lacks the original financial snapshot, affected movement rows show cost only rather than applying today's selling amounts to old movements.

## Troubleshooting

| Symptom | Explanation | Action |
|---|---|---|
| GP or COGS is Not recorded | Missing cost, incomplete fulfilment or missing financial/FX evidence | Inspect the source and evidence status |
| Stock-date and sale-date totals differ | Shipments and sales happened in different periods | Compare both dates and Reconciliation |
| Refund reduces sales but not COGS | Credit did not restock inventory | Confirm the credit's restock choice |
| Layer totals differ slightly from movement cost | Captured composite cost and allocation precision differ | Review the rounding difference |
| Accounting differs from filtered report | Different scope, eligible movement types or exclusions | Compare the full-period figure and exception counts |
| The date range is too large | More than 50,000 source records or too many allocations match | Run narrower periods; no figures are silently truncated |

## Worked examples

### Discounted sale

A tax-inclusive $110 sale receives an $11 discount. Sales excluding GST are $100, Discount is $10, Net Sales are $90 and GST is $9. With captured COGS of $50, GP is $40 and GP% is 44.44%.

### Partial fulfilment across months

An order for ten units has $900 net merchandise value. Three units ship in September and seven in October. Stock-movement results attribute $270 to September and $630 to October, together with each shipment's captured costs. Sale-date results show $900 on the source sale date, with incomplete COGS until all ten units have matched cost evidence.

### Refund without restocking

A $100 net credit is completed without restocking. Net Sales decrease by $100, but inventory and stock COGS do not change. Its financial-only row has zero stock COGS, not a fabricated cost reversal.
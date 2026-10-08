---
{"id":"ims-cogs-traceability","title":"Sales and COGS Traceability","audiences":["ims"],"capability":"navigation","screen":"Reports > Sales & COGS Traceability","product":"ims","format":"task","parentId":"ims-operational-reports","contexts":["report-cogs-traceability"],"contextSections":{"report-cogs-traceability":"Main operations"},"relatedTopics":["ims-operational-reports","ims-report-guide","ims-inventory-costing","ims-bookkeeper-audit"],"order":62,"summary":"Trace sales, returns and captured COGS by channel, product and stock location, inspect FIFO receipt evidence, and reconcile accounting-period differences.","lastReviewed":"2026-10-08","owner":"reporting","quickSections":["Main operations","At a glance","Before you begin"]}
---
# Sales and COGS Traceability

## Main operations

Open **Reports > Sales & COGS Traceability**. Start with **Summary** grouped by Sales Channel, then use **Detail** to inspect individual sales and stock events. **Reconciliation** compares recorded stock costs with the accounting COGS period.

Use **Xero Postings** to review COGS journal runs, reconcile each accounting period, verify displayed journal statuses with Xero and open the actual journals. Opening the tab is read-only; scheduled or authorised posting workflows create journals separately.

- Choose the date preset or custom range at the right, and select the date basis.
- Use the labelled Order ref, Product / SKU, Channel and Location controls. Brand, Customer Name and Sales Order Status are under **More filters**. Empty controls do not narrow the results; **Clear filters** resets them.
- In Summary, group by channel, channel instance, location, brand, SKU, customer or receipt layer, using up to four levels.
- Review captured COGS even when another record has missing costs. **Partial** means the displayed amount is the known subtotal, not complete COGS.
- Review partial Sales, Net Sales and covered GP without mistaking them for complete totals. Unavailable rows remain visible as exceptions rather than blanking every known amount in their group.
- Use the column chooser in Detail to reveal additional requested fields.
- Inspect transaction evidence for source references and recorded FIFO allocations.
- In Xero Postings, inspect a period to see original and adjustment journals, recorded statuses, cost checks and **View journal** links.
- Export CSV after checking the filters. CSV includes every matching record or group and all report fields, not only the current page or visible columns.

## At a glance

| Figure or field | Meaning |
|---|---|
| Qty Sold | Signed sold, fulfilled or credited quantity according to the date basis |
| Sales | Merchandise selling value before recorded discounts, excluding GST |
| Discount | Sales less Net Sales; signed consistently with returns |
| Net Sales | Selling value after discounts, excluding GST |
| COGS | Tax-exclusive AUD cost captured on matched stock movements |
| Captured COGS / Partial | Known captured costs only when other costs or fulfilments are incomplete; never an estimate for missing records |
| GP | Net Sales minus COGS; unavailable when either figure is incomplete |
| GP % | Total GP divided by total Net Sales; blank when Net Sales is zero |
| Tax/GST | GST shown separately from Net Sales |
| Warehouse Location | Location attached to the stock event, or document location in sale-date results |
| Receipt Layer / Batch | Internal FIFO cost-layer reference and purchase-order reference where directly recorded |
| Invoice Status | Last verified accounting invoice status when available; not payment or sync status |

All primary financial totals are AUD. Original document-currency Net Sales and GST are separate columns. Foreign sales use the recorded exchange rate, never today's rate. Original-currency totals are unavailable when a group mixes currencies.

Missing costs do not hide the costs that are known. The screen shows the captured subtotal marked **Partial**; CSV keeps **COGS (AUD)** for complete costs and **Captured COGS (AUD)** for the known amount. GP and GP% remain unavailable when the full cost or revenue is incomplete. If no costs are known, the screen shows **Not recorded**, not an assumed zero.

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

**Invoice / sale date** uses the recorded invoice date for imported history and completion/order date for live sales where invoice date is not recorded. It shows the source line's revenue and matched costs across stock dates. An incompletely fulfilled line retains the captured cost of completed stock events as a partial subtotal, without assuming a cost for outstanding units. Credit reversals appear on their recorded reversal date.

### Trace the recorded cost

1. Open Detail and find the source reference or SKU.
2. Inspect its transaction evidence and source record.
3. Check the stock movement reference, date, location and cost method.
4. Under FIFO, review the allocated quantities, recorded unit costs, layer dates and available purchase-order references.
5. Check evidence warnings for aggregated POS SKU lines, legacy ambiguous matches, historical imports or cost-only corrections.

Grouping or filtering by FIFO receipt layer attributes revenue by recorded quantity and COGS by recorded layer value, preserving the captured movement-cost total and recalculating each layer's margin. Incomplete allocation coverage remains unattributed rather than assigning all revenue to the known layers. Ordinary Detail does not repeat the full selling amount for each layer.

### Reconcile accounting COGS

Reconciliation shows the **full unfiltered movement period** used by accounting alongside the selected report movement figure. It separately identifies historical exclusions, orphaned movements, non-stock costs, missing/unexplained zero costs, corrections outside accounting movement types, stock events outside the selected sale period and allocation rounding differences. Report filters do not change the displayed full accounting-period total.

Opening or refreshing this report does not post accounting entries or change inventory.

### Review Xero journal postings

1. Select **Xero Postings** and choose the date range.
2. Review the accounting periods overlapping that range. Each row reconciles its complete stock-movement period, including dates outside a partial selection. Sales filters and Invoice / sale date do not apply here.
3. Compare **Current eligible COGS** with the Xero posted total. Displayed journals with references are checked directly with Xero when the tab loads. If that check is unavailable, the total is clearly labelled as recorded and unverified.
4. Review **Recorded drafts** separately. Draft, voided, deleted and uncertain runs are not counted as posted. A draft with a zero net amount can still require review.
5. Inspect the period to review each run's journal date, run delta, current or recorded Xero state, target amount, recorded cost checks, creation time and saved journal line-item snapshot. A run delta is the amount associated with the attempt, not proof that a journal was created or posted. A failed or pending run may not have a journal reference.
6. Use **View journal** to confirm the actual journal and its current status in Xero. The link opens in a new tab and requires access to the correct Xero organisation.
7. Check current missing and unexplained-zero costs and excluded movements. **Journal line-item snapshot** is the immutable location-channel delta saved for that run. The separate current location/accounting-channel breakdown is recalculated from current evidence. Legacy runs created before snapshots show that no line-item snapshot was captured rather than inventing one.

The tab attempts a live Xero status check for every displayed run with a journal reference. A provider or connection failure leaves the recorded state visible but labels it unverified. A numerical match does not prove that costs are complete or that the wider general ledger reconciles. Missing costs and uncertain runs remain flagged even when amounts match.

The date range is an accounting-period overlap filter, not a journal-date or run-created-date filter. All recorded runs belonging to each matching period are included. Periods with no recorded run are not listed; an empty list does not certify that COGS has been posted. If different posting schedules overlap, review the periods separately rather than adding their current COGS totals together.

Investigate a difference before deciding on an accounting adjustment. This report does not retry, create, post or void journals, change automation or fix cost evidence. Historical failed attempts remain visible even when a later run reconciles. Use **Xero > Activity > COGS** for authorised retry and changed-period adjustment actions after reviewing this evidence. Sales CSV export is available in the sales views, not Xero Postings.

### What triggers COGS journals?

Automatic COGS sync is scheduled daily at approximately **03:17 AEST / 04:17 AEDT**. This daily check does not mean a journal is created every day: the business's selected frequency is daily, weekly, monthly or quarterly, and only completed business-local periods are eligible. For example, a monthly September period first becomes eligible after September closes.

The schedule must be enabled, have a first reliable COGS date, have no unresolved schedule hold, and the business's automation must not be paused. Automatic sync is disabled by default; the default frequency is monthly. The daily check can catch up to eight due periods, but a missing/unexplained-zero cost block, failed request or uncertain posting result puts the schedule on hold and stops it progressing.

Enabling or changing a schedule starts it with the current period, which must close before it is eligible. It does not automatically backfill previously completed periods. An authorised user can separately request an eligible completed period through the Xero COGS posting workflow; normal cost checks and duplicate-run protection still apply.

Sales completion and opening or refreshing this report do **not** trigger COGS journals. A completed eligible period with no change to its verified posted total does not create another journal. Existing drafts are not treated as posted and stop duplicate automatic creation until reviewed.

Future COGS journals are requested from Xero as **POSTED** manual journals. Each location-accounting-channel amount creates a balanced pair: debit COGS and credit Inventory Asset for positive COGS, reversed for a negative adjustment. Examples include **Warehouse - Shopify / Online**, **Warehouse - B2B**, **Newtown - POS** and **QVB - POS**. Available Xero tracking mappings are applied to each pair. Returns remain a separate accounting channel.

Each run saves the exact line-item deltas used. Later adjustments compare current location-channel totals with prior saved posted buckets and send only each bucket's change. An older posted journal without a saved split remains **Prior unsplit journals** in the first split adjustment; Solvantis does not invent a historical branch allocation or rewrite the old journal.

One row in Xero Postings represents one accounting period, not necessarily one journal. Expand it to see all recorded original and adjustment attempts. Periods without a recorded attempt are absent, and the current **Cost checks blocked** label does not by itself prove that automatic scheduling is held: check the saved schedule state before concluding why later periods are missing.

## Data availability

All requested columns are available for inspection and export; everyday filters are limited to the seven business dimensions listed above. **Not recorded** means there is no verified value to display. Live invoice dates, sales-rep assignments, dispatch dates and confirmed delivery dates are not inferred. POS cashier is separate from sales rep; POS references are not individual accounting invoices. Shipment date identifies the recorded stock fulfilment timestamp, not a delivery confirmation. Brand is current catalogue metadata.

Imported history lacks captured tax, currency and cost evidence needed for verified financial margin. It remains visible in Invoice / sale date results with its recorded quantity and invoice date, but incomplete financial figures.

Supplier batch/lot labels are not recorded. FIFO layer references are internal costing evidence, not physical-lot or recall guarantees. Average Cost does not identify which purchasing receipt supplied a sale. Transfers may show a parent layer rather than a direct purchase reference.

Legacy duplicate POS SKU lines can be combined into one document/SKU record. Ambiguous historical line matches stay unresolved. When a manager edit or stock correction lacks the original financial snapshot, affected movement rows show cost only rather than applying today's selling amounts to old movements.

## Troubleshooting

| Symptom | Explanation | Action |
|---|---|---|
| GP or COGS is Not recorded | Missing cost, incomplete fulfilment or missing financial/FX evidence | Inspect the source and evidence status |
| COGS shows Partial | Other contributing records lack complete captured costs | Use Detail to inspect those records; do not treat the subtotal as full COGS |
| Stock-date and sale-date totals differ | Shipments and sales happened in different periods | Compare both dates and Reconciliation |
| Refund reduces sales but not COGS | Credit did not restock inventory | Confirm the credit's restock choice |
| Layer totals differ slightly from movement cost | Captured composite cost and allocation precision differ | Review the rounding difference |
| Accounting differs from filtered report | Different scope, eligible movement types or exclusions | Compare the full-period figure and exception counts |
| Recorded posted is lower than current COGS | Draft/voided journals, changed cost evidence, uncertain runs or a genuine difference | Inspect the period, then confirm each linked journal in Xero before taking action |
| No posting runs are listed | No recorded accounting period overlaps the range, or posting history is not configured | Widen the range and check the business's COGS posting setup; do not assume there is nothing to post |
| The date range is too large | More than 50,000 source records or too many allocations match | Run narrower periods; no figures are silently truncated |

## Worked examples

### Original and adjustment journal reconciliation

An original posted journal has $1,000 of COGS and a later posted adjustment has -$100. Recorded posted is $900. If current eligible COGS is $950, the difference is $50. A separate $50 draft is displayed in Recorded drafts but does not reduce that difference. Confirm the journals' current states in Xero and review cost checks before deciding what to do.

### Discounted sale

A tax-inclusive $110 sale receives an $11 discount. Sales excluding GST are $100, Discount is $10, Net Sales are $90 and GST is $9. With captured COGS of $50, GP is $40 and GP% is 44.44%.

### Partial fulfilment across months

An order for ten units has $900 net merchandise value. Three units ship in September and seven in October. Stock-movement results attribute $270 to September and $630 to October, together with each shipment's captured costs. Sale-date results show $900 on the source sale date. If the first three units have captured costs of $150, the report shows $150 **Partial** until all ten units have matched cost evidence; it does not hide that $150 or invent the remaining cost.

### Refund without restocking

A $100 net credit is completed without restocking. Net Sales decrease by $100, but inventory and stock COGS do not change. Its financial-only row has zero stock COGS, not a fabricated cost reversal.
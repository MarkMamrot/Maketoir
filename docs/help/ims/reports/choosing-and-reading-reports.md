---
{"id":"ims-report-guide","title":"Choosing and Reading IMS Reports","audiences":["ims"],"capability":"navigation","screen":"Reports","product":"ims","format":"task","parentId":"ims-operational-reports","contexts":["report-sales-detail","report-sales-by-branch","report-sales-summary","report-sales-search","report-inventory-valuation","report-product-margin","report-pos-price-changes","report-pos-registers","report-stock-availability"],"contextSections":{"report-sales-detail":"Sales Detail: compare products and branches","report-sales-by-branch":"Sales Detail: compare products and branches","report-sales-summary":"Sales Summary: compare grouped sales","report-sales-search":"Sales Search: review variant sales totals","report-inventory-valuation":"Inventory Valuation: review stock value at a date","report-product-margin":"Product Profitability: review recorded profit and evidence","report-pos-price-changes":"POS price changes: review recorded unit-price overrides","report-pos-registers":"Daily POS Registers: review sessions and counted takings","report-stock-availability":"Stock Availability: review open-order supply and promises"},"relatedTopics":["ims-operational-reports","ims-cash-banking","ims-cash-banking-report","ims-inventory-costing","ims-location-stock-operations","ims-stock-allocation-backorders","ims-sales-orders-fulfilment","pos-end-of-day","pos-end-of-day-xero"],"order":61,"summary":"Choose and filter sales, demand, valuation and register reports, review recorded product profitability and incomplete evidence, and check export scope.","lastReviewed":"2026-10-14","owner":"reporting","quickSections":["Main operations","At a glance","Export scope by report"],"navigation":{"category":"reports","label":"Filter reports and compare results","sections":[{"heading":"Sales Detail: compare products and branches","label":"Compare product sales across branches"},{"heading":"Sales Summary: compare grouped sales","label":"Compare sales by location, brand or time"},{"heading":"Sales Search: review variant sales totals","label":"Search variant sales and source quantities"},{"heading":"Inventory Valuation: review stock value at a date","label":"Review current or past-date inventory value"},{"heading":"Product Profitability: review recorded profit and evidence","label":"Review recorded product profit and evidence"},{"heading":"Stock Availability: review open-order supply and promises","label":"Review unsourced demand and customer promises"},{"heading":"POS price changes: review recorded unit-price overrides","label":"Review POS unit-price changes"},{"heading":"Daily POS Registers: review sessions and counted takings","label":"Review register sessions and till variances"}]}}
---
# Choosing and Reading IMS Reports

Use this guide to choose a report, understand what its dates and money mean, and trace a total back to source activity.

## Main operations

- Write down the question before choosing the report.
- Align date range, location, status, and GST treatment.
- Use detail rows to explain summary totals.
- Distinguish current stock cost from cost recorded on historical sales or movements.
- Ask Assistant to compare sales by active location for a rolling period when a concise live summary is enough.
- Review the on-screen result before exporting.
- Wait for loading to finish and resolve any displayed error. Some reports retain rows from the last successful load; those are not proof that the new filters succeeded.

For Xero-enabled businesses, use **Cash Banking** Help for preparation and lodgement under Finances, and **Cash Banking Report** Help for reviewing deposits, posting outcomes and correction notes. These are different workspaces.

## At a glance

| Business question | Best starting report | Read next when needed |
|---|---|---|
| Which products sold and where? | Sales Detail | Sales Search for variant totals split by source |
| How do locations compare? | Sales Summary grouped by Location | Sales Detail for product-level branch columns |
| What drives sales by brand, supplier, type, day, or hour? | Sales Summary | Sales Search for product/variant source quantities |
| Which variants sold in a period? | Sales Search | POS Sales or the relevant Sales Order for individual transactions |
| What is stock worth now or at a past date? | Inventory Valuation | Stock Levels and receipt history |
| What margin was recorded? | Sales Summary or Sales & COGS Traceability | Sale and movement history for cost coverage |
| What was each product's recorded profit in a period? | Product Profitability Margin | Check captured-cost and revenue evidence; incomplete totals are unavailable |
| Can each sale be traced to captured COGS and stock location? | Sales & COGS Traceability | Detail evidence and Reconciliation |
| Is a recorded POS unit-price change expected? | POS Price Changed Transactions | Product and sale source |
| What happened in a register session? | Daily POS Registers Report | POS Sales and End of Day records |
| Does recorded banking match cash handling and Xero outcomes? | Cash Banking Report | Register and deposit references |
| Which open customer orders need supply or promise review? | Stock Availability | Stock Allocation, Sales Orders and Purchase Orders |

## Before you begin

- [ ] Confirm the business date or period you intend to answer.
- [ ] Decide which branches and transaction types belong in the comparison.
- [ ] Note whether the external figure includes GST.
- [ ] Use the same filters on both reports before comparing them.
- [ ] Keep source records unchanged while investigating a reporting difference.

> **Note:** A preset such as **90 Days** is a rolling window ending on the current reporting date. A custom range uses the entered start and end dates, including both boundary dates.

## Step-by-step

### Choose and run a report

1. State one question, such as “What did Sydney sell last month?”
2. Use the chooser table to open the narrowest report that answers it.
3. Select a preset or custom date range where the report offers one.
4. Apply the same locations, storefront or channel, statuses, search terms, and groupings required by the question.
5. Read column subtitles such as **Inc. GST**, **Ex. GST**, **Attached**, or **Current**.
6. Trace at least one representative row to its source before explaining a difference.
7. Export only when the filtered screen answers the intended question.

## Sales Detail: compare products and branches

Use **Reports > Sales Detail** for product-level quantities and sales values, including branch columns. An older **Sales by Branch** link opens this same report; it is not a separate report to reconcile.

1. Choose **All Branches** for a side-by-side comparison, or select one branch for a narrower question.
2. Select the shared date preset or custom range. For a calendar-month question, use **Previous Month** rather than a rolling number of days.
3. Leave **All channels** selected for the report's combined sources, or choose one exact Shopify store.
4. Use the product/SKU search, **Brand** and **Supplier** filters as needed.
5. Read the branch quantity and sales-value columns alongside the selected-results totals. Sales values include GST; current stock columns are not stock as at the end of the sales period.
6. Page through the results when inspecting individual products. Use **Sales Search** for variant totals by source, or POS Sales and the relevant Sales Order to inspect individual transactions.
7. Select **Export CSV** only after checking the export scope below.

**Sales Detail export scope:** CSV contains the product rows on the currently displayed page, plus **TOTALS (ALL SELECTED)** for the full filtered result. With several pages of products, the exported detail rows therefore will not add up to that full-result total. Export each required page separately if you need those product rows; do not add the repeated full-result totals together.

## Sales Summary: compare grouped sales

Use **Reports > Sales Summary** for aggregated results rather than individual product or sale rows.

1. Set the shared date preset or custom range.
2. Choose a **Store** if you need one exact storefront; otherwise retain the combined-channel selection.
3. Choose **First heading**. Options are **Store / Channel**, **Location**, **Supplier**, **Brand**, **Product Type**, **Day of Week** and **Hour of Day**.
4. Add a different **Second heading** only when you need a second level of comparison. For example, **Location** followed by **Brand** compares brands within each location.
5. Leave **All Locations** selected for a business comparison, or choose the relevant locations.
6. Read **Sales Qty** and **Sales Amount Inc. GST**, then review **Attached COGS Ex. GST**, **GP Ex. GST**, **GP% Covered Sales** and **COGS Coverage** together.
7. Use **TOTALS (ALL SELECTED)** for the full filtered result, not just the current page. **Current SOH** is current stock, not stock at the historical period end.
8. Use **Export CSV** for all matching grouped rows across all pages with these filters and headings.

When all locations are included and **Location** is a heading, **ALL** rows roll up the location detail. Do not add an ALL row to its individual location rows; that counts the same sales twice. Use the report's full-result totals.

> **Important:** Gross profit and covered-sales margin use only sales whose full sold quantity has recorded movement cost. Coverage below 100% means the profit figure is incomplete, not that the missing sales had zero cost.

## Inventory Valuation: review stock value at a date

Use **Reports > Inventory Valuation** to review stock value across all locations. **As at date** defaults to **Today** in the business timezone. There is no branch selector.

1. Leave **As at date** on **Today** for the existing live valuation: current stock and current Average Cost or remaining FIFO layers. No historical reconstruction runs for today.
2. Select **Yesterday** or **Custom Date** for stock at the end of a past day in the business timezone. Future dates cannot be selected.
3. Use **Product / SKU**, **Supplier**, **Brand** and **Type** filters to select the required stock. Clearing catalogue filters keeps the selected date.
4. Check **Total Inventory Value** and **Unique SKUs Counted** against the loaded rows. Past-date results include products since deactivated where stock existed then, even if today's stock is zero.
5. Read the cost basis below each historical unit cost. **Historical cost** uses available recorded costing history. **Today's cost (estimate)** means reliable historical cost was unavailable and the row uses today's cost instead. **Cost unavailable** means no valid cost was found; its quantity remains visible but no monetary value is included.
6. Review inferred-opening, incomplete-history, negative-stock and FIFO mismatch warnings with **Stock History** and source documents before relying on the total.
7. Use **Export CSV** after loading succeeds. It includes all loaded filtered rows, the report date, timezone, cost basis and inferred-opening indication. The filename uses the loaded date.

Past quantities use opening stock and recorded physical movements through the selected day. On-order approvals and reservations do not count as physical stock. Where no dated opening stock is available, opening quantities are inferred from the available stock and movement records and marked with an asterisk. Unrecorded stock overwrites, permanently deleted records and missing historical costs cannot be recovered by the report. Do not treat an inferred or fallback result as an exact historical accounting snapshot.

Catalogue names and product filters use current information, not historical descriptions. For a quantity question at one branch, start in **Stock Levels**. A later receipt may change today's valuation without changing an earlier sale's attached cost.

## Sales Search: review variant sales totals

Use **Reports > Sales Search** to find product variants with sales activity in a period. Each row is an aggregate for one variant, not an individual receipt, customer or order.

1. Choose **All channels** or one exact Shopify store where available. You can change stores after applying filters; the dates, search text and page size are preserved, and results return to page one.
2. Set the shared date preset or custom range. The initial period is **90 Days**.
3. Type in **Search product name or SKU**. Partial words are supported, and every entered word must match either the product name or SKU. Check the displayed option and SKU to distinguish sizes and colours.
4. Read **Units Sold** and **Revenue** alongside **POS**, **Online**, **Wholesale** and **History**. The four source columns show quantities, not revenue. Imported history has its own column even when its original sale was in-store or online.
5. Use the summary beside the filters for the number of matching variants, units and revenue across the full result.
6. Page through results as needed. When paging controls are present, page-size choices are **25**, **50**, **100** and **200**. Select **Product**, **SKU**, **Brand**, **Units Sold** or **Revenue** headings to sort the current page only.
7. Use **Clear** to remove search text, or **Export CSV** to download the currently displayed, sorted page.

**Scope and limitations:**

- There is no branch selector or transaction drilldown in this screen. Use Sales Detail for branch comparisons and POS Sales, POS Reports or the relevant Sales Order for a particular transaction.
- Eligible Sales Orders contribute their ordered quantities and line amounts even if fulfilment is incomplete. The live POS source includes completed ordinary sales, not POS return transactions. Do not use this report as proof of shipment or a net-refund/register reconciliation.
- Revenue sums the source line amounts and is labelled **inc. GST** in CSV. Check the source order's tax treatment when reconciling an external figure rather than assuming the report has normalised every source.
- Changing the channel applies the visible date range, search and page size to the new store and returns to page one. Sorting remains a current-page operation. Wait for the new results before exporting; failed loads show an error rather than retaining an exportable earlier-store result.
- CSV has current-page rows only, with no full-result totals row. Sorting a page by Revenue does not rank the entire filtered result by Revenue.

## Product Profitability: review recorded profit and evidence

Open **Reports > Product Profitability Margin**. The screen heading is **Product Profitability**; older references call it Product Margin.

This report groups recorded sales and returns by product variant. Revenue is net of recorded line and document discounts, converted to AUD using the recorded exchange rate and shown excluding GST according to the source tax treatment. COGS comes from captured stock-movement costs, not today's catalogue unit cost.

1. Use **Product / SKU**, **Supplier**, **Brand** and **Type** to select the intended products.
2. Choose a shared date preset, previous calendar period or custom range. The initial range is **12 Months**. There is no branch or storefront selector in this report.
3. Read **Net Qty**, **Net Rev ex GST**, **Captured COGS**, **Gross Profit ex GST**, **Margin %** and **Evidence**. Returns reduce quantities and revenue; an eligible credit reversal restores them.
4. Review the **Net Revenue**, **Captured COGS**, **Gross Profit** and **Blended Margin** cards for **all matching products**, not only the displayed page. Check the exact date bounds and any incomplete-evidence warning.
5. Page through the results, with **100 per page**. Complete profits are ordered highest first; incomplete profits follow. Product name and classification are current catalogue metadata, including inactive products with recorded activity.
6. Use **Export CSV** for the current page only. CSV includes historical net revenue, captured COGS, profit, margin and evidence counts. Unknown amounts are blank; catalogue unit price and unit cost are not substituted.

| Label | Current calculation |
|---|---|
| Net Rev ex GST | Recorded product-line revenue after discounts and source tax/currency conversion |
| Captured COGS | Historical movement costs, including supported return cost reversals; unavailable when cost evidence is incomplete |
| Gross Profit ex GST | Net revenue less captured COGS; unavailable if either is incomplete |
| Margin % | Gross profit divided by net revenue; unavailable with incomplete evidence or zero net revenue |
| Blended Margin | Full filtered-result gross profit divided by full filtered-result net revenue, subject to the same completeness rules |

> **Important:** Missing evidence is not zero. If any contributing record lacks complete captured cost, that product's COGS, profit and margin are unavailable. Missing tax/currency evidence also withholds net revenue. Affected full-result cards are unavailable rather than silently excluding those records or estimating from today's catalogue.

The period follows sale/order dates and credit completion/reversal dates, not shipment or accounting-posting dates. Eligible unfulfilled Sales Orders can have recorded revenue but incomplete COGS. Imported history remains visible by quantity but lacks reliable captured tax/currency/cost evidence, so its financial margin is unavailable. Live sources exclude mirrored imported records, staff-preview orders and draft/cancelled orders.

Product-level totals exclude records without a product identity, including document freight and rounding adjustments; the screen reports their count. Use **Sales & COGS Traceability** to inspect source lines, missing costs and non-product adjustments. A range exceeding the source-record limit must be narrowed; no figures are silently truncated.

Changing today's catalogue price or cost does not rewrite historical amounts. Current product names and classification can change labels or which products match a filter.

## Stock Availability: review open-order supply and promises

Use **Reports > Stock Availability** for outstanding stock-item demand on confirmed, partially fulfilled and backordered non-online Sales Orders. It excludes Draft, cancelled, historical and online orders. It is not a general on-hand-stock report.

1. Review the **Unsourced**, **Ready to fulfil**, **Protected incoming** and **Promise exceptions** cards.
2. Find the relevant **SO**, **Customer**, **Product** and **Location** row. Product shows the SKU beneath the name.
3. Read the outstanding demand split using the table below. Check the sales values separately from the incoming PO cost.
4. Review **Promise** and **Risk**. Overdue means a remaining protected allocation has a saved promise date before today. At risk reflects a remaining allocation marked at risk. If both apply, the row shows **Overdue** first.
5. Note the Sales Order number and open it separately under **Sales > Sales Orders**. Use **Stock Allocation** to review or protect eligible supply; use the Purchase Order to investigate receipt timing.
6. Use **Refresh report** after the underlying order, allocation, receipt or fulfilment changes.

| Quantity or value | What it means in this report |
|---|---|
| Unsourced | Outstanding demand without remaining protected allocation; it does not prove there is no stock on hand |
| Sales value | Unsourced quantity at the discounted customer price, including tax |
| Ready | Remaining protected allocation already received and assigned, capped at outstanding demand |
| Ready value | Ready quantity at the discounted customer price, including tax |
| Incoming | Protected allocation still awaiting receipt, not every incoming PO unit |
| PO cost | Protected incoming supply's discounted PO cost, converted to AUD and excluding tax |
| Promise | Earliest saved customer promise date among remaining protected allocations, not automatically the order's required date or supplier ETA |

The three quantity buckets **Unsourced**, **Ready** and **Incoming** make up the remaining demand for a row. Do not add their money columns as a sales total: Sales value and Ready value use customer selling amounts, while PO cost uses supplier cost.

**Promise exceptions** counts distinct Sales Orders, not product rows. One order with several overdue lines counts once; overdue and at-risk counts can overlap. A dash in Risk does not prove that unsourced demand can meet the customer's required date.

This report has no search, branch/date filters, pagination or CSV export control. It is read-only: the SO number is a reference, not an allocation or fulfilment action. Use **Stock Levels** for general on-hand and available quantities, and **Stock Allocation and Customer Backorders** Help for the operational sourcing workflow.

## POS price changes: review recorded unit-price overrides

Open **Reports > POS Price Changed Transactions** to review completed POS item lines whose saved unit price differs from their captured original price. This is not a list of every discount or every intermediate edit.

1. Select the shared date preset or custom range. The initial period is **90 Days**; filtering uses the POS completion date.
2. Wait for the result to load without an error, then review **Sale #**, **Item**, **Date**, **Time**, **Location**, **Cashier** and **SKU**.
3. Compare **Original Price** with **Changed To**. These are unit selling prices, not a whole-sale total. The original price is the captured value for that item, not today's catalogue price.
4. Use Sale # and the location to find the transaction in POS Sales or POS Reports. Review its quantity, other discounts and actual tender before explaining the total financial effect.
5. Use **Export CSV** for all loaded rows in the chosen date range, ordered newest first.

There is no branch, cashier or product search filter, pagination or transaction-opening action in this report. Several changed items on one sale produce several rows, so the result count is changed item lines rather than distinct sales.

Only lines with a saved original price and a different saved unit price appear. A missing row does not prove that no discount occurred. The recorded cashier is not evidence of which manager approved a change, and the report does not include an approval reason. Prices display to cents; a very small saved precision difference can appear unchanged at that display precision.

## Daily POS Registers: review sessions and counted takings

Open **Reports > Daily POS Registers Report** for register sessions assigned to one trading date across the business's locations. Sessions are selected by their session date, not necessarily the calendar date when they closed.

1. Choose **Date**, then select **Run**. Run after changing the date, and confirm the loaded result before exporting; changing Date alone does not refresh the sessions.
2. Review **Location**, **Register**, **Status**, **Opened**, **Opened By**, **Float**, **Closed** and **Closed By**.
3. Read each **Payment Method**, **Expected**, **Counted** and **Variance** row. Cash Counted includes the opening float; cash variance subtracts that float before comparing with Expected.
4. Treat a dash in Counted as no saved count, not a verified zero. **No reconciliation data** means no linked reconciliation rows were returned for that session; it does not prove no sales occurred.
5. Use the session's **TOTAL** row once. Do not add it to its payment-method detail rows.
6. Investigate source sales or complete missing counts through the actual POS register. This report does not open, close or reconcile the register.
7. Select **Export CSV** after Run completes. It includes all loaded sessions, their payment-method rows and a TOTAL row for each reconciled session.

### Correct an opening float

Administrators and SuperAdmins can select **Edit** beside **Float** for either an open or a closed session. Enter the verified opening amount and a reason, then select **Save opening float**. This corrects that session, not the register's default float. The original opening denomination breakdown is cleared because it no longer represents the corrected amount.

Cash reconciliation uses the corrected float, so its variance and the session total variance are recalculated. The counted drawer amount, expected takings, non-cash counts and sales remain unchanged. Do not change float merely to hide a real cash shortage.

For a closed session, acknowledge the warning before saving: any affected entries already synced to Xero or another accounting system must be edited manually by the bookkeeper. The correction does not trigger an accounting sync, replace posted documents or reset posting status. Accounting till-variance information can therefore show the original posted amount alongside the corrected Solvantis variance.

After saving a closed-session correction, select **Email bookkeeper about this correction**. Solvantis sends the register, branch, session date, old and new float, correction reason and cash variance details to the configured accounts recipients. Configure these under **Settings > General > Bookkeeping / Accounts email**; these are the same recipients used for accounting reconciliation emails. Email is a separate action, not automatic on save.

If emailing fails, the float remains saved. Reopen **Edit** and use **Email bookkeeper about last correction** to retry the latest closed-session notice without changing the float again. An already-sent notice is not sent a second time.

> **Important:** TOTAL Counted includes the physical cash float, while TOTAL Expected is payment takings. TOTAL Variance sums the already float-adjusted method variances. It is not simply TOTAL Counted minus TOTAL Expected.

There is no branch selector, search or pagination in this report. An overnight session may appear on its original trading date even when closure happened the next day. **End of Day and Register Close** Help explains the operational count and closure process.

When Xero is enabled, the screen and CSV add accounting information. An invoice link proves an invoice reference exists, not that every required clearing or variance action completed. A separate till-variance link or status records that accounting action. Use **POS End of Day and Xero** and Sync History to review posting rather than treating the register's Closed status as accounting success.

## Export scope by report

| Report | What its CSV contains |
|---|---|
| Sales Detail | Current-page product rows plus TOTALS (ALL SELECTED) for the full result |
| Sales Summary | All matching grouped pages |
| Sales Search | Current-page rows in their displayed sort order; no full-result totals row |
| Inventory Valuation | All loaded filtered rows |
| Product Profitability | Current-page rows only, with blank unknown amounts and evidence counts; summary cards cover the full filtered result |
| Stock Availability | No CSV export control in this report |
| POS Price Changed Transactions | All loaded changed-item rows for the selected period |
| Daily POS Registers Report | All loaded sessions and method detail, plus a TOTAL row for each reconciled session; optional accounting fields follow the business's settings |
| Cash Banking Report, when Xero is enabled | All loaded deposits with preparation, lodgement and posting details; correction notes are not included |

## Reading dates, tax and cost

### Understand report dates

| Source shown in sales reports | Date used for the sales period | Practical meaning |
|---|---|---|
| Imported historical sale | Invoice date | The recorded business date of the imported sale |
| POS sale | Completion date | When the POS transaction completed |
| Sales Order sale | Order date | The order's recorded order date |
| Product Profitability | Sale/order dates and credit completion/reversal dates | Recorded product revenue and captured cost; not a shipment-period COGS reconciliation |
| POS Price Changed Transactions | POS completion date | Completed item lines with different captured original and final unit prices |
| Daily POS Registers Report | Register session date | A session can close on a later calendar date without moving to that date's report |
| Cash Banking Report, when Xero is enabled | Lodgement date, or creation date before lodgement | Not the original source trading dates or later posting date |

Do not assume every report uses fulfilment date or accounting-posting date. Use the displayed source and date definition when comparing with Xero or another export.

### Compare tax and cost correctly

| Measure | Typical treatment | Use it for |
|---|---|---|
| Sales amount | Tax-inclusive where labelled **Inc. GST** | Customer-facing sales totals |
| Cost of goods sold | Tax-exclusive where labelled **Ex. GST** | Margin calculations |
| Gross profit | Tax-exclusive sale value less covered cost | Comparing profit on cost-covered sales |
| Current inventory cost | Current Average Cost or remaining FIFO layers | Today's inventory valuation |
| Historical attached cost | Unit cost recorded on the completed movement | Historical margin and cost of goods sold |

Product Profitability uses recorded tax-exclusive revenue and historical captured cost. Unlike cost-covered subtotal reporting, it withholds an affected product or full-result total when any contributing record lacks the required evidence.

| Cost question | Use current inventory cost? | Use historical attached cost? |
|---|---:|---:|
| What is stock on hand worth now? | Yes | No |
| What did this sale cost when recorded? | No | Yes |
| Why did today's receipt change valuation? | Yes | Review the receipt that changed it |
| Why is margin blank or only partly covered? | No | Check whether every sold quantity has recorded cost |

> **Important:** A later receipt can change current Average Cost or add a FIFO layer without rewriting cost already attached to an earlier sale or stock movement.

### Ask Assistant for a sales comparison

Assistant can compare tax-inclusive sales quantity and value across active locations for a rolling period of up to 365 days. It uses the same imported-history, completed POS sale, and eligible Sales Order sources as **Sales Summary** and does not return customer records.

Attached COGS and gross profit are reported only for sales whose full sold quantity has recorded movement cost. Always read **COGS coverage** with gross profit: coverage below 100% means the margin does not represent every sale in the period.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Two sales totals differ | Different source coverage, dates, locations, statuses, or GST treatment | Align each choice and compare source rows |
| Gross profit is blank | No covered sale value or incomplete cost coverage | Inspect attached cost and the source movements |
| COGS coverage is below 100% | Some sold quantity has no complete attached cost | Review the affected sales and movement history |
| Current valuation changed but an earlier attached cost did not | Current Average Cost or remaining FIFO layers changed after the historical sale | Use current method valuation and historical attached cost for that sale |
| Export differs from the screen you expected | Filters changed or export includes all selected pages or groups | Recheck active filters and totals before exporting |
| Sales Detail exported rows do not add up to its total | Detail export is the current page; the total covers all selected results | Export the required pages and use the full-result total only once |
| Adding Sales Summary location rows doubles the result | ALL rollups were added to their location detail | Use TOTALS (ALL SELECTED), or sum only the detail rows |
| Inventory Valuation is needed for last month | As at date defaults to Today | Select the last day of the month and review cost-basis and opening-stock warnings |
| Inventory Valuation shows today's-cost estimates or inferred stock | Historical cost or dated opening evidence is incomplete | Check Stock History and source documents; do not describe the estimate as an exact accounting snapshot |
| Inventory Valuation is needed for one branch | Valuation aggregates all locations | Use Stock Levels for branch quantities; this report has no branch selector |
| Sales Search cannot show a particular receipt | Rows aggregate activity by variant | Inspect POS Sales, POS Reports or the relevant Sales Order |
| Sales Search totals changed after switching stores | A different channel is selected; existing filters are preserved and results return to page one | Check the selected store and wait for loading; Clear removes search text only |
| Product Profitability shows Unavailable | Captured cost, tax or currency evidence is incomplete | Inspect Evidence and Sales & COGS Traceability; do not substitute current catalogue cost |
| Product Profitability differs from another margin report | Date basis, returns, product-only scope or completeness rules differ | Align source/date scope; full-result cards cover all matching products, not just the current page |
| Stock Availability says Unsourced although stock exists | Demand lacks protected incoming/received allocation | Review Stock Allocation and Stock Levels; do not create stock to make the report balance |
| Price-change result count exceeds the number of sales | Several changed items belong to the same sale | Count distinct Sale # values only when answering a sale-count question |
| Daily register rows still describe the earlier date | Date changed without Run | Run the intended date before exporting |
| Daily register Counted minus Expected differs from Variance | Counted includes cash float; variance already removes it | Use the method variances and the session TOTAL row without adding it twice |
| An overnight session is missing from the closure date | The report uses session date | Run its original trading date and inspect Opened and Closed |

## Worked examples

### Compare last month's branch sales

A manager chooses **Previous Month**, **All channels**, **First heading > Location** and no second heading in **Sales Summary**. They compare Sydney and Melbourne, checking COGS Coverage before discussing profit. They use **TOTALS (ALL SELECTED)** once and do not add the **ALL** rollup to the branch rows.

To see which products explain Sydney's result, they open **Sales Detail**, select Sydney and the same period and channel scope. If the result spans three pages, one Sales Detail CSV contains only that page's products, even though its totals row covers all selected products.

### Compare brands within locations

A buyer selects **First heading > Location** and **Second heading > Brand** in **Sales Summary**, using the same period and storefront throughout. This shows the brand mix at each location. CSV includes all matching grouped pages, but ALL rollups still must not be added to their component location rows.

### Value one brand's current stock

Staff leave **As at date** on **Today**, filter **Inventory Valuation** to **Coastal Home** and review the current method, counted SKUs and total value. They check any FIFO warning before exporting. The result is the same live valuation as before, across all locations.

### Value stock at month end

Ten units at $20 are followed by a receipt of five units at $26. Under Average Cost the 15 units are worth $330 at $22 each. If three units are sold before month end, the remaining 12 are worth $264. Staff select the month's last day; a later receipt does not change that recorded historical result.

Under FIFO, the same receipts followed by a sale of 12 consume the ten $20 units and two $26 units. Three units worth $78 remain. A return recorded after the selected day is not included at that earlier date.

If another product has six historical units but no reliable historical cost, and today's unit cost is $18, the report shows $108 labelled **Today's cost (estimate)**. An inferred opening-stock warning is a separate quantity limitation.

### Read Sales Search without mistaking totals for receipts

A candle variant shows **POS > 10**, **Online > 3**, **Wholesale > 2** and **History > 5**, giving **20 Units Sold**. That is one variant total, not 20 receipt rows. Staff open the relevant sales records separately when they need a customer's receipt.

If the filtered result spans three pages, the summary beside the filters covers all three. An export from page one contains only that page's variants.

### Calculate recorded product profit without GST or catalogue assumptions

Ten recorded sales at **$110 including GST** each have captured tax-exclusive costs of **$60**. With complete evidence and no discounts or returns, Product Profitability shows **10 Net Qty**, **$1,000 Net Revenue**, **$600 Captured COGS**, **$400 Gross Profit** and **40% Margin**.

Changing today's catalogue price to $132 or catalogue cost to $70 does not change those historical amounts. A recorded $110 total discount would reduce tax-exclusive revenue to $900 and profit to $300.

If one contributing sale lacks captured cost, the product's COGS, profit and margin show **Unavailable**. If an imported history record also lacks reliable tax/currency evidence, net revenue is unavailable too. The record stays visible; the report does not quietly calculate a complete-looking profit from the remaining sales.

### Separate unsourced, ready and incoming demand

An order still owes **8** units: **4 Unsourced**, **2 Ready** and **2 Incoming**. At a $55 tax-inclusive customer price with a 10% discount, Sales value for the unsourced units is **$198**, and Ready value is **$99**. If the two protected incoming units each cost $20 before tax in AUD, PO cost is **$40**.

The quantity buckets add to 8, but $198, $99 and $40 are not one comparable sales total. Staff review sourcing and the customer promise in Stock Allocation, then receive and fulfil through the actual operational documents.

### Review a changed unit price

A completed sale has two item lines with recorded price changes. The report therefore shows two rows with the same Sale #. One line changed from **$110** to **$99**, both including GST: an $11 unit-price reduction. Staff inspect the source sale's quantity and any further discounts instead of treating $11 as the whole transaction's difference.

### Read a register total without counting float as sales

A session has a **$200 Float**, **$618 Expected Cash**, **$818 Counted Cash**, and **$1,100 Expected and Counted Card**. Cash variance is $818 minus $200 minus $618, or zero; card variance is also zero.

The session TOTAL shows **$1,718 Expected**, **$1,918 Counted** and **$0 Variance**. The $200 difference between the raw totals is opening float, not a $200 overage. Staff use the TOTAL row once rather than adding it to the two method rows.

### Compare a tax-inclusive sale with tax-exclusive margin

A sale amount of $110 including GST has a tax-exclusive value of $100. If its attached tax-exclusive cost is $60, gross profit is $40. Comparing $110 directly with $60 would mix tax treatments and overstate gross profit.

### Separate current and historical cost

A jacket sale records an attached cost of $50. A later receipt changes the value of remaining stock under the active method. Inventory Valuation uses current Average Cost or remaining FIFO layers; the earlier sale keeps its $50 historical cost for margin reporting.

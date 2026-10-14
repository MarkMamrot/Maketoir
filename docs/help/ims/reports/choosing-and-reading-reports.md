---
{"id":"ims-report-guide","title":"Choosing and Reading IMS Reports","audiences":["ims"],"capability":"navigation","screen":"Reports","product":"ims","format":"task","parentId":"ims-operational-reports","contexts":["report-sales-detail","report-sales-by-branch","report-sales-summary","report-sales-search","report-inventory-valuation","report-product-margin","report-pos-price-changes","report-pos-registers","report-stock-availability"],"contextSections":{"report-sales-detail":"Sales Detail: compare products and branches","report-sales-by-branch":"Sales Detail: compare products and branches","report-sales-summary":"Sales Summary: compare grouped sales","report-sales-search":"Sales Search: review variant sales totals","report-inventory-valuation":"Inventory Valuation: review current stock value","report-product-margin":"Product Profitability: understand catalogue-based estimates","report-pos-price-changes":"POS price changes: review recorded unit-price overrides","report-pos-registers":"Daily POS Registers: review sessions and counted takings","report-stock-availability":"Stock Availability: review open-order supply and promises"},"relatedTopics":["ims-operational-reports","ims-cash-banking","ims-cash-banking-report","ims-inventory-costing","ims-location-stock-operations","ims-stock-allocation-backorders","ims-sales-orders-fulfilment","pos-end-of-day","pos-end-of-day-xero"],"order":61,"summary":"Choose and filter sales, demand, valuation and register reports, distinguish catalogue-based profit estimates from recorded margins, and check export scope.","lastReviewed":"2026-10-14","owner":"reporting","quickSections":["Main operations","At a glance","Export scope by report"],"navigation":{"category":"reports","label":"Filter reports and compare results","sections":[{"heading":"Sales Detail: compare products and branches","label":"Compare product sales across branches"},{"heading":"Sales Summary: compare grouped sales","label":"Compare sales by location, brand or time"},{"heading":"Sales Search: review variant sales totals","label":"Search variant sales and source quantities"},{"heading":"Inventory Valuation: review current stock value","label":"Review current inventory value"},{"heading":"Product Profitability: understand catalogue-based estimates","label":"Understand product profitability estimates"},{"heading":"Stock Availability: review open-order supply and promises","label":"Review unsourced demand and customer promises"},{"heading":"POS price changes: review recorded unit-price overrides","label":"Review POS unit-price changes"},{"heading":"Daily POS Registers: review sessions and counted takings","label":"Review register sessions and till variances"}]}}
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
| What is stock worth now? | Inventory Valuation | Stock Levels and receipt history |
| What margin was recorded? | Sales Summary or Sales & COGS Traceability | Sale and movement history for cost coverage |
| How do current catalogue price and cost compare for sold products? | Product Profitability Margin | Check its estimate formula and GST limitation below |
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

## Inventory Valuation: review current stock value

Use **Reports > Inventory Valuation** to review current stock value across locations. It is not a historical stock-at-date report and does not offer a branch selector.

1. Use **Product / SKU**, **Supplier**, **Brand** and **Type** filters to select the required stock.
2. Check **Total Inventory Value** and **Unique SKUs Counted** against the filtered rows.
3. Under **Average Cost**, compare on-hand quantity with the current shared cost and line value. Under **FIFO**, review the value of remaining receipt layers.
4. If a FIFO quantity mismatch warning appears, investigate it with **Stock Levels**, **Stock History** and the source documents before relying on the valuation.
5. Use **Export CSV** for all loaded rows matching the current filters.

For a quantity question at one branch, start in **Stock Levels**. Changing a sales date range elsewhere does not turn Inventory Valuation into a month-end valuation, and a later receipt may change current value without changing an earlier sale's attached cost.

## Sales Search: review variant sales totals

Use **Reports > Sales Search** to find product variants with sales activity in a period. Each row is an aggregate for one variant, not an individual receipt, customer or order.

1. Choose **All channels** or one exact Shopify store where available. Choose the channel before applying the other filters.
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
- Changing the channel can reload the default 90-day, unsearched result while earlier filter labels remain visible. Reapply the intended date range, search and page size after switching stores, and check the resulting totals before exporting.
- CSV has current-page rows only, with no full-result totals row. Sorting a page by Revenue does not rank the entire filtered result by Revenue.

## Product Profitability: understand catalogue-based estimates

Open **Reports > Product Profitability Margin**. The screen heading is **Product Profitability**; older references call it Product Margin.

This report estimates results using period sales quantity multiplied by current catalogue price and cost. It does not use the actual historical selling amount, sale discount or movement-attached cost.

1. Use **Product / SKU**, **Supplier**, **Brand** and **Type** to select the intended products.
2. Choose **7 Days**, **90 Days**, **180 Days** or **12 Months**. The default is **12 Months**, a 365-day quantity window. This screen does not offer a custom date picker, branch selector or storefront selector.
3. Read **Qty Sold**, **Gross Rev**, **COGS**, **Gross Profit** and **Margin %** using the formula table below, not the definitions for historical cost-covered profit.
4. Review the **Revenue**, **Gross Profit** and **Blended Margin** cards for the currently displayed page. The results count and page count describe the full filtered set, but the cards do not.
5. Page through the results, with **100 per page**. Rows are ordered by the report's estimated gross profit, not by a user-selected column sort.
6. Use **Export CSV** for the current page only. CSV includes the current **Unit Cost** and **Unit Price** used in the estimate.

| Label | Current calculation |
|---|---|
| Gross Rev | Current catalogue selling price multiplied by Qty Sold |
| COGS | Current catalogue unit cost multiplied by Qty Sold |
| Gross Profit | Gross Rev minus COGS |
| Margin % | Current price minus current cost, divided by current price; zero when price is not positive |
| Blended Margin | Current-page total estimated profit divided by current-page total estimated revenue; zero when revenue is not positive |

> **Important:** Catalogue selling prices include GST, while supplier costs are normally tax-exclusive. This report does not extract GST from selling price before subtracting cost. Its displayed profit and margin are therefore not a tax-exclusive accounting gross profit. Use **Sales Summary**, checking **COGS Coverage**, or **Sales & COGS Traceability** for recorded sale revenue and captured costs.

Editing today's catalogue price or cost can change this estimate for the same past quantity window. It does not mean an earlier sale's recorded revenue or attached cost changed.

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
| Product Profitability | Current-page rows only; its summary cards are also page-only |
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
| Product Profitability preset | Selected rolling sales-quantity window | Period quantity combined with current catalogue price and cost, not historical sale amounts |
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

These profit definitions apply to recorded cost-covered reporting. Product Profitability uses the catalogue-based estimate above and does not normalise its price and cost to a common GST basis.

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
| Inventory Valuation cannot be set to last month or one branch | This report shows current value across locations | Use Stock Levels for branch quantities; do not label current valuation as historical |
| Sales Search cannot show a particular receipt | Rows aggregate activity by variant | Inspect POS Sales, POS Reports or the relevant Sales Order |
| Sales Search totals changed after switching stores | The channel reload can use the default date/search scope | Reapply the intended dates, search and page size before relying on the result |
| Product Profitability differs from historical margin | It uses current price/cost and does not remove selling-price GST | Use recorded sales and attached costs in Sales Summary or Sales & COGS Traceability |
| Product Profitability cards change between pages | Cards total only the currently displayed rows | Do not treat one page's cards as the business-wide result |
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

Staff filter **Inventory Valuation** to **Coastal Home** and review the current method, counted SKUs and total value. They check any FIFO warning before exporting. The result covers current stock across locations, not Coastal Home's stock value at the end of the previous month.

### Read Sales Search without mistaking totals for receipts

A candle variant shows **POS > 10**, **Online > 3**, **Wholesale > 2** and **History > 5**, giving **20 Units Sold**. That is one variant total, not 20 receipt rows. Staff open the relevant sales records separately when they need a customer's receipt.

If the filtered result spans three pages, the summary beside the filters covers all three. An export from page one contains only that page's variants.

### Distinguish a catalogue estimate from recorded profit

A product's current selling price is **$110 including GST**, its current catalogue cost is **$60**, and Qty Sold is **10**. Product Profitability calculates **$1,100 Gross Rev**, **$600 COGS**, **$500 Gross Profit** and **45.5% Margin** from those catalogue values.

Those are the screen's estimate calculations, not a tax-exclusive profit. If all ten actual sales were $110 including GST and each had $60 of captured tax-exclusive cost, their tax-exclusive revenue would be $1,000 and recorded gross profit $400. Staff use cost-covered sales reporting to establish those historical amounts rather than treating the estimate as accounting evidence.

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

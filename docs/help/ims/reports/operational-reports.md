---
{"id":"ims-operational-reports","title":"IMS Reports","audiences":["ims"],"capability":"navigation","screen":"Reports","product":"ims","format":"overview","parentId":"ims-reports","contexts":["reports"],"contextSections":{"reports":"Report directory"},"relatedTopics":["ims-report-guide","ims-bookkeeper-audit","ims-inventory-costing","ims-consignment"],"order":60,"summary":"Choose the IMS report that matches your sales, stock, margin, register, or banking question; Consignment Activity appears after enabling Consignments.","lastReviewed":"2026-10-17","owner":"reporting","quickSections":["Main operations","Report directory","Reading results"],"navigation":{"category":"reports","label":"Find the right report"}}
---
# IMS Reports

Reports mainly review operational information. Choose a report by the question it answers, then align its date, location, and status filters before comparing totals.

When Xero is enabled, Cash Banking Report also lets authorised Admins record a note about a correction already made externally; that note does not post accounting.

Sales Detail, Sales Search and Sales Summary can be filtered to an exact Shopify storefront. Sales Summary also offers **Store / Channel** as a grouping, allowing stores to be compared in one result. Leaving the filter at **All channels** retains POS, wholesale, imported history and every online channel covered by that report.

## Main operations

- Start with a summary report for the pattern and a detail report for the source records.
- Apply the shared date preset or custom range where offered.
- Check whether money is shown including or excluding GST.
- Export only after the on-screen filters and totals are correct.

## Report directory

**Consignment Activity** appears in the Reports overview only after an Admin or SuperAdmin enables **Consignments** in **Settings > Business & Team > Feature Toggle** and saves. It does not require optional Consignment Tracking. Supplier settlement records are separately available under **Purchasing > Consignment Statements** while Consignments is enabled.

| Question | Report |
|---|---|
| What stock or incomplete documents need a bookkeeper's attention? | **Bookkeeper Audit** |
| What consignment goods sold or were refunded, and at what supplier cost? | **Consignment Activity** (requires Consignments enabled) |
| Which recorded costs belong to each sale, product, warehouse and channel? | **Sales & COGS Traceability** |
| What sold, by product and branch? | **Sales Detail** |
| How do branches compare? | **Sales Summary** grouped by **Location**, or branch columns in **Sales Detail** |
| How do sales group by location, supplier, brand, product type, day, or hour? | **Sales Summary** |
| Which variants sold and which source quantities contributed? | **Sales Search** |
| Where is an individual sale or receipt? | **POS Sales**, POS Reports or the relevant Sales Order |
| What is stock worth now or at a past date? | **Inventory Valuation** |
| What margin did recorded sales produce? | **Sales Summary** or **Sales & COGS Traceability**, checking cost coverage |
| What was each product's recorded profit in a period? | **Product Profitability Margin**; recorded net revenue and captured costs with explicit incomplete-evidence warnings |
| Which completed POS items have a recorded unit-price change? | **POS Price Changed Transactions** |
| What happened in daily register sessions? | **Daily POS Registers Report** |
| How do cash deposits and Xero outcomes compare? | **Cash Banking Report** |
| Which open customer orders need sourcing or promise review? | **Stock Availability** |
| What is on hand, committed, incoming, or available at a branch? | **Products > Stock Levels** |

## Reading results

Sales reports commonly show selling amounts including GST. Margin and cost of goods sold use tax-exclusive values where labelled. Dashboard gross profit uses the cost captured on completed stock movements, including customer returns and later manager corrections, rather than today's product cost. Inventory Valuation defaults to today's unchanged live valuation; selecting a past **As at date** reconstructs end-of-day stock using recorded history. Historical margin answers what was recorded when the sale or stock movement happened.

> **Tip:** When two totals differ, compare the same date meaning, date range, locations, statuses, transaction types, and GST treatment before looking for a data problem.

**Choosing and Reading IMS Reports** Help has specific sales, valuation, profitability, stock-demand, POS price-change and daily register procedures, with an export-scope table.

**Cash Banking Report** Help covers deposit outcomes and correction notes for Xero-enabled businesses.

Sales Search aggregates by variant rather than showing individual transactions; changing stores preserves dates, search and page size and returns to page one. Product Profitability uses recorded AUD tax-exclusive revenue after discounts and captured historical costs, including supported returns. Missing cost, tax or currency evidence withholds affected product and full-result totals rather than estimating. Stock Availability is a current open-order demand and protected-supply report, not a general stock balance.

Export scope differs: Sales Detail exports the current page plus full-result totals, while Sales Summary exports all matching grouped pages. Sales Search and Product Profitability export current-page rows only. Inventory Valuation exports all loaded filtered rows with the selected date, timezone and cost basis, across all locations; it has no branch selector. Stock Availability has no CSV export control.

Daily POS Registers selects the register's session date and requires **Run** after a date change. Its Counted totals include float; use the already adjusted Variance rather than subtracting the raw totals. Price-change results count changed items, not distinct sales.

Administrators can correct a session's opening float beside **Float**. Cash variance recalculates without changing counted cash or sales. Closed-session corrections require acknowledgement that affected accounting syncs must be corrected manually by the bookkeeper; a separate email button sends the saved correction to the accounts recipients configured in General Settings.

## Troubleshooting

| Symptom | First check | Next step |
|---|---|---|
| No rows appear | Date range, search text, location, and status | Clear filters one at a time |
| A summary differs from a detail report | Grouping and transaction coverage | Trace several source rows with matching filters |
| Margin is blank or partial | Cost coverage | Review the recorded sale or movement cost |
| Branch valuation differs | Stock quantity and active costing method | Average Cost is shared; FIFO values the layers remaining at each location |

## Worked examples

### Check a branch sales total

Open **Sales Detail**, choose the required branch and date range, and note the tax-inclusive total. Use **Sales Search** for variant/source quantity totals, or inspect POS Sales and the relevant Sales Order when an individual transaction needs to be identified.

### Explain current stock value

Open **Inventory Valuation**, filter the required product, supplier, brand or type, and compare each quantity with its current value across locations. Under Average Cost, review the current shared cost; under FIFO, review remaining layers and any quantity mismatch warning. Use **Stock Levels** separately for a quantity check at one branch.

Leave **As at date** on **Today** for that live result. Choose a past date for end-of-day stock, including products since deactivated. Historical costs are used where reliable; otherwise **Today's cost (estimate)** identifies the fallback. Check inferred-opening and incomplete-history warnings before relying on a backdated total.

---
{"id":"ims-report-guide","title":"Choosing and Reading IMS Reports","audiences":["ims"],"capability":"navigation","screen":"Reports","product":"ims","format":"task","parentId":"ims-operational-reports","contexts":["report-sales-detail","report-sales-by-branch","report-sales-summary","report-sales-search","report-inventory-valuation","report-product-margin","report-pos-price-changes","report-pos-registers","report-cash-banking","report-stock-availability"],"contextSections":{"report-sales-detail":"Step-by-step","report-sales-by-branch":"Step-by-step","report-sales-summary":"Step-by-step","report-sales-search":"Step-by-step","report-inventory-valuation":"Step-by-step","report-product-margin":"Step-by-step","report-pos-price-changes":"Step-by-step","report-pos-registers":"Step-by-step","report-cash-banking":"Step-by-step","report-stock-availability":"Step-by-step"},"relatedTopics":["ims-operational-reports","ims-inventory-costing","ims-location-stock-operations"],"order":61,"summary":"Match a business question to the right report and compare dates, GST, cost, and stock consistently.","lastReviewed":"2026-08-23","owner":"reporting"}
---
# Choosing and Reading IMS Reports

Use this guide to choose a report, understand what its dates and money mean, and trace a total back to source activity.

## Main operations

- Write down the question before choosing the report.
- Align date range, location, status, and GST treatment.
- Use detail rows to explain summary totals.
- Distinguish current stock cost from cost recorded on historical sales or movements.
- Review the on-screen result before exporting.

## At a glance

| Business question | Best starting report | Read next when needed |
|---|---|---|
| Which products sold and where? | Sales Detail | Sales Search for individual source lines |
| How do locations compare? | Sales by Branch | Sales Detail with one branch selected |
| What drives sales by brand, supplier, type, day, or hour? | Sales Summary | Sales Search for source activity |
| Where is a known product sale? | Sales Search | POS Sales or the Sales Order |
| What is stock worth now? | Inventory Valuation | Stock Levels and receipt history |
| What margin was recorded? | Product Margin or Sales Summary | Sale and movement history for cost coverage |
| Is a POS price change expected? | POS Price Changes | Product and sale source |
| What happened in a register session? | POS Registers | POS Sales and End of Day records |
| Does recorded banking match cash handling? | Cash Banking | Register and deposit references |
| Can demand be supplied? | Stock Availability | Sales Orders, allocation, and Purchase Orders |

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
4. Apply the same locations, statuses, search terms, and groupings required by the question.
5. Read column subtitles such as **Inc. GST**, **Ex. GST**, **Attached**, or **Current**.
6. Trace at least one representative row to its source before explaining a difference.
7. Export only when the filtered screen answers the intended question.

### Understand report dates

| Source shown in sales reports | Date used for the sales period | Practical meaning |
|---|---|---|
| Imported historical sale | Invoice date | The recorded business date of the imported sale |
| POS sale | Completion date | When the POS transaction completed |
| Sales Order sale | Order date | The order's recorded order date |
| Product Margin movement | Movement creation date used by that report | The dated sale movement included in the selected period |

Do not assume every report uses fulfilment date or accounting-posting date. Use the displayed source and date definition when comparing with Xero or another export.

### Compare tax and cost correctly

| Measure | Typical treatment | Use it for |
|---|---|---|
| Sales amount | Tax-inclusive where labelled **Inc. GST** | Customer-facing sales totals |
| Cost of goods sold | Tax-exclusive where labelled **Ex. GST** | Margin calculations |
| Gross profit | Tax-exclusive sale value less covered cost | Comparing profit on cost-covered sales |
| Current average cost | Current organisation-wide average for a variant | Today's inventory valuation |
| Historical attached cost | Unit cost recorded on the completed movement | Historical margin and cost of goods sold |

| Cost question | Use current average cost? | Use historical attached cost? |
|---|---:|---:|
| What is stock on hand worth now? | Yes | No |
| What did this sale cost when recorded? | No | Yes |
| Why did today's receipt change valuation? | Yes | Review the receipt that changed it |
| Why is margin blank or only partly covered? | No | Check whether every sold quantity has recorded cost |

> **Important:** A later receipt can change current average cost without rewriting the cost already attached to an earlier sale or stock movement.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Two sales totals differ | Different source coverage, dates, locations, statuses, or GST treatment | Align each choice and compare source rows |
| Gross profit is blank | No covered sale value or incomplete cost coverage | Inspect attached cost and the source movements |
| COGS coverage is below 100% | Some sold quantity has no complete attached cost | Review the affected sales and movement history |
| Current valuation changed but old margin did not | Average cost changed after the historical sale | Use current cost for valuation and historical cost for that sale |
| Export differs from the screen you expected | Filters changed or export includes all selected pages or groups | Recheck active filters and totals before exporting |

## Worked examples

### Compare a tax-inclusive sale with tax-exclusive margin

A sale amount of $110 including GST has a tax-exclusive value of $100. If its attached tax-exclusive cost is $60, gross profit is $40. Comparing $110 directly with $60 would mix tax treatments and overstate gross profit.

### Separate current and historical cost

A jacket sale recorded an attached cost of $50. A later receipt moves the current average cost to $58. Inventory Valuation uses $58 for jackets still on hand; the earlier sale keeps its $50 historical cost for margin reporting.

---
{"id":"ims-operational-reports","title":"IMS Reports","audiences":["ims"],"capability":"navigation","screen":"Reports","product":"ims","format":"overview","parentId":"ims-reports","contexts":["reports"],"contextSections":{"reports":"Report directory"},"relatedTopics":["ims-report-guide","ims-bookkeeper-audit","ims-inventory-costing"],"order":60,"summary":"Choose the IMS report that matches your sales, stock, margin, register, or banking question.","lastReviewed":"2026-09-23","owner":"reporting","quickSections":["Main operations","Report directory","Reading results"]}
---
# IMS Reports

Reports are read-only views of operational information. Choose a report by the question it answers, then align its date, location, and status filters before comparing totals.

Sales Detail, Sales Search and Sales Summary can be filtered to an exact Shopify storefront. Sales Summary also offers **Store / Channel** as a grouping, allowing stores to be compared in one result. Leaving the filter at **All channels** retains POS, wholesale, imported history and every online channel covered by that report.

## Main operations

- Start with a summary report for the pattern and a detail report for the source records.
- Apply the shared date preset or custom range where offered.
- Check whether money is shown including or excluding GST.
- Export only after the on-screen filters and totals are correct.

## Report directory

| Question | Report |
|---|---|
| What stock or incomplete documents need a bookkeeper's attention? | **Bookkeeper Audit** |
| What sold, by product and branch? | **Sales Detail** |
| How do branches compare? | **Sales by Branch** |
| How do sales group by location, supplier, brand, product type, day, or hour? | **Sales Summary** |
| Where is a particular sale or product line? | **Sales Search** |
| What is current stock worth? | **Inventory Valuation** |
| What margin did products produce? | **Product Margin** or **Sales Summary** |
| Who changed a POS selling price? | **POS Price Changes** |
| What happened in daily register sessions? | **POS Registers** |
| How do cash deposits and banking compare? | **Cash Banking** |
| What is on hand, committed, incoming, or available? | **Stock Availability** |

## Reading results

Sales reports commonly show selling amounts including GST. Margin and cost of goods sold use tax-exclusive values where labelled. Dashboard gross profit uses the cost captured on completed stock movements, including customer returns and later manager corrections, rather than today's product cost. Inventory Valuation answers a current-value question; historical margin answers what was recorded when the sale or stock movement happened.

> **Tip:** When two totals differ, compare the same date meaning, date range, locations, statuses, transaction types, and GST treatment before looking for a data problem.

## Troubleshooting

| Symptom | First check | Next step |
|---|---|---|
| No rows appear | Date range, search text, location, and status | Clear filters one at a time |
| A summary differs from a detail report | Grouping and transaction coverage | Trace several source rows with matching filters |
| Margin is blank or partial | Cost coverage | Review the recorded sale or movement cost |
| Branch valuation differs | Stock quantity and active costing method | Average Cost is shared; FIFO values the layers remaining at each location |

## Worked examples

### Check a branch sales total

Open **Sales Detail**, choose the required branch and date range, and note the tax-inclusive total. Use **Sales Search** to inspect individual lines when a transaction needs to be identified.

### Explain current stock value

Open **Inventory Valuation**, select the location, and compare each quantity with its value under the active method. Under Average Cost, review the current shared cost; under FIFO, review the remaining location layers and recent movements.

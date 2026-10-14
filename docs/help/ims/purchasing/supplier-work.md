---
{"id":"ims-supplier-work","title":"Purchasing Planning and Supplier Work","audiences":["ims"],"capability":"orders","screen":"Purchasing","product":"ims","format":"overview","parentId":"ims-purchasing","contexts":["order-planner"],"contextSections":{"order-planner":"Build and review an order plan"},"relatedTopics":["ims-purchase-orders","ims-po-receiving-resolution","ims-supplier-returns-credit-notes","ims-stock-levels-adjustments","ims-report-guide"],"order":11,"summary":"Review replenishment suggestions, distinguish saved plans from purchase orders, and choose the right supplier workflow.","lastReviewed":"2026-10-14","owner":"inventory","quickSections":["Main operations","Order planner","Choose the next workflow"],"navigation":{"category":"purchasing","label":"Plan replenishment and supplier work","sections":[{"heading":"Build and review an order plan","label":"Build and review Order Planner suggestions"},{"heading":"Create a purchase order from reviewed lines","label":"Move a reviewed plan into a purchase order"}]}}
---
# Purchasing Planning and Supplier Work

Purchasing starts with a reviewed need, not an automatic order. Use Order Planner to investigate replenishment, then use Purchase Orders or Supplier Credit Notes for the action that matches the real event. Supplier backorders remain Purchase Orders and can be found with the **Backordered** status filter.

## Main operations

| Situation | Open | Result |
|---|---|---|
| Decide what may need ordering | Order Planner | Recommendations and a saved planning snapshot, not a Purchase Order |
| Place an order | Purchase Orders | A Draft, then confirmed incoming supply |
| Record goods that arrived | Purchase Orders > Receive | Stock on hand increases by the received quantity |
| Decide what happens to a short delivery | Purchase Orders > Resolve Outstanding | The remainder stays open, closes or moves to a Backordered PO |
| Return goods or record a supplier allowance | Supplier Credit Notes | Stock may reduce and a supplier credit is recorded |

## Order planner

Order Planner compares available demand and supply information to suggest replenishment. A suggestion is a starting point; staff still decide whether the quantity, supplier, location and timing make sense.

Ask Assistant for a read-only reorder forecast when you need the highest nonzero suggestions for one supplier or brand. Choose a 7, 90, 180 or 365-day sales window and an order frequency. Assistant uses the same Order Planner calculation and returns at most 30 suggestions; it does not create or change a Purchase Order.

Suggested quantity is average daily sales multiplied by the combined order frequency and supplier lead time, less available and incoming stock. A positive reorder quantity is rounded to the nearest pack multiple, with at least one pack. This can round down as well as up. Newer products with a positive selling history after lead time use that shorter history, up to the selected sales window.

Before creating a PO, review:

- [ ] Current on-hand and available stock.
- [ ] Customer commitments and unusual demand.
- [ ] Supply already incoming on other POs.
- [ ] The receiving location.
- [ ] Supplier and lead time.
- [ ] The planning window and any seasonal event.

> **Important:** **Save Draft Order** saves a planning snapshot. It does not create an IMS Purchase Order, confirm incoming supply, change stock, or send an order to the supplier. Create and review the actual Purchase Order separately.

> **Important:** Assistant forecasts are also suggestions. Seasonal events, unusual orders, stale sales-cache data, supplier minimums and unrecorded supply can make the calculated quantity unsuitable.

## Choose the next workflow

| What happened? | Best action |
|---|---|
| The supplier will send the remaining units soon | Leave the partial PO open and Continue Receiving later |
| The supplier cancelled the remaining units | Resolve Outstanding and cancel the remainder |
| The supplier will deliver the remaining units later as separate future work | Resolve Outstanding and create a backorder for the remainder |
| Received goods are physically going back | Create a Supplier Return / Credit with **Return stock** selected |
| The supplier gave a rebate or corrected an overcharge | Create a money-only Supplier Credit Note with **Return stock** cleared |

## Build and review an order plan

1. Open **Purchasing > Order Planner**.
2. Choose **Group By > Supplier** or **Brand**, then type and choose the exact supplier or brand. A brand plan can contain several suppliers; check the **Supplier** on every line.
3. Choose a **Sales Window** of **7**, **90**, **180** or **365** days. Use **Order Frequency (days)** for the period until the next planned order, not the historical sales period.
4. Review **Supplier Lead Time (days)**. Enter **0** to use the supplier default, or a positive number to override it for this plan.
5. Review **Sales Source Branches**. For selected branches, choose **Only selected branches** and use **Pick Branches For Sales** to select at least one location. Sales and supply are restricted to those locations. This does not choose the receiving location for a Purchase Order.
6. Select **Build Order Plan**. Check **Sales Qty**, **Avg/Day**, **Available**, **Incoming**, **Suggested** and **Pack Size** before accepting a recommendation.
7. Review any **Stock incomplete** warning. It names selected branches with missing stock data; Available and Incoming show dashes and Suggested shows **Withheld**, not a confirmed zero. Check quantities in **Stock Levels**. Either rebuild after the missing data is available, or select **Stock checked — allow manual quantity** after verification and enter your own Reorder Qty. Acknowledgement does not calculate an automatic suggestion or change stock.
8. Edit **Reorder Qty** and **Cost** where needed. Check the quantity again after editing because pack rounding can change the number entered. Set **Reorder Qty** to **0** when you do not intend to order that line.
9. Turn on **Show zero-qty rows** to review complete lines without a positive recommendation. Incomplete-stock lines remain visible without that option. Check the **Lines**, **Units**, **Estimated Cost** and **Suppliers In Order** summaries.
10. Select **Save Draft Order** if you want to save the reviewed planning snapshot, and note the returned draft name.

> **Important:** Selected-branch plans never substitute business-wide sales or stock. Every selected branch must have stock data for a line before it receives an automatic suggestion. A recorded zero is valid data; a missing value is unknown. Sales without a matching branch assignment are not assumed to belong to the selected branches.

The **Plan scope** label identifies the branches and sales window actually used. Changing controls requires another **Build Order Plan** to apply them; saving an existing plan keeps its original scope. Rebuilding replaces edited quantities, costs and stock acknowledgements, so record reviewed lines before rebuilding or leaving the planner. Clearing a Stock checked acknowledgement resets that line's manual quantity to zero.

All-branch plans use refreshed rolling totals. Selected-branch sales use recorded sales for the chosen locations and period, following Sales Detail's source rules. Recent changes can appear at different times until all-branch totals refresh. Recorded Sales Order quantities can include orders not yet fulfilled; check unusual orders and incoming supply before purchasing.

The saved planning snapshot is not a purchase-order draft and does not provide a current spreadsheet link or an automatic transfer into IMS Purchase Orders. Keep the reviewed supplier, variant, quantity and cost details available for the next step.

## Create a purchase order from reviewed lines

1. Separate the positive reviewed lines by supplier. Do not place a mixed-supplier brand plan on one supplier's Purchase Order.
2. Open **Purchasing > Purchase Orders**, then **New Purchase Order**.
3. Choose the supplier and the actual receiving location. The planner's branch selection is not a receiving-location instruction.
4. Add the exact variants and enter the reviewed quantities and tax-exclusive supplier costs. These details must be entered separately; saving the plan does not fill this Purchase Order.
5. Save the Purchase Order as **Draft**, then review supplier, location, quantities, costs and any existing incoming supply.
6. Confirm only when the order is ready to become incoming supply. Receive stock only when goods actually arrive.

Use **Purchase Orders** Help for the full creation and confirmation procedure. Neither a saved plan nor an unconfirmed Purchase Order Draft increases stock on hand.

## Costs and GST

Use supplier documents to record buying costs. Supplier costs are treated as tax-exclusive for stock value after any included GST is removed. Selling prices in Products and POS are tax-inclusive and should not be copied into a PO as though they were supplier costs.

For example, a candle sells for $44 including $4 GST, but the supplier charges $18 before GST. The PO cost is $18, not $44.

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| A suggestion looks too high | Demand window, commitments or incoming supply need review | Check each input and edit Reorder Qty rather than ordering blindly |
| A branch line says Stock incomplete or Suggested is Withheld | At least one selected branch has missing stock data for that variant | Check the named branches in Stock Levels; rebuild after data is available, or acknowledge a stock check before entering a manual quantity |
| A manual quantity is unavailable | An incomplete-stock line has not been acknowledged | Verify stock first, then select Stock checked; do not treat a dash as zero |
| Branch sales differ from another report | The branch, period, source rules or freshness differ | Compare the same branches and period in Sales Detail; verify source orders before purchasing |
| Controls differ from the Plan scope label | The controls changed after the plan was built | Rebuild to apply them, or save the reviewed plan with its original scope |
| Edited quantities disappeared | Build Order Plan recalculated the recommendations | Re-enter the reviewed quantities; record them before rebuilding again |
| The saved draft is missing from Purchase Orders | Save Draft Order saved a planning snapshot, not a PO | Create a separate Purchase Order from the reviewed lines |
| Saving a plan reports an error or no clear result | The save outcome needs checking | Keep the reviewed lines and any returned draft name; do not assume a PO was created |
| A backorder cannot be found | The source PO may already be resolved | Open the original PO and review its status and Activity History |
| A supplier issue has both stock and money effects | The wrong workflow may be open | Start from the completed PO and choose Supplier Return / Credit |
| A supplier credit is complete but Xero shows an error | Stock and accounting completed separately | Review the credit note's Xero status and retry the unfinished sync only |

## Worked examples

### Review a summer replenishment suggestion

Order Planner suggests 30 sun hats in packs of 6. Staff check branch sales, available stock and existing incoming supply, then decide that 24 is the appropriate quantity. They enter **Reorder Qty > 24** and **Cost > $18**, giving an estimated line value of **$432**.

**Save Draft Order** records that plan only. Staff separately create a Purchase Order for the hat supplier and the Gold Coast receiving location, add the exact hat variant with 24 units at $18 before GST, and review the Purchase Order Draft before confirmation. Stock on hand changes later, when those hats are received.

### Choose between a backorder and a credit

A supplier delivers 18 of 24 towels. The remaining 6 are due next week, so staff receive 18 and leave 6 open. If the supplier instead cancels the 6, staff resolve the outstanding remainder. No supplier credit is needed because those 6 were never received or paid as returned goods.

### Plan for one branch without mixing another branch's demand

Over 90 days, Sydney sold 90 units and Melbourne sold 270. Staff select **Sydney only**, use 30 days of coverage and no extra lead time, and review a variant with at least 90 effective sales days. Its Sydney Available is 5 and Incoming is 0.

The planner uses Sydney's **90 Sales Qty**, or one unit per day, and suggests **25** before any pack rounding: 30 days of demand minus 5 available. It does not use the business-wide 360 sales against Sydney's five units.

### Check an incomplete multi-branch line

Staff select Sydney and Melbourne, but the variant has stock data only for Sydney. The line names Melbourne as incomplete and withholds the combined suggestion rather than treating Melbourne as zero or substituting business totals.

Staff verify both branches in Stock Levels. If they decide to enter 12 units manually, they select **Stock checked — allow manual quantity**, enter 12 and review pack rounding. The saved snapshot records the acknowledgement and incomplete-data warning. Suggested remains Withheld until a rebuilt plan has complete branch data; no stock or Purchase Order is created by the acknowledgement.
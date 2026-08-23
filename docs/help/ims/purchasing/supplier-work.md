---
{"id":"ims-supplier-work","title":"Purchasing Planning and Supplier Work","audiences":["ims"],"capability":"orders","screen":"Purchasing","product":"ims","format":"overview","parentId":"ims-purchasing","contexts":["order-planner"],"contextSections":{"order-planner":"Order planner"},"relatedTopics":["ims-purchase-orders","ims-po-receiving-resolution","ims-supplier-returns-credit-notes","ims-stock-levels-adjustments"],"order":11,"summary":"Turn replenishment suggestions into reviewed purchase orders and choose the right supplier workflow when plans change.","lastReviewed":"2026-08-23","owner":"inventory"}
---
# Purchasing Planning and Supplier Work

Purchasing starts with a reviewed need, not an automatic order. Use Order Planner to investigate replenishment, then use Purchase Orders, Supplier Backorders or Supplier Credit Notes for the action that matches the real event.

## Main operations

| Situation | Open | Result |
|---|---|---|
| Decide what may need ordering | Order Planner | A suggestion for staff to review |
| Place an order | Purchase Orders | A Draft, then confirmed incoming supply |
| Record goods that arrived | Purchase Orders > Receive | Stock on hand increases by the received quantity |
| Decide what happens to a short delivery | Supplier Backorders or Resolve Outstanding | The remainder stays open, closes or moves to a held PO |
| Return goods or record a supplier allowance | Supplier Credit Notes | Stock may reduce and a supplier credit is recorded |

## Order planner

Order Planner compares available demand and supply information to suggest replenishment. A suggestion is a starting point; staff still decide whether the quantity, supplier, location and timing make sense.

Before creating a PO, review:

- [ ] Current on-hand and available stock.
- [ ] Customer commitments and unusual demand.
- [ ] Supply already incoming on other POs.
- [ ] The receiving location.
- [ ] Supplier and lead time.
- [ ] The planning window and any seasonal event.

> **Important:** Creating a PO from a suggestion does not make the suggestion correct. Review the resulting Draft before confirmation.

## Choose the next workflow

| What happened? | Best action |
|---|---|
| The supplier will send the remaining units soon | Leave the partial PO open and Continue Receiving later |
| The supplier cancelled the remaining units | Resolve Outstanding and cancel the remainder |
| The remaining units should be kept as a separate future order | Resolve Outstanding and create a held backorder |
| Received goods are physically going back | Create a Supplier Return / Credit with **Return stock** selected |
| The supplier gave a rebate or corrected an overcharge | Create a money-only Supplier Credit Note with **Return stock** cleared |

## Costs and GST

Use supplier documents to record buying costs. Supplier costs are treated as tax-exclusive for stock value after any included GST is removed. Selling prices in Products and POS are tax-inclusive and should not be copied into a PO as though they were supplier costs.

For example, a candle sells for $44 including $4 GST, but the supplier charges $18 before GST. The PO cost is $18, not $44.

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| A suggestion looks too high | Demand window, commitments or incoming supply need review | Check each input and adjust the Draft rather than ordering blindly |
| A backorder cannot be found | The source PO may already be resolved | Open the original PO and review its status and Activity History |
| A supplier issue has both stock and money effects | The wrong workflow may be open | Start from the completed PO and choose Supplier Return / Credit |
| A supplier credit is complete but Xero shows an error | Stock and accounting completed separately | Review the credit note's Xero status and retry the unfinished sync only |

## Worked examples

### Review a summer replenishment suggestion

Order Planner suggests 30 sun hats for the Gold Coast store. Staff find 8 available, 10 already incoming and an expected weekend demand of 22. They reduce the Draft to a quantity supported by those facts, check the supplier and tax-exclusive cost, then confirm it.

### Choose between a backorder and a credit

A supplier delivers 18 of 24 towels. The remaining 6 are due next week, so staff receive 18 and leave 6 open. If the supplier instead cancels the 6, staff resolve the outstanding remainder. No supplier credit is needed because those 6 were never received or paid as returned goods.
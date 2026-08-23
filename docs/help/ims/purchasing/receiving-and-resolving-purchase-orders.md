---
{"id":"ims-po-receiving-resolution","title":"Receiving and Resolving Purchase Orders","audiences":["ims"],"capability":"orders","screen":"Purchasing > Purchase Orders","product":"ims","format":"task","parentId":"ims-purchase-orders","contexts":["purchase-order-receive","purchase-order-resolve","supplier-backorders"],"contextSections":{"purchase-order-receive":"Step-by-step","purchase-order-resolve":"Resolve a short delivery","supplier-backorders":"Resolve a short delivery"},"relatedTopics":["ims-purchase-orders","ims-supplier-work","ims-supplier-returns-credit-notes","ims-inventory-costing"],"order":12,"summary":"Receive only goods that arrived and decide whether an outstanding supplier quantity stays open, closes, or moves to a held order.","lastReviewed":"2026-08-23","owner":"inventory"}
---
# Receiving and Resolving Purchase Orders

Use this guide to record a full or partial delivery once, then make a clear decision about any quantity that did not arrive.

## Main operations

- Receive the cumulative quantity physically delivered for each line.
- Leave a partial PO open when the supplier will deliver soon.
- Cancel an outstanding remainder when it will not arrive.
- Move a remainder to a held backorder when it should be kept as separate future purchasing work.
- Use Undo Mistaken Receipt only when the recorded delivery never happened.

## At a glance

| Situation | Action | Stock result |
|---|---|---|
| Everything arrived | Receive all and complete | All entered units are added once |
| Some arrived; balance is coming soon | Receive actual units and leave partial | Actual units added; balance remains outstanding |
| Supplier cancelled the balance | Resolve Outstanding > Cancel outstanding remainder | Earlier receipt stays; balance closes |
| Balance should become a future PO | Resolve Outstanding > Create held backorder | Earlier receipt stays; balance moves without a receipt |
| Receipt was entered but no goods arrived | Undo Mistaken Receipt, if checks allow | Exact mistaken receipt is removed |

> **Important:** Enter the total received quantity shown for the line, including earlier receipts. Solvantis records only the increase from the quantity already received. Never repeat an earlier delivery to fix an accounting warning.

## Before you begin

- [ ] Confirm the PO number, supplier and receiving location.
- [ ] Count the physical delivery by variant.
- [ ] Separate damaged or incorrect goods before confirming quantities.
- [ ] Have the supplier invoice number when marking the PO Complete.
- [ ] Check short-delivery warnings and protected customer demand.
- [ ] Confirm tax treatment, supplier cost and currency before receipt.

Supplier cost becomes inventory cost on a tax-exclusive AUD basis. For a $33 tax-inclusive local cost at 10% GST, the cost basis is $30 and GST is $3.

## Step-by-step

1. Open **Purchasing > Purchase Orders** and find the Confirmed or Partially Received PO.
2. Choose **Receive** or **Continue Receiving**.
3. Compare each product and variant with the delivery.
4. Enter the cumulative received quantity for each line.
5. Review the receiving location, unit costs, discounts, freight, landed costs, tax and currency.
6. For a short delivery, save the actual receipt and keep the PO Partially Received unless the balance is being resolved now.
7. To finish with a shortfall during receipt, choose the completion option that creates a held backorder only after reviewing the confirmation.
8. Enter the supplier invoice number before marking the PO Complete.
9. Reopen the PO and confirm received, outstanding, stock and Xero status separately.

## Resolve a short delivery

| Choice | Use when | What happens to the remainder |
|---|---|---|
| Leave partially open | The supplier expects to deliver soon | Stays on the original PO |
| Cancel outstanding remainder | The supplier will not deliver it | Original PO closes at the quantity actually received |
| Create held backorder | The balance should remain as separate future work | Moves to a held child PO; release it when ready |

The earlier receipt is not repeated by any resolution choice. A held backorder starts inactive and does not add another stock movement.

## Status flow

| From | Action | To |
|---|---|---|
| Confirmed | Receive less than ordered | Partially Received |
| Partially Received | Continue Receiving final units | Complete |
| Partially Received | Leave partially open | Partially Received |
| Partially Received | Cancel remainder | Complete at actual received quantity |
| Partially Received | Create held backorder | Source resolved; child Backordered |
| Backordered child | Release | Confirmed |

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| A line appears to include an earlier receipt | The field shows cumulative received quantity | Keep the earlier quantity and add only what arrived now |
| Complete is blocked | Supplier invoice number is blank | Enter the invoice number and try again |
| Stock is correct but Xero failed | Receipt completed before accounting sync | Repair or retry Xero; do not receive again |
| Resolve Outstanding offers financial choices | Paid or accounting records need a separate settlement decision | Review the preview and use the supplier reference or evidence requested on screen |
| Undo Mistaken Receipt is unavailable | Later stock or accounting activity prevents an exact reversal | Use Supplier Return / Credit for genuine returned goods, or review the blocking activity |

## Worked examples

### Receive two deliveries

A PO orders 10 kettles at $40 each before GST. Six arrive Monday. Staff enter 6 and the PO becomes Partially Received with 4 outstanding. Four arrive Friday; Continue Receiving shows the earlier 6, so staff enter a cumulative total of 10. Solvantis adds only the new 4 and completes the PO.

### Move a cancelled shipment to a held order

A supplier delivers 18 of 24 towels but cannot send the final 6 until next season. Staff receive 18, choose Resolve Outstanding, and create a held backorder for 6. The 18-unit receipt remains unchanged. The held PO can be released later and does not add stock until those 6 are actually received.
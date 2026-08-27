---
{"id":"ims-supplier-returns-credit-notes","title":"Supplier Returns and Credit Notes","audiences":["ims"],"capability":"orders","screen":"Purchasing > Supplier Credit Notes","product":"ims","format":"task","parentId":"ims-supplier-work","contexts":["supplier-credit-notes"],"contextSections":{"supplier-credit-notes":"Step-by-step"},"relatedTopics":["ims-supplier-work","ims-purchase-orders","ims-po-receiving-resolution","ims-inventory-costing"],"order":13,"summary":"Return received goods to a supplier or record a rebate, overcharge correction, or other money-only supplier credit.","lastReviewed":"2026-08-27","owner":"inventory"}
---
# Supplier Returns and Credit Notes

Use a Supplier Credit Note when a supplier owes your business money, with or without physical goods leaving a location.

## Main operations

- Start from a completed PO for a linked return when possible.
- Keep **Return stock** selected for goods physically sent back to the supplier.
- Clear **Return stock** for a rebate, overcharge or other money-only credit.
- Save a Draft for review, then Complete it to apply the stock and supplier-credit result.
- Review Xero and attachment status separately after completion.

## At a glance

| Event | Return stock? | Stock result | Supplier value result |
|---|---|---|---|
| Damaged goods sent back | Yes | On hand decreases | Credit recorded |
| Wrong colour sent back | Yes | On hand decreases | Credit recorded |
| Supplier rebate | No | No stock change | Credit recorded |
| Invoice overcharge correction | No | No stock change | Credit recorded |
| Receipt entered but goods never arrived | No supplier credit note | Use Undo Mistaken Receipt if available | Original receipt correction |

> **Important:** **Return stock** means goods are leaving your business. Despite the field's older technical name, selecting it reduces stock; clearing it records a money-only credit.

## Before you begin

- [ ] Confirm whether goods physically arrived and whether they are now leaving.
- [ ] Open the completed PO and use **Supplier Return / Credit** when the credit relates to that receipt.
- [ ] Confirm the supplier, location, variants and returnable quantities.
- [ ] Obtain the supplier's credit reference or keep a clear evidence note.
- [ ] Check currency, exchange rate, tax treatment and tax-exclusive unit cost.
- [ ] Attach the supplier document when available.

Supplier credit lines use positive quantities and values in the form, even if the supplier's PDF prints them as negatives. Solvantis converts entered negative values to positive credit-note values.

## Step-by-step

1. For received goods, open the completed PO and choose **Supplier Return / Credit**. For a standalone rebate, open **Purchasing > Supplier Credit Notes** and select **New Supplier Credit Note**.
2. Confirm the supplier, location, date and reference.
3. Enter the supplier's credit reference when available.
4. Review each product, quantity, tax-exclusive unit cost and tax rate.
5. Keep **Return stock** selected only on lines for goods physically going back.
6. Clear **Return stock** on money-only lines such as rebates and overcharge corrections.
7. Review the displayed stock quantity to be removed and the total credit value.
8. Select **Create Draft**, attach supporting files and review the Draft.
9. Complete the credit note when the stock and money treatment are correct.
10. Check Xero status. If it failed, retry the Xero sync without completing the credit again.

## Decision matrix

| Question | Yes | No |
|---|---|---|
| Did the goods physically arrive? | Continue | Consider Undo Mistaken Receipt instead |
| Are goods now leaving your location? | Select Return stock | Clear Return stock |
| Is the credit linked to a completed PO? | Start from that PO | Create a standalone Supplier Credit Note |
| Has the Draft been checked against supplier evidence? | Complete | Leave as Draft |
| Did only Xero fail? | Retry Xero | Investigate the operational document first |

## Status and correction flow

| Status or action | Meaning |
|---|---|
| Draft | Editable; no stock has been removed |
| Complete | Selected return lines reduce stock and the supplier credit is recorded |
| Cancelled | Retained for reference; no stock change is applied |
| Reverse Mistaken Completion | Restores stock previously removed and records a correcting result |
| Void in Xero | Voids the linked Xero credit when available; it is separate from the IMS stock correction |

## GST and cost example

| Detail | Amount |
|---|---:|
| Supplier unit price including 10% GST | $55.00 |
| Tax-exclusive unit cost | $50.00 |
| GST per unit | $5.00 |
| Two units returned: credit before GST | $100.00 |
| GST on credit | $10.00 |
| Total supplier credit | $110.00 |

Stock value is reduced using the tax-exclusive cost basis. Selling prices remain tax-inclusive and do not determine the supplier credit.

## Xero account for non-stock credits

Map **Supplier Credit Notes (Non-stock lines)** to a Xero **Direct Costs** or **Expense** account. Use an account such as **Purchases**, or create a dedicated **Supplier Credits - Non-stock** account when you want these adjustments reported separately. Xero handles the reduction in Accounts Payable; this mapping controls the account used for the credit-note line.

For example, a supplier refunds $55 including $5 GST for freight, and no goods are returned. The credit reduces the mapped expense by $50, reduces GST by $5 and reduces Accounts Payable by $55. Stock quantity and inventory value do not change. Lines for physical goods returned to the supplier use the Inventory Asset mapping instead.

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Remaining returnable quantity is lower than expected | Earlier linked returns already used part of the receipt | Review the PO and earlier supplier credit notes |
| Stock would reduce for a rebate | Return stock is selected | Clear it before completing the Draft |
| A zero quantity cannot be saved | Credit-note quantities must be non-zero | Remove the line or enter the actual positive quantity |
| The credit is complete but Xero failed | The IMS result completed separately | Use Retry Xero Sync; do not complete another credit note |
| Completion was genuinely entered by mistake | A reversing correction is needed | Use Reverse Mistaken Completion and provide the reason |

## Worked examples

### Return damaged stock

A Sydney store received 12 lamps at $50 each before GST. Two are damaged and go back. Staff start from the completed PO, enter quantity 2, keep **Return stock** selected and record the supplier's $110 tax-inclusive credit. Completion removes 2 lamps and records a $100 credit before GST plus $10 GST.

### Record a freight overcharge

A supplier gives a $44 credit for freight charged twice. No goods leave the store. Staff create a Supplier Credit Note, enter the agreed tax treatment and clear **Return stock**. Completion records the $44 supplier credit and leaves all product quantities unchanged.
---
{"id":"ims-purchase-orders","title":"Purchase Orders","audiences":["ims"],"capability":"orders","screen":"Purchasing > Purchase Orders","product":"ims","format":"overview","parentId":"ims-purchasing","contexts":["purchase-orders","purchase-order-detail","purchase-order-edit","purchase-order-replacement"],"contextSections":{"purchase-orders":"Main operations","purchase-order-detail":"Review an order","purchase-order-edit":"Create or edit a purchase order","purchase-order-replacement":"Corrections and replacement drafts"},"relatedTopics":["ims-po-receiving-resolution","ims-supplier-returns-credit-notes","ims-inventory-costing","ims-supplier-work"],"order":10,"summary":"Create, confirm, review and correct supplier purchase orders, with configurable list fields.","lastReviewed":"2026-09-10","owner":"inventory"}
---
# Purchase Orders

A purchase order records what you intend to buy from a supplier and where it should arrive. Confirmation makes the quantity incoming; receiving records the physical delivery.

## Main operations

| Action | Use it when | Stock effect |
|---|---|---|
| New Purchase Order | You are preparing a supplier order | None while Draft |
| Confirm | The order is ready to place | Quantity becomes incoming, not on hand |
| Receive | Goods have physically arrived | Adds the entered quantity to on hand |
| Resolve Outstanding | A partial delivery has a balance to decide | Resolves only the unreceived balance |
| Supplier Return / Credit | Received goods are going back or the supplier gives a credit | Depends on **Return stock** |
| Create Replacement Draft | You need a fresh draft based on a completed or cancelled order | No stock effect by itself |

Advisor access is read-only. Other actions can be unavailable when the order's status or later stock, payment, credit or accounting activity requires a controlled correction.

Select **Display Fields** above the Purchase Orders list to choose which order, date and financial columns are visible. **PO #** and **Supplier** remain visible and frozen while the rest of the table scrolls horizontally. Your selection is saved for the current business.

Use the supplier or order-number search and date-range picker for quick filtering. Open **Filters** to narrow the list by status or Product/SKU. Solvantis remembers the current filters, date range, and sort order for your next session in the same browser.

Use **Presets** to return to a named combination of Purchase Order filters, date range, and sort order. The bookmark button saves the current workspace or deletes the selected preset. Presets belong to the signed-in user and are available when that user opens the business on another device.

Ask Assistant for purchase-order aging when you need a read-only list of open Confirmed, Partially Received or Backordered orders. Choose all open orders, overdue orders, or orders due within a future window. The live check returns at most 30 orders and includes outstanding quantity, receiving location, order age, expected date and overdue days.

An order is overdue only when it has an expected date earlier than today and still has unreceived quantity. Orders without an expected date remain in the all-open view but cannot be classified as overdue or due soon.

Assistant shows outstanding value before tax in the PO currency and includes the recorded exchange rate for foreign-currency orders. It omits supplier contact channels, notes, invoice references, files, payment details and customer data.

## Create or edit a purchase order

Advisor access is read-only, so an Advisor cannot create or edit a purchase order.

1. Open **Purchasing > Purchase Orders** and select **New Purchase Order**.
2. Choose the supplier and receiving location.
3. Add the exact product variants and quantities.
4. Check order and expected dates, supplier invoice details, early-payment discount, freight, currency, exchange rate, landed costs and notes.
5. Check the supplier's tax treatment.
6. Save as **Draft** while details are still being prepared, or confirm when the order is ready to place.

When you use **Upload Invoice**, each printed line subtotal is the source of truth. If the printed quantity, pre-discount unit price and line discount reconcile to that subtotal, Solvantis carries the discount into the PO and shows its amount in the PO detail and generated PO document, with the derived percentage retained for accounting. If those columns do not reconcile, Solvantis preserves the subtotal and uses its effective unit cost instead of applying an uncertain discount twice.

Supplier unit costs are normally tax-exclusive. If a supplier charges 10% GST and quotes a $55 tax-inclusive cost, the stock cost is $50 and GST is $5. Choose **Tax inclusive** only when the entered supplier amount already includes tax.

Foreign-currency purchase orders imported from Cin7 are tax-free. Their line costs and totals are shown in the supplier currency, with the recorded exchange rate used to show the AUD equivalent. Check both amounts against the supplier invoice before relying on the imported order.

Create early-payment rules under **Settings > Payment Discounts**. On a new PO, **Early-payment discount** shows the selected supplier's current default by name. Keep that default, choose any active rule as an order-only override, or choose **No early-payment discount**. An order-only rule can be selected even when the supplier has no default. Solvantis saves the rule details and cutoff date on the new PO. The supplier invoice date is the cutoff basis when supplied; otherwise the order date is used. Later changes to the supplier or rule do not rewrite the saved PO terms.

When adding a payment to a PO with saved early-payment terms, Solvantis previews the discount, qualifying settlement total, cutoff date, and amount still required. The preview includes earlier payments dated on or before the cutoff and the payment currently being entered. A payment after the cutoff does not qualify, and freight is not part of the discount base.

For a foreign-currency payment, enter the amount in the purchase-order currency and either the AUD amount paid or the exchange rate. Solvantis keeps the AUD amount and rate in step. Use the direction button beside the rate to switch between **1 foreign currency unit = AUD** and **1 AUD = foreign currency units**; changing the direction does not change the payment value.

When the entered payment reaches the qualifying settlement, turn on **Apply discount and create the supplier credit note** before saving. Solvantis records the payment, a stock-neutral supplier credit note, and the discount application together. The supplier credit reference remains blank unless the supplier actually issued one. An applied settlement payment and its credit note must be corrected together.

> **Important:** Confirming a PO does not mean the goods have arrived. It records expected supply. Use Receive only after checking the physical delivery.

## Purchase order status flow

| Status | What it means | Usual next action |
|---|---|---|
| Draft | The order is being prepared | Edit, confirm or delete |
| Confirmed | The supplier order is active and quantity is incoming | Receive, edit, revert to Draft or cancel where offered |
| Partially Received | Some goods arrived and some remain outstanding | Continue Receiving or Resolve Outstanding |
| Backordered | Outstanding quantity was moved to a held child order | Release when it should become active, or cancel |
| Complete | Receiving is finished | Review, return goods, correct a mistaken receipt or create a replacement draft |
| Cancelled | The order is closed without further receiving | Review or create a replacement draft |

## Review an order

Open the PO number to review products, quantities, supplier invoice details, receipts, payments, files and Xero status. Activity History shows later edits, status changes, receipts, resolution choices, linked supplier credits and replacement orders.

Use the current status and available actions as your guide. A missing action usually means the order has already produced a physical or accounting result that should not be overwritten.

For a Partially Received order, choose **Edit Details** to increase an ordered quantity, add a product, amend a wholly unreceived line, or update expected date, notes, supplier invoice details, and payment terms. Received quantities remain unchanged. An existing received line cannot change product, cost, discount, or tax, cannot be removed, and cannot be reduced below the quantity already received. Supplier, receiving location, order date, currency, freight, and landed costs remain locked after the first receipt.

If the PO has active incoming-stock allocations, release or reassign them before changing its lines. If it has a linked Xero bill, Solvantis checks the live Xero state before saving a financial amendment. Paid, credited, locked-period, or unverifiable bills cannot be amended this way.

## Costs and stock value

The received cost can include line discounts, foreign-currency conversion, freight and landed costs according to the saved settings. Included purchase tax is removed from inventory cost. Completing a receipt updates the current weighted-average cost for each received variant.

| Entered amount | Tax choice | Cost before other adjustments | GST |
|---:|---|---:|---:|
| $50.00 | Tax exclusive at 10% | $50.00 | $5.00 |
| $55.00 | Tax inclusive at 10% | $50.00 | $5.00 |
| $50.00 | No tax | $50.00 | $0.00 |

## Corrections and replacement drafts

Choose the action that matches what happened:

| Situation | Use | Do not use |
|---|---|---|
| The receipt was entered, but the goods never arrived | **Undo Receipt**, when offered | Supplier Return / Credit |
| Goods arrived and are now being sent back | **Supplier Return / Credit** | Undo Receipt |
| You need a new order with similar lines | **Create Replacement Draft** | Reopen a completed PO |
| Stock receipt succeeded but Xero failed | Retry or repair the Xero action | Receive the stock again |

A replacement is a new Draft. It does not undo the original receipt or change the original accounting record.

**Undo Receipt** is available for In Progress and Complete POs when the exact received stock and valuation can be reversed and no dependent payment, supplier credit, shortfall resolution, child workflow, or unsafe Xero state blocks it. The receiving location must still have enough uncommitted stock to remove every received unit. If stock has been sold, transferred, adjusted, or committed to a sales order or transfer, Solvantis blocks the undo and explains the quantity that is unavailable. Release any commitments first, or use **Supplier Return / Credit** when goods genuinely arrived and are being returned. For an In Progress PO, Undo Receipt clears all received quantities, restores them to incoming, and returns the PO to Confirmed without changing its linked Xero bill. For a Complete PO, it cancels the PO and attempts to void the linked Xero bill.

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| Receive is unavailable | The PO is still Draft, already Complete, Cancelled or held | Check the status and choose an offered action |
| Mark Complete asks for more information | A supplier invoice number is required | Enter the supplier invoice number, then complete |
| Some fields are locked during Edit Details | Received stock or valuation already exists | Amend only outstanding quantities and unreceived lines; use Resolve Outstanding, Supplier Return / Credit or Replacement for completed activity |
| Undo Receipt says stock is committed | A sales order or transfer reserves some of the stock at the receiving location | Release or complete the related commitment, then retry; use Supplier Return / Credit if the goods genuinely arrived |
| Xero failed after stock was received | The operational receipt and accounting result are separate | Check Xero status and retry only the accounting action |

## Worked examples

### Place a local supplier order

A Brisbane store orders 20 water bottles at $15 each before GST. The PO subtotal is $300, GST is $30 and the supplier total is $330. Confirming makes 20 incoming. It does not add 20 to on hand until staff receive the delivery.

### Replace a cancelled order

A cancelled PO has the right products but the supplier has changed. Staff choose **Create Replacement Draft**, update the supplier and dates, review every line, then confirm the new order. The old PO stays cancelled for reference.
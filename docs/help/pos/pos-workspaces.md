---
{"id":"pos-workspaces","title":"Point of Sale","audiences":["pos","ims"],"capability":"pos","screen":"Point of Sale","product":"pos","contexts":["pos","reports","parked","receive-transfers","branch-transfer"],"contextSections":{"pos":"Selling","reports":"POS Reports","parked":"Parked Sales","receive-transfers":"Receive Transfers","branch-transfer":"Branch Transfers"},"order":1,"summary":"Sell, take payments, manage register work, transfers, returns, and reports.","lastReviewed":"2026-08-23","owner":"retail"}
---
# Point of Sale

POS is the location-bound workspace for staff selling, receiving payment, parking sales, processing supported returns, transferring stock, and closing the register.

## Main operations

- Sign in with the assigned staff identity and work only in the active location/register context.
- Search or scan products, build the cart, review tax-inclusive prices, and take payment.
- Park an unfinished sale and resume it later from Parked Sales.
- Use the linked return and credit-note workflow for returns.
- Send and receive branch transfers through their dedicated screens.
- Close and reconcile the register through End of Day.

## Selling

Search by product, SKU, or barcode and add the correct variant. Review quantities, discounts, customer selection, loyalty/store-credit/gift-card effects, notes, and payment tender before completion. Protected discounts, adjustments, voids, and register actions can require manager authority.

POS prices are tax-inclusive. Solvantis extracts GST from the total; it does not add GST on top. Completed stock-item sales reduce stock at the active location. Supported oversell handling prevents POS-originated deductions from leaving recorded stock below zero while preserving the movement evidence.

## Parked Sales

Park a sale when checkout cannot be completed immediately. Resuming restores the saved cart for review; current product availability and permissions still apply before final payment.

## Branch Transfers

Create an outbound transfer from the current POS branch, choose the destination, add products and quantities, and send it through the protected transfer workflow. Sending records the source stock movement.

## Receive Transfers

Open Receive Transfers at the destination, scan or review the incoming transfer, confirm physically received quantities, and complete receipt. Receiving records destination stock and closes the transfer when appropriate.

## POS Reports

POS Reports provides transaction and daily activity for the active role and location. Use transaction detail to inspect products, payments, returns, and references; reports do not edit completed sales.

## Offline operation

Supported selling can continue from the local product cache and queue while offline. Review connection and queue state before closing the browser or device. Solvantis Assistant requires a network connection and does not queue questions.

## Troubleshooting

- Confirm the device location, active register, and signed-in operator when products or actions differ from expectation.
- Resolve queued offline sales after connectivity returns before assuming the sale was lost.
- Use a manager-authorised workflow for protected adjustments rather than sharing PINs or bypassing controls.
- Use the linked credit note for returns so stock and customer credit are recorded once.

## Worked examples

### Split tender sale

Add the products, review the tax-inclusive total, select split payment, enter each tender amount, and complete only when the split equals the amount due. The receipt records each payment component.

### Offline sale recovery

Complete the supported sale while offline and leave the device open until connectivity returns. Confirm the queue synchronizes and the transaction appears in POS Reports before attempting to enter it again.
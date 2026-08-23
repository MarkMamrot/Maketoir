---
{"id":"ims-orders","title":"Purchase and sales order workflows","audiences":["ims"],"capability":"orders","screen":"Orders","lastReviewed":"2026-08-23","owner":"inventory"}
---
# Purchase and sales order workflows

Orders use guided lifecycle states so stock, commitments, credits, and accounting documents stay aligned. Use the action offered on the order rather than manually recreating stock or financial effects elsewhere.

## Partial customer fulfilment

A customer sales order can be fulfilled incrementally. Shipping part of an order leaves the remaining quantity committed on the original order. Each fulfilment reduces stock and commitments only by the shipped quantity. The final fulfilment completes the order.

## Resolving an outstanding balance

For a partially fulfilled sales order, Resolve Outstanding can leave the balance open, cancel it, or transfer it to a held child order. This avoids repeating stock movements already recorded by the original shipment.

## Partial supplier receipts

A purchase order can be received incrementally. Record only quantities actually received. Remaining quantities stay outstanding until a later receipt or an approved resolution path is used.

## Why some direct edits are unavailable

Actions may be restricted after stock, payments, credits, or external accounting documents exist. These restrictions preserve the audit trail. Use the order's amendment, resolution, credit, or reversal workflow where available.
---
{"id":"pos-operations","title":"POS register and selling workflows","audiences":["pos","ims"],"capability":"pos","screen":"Point of Sale","lastReviewed":"2026-08-23","owner":"retail"}
---
# POS register and selling workflows

The POS supports product search, barcode scanning, parked sales, split payments, receipts, returns, register sessions, and end-of-day reconciliation. Available controls depend on the signed-in operator and location.

## Location and register access

POS users work within their assigned location and active register. Stock and register information shown by the assistant is limited to that verified context. A manager may be required for protected adjustments.

## Working offline

The POS can continue supported selling workflows while offline using its local product cache and queue. AI assistance requires a network connection and does not queue requests for later processing.

## Returns and store credit

Returns use the linked credit-note workflow so stock and customer credit are recorded once. Store credit is ledger-owned and should not be manually overwritten through customer contact editing.
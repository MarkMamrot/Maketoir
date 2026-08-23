---
{"id":"ims-customer-orders","title":"Customer Orders, Allocation, and Credits","audiences":["ims"],"capability":"orders","screen":"Sales","product":"ims","parentId":"ims-sales","contexts":["sales-orders","wholesale-applications","backorders","customer-backorders","stock-availability","credit-notes","pos-sales","online-sales"],"contextSections":{"sales-orders":"Sales orders","wholesale-applications":"Wholesale applications","backorders":"Backorders and allocation","customer-backorders":"Backorders and allocation","stock-availability":"Backorders and allocation","credit-notes":"Customer credit notes","pos-sales":"POS and online sales","online-sales":"POS and online sales"},"order":30,"summary":"Manage customer demand, fulfilment, stock allocation, returns, credits, and imported sales activity.","lastReviewed":"2026-08-23","owner":"sales"}
---
# Customer Orders, Allocation, and Credits

## Main operations

- Draft and confirm Sales Orders before recording fulfilment.
- Fulfil only quantities actually shipped and continue later for partial supply.
- Use Stock Allocation to protect incoming supply for known customer demand.
- Complete customer returns and credits through Customer Credit Notes.
- Review POS Sales and Online Sales as source activity; correct them through their owning workflow.

## Sales orders

A Draft order can be prepared without committing stock. Confirmation establishes active demand and can commit quantity. Use **Fulfil** or **Continue Fulfilment** for quantities actually shipped. Use the offered outstanding-resolution action when an unshipped balance will not be supplied. Cancellation and correction options depend on lifecycle state and existing stock or accounting effects.

## Wholesale applications

Review the applicant, company relationship, intended customer account, and requested access before approval. Approval grants portal access to the linked commercial identity; it should not be used to work around missing customer setup.

## Backorders and allocation

Customer Backorders identifies outstanding supply. Stock Allocation links incoming PO quantities to SO demand and distinguishes received-ready, incoming, unsourced, overdue, and at-risk quantities. Allocation protects supply but does not receive the purchase order or fulfil the sales order.

## Customer credit notes

Customer Credit Notes owns manual IMS returns and customer credits. Complete eligible lines through the supported workflow so stock and customer value remain linked and auditable. POS returns use a linked POS-sourced credit note as the sole return-stock owner; do not restock both records.

## POS and online sales

POS Sales and Online Sales provide source transaction and synchronization detail. Use them to inspect lines, payments, returns, references, and status. Online accounting follows the configured online-sales policy and is separate from POS End of Day summaries.

## Troubleshooting

- If fulfilment is unavailable, check confirmation state, remaining quantity, location, and role.
- If stock appears reserved, inspect confirmed orders and allocation before adjusting quantity.
- If a return already has a linked credit note, continue in that note rather than creating another return.
- If an accounting sync fails, repair the integration and retry the unfinished posting without repeating fulfilment or return stock.

## Worked examples

### Partially fulfil an order

Open the confirmed Sales Order, choose Fulfil, enter only shipped quantities, and complete that fulfilment. When later stock arrives, reopen the order and use Continue Fulfilment for the remaining shipment.

### Allocate incoming supply

Open Stock Allocation, select the outstanding customer demand, inspect matching incoming PO supply and dates, and assign the required quantity. Receive the PO when stock physically arrives, then fulfil the Sales Order separately.
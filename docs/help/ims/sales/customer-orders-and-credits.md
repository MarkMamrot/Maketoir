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

Customer Credit Notes owns manual IMS returns and customer credits. Complete eligible lines through the supported workflow so stock and customer value remain linked and auditable. POS and native online returns use the linked credit note as the sole return-stock owner; do not restock both records. For a native order, **Original payment refund** restores the original store-credit portion first and sends any remainder to Stripe before stock is returned.

## POS and online sales

POS Sales and Online Sales provide source transaction and synchronization detail. Use them to inspect lines, payments, returns, references, and status. Online accounting follows the configured online-sales policy and is separate from POS End of Day summaries.

When Shopify sends an order, Solvantis matches each Shopify variant ID to the corresponding IMS variant. If a line has no variant ID or its Shopify variant is not linked to an IMS variant, the line is assigned to the protected, non-stock **Shopify Misc Charge** item with SKU **SHOPIFY-MISC**. The original Shopify line title appears beneath it in Online Sales. This is not an extra fee added by Solvantis: it preserves the Shopify line and its value without moving stock against the wrong product.

If a normal product appears as Shopify Misc Charge, check that the product and variant have synced from Shopify and retain their Shopify linkage. The protected fallback item should not be edited or deleted. Correcting the product mapping prevents later Shopify lines from falling back; an already imported order may need its Shopify update processed again after the mapping is repaired.

## Troubleshooting

- If fulfilment is unavailable, check confirmation state, remaining quantity, location, and role.
- If stock appears reserved, inspect confirmed orders and allocation before adjusting quantity.
- If a return already has a linked credit note, continue in that note rather than creating another return.
- If an accounting sync fails, repair the integration and retry the unfinished posting without repeating fulfilment or return stock.
- If Shopify Misc Charge appears, compare the **Shopify item** title shown beneath it with the intended IMS product, then check that product's Shopify variant linkage. It is a product-mapping fallback, not a Xero policy charge.
- If a native payment refund fails, retry the credit-note completion after resolving the Stripe connection or payment issue. No return stock or customer value is changed until settlement succeeds.

## Worked examples

### Partially fulfil an order

Open the confirmed Sales Order, choose Fulfil, enter only shipped quantities, and complete that fulfilment. When later stock arrives, reopen the order and use Continue Fulfilment for the remaining shipment.

### Allocate incoming supply

Open Stock Allocation, select the outstanding customer demand, inspect matching incoming PO supply and dates, and assign the required quantity. Receive the PO when stock physically arrives, then fulfil the Sales Order separately.
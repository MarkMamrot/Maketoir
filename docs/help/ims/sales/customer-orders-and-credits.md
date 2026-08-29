---
{"id":"ims-customer-orders","title":"Customer Orders, Allocation, and Credits","audiences":["ims"],"capability":"orders","screen":"Sales","product":"ims","format":"overview","parentId":"ims-sales","relatedTopics":["ims-sales-orders-fulfilment","ims-stock-allocation-backorders","ims-customer-returns-refunds"],"contexts":["wholesale-applications","pos-sales","online-sales"],"contextSections":{"wholesale-applications":"Wholesale applications","pos-sales":"POS and online sales","online-sales":"POS and online sales"},"order":30,"summary":"Choose the right Sales workspace for orders, incoming-stock allocation, returns, credits, and source sales activity.","lastReviewed":"2026-08-23","owner":"sales"}
---
# Customer Orders, Allocation, and Credits

Use this page to choose where to start. Each related task guide explains what changes in stock and customer value.

## Main operations

| What you need to do | Start here | What it changes |
|---|---|---|
| Create, confirm, ship, or finish a customer order | **Sales Orders** | Customer demand and stock when goods are shipped |
| Protect incoming purchase-order stock for a customer | **Stock Allocation** | Which customer demand is protected by incoming supply |
| Record a return, store credit, or original-payment refund | **Customer Credit Notes** | Returned stock and customer value when the credit note completes |
| Investigate a register or online transaction | **POS Sales** or **Online Sales** | Nothing until you use the return or correction action offered for that source |

## Wholesale applications

Review the applicant, company relationship, intended customer account, and requested access before approval. Approval gives the linked business customer access to the wholesale portal; it does not replace missing customer or catalogue setup.

## POS and online sales

Use **POS Sales** and **Online Sales** to inspect items, payments, returns, references, and processing status. Start a correction from the source sale when an action is offered, then follow the linked credit note rather than entering the stock movement again.

When Xero accounting is enabled for the business, **Online Sales** also shows daily Xero posting guidance and a sync action for eligible trading days. These accounting controls are hidden when Xero accounting is disabled; the underlying online sales history remains available.

Shopify lines that cannot be matched to an IMS variant appear as **Shopify Misc Charge** with SKU **SHOPIFY-MISC**. The Shopify item title remains visible underneath. This preserves the order value without moving stock for the wrong product; it is not an added fee.

If a normal product appears this way, check that its Shopify product and variant link is current. Repairing the link prevents later orders from using the fallback, but an existing import may need to be processed again.

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| An order cannot be fulfilled | It is not confirmed, has no remaining quantity, or your access is read-only | Review its status, remaining quantity, location, and available actions |
| Stock looks reserved | A confirmed order or allocation is protecting it | Open Stock Allocation before changing stock |
| A return already shows a credit-note number | The return record already exists | Open that credit note; do not create another return |
| Shopify Misc Charge appears | The Shopify line did not match an IMS variant | Compare the shown Shopify title, repair the variant link, and reprocess only if required |

## Worked examples

### Choose the correct workflow

A customer ordered 12 jackets, 8 shipped, and 4 are waiting on a purchase order. Use **Sales Orders** to review the shipment, **Stock Allocation** to protect 4 incoming jackets, and **Customer Credit Notes** only if the customer later returns shipped goods.

### Investigate an online line

An online order contains a $44.95 item shown as Shopify Misc Charge. Read the original Shopify title under the line, repair the intended variant link, and avoid making a stock adjustment for the fallback item.
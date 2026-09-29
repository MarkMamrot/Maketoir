---
{"id":"ims-stock-allocation-backorders","title":"Stock Allocation and Customer Backorders","audiences":["ims"],"capability":"orders","screen":"Sales > Stock Allocation","product":"ims","format":"task","parentId":"ims-customer-orders","relatedTopics":["ims-sales-orders-fulfilment","ims-purchase-orders"],"contexts":["stock-availability","backorders","customer-backorders","sales-orders"],"contextSections":{"stock-availability":"Step-by-step","backorders":"At a glance","customer-backorders":"At a glance","sales-orders":"Confirm with incoming supply"},"order":32,"summary":"Protect confirmed incoming purchase-order quantities for outstanding customer demand and identify quantities that still have no source.","lastReviewed":"2026-09-11","owner":"sales","quickSections":["Main operations","At a glance"]}
---
# Stock Allocation and Customer Backorders

Use Stock Allocation to connect confirmed incoming supply to outstanding customer order lines without receiving or shipping the goods.

## Main operations

- Find customer demand that is ready, incoming, at risk, overdue, or unsourced.
- Allocate free incoming purchase-order quantity to a customer order.
- Review and protect eligible incoming supply while confirming a Draft Sales Order.
- Add an optional customer promise date.
- Open the customer order when supply arrives and fulfil it separately.
- Ask Solvantis to check current allocation exceptions by state when you need a read-only summary. The live check can show order, product, location, and quantity evidence, but omits customer and supplier identities.

## At a glance

| Quantity or state | Plain meaning | What staff can do |
|---|---|---|
| Outstanding | Customer quantity not yet fulfilled | Find available or incoming supply |
| Protected | Incoming or received supply assigned to this demand | Avoid promising it to another order |
| Ready | Protected supply has been received | Open the sales order and fulfil actual shipment |
| Incoming | Protected supply is still on a purchase order | Monitor its expected date |
| Unsourced | Outstanding demand has no protected supply | Allocate eligible incoming supply or plan another source |
| At risk or overdue | Supply timing may miss the customer need | Review the purchase order and customer promise |

## Before you begin

- [ ] Confirm the customer Sales Order and supplier Purchase Order use the same product variant and location.
- [ ] Confirm the Purchase Order is not Draft and still has free incoming quantity.
- [ ] Check earlier customer demand before overriding the first-in, first-out suggestion.
- [ ] Remember that native online orders use available stock and do not join this incoming-allocation workflow.

> **Note:** Allocation protects incoming supply. It does not receive the purchase order, increase stock on hand, or fulfil the customer order.

## Confirm with incoming supply

When a Draft Sales Order has less available stock than its ordered quantity, **Confirm** opens a stock sourcing review. The review exists to allocate and protect incoming Purchase Order stock for that Sales Order. **Available now** uses recorded stock on hand after demand already committed to other orders, and the review explicitly identifies a line when no stock is currently available. **Needs incoming** is the remaining shortage. Solvantis suggests free quantities from eligible Purchase Orders in expected-date order.

Each option shows the supplier, expected date, total line quantity ordered and received, free quantity available to allocate, and the quantity to protect for this Sales Order. Select the PO number to open that Purchase Order. Review and edit the suggested quantities, then choose **Confirm & Allocate** to confirm the order and protect that incoming supply together. If incoming supply covers only part of the shortage, acknowledge the remaining unsourced quantity and choose **Confirm with Unsourced Quantity**. **Return to Draft** closes the review without confirming or allocating anything.

Solvantis rechecks the order, stock, Purchase Orders, and existing allocations when you confirm. If supply changed while the review was open, the whole action stops so no partial allocation or status change is left behind.

## Step-by-step

1. Open **Sales > Stock Allocation**.
2. Use the **Unsourced**, **Ready**, **At risk**, or **Overdue** view to focus the list.
3. Filter by location or supplier, or search by order, customer, SKU, or product.
4. On an unsourced line, select the allocation action.
5. Review the first eligible purchase order, expected date, free incoming quantity, and maximum quantity available for this demand.
6. Enter the quantity to protect and, if useful, a customer promise date.
7. Confirm the allocation and check that **Protected**, **Incoming**, and **Unsourced** now show the intended split.
8. When the goods arrive, receive the Purchase Order. Then open the Sales Order and fulfil only the quantity physically shipped.

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| No eligible supply appears | The PO is Draft, the location or variant differs, or its free quantity is already allocated | Review the matching PO line and existing allocations |
| Some demand remains unsourced | Incoming free quantity is lower than customer demand | Protect what is available and plan the remaining quantity separately |
| Protected quantity is not ready | The linked PO has not been received | Check its expected date and receipt status |
| An online order is absent | Native online orders do not use incoming PO allocation | Review the online order and its reserved available stock |
| Revert to Draft is blocked | The Sales Order still protects incoming Purchase Order stock | Release each active allocation first, then revert the Sales Order |

## Worked examples

### Split sourced and unsourced demand

SO-1042 has 10 backpacks outstanding. PO-781 has 6 free incoming backpacks at the same location. Allocate 6. The line now shows **Outstanding 10**, **Protected 6**, **Incoming 6**, and **Unsourced 4**. No stock on hand changes yet.

### Receive protected supply

Five of the 6 protected backpacks arrive. After the PO receipt, the customer line can show **Ready 5**, **Incoming 1**, and **Unsourced 4**. Ship up to the quantity physically available; allocation itself is not a shipment.
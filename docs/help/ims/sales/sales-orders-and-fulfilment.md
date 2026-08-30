---
{"id":"ims-sales-orders-fulfilment","title":"Sales Orders and Fulfilment","audiences":["ims"],"capability":"orders","screen":"Sales > Sales Orders","product":"ims","format":"task","parentId":"ims-customer-orders","relatedTopics":["ims-stock-allocation-backorders","ims-customer-returns-refunds","ims-purchase-orders"],"contexts":["sales-orders"],"contextSections":{"sales-orders":"Step-by-step"},"order":31,"summary":"Create customer sales orders, ship actual quantities, continue partial fulfilment, and resolve an unshipped remainder.","lastReviewed":"2026-08-30","owner":"sales"}
---
# Sales Orders and Fulfilment

Use Sales Orders to record customer demand and reduce stock only when goods are actually shipped.

## Main operations

- Create and review a Draft order.
- Confirm the order when customer demand is real.
- Fulfil only the quantities sent to the customer.
- Continue a partial fulfilment or resolve the remainder.

## At a glance

| Stage or choice | What it means | Stock effect |
|---|---|---|
| Draft | The order is still being prepared | No shipment; stock is not reduced |
| Confirmed | Customer demand is active | Quantity can be committed, but stock on hand is unchanged |
| Partially fulfil now | Ship entered quantities and leave the balance on this order | Only the shipped quantity reduces stock |
| Create backorder for remainder | Ship entered quantities and move the balance to a held child order | Only the shipped quantity reduces stock |
| Complete | All intended shipments or remainder decisions are finished | No extra movement beyond recorded shipments |

## Before you begin

- [ ] Confirm the customer, delivery location, stock location, products, quantities, and tax-inclusive selling prices.
- [ ] Check whether incoming stock is already protected for this order.
- [ ] Count or verify the goods being dispatched.
- [ ] Make sure you are not using an advisor account, which is read-only.

> **Important:** Record what physically ships. If a shipment succeeds but a later accounting action fails, retry the unfinished accounting action; do not fulfil the goods again.

## Step-by-step

1. Open **Sales > Sales Orders** and select **New Sales Order**.
2. Choose the customer and location, then add the products and ordered quantities.
3. Review prices, tax treatment, discounts, freight, dates, and notes. Save the order as Draft while it is still being prepared.
4. Confirm the order when the customer demand is ready to proceed.
5. Select **Fulfil** and enter only the quantity in this shipment for each line.
6. Choose **Partially fulfil now** when the balance should stay on the order, or **Create backorder for remainder** when the balance needs a separate held child order.
7. Confirm the fulfilment. Reopen a partial order and use **Continue Fulfilment** for a later shipment.

> **Important:** Shopify remains the authority for whether its order was physically fulfilled. If Shopify reports fulfilment before stock reaches the selected Solvantis location, Solvantis completes it only when recorded incoming purchase-order or branch-transfer stock fully covers the shortage. Stock may temporarily become negative until that supply is received. IMS Notifications names each affected product, fulfilled quantity, stock change, and incoming coverage so staff can complete the pending receipt and verify location stock. An unexplained or only partly covered shortage remains blocked for review.
8. If the remaining quantity will not be shipped as planned, select **Resolve Outstanding** and review the choices below.

| Resolve Outstanding choice | Use it when | Result |
|---|---|---|
| Leave partially open | A short delay is expected | The remainder stays on the current order |
| Cancel outstanding remainder | The customer no longer wants the balance | The source order closes at the quantity already shipped |
| Create held backorder | The balance still needs supply and separate follow-up | Only the unshipped balance moves to a held child order |

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| Fulfil is unavailable | The order is Draft, cancelled, complete, or read-only | Confirm the order and review the available action list |
| A negative-stock warning appears | The entered shipment is greater than stock on hand | Recount the goods and correct the quantity; continue only if the physical shipment truly occurred |
| Shopify incoming-stock notification appears | Shopify fulfilled an order before recorded incoming supply was received | Review every named product, receive the pending PO or branch transfer, and verify the fulfilment location stock |
| The first shipment appears twice | Fulfilment was repeated instead of continued | Stop and review order activity before making another change |
| Resolve Outstanding is blocked | Payments or accounting records need a controlled value decision | Read the preview and choose the offered settlement; do not alter shipped quantities |

## Worked examples

### Ship an order in two deliveries

A customer orders 10 shirts at $49.95 each, total $499.50 including GST. Ship 6 now, leaving 4 outstanding. The first fulfilment reduces stock by 6. When the last 4 arrive, use **Continue Fulfilment** and ship 4; the first 6 are not moved again.

### Move the balance to a held backorder

An order contains 8 lamps. You dispatch 5 and choose **Create backorder for remainder**. Stock reduces by 5, the source order records that shipment, and a held child order carries the remaining 3 without another stock movement.
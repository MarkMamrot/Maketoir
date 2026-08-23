---
{"id":"ims-purchase-orders","title":"Purchase Orders","audiences":["ims"],"capability":"orders","screen":"Purchasing > Purchase Orders","product":"ims","parentId":"ims-purchasing","contexts":["purchase-orders","purchase-order-detail","purchase-order-edit","purchase-order-receive","purchase-order-resolve","purchase-order-replacement"],"order":10,"summary":"Create, confirm, receive, correct, and review supplier purchase orders.","lastReviewed":"2026-08-23","owner":"inventory"}
---
# Purchase Orders

Purchase Orders records planned and received supply from a supplier. Open **Purchasing > Purchase Orders** in IMS. If the sidebar is collapsed, selecting the **Purchasing** icon opens Purchase Orders directly.

## Main operations

- Select **New Purchase Order** to create a Draft, then choose the supplier and receiving location and add product variants and quantities.
- Review costs, tax, dates, freight, discounts, currency, landed costs, and notes before confirming.
- Confirm the order to record incoming stock.
- Use **Receive** or **Continue Receiving** to record only stock that physically arrived.
- Use the available correction, resolution, credit, reversal, or replacement action when later stock or accounting activity prevents direct editing.

## Before you begin

The supplier, receiving location, products, quantities, and commercial values should be known before confirmation. Advisor accounts are read-only. Other actions can be restricted by role or when receipts, payments, credits, allocations, or accounting records already exist.

## Step-by-step workflows

### Create and confirm an order

1. Open **Purchasing > Purchase Orders** and select **New Purchase Order**.
2. Choose the supplier and receiving location.
3. Add product variants and quantities.
4. Review tax-exclusive costs, tax, discounts, freight, currency, landed costs, dates, and notes.
5. Save as Draft if further preparation is needed, or confirm when the order is ready to place.

### Receive stock

1. Open the confirmed order and select **Receive**.
2. Enter only the quantity physically received for each line.
3. Save a partial receipt when more stock is still expected, or complete the receipt when the remaining supply is resolved.
4. Review any protected customer demand or short-receipt warnings before confirming.

## Statuses, calculations, and permissions

- **Draft**: editable preparation state; no incoming stock has been recorded.
- **Confirmed**: expected quantities contribute to incoming stock.
- **Partially Received**: some stock is received and the balance remains outstanding.
- **Completed**: receiving is finished and the order remains as an audit record.
- **Cancelled**: the order is retained but no longer active.

Received inventory cost uses the purchase-order line cost after discount, removes included purchase tax when applicable, converts foreign currency to AUD, and can include allocated freight and landed costs. Solvantis then updates the organisation-wide weighted-average cost for the variant.

## Troubleshooting

- If editing is unavailable, inspect the available order actions. Existing receipts, allocations, payments, credits, or Xero state can require a controlled correction instead of direct editing.
- If only part of the shipment arrived, do not mark unreceived units as received. Save the actual receipt and leave or resolve the outstanding balance.
- If an accounting action fails after stock receipt succeeds, review the visible Xero status or Sync History and retry the unfinished accounting action rather than receiving stock again.

## Related tasks

Related Help topics include Supplier Backorders, Supplier Credit Notes, Stock Allocation, Inventory Costing, Xero, and Order Planner.

## Worked examples

### Receive one shipment in two deliveries

A confirmed order contains 10 units. Six arrive today, so receive 6. The order becomes Partially Received with 4 outstanding. When the final 4 arrive, use Continue Receiving and receive 4; Solvantis completes the order without repeating the first stock movement.

### Correct a completed order

An order has already been received and its accounting record exists. Direct line editing is unavailable because it would rewrite stock and financial history. Use the order's supported correction, supplier-credit, reversal, or replacement workflow according to what physically happened.
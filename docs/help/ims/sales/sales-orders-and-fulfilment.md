---
{"id":"ims-sales-orders-fulfilment","title":"Sales Orders and Fulfilment","audiences":["ims"],"capability":"orders","screen":"Sales > Sales Orders","product":"ims","format":"task","parentId":"ims-customer-orders","relatedTopics":["ims-stock-allocation-backorders","ims-customer-returns-refunds","ims-purchase-orders"],"contexts":["sales-orders"],"contextSections":{"sales-orders":"Step-by-step"},"order":31,"summary":"Create customer sales orders, choose visible order fields, ship actual quantities, and resolve an unshipped remainder.","lastReviewed":"2026-09-09","owner":"sales"}
---
# Sales Orders and Fulfilment

Use Sales Orders to record customer demand and reduce stock only when goods are actually shipped.

## Main operations

- Create and review a Draft order.
- Confirm the order when customer demand is real.
- Choose **Display Fields** to show the order details needed for the current task.
- Select eligible orders, choose a carrier service, submit shipments and download labels.
- Fulfil only the quantities sent to the customer.
- Continue a partial fulfilment or resolve the remainder.

## At a glance

| Stage or choice | What it means | Stock effect |
|---|---|---|
| Draft | The order is still being prepared | No shipment; stock is not reduced |
| Confirmed | Customer demand is active | Quantity can be committed, but stock on hand is unchanged |
| Prepare Shipments | Check delivery details, enter packages and review carrier prices | Saves shipment drafts; stock is unchanged |
| Submit to Australia Post & create labels | Creates billable Australia Post shipments and generates printable labels | Postage is charged; stock is unchanged |
| Partially fulfil now | Ship entered quantities and leave the balance on this order | Only the shipped quantity reduces stock |
| Create backorder for remainder | Ship entered quantities and move the balance to a held child order | Only the shipped quantity reduces stock |
| Complete | All intended shipments or remainder decisions are finished | No extra movement beyond recorded shipments |

## Before you begin

- [ ] Confirm the customer, delivery location, stock location, products, quantities, and tax-inclusive selling prices.
- [ ] Check whether incoming stock is already protected for this order.
- [ ] Count or verify the goods being dispatched.
- [ ] Configure an active Australia Post eParcel account under **Settings > Shipping**.
- [ ] Record variant weights and dimensions for products that will be packed automatically.
- [ ] Make sure you are not using an advisor account, which is read-only.

> **Important:** Record what physically ships. If a shipment succeeds but a later accounting action fails, retry the unfinished accounting action; do not fulfil the goods again.

## Choose list fields

Select **Display Fields** above the Sales Orders list to choose its visible columns. **SO #** and **Customer** remain visible and frozen while the rest of the table scrolls horizontally. Your selection is saved for the current business.

**Channel Order #** shows the order reference supplied by Shopify or another connected sales channel, while **SO #** remains the Solvantis order number. **Shipping Method** preserves the delivery or pickup method supplied by the connected channel. Search matches customer names, Solvantis order numbers and connected-channel order references. Other optional fields include channel, location, status, dates, payment details, totals, notes and delivery address.

For Shopify orders, Solvantis copies the shipping address supplied on the order into the Sales Order delivery fields when the order is created, paid, updated or imported. Shopify pickup or other orders without a shipping address may correctly leave those fields blank.

## Step-by-step

1. Open **Sales > Sales Orders** and select **New Sales Order**.
2. Choose the customer and location, then add the products and ordered quantities.
3. Review prices, tax treatment, early-payment discount, freight, dates, and notes. Save the order as Draft while it is still being prepared.
4. Confirm the order when the customer demand is ready to proceed.
5. To prepare carrier shipments, select one or more eligible Confirmed or In Progress orders on the current page, then select **Ship Orders**. The header checkbox selects every eligible order on the page and remains available while orders are selected; clear it to deselect them all.
6. Choose the carrier account and review each Solvantis SO number, Channel Order #, channel shipping method and delivery address. Channel pickup orders show their pickup location and are excluded because they do not require carrier shipping. The selected carrier account's dispatch location must have a street address, suburb or city, state and postcode; use **Update location** when the shipping screen identifies missing sender fields. Solvantis starts with suggested packages when product measurements and suitable presets are available. Otherwise, enter the parcel length, width, height and final packed weight manually. A preset is optional and only fills its saved dimensions.
7. Use **Add parcel** when the order is packed into more than one parcel. Assign each remaining order-line quantity across the parcels; the total assigned quantity must match the quantity still to ship.
8. Select **Get shipping prices** to retrieve the available Australia Post contract services and GST-inclusive prices for the current destination, dimensions and packed weight. Choose one quoted service for each order. Change a parcel and select **Refresh prices** to price it again.
9. Select **Prepare Shipments** to save the reviewed service, price and parcel drafts. Preparing drafts is local to Solvantis: it does not charge postage, reduce stock, create a carrier shipment or print a label.
10. Review the saved services and prices, then select **Submit to Australia Post & create labels** and confirm the billable action. Solvantis rechecks each selected service and price immediately before submission. If a price changed or the service became unavailable, retrieve prices and prepare a new shipment rather than silently accepting the change.
11. Open the available **Batch PDF** and print it. Solvantis sends the selected shipment batch in one label request so Australia Post can fill each sheet. Parcel Post uses Australia Post's four-label A4 layout; Express Post uses its supported three-label A4 layout, so a mixed-service batch can produce a separate PDF for each required layout. Labels include both the Solvantis SO number and the connected channel order number when the channel supplies one. Use **Check label status** when Australia Post is still generating a label.
12. After the labelled parcels physically leave, select **Mark dispatched**. Solvantis fulfills the quantities assigned to those parcels, reduces stock, and marks the Sales Order In Progress or Completed. Shopify orders then receive the matching fulfillment and Australia Post tracking details. A channel error leaves the shipment at **Channel sync pending** without repeating stock movement; reopen it and select **Mark dispatched** to retry only the channel sync.

Prepared shipments are not lost when the dialog closes. Open **Shipping Workspace** from the Sales Orders header, choose one or more saved shipments, and use **Open selected** to continue pricing submission, label polling, printing, dispatch, or a pending channel retry. To discard local drafts, choose them and use **Delete selected**. A shipment that has reached Australia Post cannot be removed in the workspace because it may already have incurred postage; continue or resolve it with the carrier instead.
12. To record goods that have physically left, select **Fulfil** and enter only the quantity in this shipment for each line.
13. Choose **Partially fulfil now** when the balance should stay on the order, or **Create backorder for remainder** when the balance needs a separate held child order.
14. Confirm the fulfilment. Reopen a partial order and use **Continue Fulfilment** for a later shipment.

For **Early-payment discount**, keep **Customer default** to use the active rule configured on the customer, choose an active rule as an order-only override, or choose **No early-payment discount**. Solvantis saves the rule details and cutoff date on the new Sales Order using its order date. Later changes to the customer or rule do not rewrite the saved order terms.

When adding a payment to a Sales Order with saved early-payment terms, Solvantis previews the discount, qualifying settlement total, cutoff date, and amount still required. The preview includes earlier payments dated on or before the cutoff and the payment currently being entered. A payment after the cutoff does not qualify, and freight is not part of the discount base.

When the entered payment reaches the qualifying settlement, turn on **Apply discount and create the customer credit note** before saving. Solvantis records the payment, a stock-neutral customer credit note, and the discount application together. It does not issue store credit because the credit note settles the order balance. An applied settlement payment and its credit note must be corrected together.

> **Important:** Shopify remains the authority for whether its order was physically fulfilled. If Shopify reports fulfilment before stock reaches the selected Solvantis location, Solvantis completes it only when recorded incoming purchase-order or branch-transfer stock fully covers the shortage. Stock may temporarily become negative until that supply is received. IMS Notifications names each affected product, fulfilled quantity, stock change, and incoming coverage so staff can complete the pending receipt and verify location stock. An unexplained or only partly covered shortage remains blocked for review.
15. If the remaining quantity will not be shipped as planned, select **Resolve Outstanding** and review the choices below.

| Resolve Outstanding choice | Use it when | Result |
|---|---|---|
| Leave partially open | A short delay is expected | The remainder stays on the current order |
| Cancel outstanding remainder | The customer no longer wants the balance | The source order closes at the quantity already shipped |
| Create held backorder | The balance still needs supply and separate follow-up | Only the unshipped balance moves to a held child order |

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| Fulfil is unavailable | The order is Draft, cancelled, complete, or read-only | Confirm the order and review the available action list |
| An order cannot be selected for shipping | It is a POS sale, has no remaining quantity, or is not Confirmed or In Progress | Open the order and resolve its status or remaining quantities |
| Dispatch location is incomplete | The location selected on the carrier account is missing one or more sender fields | Select **Update location** and complete the named street, suburb or city, state, or postcode fields |
| Automatic packing is unavailable | Product measurements are missing or no preset fits | Enter the actual packed dimensions and weight directly, or choose a suitable preset |
| Get shipping prices is unavailable | A parcel field is empty, non-positive, or line quantities are not fully assigned | Complete every parcel measurement and assign the full remaining quantity |
| Prepare Shipments is unavailable after pricing | A quoted service has not been selected for every order | Choose one service for each order |
| Australia Post returns no common service | The selected service is not available for every parcel | Review parcel measurements and destination, or prepare separate shipments where appropriate |
| The price changed before submission | Australia Post returned a different live price for the selected service | Retrieve prices again, review the new amount and prepare a new shipment |
| Label processing does not finish immediately | Australia Post accepted the shipment but is still generating the PDF | Select **Check label status**; do not prepare or submit the shipment again |
| Channel sync remains pending after dispatch | The connected channel rejected the fulfillment, commonly because the Shopify custom app lacks fulfillment-order permissions | In Shopify, grant the app `read_merchant_managed_fulfillment_orders` and `write_merchant_managed_fulfillment_orders`, refresh its access token in **Setup > Connections**, then reopen the shipment and select **Mark dispatched** to retry the channel sync only |
| Submission outcome requires review | The connection ended without a definitive Australia Post response | Stop and verify the shipment in Australia Post before retrying so postage is not purchased twice |
| A negative-stock warning appears | The entered shipment is greater than stock on hand | Recount the goods and correct the quantity; continue only if the physical shipment truly occurred |
| Shopify incoming-stock notification appears | Shopify fulfilled an order before recorded incoming supply was received | Review every named product, receive the pending PO or branch transfer, and verify the fulfilment location stock |
| The first shipment appears twice | Fulfilment was repeated instead of continued | Stop and review order activity before making another change |
| Resolve Outstanding is blocked | Payments or accounting records need a controlled value decision | Read the preview and choose the offered settlement; do not alter shipped quantities |

## Worked examples

### Ship an order in two deliveries

A customer orders 10 shirts at $49.95 each, total $499.50 including GST. Ship 6 now, leaving 4 outstanding. The first fulfilment reduces stock by 6. When the last 4 arrive, use **Continue Fulfilment** and ship 4; the first 6 are not moved again.

### Move the balance to a held backorder

An order contains 8 lamps. You dispatch 5 and choose **Create backorder for remainder**. Stock reduces by 5, the source order records that shipment, and a held child order carries the remaining 3 without another stock movement.
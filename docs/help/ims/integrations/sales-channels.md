---
{"id":"ims-sales-channels","title":"Sales Channels","audiences":["ims"],"capability":"integrations","screen":"Integrations > Sales Channels","product":"ims","format":"overview","parentId":"ims-xero-shopify","contexts":["sales-channels"],"contextSections":{"sales-channels":"Review channel instances"},"relatedTopics":["ims-shopify-sync","ims-online-shop","ims-xero-shopify"],"order":91,"summary":"Review each connected online storefront and its current operating state.","lastReviewed":"2026-09-15","owner":"integrations"}
---
# Sales Channels

Sales Channels shows each online storefront separately. A business can connect multiple Amazon Seller Central accounts, while each Shopify store and the Solvantis Online Store also appears as its own channel.

## Main operations

- Confirm that every expected storefront appears as a separate channel.
- Check whether a channel is active, paused, waiting for setup, or needs attention.
- Review the external account identity and last successful synchronization time.
- Compare the operations supported by each provider.
- Rename a channel so staff can distinguish its purpose.
- Test a Shopify instance against its exact saved store and credentials.
- Connect an Amazon Australia Seller Central account through Amazon's authorization page.
- Test the saved authorization for one Amazon seller account.
- Synchronize Amazon Australia listings and review the linked, unmatched, and conflicting SKU totals.
- Enable inventory for selected one-to-one Amazon listing mappings and synchronize current online availability.
- Choose a dispatch location for each Amazon seller account and synchronize seller-fulfilled orders.
- Dispatch prepared Amazon orders with parcel tracking and monitor any channel confirmation retry.
- Synchronize Amazon returns and externally settled refunds, then review any generated credit-note drafts.
- Check Amazon activation readiness and resolve every reported blocker without activating the channel.
- Open the provider's integration area when catalogue, order, mapping, or synchronization work is required.

## Review channel instances

Open **Integrations > Sales Channels**. Each row identifies the storefront, provider, operating state, account identity, last synchronization time, and supported operations.

Administrators can use the pencil button beside a channel name to rename it. Other IMS users can review the same status information but cannot change it.

Administrators can choose **Test connection** on a Shopify row. Solvantis authenticates with that instance's saved credentials and confirms Shopify returns the same permanent store domain. The result updates the readiness status but does not synchronize products, orders, customers, inventory, or payments.

### Connect Amazon Australia

1. Choose **Connect Amazon**.
2. Enter a channel name that identifies the seller account for staff.
3. Continue to Amazon and sign in to the intended Seller Central account.
4. Review Amazon's permissions and authorize Solvantis.
5. Return to Sales Channels and confirm the Amazon seller ID and **Setup pending** status.

Solvantis verifies that the account actively participates in Amazon Australia and that its listings are not suspended. Each Seller Central account becomes a separate channel, so repeat these steps for another seller account. Authorization alone does not start catalogue, inventory, order, fulfilment, or return synchronization; the channel remains setup pending until every required operation is configured.

Choose **Test connection** on an Amazon row to refresh that account's saved authorization and recheck its Amazon Australia participation.

Choose **Sync listings** to read that seller account's Amazon Australia listings. Solvantis keeps existing valid links and automatically links a listing only when its seller SKU has one exact IMS variant match. A missing SKU remains unmatched, and a SKU used by multiple IMS variants is reported as a conflict. Listing sync does not create products, publish listings, change prices, push inventory, import orders, or activate the channel.

Open **Manage listings**, select linked listings, and choose **Inventory on** to permit stock synchronization for those mappings. **Inventory off** stops later inventory pushes without removing the listing link. Choose **Sync inventory** on the Amazon channel to send the current available quantity for every enabled mapping. Availability is the whole-number stock on hand minus committed stock across the configured online stock locations, never less than zero. Each update sets Amazon's seller-fulfilled quantity to the current Solvantis value, so retrying a synchronization does not add stock twice. Failed updates remain queued for a later retry and are included in the result summary.

After an Amazon channel completes final activation, Solvantis checks for stock movements every 15 minutes and sends changed enabled listings to that exact seller account. A paused, setup-pending, disabled, or automation-paused channel is not processed automatically. Use **Sync inventory** during setup or when an administrator needs an immediate full reconciliation.

Choose **Order setup** and assign the active IMS location that will dispatch orders for that seller account. Each Amazon account can use a different location. Solvantis cannot import an order until its seller account has a dispatch location.

Choose **Sync orders** to import recent Amazon Australia seller-fulfilled orders. The first successful synchronization checks the preceding 24 hours; later synchronizations overlap the saved update time by five minutes so boundary updates are not missed. Repeated updates cannot create a second sales order for the same Amazon account and order ID.

Amazon orders use the standard Online Customer and are shown as paid through Amazon without creating an IMS payment transaction. Amazon settlement accounting remains separate. Exact seller-SKU links use their IMS variants. An order line without a linked seller SKU uses the non-stock online fallback product, preserving the complete order value without changing stock for an unidentified product.

An unshipped order becomes a confirmed IMS sales order and commits stock at the configured dispatch location. Quantities Amazon reports as shipped pass through the normal sales-order fulfilment process, including partial shipments. A cancellation releases remaining committed stock. Pending and Amazon-fulfilled orders are not imported.

When staff mark a prepared Amazon shipment dispatched, Solvantis fulfils the assigned quantities locally and then confirms each tracked parcel to the exact Seller Central account that supplied the order. Each parcel sends its carrier, service, tracking number, dispatch time, and Amazon order-item quantities separately. Multiple parcels can therefore carry different tracking numbers.

If Amazon does not accept a confirmation, the local stock movement remains complete and the shipment shows **Channel sync pending**. Choose **Mark dispatched** again to retry only the outstanding Amazon package confirmations. Completed packages are not sent again, and automatic retries start only after the Amazon channel completes final activation. Amazon Buy Shipping and Ship+ orders do not use this manual confirmation workflow.

Choose **Sync returns** to request or poll the seller return report and read released Amazon refund transactions for that account. Amazon prepares return reports asynchronously, so one synchronization may request or wait for a report and a later synchronization imports it. Overlapping report and finance windows plus Amazon return/refund identities prevent a boundary update from creating a duplicate observation. After final activation, Solvantis performs the same checks automatically.

An Amazon return observation records the return request, quantity, reason, resolution, delivery date, and Amazon-reported refunded amount against an order from that exact seller account. When one unreconciled Amazon RMA and one released refund match the order unambiguously, Solvantis creates an Amazon Draft in **Customer Credit Notes**. Its settlement is already external and every line starts with **Restock** cleared. Review the draft and select **Restock** only for sellable goods physically received before completion. Completing it does not issue store credit, send another Amazon refund, or create a separate Xero credit note.

If an order has multiple unmatched RMAs or refunds, Solvantis reports the evidence as ambiguous and does not guess which records belong together. Review those cases before recording a linked correction.

### Check Amazon activation readiness

Choose **Check readiness** after completing the setup operations for one Amazon seller account. Solvantis rechecks that account's Amazon Australia authorization and reports each requirement separately:

- An active IMS dispatch location is assigned.
- A complete listing synchronization has succeeded, at least one listing was observed, and no listing mapping remains unmatched or conflicting.
- Inventory is enabled for at least one linked listing and a complete inventory synchronization has succeeded.
- Order, return-report, and released-refund synchronization cursors are established.
- No Amazon inventory, report, or shipment-confirmation job is pending or failed.
- No ambiguous refund match or unreviewed Amazon credit-note draft remains.

A passing result records that the seller account is operationally ready. It does not activate the channel, enable automatic synchronization, or turn on any Amazon capability. A later setup change resets the result so administrators must run **Check readiness** again.

Inventory synchronization does not itself activate the Amazon channel. Orders, fulfilments, returns, refunds, and the final readiness check must still be completed before the channel can become active.

> **Important:** Confirm the intended Seller Central account before authorizing. An Amazon seller ID can belong to only one Solvantis business.

| Status | Meaning | Next step |
|---|---|---|
| Active | The instance is enabled and passed its latest readiness check | Continue normal monitoring |
| Paused | New provider synchronization is paused for this instance | Review the provider setup before resuming it |
| Setup pending | The instance has not completed readiness checks | Complete the provider connection setup |
| Needs attention | The latest readiness or runtime state contains an operational problem | Read the safe error summary and inspect the provider integration |

> **Important:** Passing Amazon readiness does not activate the channel. Activation remains a separate controlled rollout step.

## Troubleshooting

| Symptom | What to check |
|---|---|
| An expected store is missing | Confirm the business has that provider enabled, then review its connection setup |
| Two stores look similar | Compare the external account identity; channel names are labels and may be changed later |
| A row needs attention | Use its error summary, then open the matching provider integration for detailed history |
| Products or orders are stale | Check the exact channel instance before retrying provider synchronization |
| Amazon listings are unmatched | Add or correct the IMS variant SKU, then run **Sync listings** again |
| Amazon listings have conflicts | Find the duplicated IMS variant SKU and resolve the intended mapping before enabling later synchronization |
| An Amazon inventory item is skipped | Confirm the listing is linked one-to-one, included, inventory-enabled, and belongs to a stock-tracked IMS product |
| Amazon inventory is queued for retry | Test the exact seller connection, review the mapping, and run **Sync inventory** again after the provider issue is resolved |
| Automatic Amazon inventory updates do not run | Confirm the channel has completed activation, is not paused, and the business's automation is not paused |
| Amazon orders cannot synchronize | Open **Order setup** and choose an active dispatch location for that seller account |
| An Amazon order shows the fallback product | Link that seller SKU to one IMS variant, then review the imported order before fulfilment |
| More Amazon order updates remain | Run **Sync orders** again; each pass is bounded so provider requests remain reliable |
| An Amazon shipment shows Channel sync pending | Check parcel tracking and the exact seller connection, then choose **Mark dispatched** to retry the outstanding confirmation |
| An Amazon return is not yet observed | Amazon may still be preparing the seller return report; check the exact seller account and allow the next synchronization to poll it |
| An Amazon return shows as ambiguous | More than one unmatched RMA or refund exists for the order; review the Amazon records before creating a linked correction |
| An Amazon Draft did not add stock or customer credit | This is intentional; verify the externally settled amount and select Restock only for goods physically received before completing the draft |
| Amazon readiness does not pass | Expand the readiness results and complete each failed item for that exact seller account; pending jobs and unreviewed Amazon drafts must be resolved first |

## Worked examples

### Review two Shopify stores

A retailer operates separate Australian retail and wholesale Shopify stores. **Sales Channels** shows two Shopify rows with different store domains. Staff use the domain to choose the correct instance before investigating a stale order or product mapping.

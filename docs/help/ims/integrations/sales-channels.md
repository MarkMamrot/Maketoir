---
{"id":"ims-sales-channels","title":"Sales Channels","audiences":["ims"],"capability":"integrations","screen":"Integrations > Sales Channels","product":"ims","format":"overview","parentId":"ims-xero-shopify","contexts":["sales-channels"],"contextSections":{"sales-channels":"Review channel instances"},"relatedTopics":["ims-shopify-sync","ims-online-shop","ims-xero-shopify"],"order":91,"summary":"Review and configure each connected online storefront separately.","lastReviewed":"2026-09-27","owner":"integrations","quickSections":["Main operations"]}
---
# Sales Channels

Sales Channels shows each online storefront separately. A business can connect multiple Amazon Seller Central accounts, while each Shopify store and the Solvantis Online Store also appears as its own channel.

## Main operations

- Confirm that every expected storefront appears as a separate channel.
- Check whether a channel is active, paused, waiting for setup, or needs attention.
- Review the external account identity and last successful synchronization time.
- Compare the operations supported by each provider.
- Choose **Configure** on a Shopify row to manage that exact store's connection, products, orders, inventory, customers, gift cards, accounting opt-ins, and activity.

## Publishing and provider operations

- Rename a channel so staff can distinguish its purpose.
- Use **Add Sales Channel** to choose the provider-specific connection setup.
- Define ordered product rules for each exact storefront and preview their recommendations.
- Keep **Automatic assignment** off for Manual mode, or explicitly turn it on for one exact channel.
- Filter **All Products** by a saved rule, select matching products, then include or exclude them explicitly.
- Enable automatic publication for a prepared channel and reconcile confirmed assignment differences.
- Connect and configure multiple Shopify stores with separate credentials.
- Test a Shopify instance against its exact saved store and credentials.
- Connect an Amazon Australia Seller Central account through Amazon's authorization page.
- Test the saved authorization for one Amazon seller account.
- Synchronize Amazon Australia listings and review the linked, unmatched, and conflicting SKU totals.
- Enable inventory for selected one-to-one Amazon listing mappings and synchronize current online availability.
- Choose a dispatch location for each Amazon seller account and synchronize seller-fulfilled orders.
- Dispatch prepared Amazon orders with parcel tracking and monitor any channel confirmation retry.
- Synchronize Amazon returns and externally settled refunds, then review any generated credit-note drafts.
- Check Amazon activation readiness and resolve every reported blocker without activating the channel.
- Activate or deactivate a ready Amazon seller account's automatic synchronization.
- Open the provider's integration area when catalogue, order, mapping, or synchronization work is required.

## Review channel instances

Open **Integrations > Sales Channels**. Each row identifies the storefront, provider, operating state, account identity, last synchronization time, and supported operations.

Administrators can use the pencil button beside a channel name to rename it. Choose **Configure** on a Shopify row to open that store's dedicated detail view. Other IMS users can review the same status information but cannot change it.

### Assign products with channel rules

Choose **Product rules** on any channel row to define recommendations for that exact storefront. A product's **Online candidate** setting means its online content should be prepared and makes it available to rule conditions; it does not publish the product or include it in every channel.

Rules run in their displayed order and the first matching enabled rule decides whether to include or exclude the product. A rule can require all of its conditions or any one condition. Conditions can use catalogue facts such as active status, online candidate, product type, category, brand, tags, content, images and variant count. A product that matches no rule is excluded by default.

Use **Save and preview** to store the rules and inspect the result without changing inclusions. Saving a rule never changes a product's channel inclusion. The preview shows the matched rule, recommendation, current control and provider state.

Use the **Automatic assignment** toggle on the exact channel row:

- **Off (Manual)** is the default. Rules are filters and recommendations only; staff choose every inclusion or exclusion.
- **On (Automatic)** checks rules hourly and includes new matching products that are not protected by an explicit choice. It never removes an existing inclusion when a product stops matching.

Automatic assignment runs only for an enabled, active and ready channel that has been explicitly switched on. It updates Solvantis destination intent only; provider publication remains controlled separately.

An explicit **Always include** or **Always exclude** choice is protected from later automation. Choose **Follow channel mode** to remove that protection while preserving the current inclusion unless the channel is Automatic and the product matches an Include rule.

For one saved product, open **Products > All Products > Channels**, choose **Include in Channels**, review configured destinations and recommendations, then apply the checked channels. For several products, open **Products > All Products**, choose the exact sales channel and one of its saved Include rules, then select some products or use **Select all matching**. Choose **Include in Sales Channels**, confirm the exact channel, and use **Always include**. Filtering, previewing, selecting and saving rules do not change inclusion by themselves.

### Publish assigned products

Product publication is off by default for every channel. An administrator must first complete the provider setup and readiness checks, activate the channel, then choose **Automatic publication** for that exact storefront. Enabling the setting does not immediately change provider products.

Choose **Reconcile products** to review how many assignments differ from their observed provider state. Confirm that count to queue and process the current differences. Solvantis rechecks each product's latest assignment before contacting the provider, so a queued item whose intent has changed is skipped. Blocked products retain their assignment and show an issue that must be corrected before reconciliation is retried. Automatic scheduled reconciliation uses the same safeguards and does not run for disabled, paused, unready, or opted-out channels.

Provider behavior differs:

- The Solvantis Online Store publishes or unpublishes the local online product after confirming the product is active and has an active variant with a positive price.
- Shopify changes an exactly linked product between Active and Draft. A product without an exact link to that Shopify store is blocked rather than guessed.
- Amazon creates or removes seller-fulfilled offers only for variants mapped to an existing ASIN and seller SKU in that exact seller account. The product must be active, have a positive tax-inclusive AUD price, and use tracked inventory. Full Amazon parent/child catalogue creation is not supported by this workflow.

Assignment intent and provider state are separate. **Include** means Solvantis should publish when the channel is eligible; it does not prove that the provider has accepted the change. Review blocked or failed results before relying on an offer being live.

Administrators can choose **Test connection** on a Shopify row. Solvantis authenticates with that instance's saved credentials and confirms Shopify returns the same permanent store domain. The result updates the readiness status but does not synchronize products, orders, customers, inventory, or payments. After a successful test, choose **Activate** to make that exact store eligible for its enabled channel workflows. Choose **Deactivate** to pause it while retaining credentials, mappings, assignments, and history.

### Add a sales channel

Choose **Add Sales Channel**, then choose a provider. Amazon continues to Seller Central authorization for a new seller account. Shopify opens an exact-store configuration form. Enable the single Solvantis Online Store channel in Online Channels settings.

### Connect Shopify

1. Choose **Add Sales Channel**, then **Shopify**.
2. Enter a staff-facing channel name and the permanent domain ending in `.myshopify.com`.
3. Choose client credentials or a legacy Admin API token, then enter the credentials for that exact store.
4. Save the channel, choose **Test connection**, and correct any reported credential or domain mismatch.
5. After the test succeeds, choose **Activate**.

Repeat these steps for another Shopify store. Use **Configure** on a Shopify row to change that instance. A blank secret field keeps the saved secret only while the authentication mode and permanent store domain remain unchanged; stored secrets are never displayed. Changing the store domain, authentication mode, client ID, token, or secret deactivates the instance. Test the changed connection successfully, then choose **Activate** explicitly. Changing only the channel name or saving unchanged credentials preserves the current state.

Exact-instance Shopify credentials control connection testing, channel product publication, inventory synchronization, price synchronization, and linked variant updates. Choose the intended Shopify storefront before previewing or manually pushing inventory or prices. Stock changes fan out only to stores with an exact linked variant mapping; each store uses its own Shopify inventory location, IMS stock locations, and safety buffer. A failure in one store remains queued for retry without preventing another linked store from updating.

Inventory writes set Shopify's absolute available quantity rather than adding or subtracting a delta. Products with **Tracks inventory** off do not receive quantity updates. Price and variant updates use only the selected or mapped storefront identity and do not publish, activate, draft, or otherwise change product publication state.

Under **Integrations > Sales Channels**, choose **Configure** for the intended store, then open **Orders & Inventory** before importing orders or checking webhooks. **Register webhooks via API** creates or repairs that store's supported order, fulfilment, refund, return-observation, and Shopify Payments payout subscriptions using its exact callback URL. Client-credential connections use the saved app secret for delivery verification. A legacy Admin API token connection also needs that storefront's webhook signing secret when it is first registered; the secret is encrypted and is not displayed later.

The same storefront choice owns its order start date, online-orders location, order-sync switch, and automatic daily Xero batch switch. When only one active Shopify store exists it is selected automatically; when more than one exists, choose the store before changing settings or running an action. Each store creates separate daily Xero batches, gateway mappings and payout records.

Webhook health is tracked separately for every storefront and topic. A missing or failed topic does not fall back to another Shopify connection. Every Shopify webhook uses the exact storefront callback shown on the Orders tab; business-level callback URLs are not supported. Registering webhooks or importing orders does not change product publication state.

### Connect Amazon Australia

1. Choose **Add Sales Channel**, then **Amazon Australia**.
2. Enter a channel name that identifies the seller account for staff.
3. Continue to Amazon and sign in to the intended Seller Central account.
4. Review Amazon's permissions and authorize Solvantis.
5. Return to Sales Channels and confirm the Amazon seller ID and **Setup pending** status.

Solvantis verifies that the account actively participates in Amazon Australia and that its listings are not suspended. Each Seller Central account becomes a separate channel, so repeat these steps for another seller account. Authorization alone does not start catalogue, inventory, order, fulfilment, or return synchronization; the channel remains setup pending until every required operation is configured.

Choose **Test connection** on an Amazon row to refresh that account's saved authorization and recheck its Amazon Australia participation.

Choose **Sync listings** to read that seller account's Amazon Australia listings. Solvantis keeps existing valid links and automatically links a listing only when its seller SKU has one exact IMS variant match. A missing SKU remains unmatched, and a SKU used by multiple IMS variants is reported as a conflict. After the final page, listings no longer returned by Amazon are archived and stop receiving inventory updates. Listing sync does not create products, publish listings, change prices, push inventory, import orders, or activate the channel.

Open **Manage listings**, choose linked listings, and choose **Inventory on** to permit stock synchronization for those mappings. To prepare a new seller offer for a product already present in Amazon's catalogue, search for one active IMS variant under **Add existing-ASIN offer**, enter its 10-character ASIN and the seller SKU for this account, then save the mapping. Saving enables offer price and inventory controls but does not contact Amazon; the offer changes only during a later confirmed product reconciliation. A variant or seller SKU can be linked only once in the same Amazon account.

**Inventory off** stops later inventory pushes without removing the listing link. Choose **Sync inventory** on the Amazon channel to send the current available quantity for every enabled mapping. Availability is the whole-number stock on hand minus committed stock across the configured online stock locations, never less than zero. Amazon's seller-fulfilled quantity becomes the current Solvantis value, so retrying a synchronization does not add stock twice. Failed updates remain queued for a later retry and are included in the result summary.

After an Amazon channel completes final activation, Solvantis checks for stock movements every 15 minutes and sends changed enabled listings to that exact seller account. A paused, setup-pending, disabled, or automation-paused channel is not processed automatically. Use **Sync inventory** during setup or when an administrator needs an immediate full reconciliation.

Choose **Order setup** and assign the active IMS location that will dispatch orders for that seller account. Each Amazon account can use a different location. Solvantis cannot import an order until its seller account has a dispatch location.

Choose **Sync orders** to import recent Amazon Australia seller-fulfilled orders. The first successful synchronization checks the preceding 24 hours; later synchronizations overlap the saved update time by five minutes so boundary updates are not missed. When a large window needs more than one pass, Solvantis resumes the same window on the next pass and advances the cursor only after every page completes. Repeated updates cannot create a second sales order for the same Amazon account and order ID.

Amazon orders use the standard Online Customer and are shown as paid through Amazon without creating an IMS payment transaction. Amazon settlement accounting remains separate. Exact seller-SKU links use their IMS variants. An order line without a linked seller SKU uses the non-stock online fallback product, preserving the complete order value without changing stock for an unidentified product.

An unshipped order becomes a confirmed IMS sales order and commits stock at the configured dispatch location. Quantities Amazon reports as shipped pass through the normal sales-order fulfilment process, including partial shipments. A cancellation releases remaining committed stock. Pending and Amazon-fulfilled orders are not imported.

When staff mark a prepared Amazon shipment dispatched, Solvantis fulfils the assigned quantities locally and then confirms each tracked parcel to the exact Seller Central account that supplied the order. Each parcel sends its carrier, service, tracking number, dispatch time, and Amazon order-item quantities separately. Multiple parcels can therefore carry different tracking numbers.

If Amazon does not accept a confirmation, the local stock movement remains complete and the shipment shows **Channel sync pending**. Choose **Mark dispatched** again to retry only the outstanding Amazon package confirmations. Completed packages are not sent again. Automatic retries start only after final activation and stop after five failed attempts; an administrator can retry manually after correcting the cause. Amazon Buy Shipping and Ship+ orders do not use this manual confirmation workflow.

Choose **Sync returns** to request or poll the seller return report and read released Amazon refund transactions for that account. Amazon prepares return reports asynchronously, so one synchronization may request or wait for a report and a later synchronization imports it. Overlapping report and finance windows plus Amazon return/refund identities prevent a boundary update from creating a duplicate observation. Large Finance windows resume from the saved page on the next run. Return and refund evidence is retained even when its local order arrives later. After final activation, Solvantis performs the same checks automatically.

An Amazon return observation records the return request, quantity, reason, resolution, delivery date, and Amazon-reported refunded amount against an order from that exact seller account. When one unreconciled Amazon RMA and one released refund match the order unambiguously, Solvantis creates an Amazon Draft in **Customer Credit Notes**. Its settlement is already external and every line starts with **Restock** cleared. Review the draft and choose **Restock** only for sellable goods physically received before completion. Completing it does not issue store credit, send another Amazon refund, or create a separate Xero credit note.

If an order has multiple unmatched RMAs or refunds, Solvantis reports the evidence as ambiguous and does not guess which records belong together. Choose **Resolve refunds**, choose the order, one RMA, and one released refund, then create the review draft. Solvantis verifies that both records belong to the same Amazon order and are still unlinked. The return report amount supplies the customer refund value; the Finance seller-net amount is shown only to identify the settlement.

### Check Amazon activation readiness

Choose **Check readiness** after completing the setup operations for one Amazon seller account. Solvantis rechecks that account's Amazon Australia authorization and reports each requirement separately:

- An active IMS dispatch location is assigned.
- A complete listing synchronization has succeeded in the last 24 hours, at least one listing was observed, and no current listing mapping remains unmatched or conflicting.
- Inventory is enabled for at least one linked listing and synchronized after the latest listing sync within the last hour.
- The order cursor is no more than 30 minutes old, return and refund cursors are no more than 26 hours old, and no order or Finance page window remains incomplete.
- No Amazon inventory, report, or shipment-confirmation job is pending or failed.
- No ambiguous refund match or unreviewed Amazon credit-note draft remains.

A passing result records that the seller account is operationally ready but does not activate it. A later setup change resets the result so administrators must run **Check readiness** again.

Inventory synchronization does not itself activate the Amazon channel. Orders, fulfilments, returns, refunds, and the final readiness check must still be completed before the channel can become active.

### Activate or deactivate Amazon

After every readiness check passes, choose **Activate** and confirm the exact seller account. Solvantis repeats the complete readiness assessment immediately before changing the state. Activation succeeds only if the persisted channel is still ready after that assessment.

Activation starts automatic inventory, seller-fulfilled order, shipment-confirmation retry, return-report, and released-refund synchronization for that seller account. The business-wide automation pause still prevents scheduled processing while it is on.

Choose **Deactivate** to stop that channel from entering any automatic Amazon synchronization. Deactivation retains its authorization, seller identity, mappings, settings, synchronization cursors, observations, orders, and credit notes. Manual setup controls remain available, and a later activation repeats the complete readiness assessment.

> **Important:** Confirm the intended Seller Central account before authorizing. An Amazon seller ID can belong to only one Solvantis business.

| Status | Meaning | Next step |
|---|---|---|
| Active | The instance is enabled and passed its latest readiness check | Continue normal monitoring |
| Paused | New provider synchronization is paused for this instance | Review the provider setup before resuming it |
| Setup pending | The instance has not completed readiness checks | Complete the provider connection setup |
| Needs attention | The latest readiness or runtime state contains an operational problem | Read the safe error summary and inspect the provider integration |

> **Important:** Read the confirmation carefully. Activating one Amazon row starts automation only for the seller ID displayed on that row.

## Troubleshooting

| Symptom | What to check |
|---|---|
| An expected store is missing | Confirm the business has that provider enabled, then review its connection setup |
| Two stores look similar | Compare the external account identity; channel names are labels and may be changed later |
| A row needs attention | Use its error summary, then open the matching provider integration for detailed history |
| Products or orders are stale | Check the exact channel instance before retrying provider synchronization |
| Amazon listings are unmatched | Add or correct the IMS variant SKU, then run **Sync listings** again |
| Amazon listings have conflicts | Find the duplicated IMS variant SKU and resolve the intended mapping before enabling later synchronization |
| An Amazon product cannot be published | Confirm one active IMS variant is mapped to an existing ASIN and unique seller SKU, has a positive price, and uses tracked inventory |
| Reconcile products is unavailable | Complete readiness, activate the exact channel, and enable Automatic publication |
| A product remains blocked after reconciliation | Review its provider link and required product data, correct the issue, then reconcile again |
| An Amazon inventory item is skipped | Confirm the listing is linked one-to-one, included, inventory-enabled, and belongs to a stock-tracked IMS product |
| Amazon inventory is queued for retry | Test the exact seller connection, review the mapping, and run **Sync inventory** again after the provider issue is resolved |
| Automatic Amazon inventory updates do not run | Confirm the channel has completed activation, is not paused, and the business's automation is not paused |
| Amazon orders cannot synchronize | Open **Order setup** and choose an active dispatch location for that seller account |
| An Amazon order shows the fallback product | Link that seller SKU to one IMS variant, then review the imported order before fulfilment |
| More Amazon order updates remain | Run **Sync orders** again; Solvantis resumes the saved window until every page completes |
| An Amazon shipment shows Channel sync pending | Check parcel tracking and the exact seller connection, then choose **Mark dispatched** to retry the outstanding confirmation |
| An Amazon return is not yet observed | Amazon may still be preparing the seller return report; check the exact seller account and allow the next synchronization to poll it |
| An Amazon return shows as ambiguous | Choose **Resolve refunds**, select one RMA and one released refund for the same order, then create the review draft |
| An Amazon Draft did not add stock or customer credit | This is intentional; verify the externally settled amount and select Restock only for goods physically received before completing the draft |
| Amazon readiness does not pass | Expand the readiness results and complete each failed item for that exact seller account; pending jobs and unreviewed Amazon drafts must be resolved first |
| Amazon activation is rejected after readiness passed | Setup changed or new unresolved work appeared before activation; run **Check readiness** again and resolve the new blocker |

## Worked examples

### Review two Shopify stores

A retailer operates separate Australian retail and wholesale Shopify stores. **Sales Channels** shows two Shopify rows with different store domains. Staff use the domain to choose the correct instance before investigating a stale order or product mapping.

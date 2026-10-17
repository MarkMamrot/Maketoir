---
{"id":"ims-sales-channels","title":"Sales Channels","audiences":["ims"],"capability":"integrations","screen":"Sales > Sales Channels","product":"ims","format":"overview","parentId":"ims-xero-shopify","contexts":["sales-channels","online-sales-recovery"],"contextSections":{"sales-channels":"Review channel instances","online-sales-recovery":"Online sales recovery"},"relatedTopics":["ims-shopify-sync","ims-online-shop","ims-xero-shopify","ims-business-operations-pos-settings"],"order":91,"summary":"Review Point of Sale, the B2B Wholesale Portal, each online storefront and available online order recovery status.","lastReviewed":"2026-10-17","owner":"integrations","quickSections":["Main operations"],"navigation":{"category":"sales","label":"Configure sales channels"}}
---
# Sales Channels

Sales Channels brings together Point of Sale, the B2B Wholesale Portal and each online storefront. Point of Sale appears once for the business, with its active POS location count. A business can connect multiple Amazon Seller Central accounts, while each Shopify store and the Solvantis Online Store also appears as its own channel.

Open **Sales > Sales Channels** from the sidebar. The storefront icon identifies physical POS, the office-building icon identifies B2B wholesale, and the globe identifies online channels. **Add Sales Channel** uses the aqua-teal action colour.

## Main operations

- Confirm that every expected storefront appears as a separate channel.
- Review whether Point of Sale and the B2B Wholesale Portal are enabled in Business Operations.
- Choose **Configure** on either built-in channel to open its existing settings. Use **Manage locations** for POS locations or **Preview portal** for the enabled B2B portal.
- Check whether a channel is active, paused, waiting for setup, or needs attention.
- Review the external account identity and last successful synchronization time.
- Compare the operations supported by each provider.
- Choose **Configure** on a channel row to open that exact storefront or seller account. Shopify and Amazon open dedicated channel details; the Solvantis Online Store opens its existing setup area.
- Check **Online sales recovery** for baseline completion, incremental coverage, queued or failed work and orders needing review. Admins and SuperAdmins can use the recovery controls when available.

## Online sales recovery

Open **Sales > Sales Channels > Online sales recovery**. Use **Refresh recovery status** to read current status; this does not import orders or post accounting.

Availability is shown explicitly:

- **Unavailable until rollout:** current order synchronization continues unchanged. This status does not activate recovery or grant access to it.
- **Validation:** recovery is being checked while existing catch-up behaviour remains in place. Do not assume that opening POS or IMS has stopped triggering catch-up.
- **Cutover:** bounded scheduled order reconciliation is active. Only after verified cutover does opening POS or IMS no longer trigger order catch-up.

Webhooks prompt order updates. Scheduled reconciliation starts with a recent updated-order window, normally seven days, then checks changes since its last confirmed checkpoint with a short overlap. An older order changed recently can still be discovered. It does not automatically audit every imported order; historical backfills require a separate, explicitly chosen scope.

Daily accounting runs independently from its configured business start date, after each trading day closes. Older accounting days and earlier credit-note postings are left unchanged. A complete initial catch-up confirms only the displayed recovery window: it does not certify all historical orders or completion of gift card and accounting work.

Each exact storefront shows:

| Status | Meaning |
|---|---|
| Initial catch-up | Whether the displayed initial recovery window is complete |
| Recovery coverage from | The earliest updated-order timestamp covered by this recovery rollout |
| Scheduled accounting from | The first business date eligible for scheduled accounting |
| Historical work held | Earlier saved work retained outside the active scope; retry does not resume it |
| Incremental coverage through | The latest confirmed recovery coverage, not the time a page was opened |
| Next scheduled check | When the next recovery check is expected; it is not a completion guarantee |
| Queued work / Failed work | Work still waiting or needing a recovery retry |
| Orders needing review | The total number needing investigation; the displayed references may be a limited selection |

When the review list is limited, **Showing** states how many references are displayed out of the total. This is not the full review list; do not assume that orders absent from the displayed selection need no review.

Admins and SuperAdmins can choose **Retry recovery for** the affected storefront. A retry requests unfinished work; it does not mean processing is already complete. Refresh status afterwards to inspect the result. Other users, including Advisors with accounting-sync access, can review status but cannot retry, pause or resume order recovery.

When scheduled recovery is active, **Import Orders from Shopify** reports **queued for scheduled recovery**, not a completed import or an imported-order count. Check recovery progress before assuming that the order is ready. Before rollout, the existing direct import still reports its completed counts.

Missing gift card permissions or genuine gift card discrepancies remain failed until an explicit retry. Correct the provider permissions or investigate the discrepancy first, then ask an Admin or SuperAdmin to retry. Retrying creates recovery work but never clears an order's review requirement.

**Pause recovery** and **Resume recovery** apply to scheduled order recovery across channels. Pausing does not restore old historical scans and is not an accounting posting switch. Resume recovery before requesting a retry.

Manual daily posting remains blocked until the selected recovery window and catch-up readiness checks pass. Dates before the configured accounting start remain excluded. Review holds on the affected accounting day remain blocking; an unrelated historical review does not prevent a verified current day from posting. There is no posting override, force-ready action or clear-review bypass. Retry does not clear review for a previously posted day. Investigate non-refund late changes to an already posted day in **Online Sales** before treating the accounting as reconciled.

Recovered refunds repair local orders and linked credit notes and automatically use the existing Xero flow when eligible. They never charge or refund the customer again. Do not repeat the original customer refund to repair local or accounting records.

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

The **Point of Sale** and **B2B Wholesale Portal** rows use existing Business Operations settings. Administrators choose **Configure** to open **Settings > Point of Sale** or **Settings > Sales & Customers > Wholesale portal**. POS shows **Setup pending** when enabled without active POS locations. Its count includes active locations marked for POS or with a POS location code; inactive and non-POS locations are excluded. **Manage locations** opens the existing Locations workspace. **Preview portal** opens the enabled wholesale portal's staff preview in a new tab.

These built-in rows are navigation summaries, not new online integrations. They do not change stock, pricing, order attribution, accounting or product publishing. They do not have external connection tests or synchronization timestamps. Staff without administrator access can use the location and preview links but do not receive a Configure action.

Open **Sales > Sales Channels**. Each compact row identifies the storefront, provider, operating state, account identity, last successful synchronization time, and number of supported features. A current safe error appears beneath the affected channel when it needs attention.

Rows use aligned identity, status, summary and action columns with alternating backgrounds to help track each channel across the list. On smaller screens, the same information stacks within each channel row.

Administrators choose **Configure** to open the provider details where connection settings and channel workflows belong. Use the three-dot menu for the quick **Test connection** and **Activate** or **Deactivate** commands. Other IMS users choose **View details** and can review the same information without changing it.

### Assign products with channel rules

Choose **Configure**, then open **Products** and choose **Product rules** to define recommendations for that exact storefront. A product's **Online candidate** setting means its online content should be prepared and makes it available to rule conditions; it does not publish the product or include it in every channel.

Rules run in their displayed order and the first matching enabled rule decides whether to include or exclude the product. A rule can require all of its conditions or any one condition. Conditions can use catalogue facts such as active status, online candidate, product type, category, brand, tags, content, images and variant count. A product that matches no rule is excluded by default.

Use **Save and preview** to store the rules and inspect the result without changing inclusions. Saving a rule never changes a product's channel inclusion. The preview shows the matched rule, recommendation, current control and provider state.

Use the **Automatic assignment** toggle under the exact channel's **Products** section:

- **Off (Manual)** is the default. Rules are filters and recommendations only; staff choose every inclusion or exclusion.
- **On (Automatic)** checks rules hourly and includes new matching products that are not protected by an explicit choice. It never removes an existing inclusion when a product stops matching.

Automatic assignment runs only for an enabled, active and ready channel that has been explicitly switched on. It updates Solvantis destination intent only; provider publication remains controlled separately.

An explicit **Always include** or **Always exclude** choice is protected from later automation. Choose **Follow channel mode** to remove that protection while preserving the current inclusion unless the channel is Automatic and the product matches an Include rule.

For one saved product, open **Products > All Products > Channels and Publishing**, choose **Include in Channels**, review configured destinations and recommendations, then choose **Apply**. **Apply Rules** fills the channel checkboxes from eligible rule recommendations; it does not save or publish those selections. Solvantis sends applied selections to each active, ready channel and shows a provider link after success. For several products, open **Products > All Products**, choose the exact sales channel and one of its saved Include rules, then select some products or use **Select all matching**. Choose **Include in Sales Channels**, confirm the exact channel, and use **Always include**. Filtering, previewing, selecting and saving rules do not change inclusion by themselves.

If you change channel checkboxes and then cancel, dismiss the dialog, or navigate away without applying, Solvantis warns that the selections have not been applied. Choose **Return** to keep reviewing, or **Leave without applying** to discard those checkbox changes. Reloading or closing the browser also warns about unapplied selections.

### Publish assigned products

Before publishing to any online channel, the saved product must be active and have a **Title**, a non-empty **Description**, and at least one active variant. Every active variant needs a **SKU** and a positive **RRP** (GST-inclusive). The website title is used when populated; otherwise the product name supplies the title. Inactive variants are not checked. Save product edits before opening the channel picker. Missing fields are listed in the Apply dialog and block publication; bulk inclusion also checks all selected products before saving any inclusions. Background publication checks these same requirements again. Removing a product from a channel does not require those fields.

Explicit **Apply** actions run immediately for an active, ready channel. **Automatic publication** is off by default and controls later background reconciliation of assignment differences; enabling it does not immediately change provider products.

Choose **Reconcile products** to review how many assignments differ from their observed provider state. Confirm that count to queue and process the current differences. Solvantis rechecks each product's latest assignment before contacting the provider, so a queued item whose intent has changed is skipped. Blocked products retain their assignment and show an issue that must be corrected before reconciliation is retried. Automatic scheduled reconciliation uses the same safeguards and does not run for disabled, paused, unready, or opted-out channels.

Provider behavior differs:

- The Solvantis Online Store publishes or unpublishes the local online product after confirming the product is active and has an active variant with a positive price.
- Shopify changes an exactly linked product between Active and Draft. When an explicitly included product has no link, Solvantis creates it as a Draft in the selected Shopify store, saves the exact product and variant links, sends its images and inventory, then makes it Active. Existing ambiguous or conflicting links remain blocked rather than guessed.
- Amazon creates or removes seller-fulfilled offers only for variants mapped to an existing ASIN and seller SKU in that exact seller account. The product must be active, have a positive tax-inclusive AUD price, and use tracked inventory. Full Amazon parent/child catalogue creation is not supported by this workflow.

Assignment intent and provider state are separate. After **Apply**, confirm the Provider column says **Published** and use **View listing** or **Manage listing**. Missing required fields prevent new inclusion from being saved. A later provider blocker or failure can retain inclusion without making the product live; correct the issue, save the product and reopen **Include in Channels**, leave the intended channel checked, then choose **Apply** to retry.

Administrators can choose **Test connection** from a Shopify row's three-dot menu or from its **Connection** details. Solvantis authenticates with that instance's saved credentials and confirms Shopify returns the same permanent store domain. The result updates the readiness status but does not synchronize products, orders, customers, inventory, or payments. After a successful test, choose **Activate** to make that exact store eligible for its enabled channel workflows. Choose **Deactivate** to pause it while retaining credentials, mappings, assignments, and history.

### Add a sales channel

Choose **Add Sales Channel**, then choose a provider. Amazon continues to Seller Central authorization for a new seller account. Shopify opens an exact-store configuration form. Enable the single Solvantis Online Store channel in Online Channels settings.

### Connect Shopify

1. Choose **Add Sales Channel**, then **Shopify**.
2. Enter a staff-facing channel name and the permanent domain ending in `.myshopify.com`.
3. Choose client credentials or a legacy Admin API token, then enter the credentials for that exact store.
4. Save the channel, choose **Test connection**, and correct any reported credential or domain mismatch.
5. After the test succeeds, choose **Activate**.

Repeat these steps for another Shopify store. Use **Configure** on a Shopify row to change that instance. A blank secret field keeps the saved secret only while the authentication mode and permanent store domain remain unchanged; stored secrets are never displayed. Changing the store domain, authentication mode, client ID, token, or secret deactivates the instance. Test the changed connection successfully, then choose **Activate** explicitly. Changing only the channel name or saving unchanged credentials preserves the current state.

The Shopify configuration is divided by task. **Connection** contains credentials, connection testing, activation and webhooks. **Products** contains assignment rules, publication controls, the exact-store product list and product import. **Orders** contains order settings and manual import, while **Inventory** contains stock synchronization. Customer synchronization is under **Customers**, and gift card mode and reconciliation are under **Gift Cards**. Store-specific Xero options are under **Accounting**, and synchronization history is under **Activity**.

In **Products**, review or filter the current product list before starting a catalogue import. **Import Products from Shopify** appears below that list. An import creates missing products and variants and refreshes linked catalogue details; it does not change stock quantities. Opening stock is handled separately by **Import Shopify Opening Stock**.

Exact-instance Shopify credentials control connection testing, channel product publication, inventory synchronization, price synchronization, and linked variant updates. Choose the intended Shopify storefront before previewing or manually pushing inventory or prices. Stock changes fan out only to stores with an exact linked variant mapping; each store uses its own Shopify inventory location, IMS stock locations, and safety buffer. A failure in one store remains queued for retry without preventing another linked store from updating.

Inventory writes set Shopify's absolute available quantity rather than adding or subtracting a delta. Products with **Tracks inventory** off do not receive quantity updates. Price and variant updates use only the selected or mapped storefront identity and do not publish, activate, draft, or otherwise change product publication state.

Under **Sales > Sales Channels**, choose **Configure** for the intended store. Open **Orders** to change order settings or import orders, and open **Connection** to check or register webhooks. **Register webhooks via API** creates or repairs that store's supported order, fulfilment, refund, return-observation, and Shopify Payments payout subscriptions using its exact callback URL. Client-credential connections use the saved app secret for delivery verification. For a legacy Admin API token connection, enter the **API secret key** of the same Shopify app that issued that token as the webhook signing secret. Do not use the Admin API access token or the separate signing secret for webhooks created manually under Shopify's Notifications settings. The secret is encrypted and is not displayed later.

The same storefront choice owns its order start date, online-orders location, order-sync switch, and automatic daily Xero batch switch. When only one active Shopify store exists it is selected automatically; when more than one exists, choose the store before changing settings or running an action. Each store creates separate daily Xero batches, gateway mappings and payout records.

Webhook registration is tracked separately for every storefront and topic. A Registered status confirms the saved subscription, not that Shopify deliveries are being received and verified. Compare a new Shopify order with its IMS order and review **Activity** when checking delivery health. A missing or failed topic does not fall back to another Shopify connection. Every Shopify webhook uses the exact storefront callback shown under **Connection**; business-level callback URLs are not supported. Registering webhooks or importing orders does not change product publication state.

### Connect Amazon Australia

1. Choose **Add Sales Channel**, then **Amazon Australia**.
2. Enter a channel name that identifies the seller account for staff.
3. Continue to Amazon and sign in to the intended Seller Central account.
4. Review Amazon's permissions and authorize Solvantis.
5. Return to Sales Channels and confirm the Amazon seller ID and **Setup pending** status.

Solvantis verifies that the account actively participates in Amazon Australia and that its listings are not suspended. Each Seller Central account becomes a separate channel, so repeat these steps for another seller account. Authorization alone does not start catalogue, inventory, order, fulfilment, or return synchronization; the channel remains setup pending until every required operation is configured.

Choose **Configure** on an Amazon row to open its dedicated details. **Connection & readiness** contains connection testing, readiness checks, and activation. **Products**, **Listings**, **Orders & inventory**, and **Returns** contain the corresponding exact-seller workflows described below.

Choose **Test connection** from the row's three-dot menu or from **Connection & readiness** to refresh that account's saved authorization and recheck its Amazon Australia participation.

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

### A retry does not clear posted-day review

The retail store has a complete baseline, two failed recovery items and one order needing review because a non-refund change arrived after the day was posted. An Admin chooses **Retry recovery for** that store and refreshes status. The failed work can recover, but the order still needs review; the retry is not permission to repost that day.

### Recover an already settled refund

A customer refund completed at the online provider while order updates were interrupted. Recovery repairs the local order and linked credit note and automatically follows the existing Xero flow when eligible. Staff check the recovered records and accounting status rather than issuing the customer another refund.

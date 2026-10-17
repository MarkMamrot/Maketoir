---
{"id":"ims-shopify-sync","title":"Shopify Sync and Product Mapping","audiences":["ims"],"capability":"integrations","requiresCapabilities":["shopify"],"screen":"Sales > Sales Channels > Shopify store > Configure","product":"ims","format":"task","parentId":"ims-xero-shopify","contexts":["sales-channels","shopify","shopify-refund"],"contextSections":{"sales-channels":"Step-by-step","shopify":"Shopify catalogue and simple products","shopify-refund":"Shopify refunds and return costs"},"relatedTopics":["ims-xero-shopify","ims-sales-channels","ims-online-shop","ims-customer-orders"],"order":92,"summary":"Configure one Shopify store, safely onboard its catalogue and mapped opening stock, and maintain synchronization.","lastReviewed":"2026-10-17","owner":"integrations","quickSections":["Main operations","At a glance","Shopify catalogue and simple products"],"navigation":{"category":"sales","label":"Sync Shopify and repair product mappings"}}
---
# Shopify Sync and Product Mapping

Use Shopify integration status and history to keep supported catalogue and order information linked without creating duplicate products or incorrect stock movements.

## Main operations

- Confirm Shopify connection health and required access before syncing.
- Normally create products in Solvantis and sync them to Shopify. Product upload and resync send each variant's nonblank SKU and check that Shopify saved it. Import a Shopify catalogue in paced batches for onboarding.
- For onboarding only, explicitly map Shopify locations to Solvantis locations, preview inventory, and type the safety phrase before replacing mapped stock.
- Follow the separate **Step 1 · Catalogue** and **Step 2 · Opening stock** panels; watch confirmed batch progress while stock is applied.
- Pull Shopify customers into IMS and choose how long customers without recent orders remain active.
- Review products that are linked, not linked, or waiting for synchronization.
- Trace customer, order, inventory, fulfilment, and webhook activity in sync history.
- Ask Assistant for a bounded local summary of connection readiness, catalogue linkage and recent sync outcomes.
- Repair variant linkage before retrying affected Shopify data.
- Use Xero's Shopify Payouts area for payout accounting, not product sync.

## At a glance

| Need | Check | Safe action |
|---|---|---|
| Bring an existing Shopify catalogue into Solvantis | Shopify connection and existing SKU or barcode records | Use **Products > Import from Shopify** and review any warnings |
| Establish opening stock after catalogue import | Explicit, one-to-one active location mappings and paused trading | Preview, review, type **REPLACE SOLVANTIS STOCK**, then replace mapped stock |
| Product is missing from Shopify sync | Product eligibility and sync status | Sync or retry where offered |
| Shopify variant has no SKU | The Solvantis variant SKU and exact storefront mapping | Resync the linked product; if the Solvantis SKU is blank, enter the correct code first |
| A simple product shows Size or Colour as Default in Shopify | Whether Solvantis has real option values or just its internal default row | New uploads omit placeholder-only options; existing Shopify options need a separately reviewed correction |
| Shopify customer is missing from active lists | Customer Sync result and recent Shopify order activity | Pull customers again; a new identified order reactivates its linked customer automatically |
| Inventory looks stale | Variant and inventory-item linkage, location mapping, and recent sync or webhook | Fix the cause, then wait for the queued update to retry |
| Order line shows Shopify Misc Charge | Original Shopify title and variant linkage | Repair the intended product mapping |
| Fulfilment or tracking is stale | Fulfilment webhook and sync history | Process the supported update again after fixing the cause |
| Payout needs accounting review | **Xero > Shopify Payouts** | Reconcile and post the balanced payout plan |

## Shopify catalogue and simple products

Solvantis keeps one internal default row for a product without size, colour or other real options. New Shopify uploads represent that as a simple product, using Shopify's hidden default variant rather than visible **Size: Default** or **Colour: Default** selectors. Its SKU, barcode, price and inventory tracking still belong to the same sellable item.

An option with a real value, such as **One Size** or **Colour: Red**, remains an option even when there is only one sellable variant. Placeholder-only option axes are omitted, and real axes keep the corresponding values. Multiple rows without real options must be corrected before upload; they are not silently merged.

This upload correction does not automatically remove options from products already in Shopify. Review existing artificial options separately and preserve the mapped variant, SKU and inventory item. Do not delete and recreate the variant to hide the options, because that can break stock and order linkage. Products with multiple Shopify variants or genuine option values require manual review rather than automatic collapse.

## Before you begin

- [ ] Confirm the Shopify connection is active.
- [ ] Identify the Shopify product, variant, order, or webhook involved.
- [ ] Search IMS for an existing product before creating another one.
- [ ] Compare the Shopify variant with the intended IMS variant.
- [ ] Review sync history before making a manual stock change.

> **Important:** Product-level similarity is not enough for order-line stock. The Shopify variant must retain its linkage to the correct IMS variant.

Product resync sends the Solvantis variant SKU to the linked Shopify variant; it can replace a different Shopify SKU. Blank Solvantis SKUs are not sent as replacements. If Shopify cannot save or verify a SKU, the sync reports a failure rather than treating the SKU update as successful. Publication retries also resend mapped nonblank SKUs before publishing.

For a missing-SKU repair, only blank Shopify SKUs with an unambiguous variant mapping and a nonblank Solvantis SKU can be filled safely. Existing Shopify SKUs are left unchanged. Products without a reliable mapping or source SKU require review rather than a guessed code. This repair does not change prices, barcodes or stock.

### Ask Assistant about Shopify sync health

Assistant can check whether the local Shopify connection appears configured, whether order sync and a webhook secret are configured, how many active products are linked or unlinked, and up to 30 recent catalogue sync outcomes. Failed outcomes are grouped into safe categories and their short summaries redact URLs, email addresses and credential-like values.

This check reads Solvantis records only. It does not contact Shopify, inspect live webhook registration, test access scopes, retry a sync or change a mapping. Open **Sales > Sales Channels**, configure the exact Shopify store, and use its **Connection**, **Orders**, and **Activity** tabs for saved webhook status, order settings, and operational history.

For products uploaded or resynchronised from Solvantis, **Tracks Inventory** also controls Shopify inventory tracking. Tracked products use Shopify's deny-when-out-of-stock policy and receive quantity updates from mapped Solvantis locations. Untracked products are marked as not inventory-tracked in Shopify, continue selling without a stock limit, and are excluded from quantity synchronization.

Branch-transfer reservations also queue inventory updates. Sending, editing or cancelling a Sent reservation, removing a Sent transfer line, receiving a short shipment, or undoing a receipt refreshes the linked items on the next scheduled inventory run. Shopify availability uses the configured Solvantis stock-counting locations, subtracts committed stock and the stock buffer, and is never negative. A transfer can therefore change online availability before the destination receives any physical stock.

Failed Shopify quantity updates remain queued and are retried by the next scheduled inventory run. The failed run does not advance the last-successful inventory sync time. Review the inventory notification or **Sync History**, repair an invalid Shopify product, variant, inventory-item, location, or connection link, then allow the queued update to retry. Do not make a compensating stock adjustment unless the Solvantis quantity itself is wrong.

Shopify fulfilment webhooks remain the primary source for customer-order completion. Each night, Solvantis also reviews Shopify orders updated during the previous 36 hours. When Shopify reports an order fully fulfilled but the matching Solvantis Sales Order is still Confirmed or In Progress, Solvantis applies the same stock-safe fulfilment workflow used by the webhook. The overlapping window covers delayed nightly runs, and completed orders are not fulfilled twice. Whenever this fallback repairs an order, Solvantis records an operational warning for administrators because the usual webhook pathway did not bring the order up to date. Partial Shopify fulfilments are not inferred by this nightly check.

An administrator can run the same check immediately for one storefront. Open **Sales > Sales Channels**, configure the Shopify store, open **Orders**, and find **Fulfilment reconciliation**. Enter a whole-number lookback period from 1 to 168 hours, then choose **Check last [number] hours**. Review the scanned, fully fulfilled, repaired, already current, missing locally, and needs review counts. A repair changes stock and allocations through the normal fulfilment workflow, so confirm that the selected storefront and its online-orders location are correct before running it. Missing local orders and unsupported Sales Order statuses are reported but are not created or forced through fulfilment.

## Shopify refunds and return costs

Initiate Shopify refunds in Shopify Admin. Solvantis records the refund as an externally settled customer credit note; it does not issue IMS store credit. Returnable lines restore stock, while **no restock** lines record value only.

Returned stock stays linked to the original fulfilled sales-order line. Under FIFO, its cost comes from the original stock allocations, not today's product cost. Under Average Cost, the return uses the original line's captured cost. Missing or inconsistent source history blocks the stock return rather than inventing a cost.

If Shopify has already refunded the customer but Solvantis could not complete the return, correct the reported linkage or source-history issue and retry processing that existing refund. Do not issue another Shopify refund or manually add the same returned stock. Reprocessing a completed refund does not create another credit note or restock it again.

## Check order sync and webhook verification

1. Open **Sales > Sales Channels**, choose **Configure** on the intended Shopify store, then open **Connection**.
2. Confirm the connection is active and the supported order webhooks are registered against that store's displayed callback.
3. For a legacy Admin API token connection, use the **API secret key** from the same Shopify app's API credentials as the webhook signing secret. The access token and the separate signing secret for manually created Shopify Notifications webhooks are not substitutes. Client-credential connections use their saved app secret.
4. Open **Orders** and confirm order sync is enabled, the start date includes the affected order, and an online-orders location is configured.
5. Compare a new Shopify order with its IMS Sales Order and review **Activity**. Successful registration alone does not prove that real deliveries pass signature verification.
6. After correcting the configuration, use the store's order import to recover missing orders. Existing orders are reused and interrupted Drafts resume through the normal confirmation workflow; do not create a second order or make a compensating stock adjustment.

If an order update arrives before its matching order has been imported from that same storefront, Solvantis leaves the update pending and asks Shopify to retry delivery. Waiting does not consume the processing retry allowance, import an order, or create stock commitments. A later delivery can apply the update after the normal order import completes. Shopify's redelivery window is limited; if the order or update remains missing, review the store's import settings and Activity with support rather than creating a duplicate order.

Before verified recovery cutover, automatic daily Xero batch sync can still attempt a catch-up order import when IMS opens, once per browser session. Validation alone does not change that behaviour. Only after verified cutover does bounded scheduled reconciliation replace catch-up triggered by opening POS or IMS; webhooks still prompt order updates.

When scheduled recovery is active, **Import Orders from Shopify** reports **queued for scheduled recovery**. It requests unfinished recovery work rather than returning completed import counts. Check **Sales > Sales Channels > Online sales recovery** for progress; acceptance does not confirm that orders, gift card work or accounting have finished. Before rollout, direct imports retain their completed counts. Do not create duplicate orders or repeat customer charges or refunds while waiting.

## Step-by-step

### Import products from Shopify

> **Onboarding only:** The usual workflow is to create items in Solvantis and sync them to Shopify. Importing in the opposite direction refreshes linked catalogue details from Shopify. Confirm the onboarding warning before continuing.

1. Open **Sales > Sales Channels**, choose **Configure** on the intended Shopify store, then choose **Products**.
2. Turn on **Create missing brands from Shopify vendor** when new Shopify vendor names should be added to the Solvantis brand list.
3. Turn on **Create and assign missing suppliers from Shopify vendor** when new Shopify vendor names should be created as supplier contacts and assigned as each product's default supplier.
4. Choose whether to keep **Auto-create missing Product SKUs** enabled, then choose **Import from Shopify** and confirm the onboarding warning.
5. Keep the page open while Solvantis imports the catalogue in small batches.
6. Review the running totals for Shopify products, image links, brands, and suppliers.
7. Open **items need review** when warnings appear and resolve ambiguous matches.
8. Confirm the imported products, variants, prices, images, brands, and suppliers in IMS before using them in normal operations.

The import creates active Shopify products and variants that are not already present. It refreshes Shopify-linked catalogue details and stores up to five Shopify image URLs per product. Draft and archived Shopify products are not imported. Repeating the import updates linked records instead of creating another copy. A Shopify product ID is used first; otherwise, Solvantis adopts an existing product only when its variant identifiers point to one clear, unlinked product. When an imported SKU or barcode is already used in Solvantis, the later value receives the next available numeric suffix, such as `-2` or `-3`, so identifiers remain unique without moving an existing Shopify link.

Each Shopify variant and inventory item can belong to only one Solvantis variant in that storefront. If an import, publication, or manual link finds that identity on another local variant, Solvantis stops the link and leaves the existing owner unchanged. Resolve the conflicting local records before retrying; Solvantis does not guess which record should own stock synchronization.

Shopify supplies one standard **vendor** value rather than separate brand and supplier values. The two import options use that vendor independently: the brand option maintains the brand list, while the supplier option creates or reuses an active supplier contact and fills a missing default supplier. Existing default suppliers are preserved. Both vendor options are off by default, and blank vendor values are ignored.

**Auto-create missing Product SKUs** is on by default. For a blank Product SKU, Solvantis recognises consistent variant option suffixes: `Erin/L` and `Erin-M` become `Erin` when L and M are the variant sizes. Colour and size suffixes may appear in either order. Every variant must support the same base; incomplete, inconsistent, or already-used bases fall back to the bulk creator's format, such as `SYL-261015-120001`. Existing Product SKUs are never replaced. Turning the checkbox off leaves blank Product SKUs unchanged. Variant SKUs retain their normal import handling.

> **Important:** Catalogue import does not change stock on hand, committed stock, incoming stock, or location quantities. Review and establish opening stock through the normal stock onboarding process.

> **Tip:** During onboarding, the import can be repeated to refresh catalogue details or image links. The batches are deliberately paced, so large catalogues take longer and place less pressure on Shopify.

### Synchronize Shopify customers

1. Open **Sales > Sales Channels**, configure the intended Shopify store, then open **Customers & Gift Cards**.
2. Set **Inactive after** to the number of months of Shopify order history that should keep a customer active (default **60**), or leave it blank for no activity cutoff.
3. Choose **Pull Customers From Shopify** and keep the page open while all batches complete.
4. Review the created, linked, updated, skipped, and error totals.
5. Search **Contacts** for the customer and confirm the Shopify customer link and active status.

Pull always downloads all Shopify customers; **Inactive after** controls their active status, not which customers are downloaded. A blank value or **0** disables the activity cutoff: imported customers become active, including previously inactive linked contacts, unless disabled in Shopify. This is useful for manually added in-store customers without Shopify order history.

Pull matches the Shopify customer ID first and then uses an exact email match when no Shopify link exists. Existing nonblank IMS contact details are preserved. With a month limit, customers older than the selected period with no Shopify order in that period are marked inactive; recently created Shopify customers remain active unless disabled in Shopify. In-store purchases recorded only in Solvantis do not count as Shopify order activity. Contacts not matched to an imported Shopify customer are unchanged. When a later identified Shopify order arrives, its linked IMS customer is reactivated automatically and blank profile details are filled from the order.

> **Warning:** **Push IMS Retail Customers** sends IMS status and details to Shopify. Review unexpectedly inactive customers before running a push, because an inactive linked IMS customer is disabled in Shopify.

### Download inventory from Shopify for onboarding

1. Complete the Shopify product import so variants retain their Shopify inventory links.
2. Pause trading and stock changes while previewing and applying. Solvantis is the stock source of truth: normal stock updates go to Shopify, while Shopify sales and returns use the normal order workflow.
3. In the store's **Products** tab, find **Download Inventory from Shopify (Onboarding)** beside the catalogue import and choose **Load Shopify and Solvantis Locations**.
4. Select a Solvantis destination for each Shopify location to import, then choose **Preview Inventory Download**. Each source and destination can be mapped once. Leave other locations as **Do not import this location**. Keep the page open while linked, active, inventory-tracked products are read in paced batches.
5. Review the target unit totals, number of adjustments, and any negative quantities for each location.
6. Type **REPLACE SOLVANTIS STOCK** exactly, choose **Replace Solvantis Stock**, and confirm the change. Keep the page open and follow the batch progress bar and confirmed variant count.
7. Note the completed stocktake numbers shown when the import finishes. Each import creates one stocktake per selected location, with all its variant adjustments in that single document.
8. Review those stocktakes and the resulting stock at each previewed location before continuing onboarding.

Each Shopify location's quantities are applied only to its selected Solvantis location, not to other locations. Names need not match. These selections apply to this onboarding download and do not change normal outbound inventory settings. Preview prepares short-lived, protected quantity snapshots for the selected storefront. Changing locations requires another preview. Apply validates snapshots and links and processes small database-only batches, replacing on-hand quantities with previewed Shopify available quantities and recording differences through completed stocktakes. Negative quantities become zero. Missing, untracked, or invalid inventory levels are reported as skipped and remain untouched; an explicit Shopify zero is imported as zero. Committed and incoming quantities are not imported.

Solvantis prepares all counted lines before applying quantities in small batches. The same stocktake stays **In Progress** until every batch for its location has finished, then becomes **Completed**. Use the Shopify import to finish a prepared stocktake; its counted lines must not be manually edited.

Each inventory request has a one-minute timeout. A timeout does not prove that its batch failed: the server may still complete it. If an import is interrupted, the preview and stocktake numbers remain visible. Review the stocktake, enter the safety phrase again, and retry the same prepared import. Confirmed batches are safely recognized without repeating their stock adjustments. Do not enter a compensating manual stock adjustment. A missing or untracked inventory-level warning means that quantity was left untouched, not set to zero; it does not mean the other batches failed.

> **Warning:** Applying opening stock replaces the current on-hand quantity for each linked variant at the locations shown in the preview. It does not add Shopify stock on top of the Solvantis balance.

> **Note:** If a completed opening-stock import must be undone, open its stocktake and use the supported reversal workflow. This reverses the location's complete import, not an individual request batch.

> **Tip:** Keep the page open until completion. A new preview starts a new import; it does not finish an earlier In Progress stocktake. If the preview expires before you can resume, review the unfinished stocktake before starting another import.

### Check or repair product linkage

1. Open **Sales > Sales Channels**, configure the intended Shopify store, and choose **Products**.
2. Filter for products not in Shopify, linked products, or all products as required.
3. Search IMS for the intended product and inspect its variants.
4. Confirm the Shopify product and variant identifiers are linked to the matching IMS variants.
5. Run the supported product sync or retry after correcting the cause.
6. Confirm the item moves to the expected sync state.
7. Review inventory and a later order line to verify the mapping before making any manual stock correction.

### Resolve Shopify Misc Charge

1. Open the affected order in **Online Sales**.
2. Read the **Shopify item** title shown beneath **Shopify Misc Charge**.
3. Use that original title to identify what the customer actually bought in Shopify.
4. Find the intended IMS product and variant.
5. Check whether the Shopify line lacked a variant ID or its variant was not linked to that IMS variant.
6. Repair and synchronize the mapping.
7. Process the Shopify update again where supported for an already imported order, then verify the result.

| Symptom | Cause | Fix |
|---|---|---|
| **Shopify Misc Charge** appears on an order line | The Shopify line has no variant ID, or that Shopify variant is not linked to an IMS variant | Link and sync the intended variant, then reprocess the affected update where supported |
| The product name below it differs from **Shopify Misc Charge** | The lower **Shopify item** text preserves the original Shopify line title | Use that title to find the real Shopify product; it is not an added Solvantis fee |
| No stock moved for the line | The fallback is a protected non-stock item | Repair mapping before future orders; do not assign stock to the fallback |

The protected fallback uses SKU **SHOPIFY-MISC**. It preserves the original Shopify line and value without moving stock against the wrong IMS product. The original title is shown so staff can identify the purchased item even though no safe variant match was available.

Extras explicitly marked as untracked in Shopify, such as gift wrapping, can continue as miscellaneous charges without an inventory mapping. When scheduled recovery is active, stock-tracked items without an exact mapping are held for review instead; missing tracking information is not treated as proof that an item is untracked.

> **Warning:** Do not edit or delete Shopify Misc Charge. Do not use a manual stock adjustment to imitate the missing order-line movement until the product mapping and imported order state have been traced.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Import reports items needing review | A SKU or barcode matches variants on more than one Solvantis product | Inspect the listed products, correct the duplicate identifier, then run the import again |
| Imported product has no stock | Catalogue import intentionally leaves stock unchanged | Preview and apply Shopify opening stock after confirming location mappings |
| Opening-stock preview cannot map a location | A required location is missing, inactive, or duplicated in either system | Read the location identified by the error and confirm it has exactly one active matching location in each system |
| A Shopify quantity is negative | Shopify available stock is below zero | Review the warning; the opening-stock import applies zero |
| Opening-stock apply stops partway through | A request or connection failed between batches | Preview again and retry; completed batches are protected from duplicate application |
| Import stops partway through | The browser closed, the connection failed, or Shopify rejected a request | Correct the connection issue and run the import again; completed records will be updated rather than duplicated |
| Several sync actions fail | Authorization or required Shopify access changed | Reconnect or correct access before retrying individual items |
| A returning Shopify customer is inactive in IMS | An earlier customer pull placed their previous order outside the selected activity window | Process or re-import the identified Shopify order, or pull customers again; the linked contact becomes active without creating a duplicate |
| One product remains unlinked | Variant linkage is absent or points to another item | Inspect every variant and repair the intended match |
| Inventory differs between systems | Queued update, location mapping, webhook failure, or manual change | Trace sync history and source stock before correcting anything |
| A Shopify order is missing or remains Draft after a sync interruption | The order event was not received, or processing stopped before confirmation | Correct the connection or reported configuration issue, then retry the Shopify order sync; existing Drafts resume without creating a duplicate order |
| Shopify is fully fulfilled but the Sales Order remains Confirmed | The dedicated fulfilment event was missed or could not be processed | Review Runtime Issues and stock readiness; the nightly 36-hour reconciliation retries eligible fully fulfilled orders automatically |
| An old order still shows the fallback after mapping is fixed | Existing import has not been reprocessed | Use the supported Shopify update or retry and verify the order |
| Payout status is missing here | Payout accounting is handled in Xero activity | Open **Xero > Shopify Payouts** |

## Worked examples

### Onboard an existing Shopify catalogue

A retailer connects a store with 620 products and starts **Import from Shopify**. Solvantis requests 25 products at a time, pauses between batches, creates missing products and variants, and records their Shopify image URLs. An existing SKU matches one clear IMS product, so that product is linked and refreshed. Two duplicate barcodes point to different IMS products, so those Shopify items are left for review instead of being guessed. No stock quantity changes during the import.

### Establish opening stock at matched locations

Staff map Shopify Main Store to Solvantis Retail and Shopify Storage to Solvantis Warehouse. The preview finds 600 linked variants with 2,400 available units at one location and 850 at the other. Staff review 570 differing balances, type **REPLACE SOLVANTIS STOCK**, and confirm. Solvantis creates completed stocktakes for each paced batch. A Shopify quantity of -1 becomes zero and is highlighted; a missing level is skipped. Unmapped locations remain unchanged, and the download sets final balances rather than adding stock.

### Identify an unmatched size variant

Online Sales shows **Shopify Misc Charge**, with **Shopify item: Harbour Tee - Black / Medium** beneath it. The title explains the real item ordered. Staff find that the Medium Shopify variant is not linked to the IMS Medium variant, repair and sync that mapping, then reprocess the order update where supported. The fallback itself remains unchanged.

### Investigate stale inventory

Shopify shows 4 units while IMS shows 2 available. Check the exact variant linkage, mapped location, and recent inventory sync or webhook. Correct the failed mapping or event and retry that sync; do not simply set both systems to a guessed quantity.

### Reactivate a returning customer

A Shopify customer was marked inactive because their last order fell outside the selected activity period. They later place a new order using the same Shopify customer account. Solvantis links the order to the existing contact, reactivates that contact, and fills blank profile details from the order without replacing staff-maintained values.

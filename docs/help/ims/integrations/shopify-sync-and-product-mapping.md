---
{"id":"ims-shopify-sync","title":"Shopify Sync and Product Mapping","audiences":["ims"],"capability":"integrations","requiresCapabilities":["shopify"],"screen":"Integrations > Shopify","product":"ims","format":"task","parentId":"ims-xero-shopify","contexts":["shopify"],"contextSections":{"shopify":"Step-by-step"},"relatedTopics":["ims-xero-shopify","ims-online-shop","ims-customer-orders"],"order":92,"summary":"Monitor Shopify synchronization, maintain product linkage, and resolve unmatched order lines safely.","lastReviewed":"2026-08-29","owner":"integrations"}
---
# Shopify Sync and Product Mapping

Use Shopify integration status and history to keep supported catalogue and order information linked without creating duplicate products or incorrect stock movements.

## Main operations

- Confirm Shopify connection health and required access before syncing.
- Import a Shopify catalogue into Solvantis in paced batches during onboarding or later catalogue maintenance.
- Preview and import opening stock from matching Shopify Warehouse and Kotara locations.
- Review products that are linked, not linked, or waiting for synchronization.
- Trace customer, order, inventory, fulfilment, and webhook activity in sync history.
- Repair variant linkage before retrying affected Shopify data.
- Use Xero's Shopify Payouts area for payout accounting, not product sync.

## At a glance

| Need | Check | Safe action |
|---|---|---|
| Bring an existing Shopify catalogue into Solvantis | Shopify connection and existing SKU or barcode records | Use **Products > Import from Shopify** and review any warnings |
| Establish opening stock after catalogue import | Warehouse and Kotara exist in both systems with matching names | Preview, review, then apply Shopify opening stock |
| Product is missing from Shopify sync | Product eligibility and sync status | Sync or retry where offered |
| Inventory looks stale | Variant linkage, location mapping, and recent sync or webhook | Fix the cause, then retry or wait for the queued update |
| Order line shows Shopify Misc Charge | Original Shopify title and variant linkage | Repair the intended product mapping |
| Fulfilment or tracking is stale | Fulfilment webhook and sync history | Process the supported update again after fixing the cause |
| Payout needs accounting review | **Xero > Shopify Payouts** | Reconcile and post the balanced payout plan |

## Before you begin

- [ ] Confirm the Shopify connection is active.
- [ ] Identify the Shopify product, variant, order, or webhook involved.
- [ ] Search IMS for an existing product before creating another one.
- [ ] Compare the Shopify variant with the intended IMS variant.
- [ ] Review sync history before making a manual stock change.

> **Important:** Product-level similarity is not enough for order-line stock. The Shopify variant must retain its linkage to the correct IMS variant.

## Step-by-step

### Import products from Shopify

1. Open **Integrations > Shopify** and choose **Products**.
2. Turn on **Create missing brands from Shopify vendor** when new Shopify vendor names should be added to the Solvantis brand list.
3. Turn on **Create and assign missing suppliers from Shopify vendor** when new Shopify vendor names should be created as supplier contacts and assigned as each product's default supplier.
4. Choose **Import from Shopify**.
5. Keep the page open while Solvantis imports the catalogue in small batches.
6. Review the running totals for Shopify products, image links, brands, and suppliers.
7. Open **items need review** when warnings appear and resolve ambiguous matches.
8. Confirm the imported products, variants, prices, images, brands, and suppliers in IMS before using them in normal operations.

The import creates active Shopify products and variants that are not already present. It refreshes Shopify-linked catalogue details and stores up to five Shopify image URLs per product. Draft and archived Shopify products are not imported. Repeating the import updates linked records instead of creating another copy. A Shopify product ID is used first; otherwise, Solvantis adopts an existing product only when its variant identifiers point to one clear, unlinked product. When an imported SKU or barcode is already used in Solvantis, the later value receives the next available numeric suffix, such as `-2` or `-3`, so identifiers remain unique without moving an existing Shopify link.

Shopify supplies one standard **vendor** value rather than separate brand and supplier values. The two import options use that vendor independently: the brand option maintains the brand list, while the supplier option creates or reuses an active supplier contact and assigns it to the product. Both options are off by default, and blank vendor values are ignored.

> **Important:** Catalogue import does not change stock on hand, committed stock, incoming stock, or location quantities. Review and establish opening stock through the normal stock onboarding process.

> **Tip:** Run the import again when Shopify catalogue details or image links need refreshing. The batches are deliberately paced, so large catalogues take longer and place less pressure on Shopify.

### Import opening stock from Shopify

1. Complete the Shopify product import so variants retain their Shopify inventory links.
2. Confirm there is one active location named **Warehouse** and one named **Kotara** in both Shopify and Solvantis.
3. Under **Shopify > Products**, choose **Preview Opening Stock**.
4. Keep the page open while Solvantis reads linked variants in paced batches.
5. Review the target unit totals, number of adjustments, and any negative quantities for each location.
6. Choose **Apply Opening Stock** and confirm the change.
7. Note the completed stocktake numbers shown when the import finishes.
8. Review those stocktakes and the resulting Warehouse and Kotara stock before continuing onboarding.

Shopify Warehouse quantities are applied only to Solvantis Warehouse. Shopify Kotara quantities are applied only to Solvantis Kotara. Preview reads Shopify and prepares short-lived, protected quantity snapshots. Apply validates those snapshots and processes small database-only batches, setting each linked variant to the previewed available quantity and recording the difference through completed stocktakes. Negative Shopify quantities become zero.

When opening stock was partly applied before an interruption, run Preview again. Solvantis compares the latest Shopify quantities with current stock and prepares apply batches only for variants that still differ. Variants already synchronized are shown in the scanned total but are not applied again.

> **Warning:** Applying opening stock replaces the current on-hand quantity for each linked variant at Warehouse and Kotara. It does not add Shopify stock on top of the Solvantis balance.

> **Note:** If a completed opening-stock batch must be undone, open its stocktake and use the supported reversal workflow. Do not compensate with an unrelated manual quantity change.

> **Tip:** If the connection is interrupted during apply, keep the preview open and choose **Apply Opening Stock** again. Completed batches are recognized and safely replayed. Run a new preview when the existing preview has expired or Shopify quantities need refreshing.

### Check or repair product linkage

1. Open **Integrations > Shopify** and choose the product area.
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

> **Warning:** Do not edit or delete Shopify Misc Charge. Do not use a manual stock adjustment to imitate the missing order-line movement until the product mapping and imported order state have been traced.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Import reports items needing review | A SKU or barcode matches variants on more than one Solvantis product | Inspect the listed products, correct the duplicate identifier, then run the import again |
| Imported product has no stock | Catalogue import intentionally leaves stock unchanged | Preview and apply Shopify opening stock after confirming location mappings |
| Opening-stock preview cannot map a location | Warehouse or Kotara is missing, inactive, or duplicated in either system | Correct the location names so each system has exactly one active Warehouse and one active Kotara |
| A Shopify quantity is negative | Shopify available stock is below zero | Review the warning; the opening-stock import applies zero |
| Opening-stock apply stops partway through | A request or connection failed between batches | Preview again and retry; completed batches are protected from duplicate application |
| Import stops partway through | The browser closed, the connection failed, or Shopify rejected a request | Correct the connection issue and run the import again; completed records will be updated rather than duplicated |
| Several sync actions fail | Authorization or required Shopify access changed | Reconnect or correct access before retrying individual items |
| One product remains unlinked | Variant linkage is absent or points to another item | Inspect every variant and repair the intended match |
| Inventory differs between systems | Queued update, location mapping, webhook failure, or manual change | Trace sync history and source stock before correcting anything |
| A Shopify order is missing or remains Draft after a sync interruption | The order event was not received, or processing stopped before confirmation | Correct the connection or reported configuration issue, then retry the Shopify order sync; existing Drafts resume without creating a duplicate order |
| An old order still shows the fallback after mapping is fixed | Existing import has not been reprocessed | Use the supported Shopify update or retry and verify the order |
| Payout status is missing here | Payout accounting is handled in Xero activity | Open **Xero > Shopify Payouts** |

## Worked examples

### Onboard an existing Shopify catalogue

A retailer connects a store with 620 products and starts **Import from Shopify**. Solvantis requests 25 products at a time, pauses between batches, creates missing products and variants, and records their Shopify image URLs. An existing SKU matches one clear IMS product, so that product is linked and refreshed. Two duplicate barcodes point to different IMS products, so those Shopify items are left for review instead of being guessed. No stock quantity changes during the import.

### Establish Warehouse and Kotara opening stock

The opening-stock preview finds 600 linked variants. Shopify Warehouse has 2,400 available units and Shopify Kotara has 850. Solvantis shows 570 location and variant balances that differ. Staff apply the preview, and Solvantis creates completed stocktakes for each paced batch at each location. A Shopify quantity of -1 is recorded as zero and highlighted in the preview. Warehouse stock never flows into Kotara, and the import sets the final balances rather than adding to them.

### Identify an unmatched size variant

Online Sales shows **Shopify Misc Charge**, with **Shopify item: Harbour Tee - Black / Medium** beneath it. The title explains the real item ordered. Staff find that the Medium Shopify variant is not linked to the IMS Medium variant, repair and sync that mapping, then reprocess the order update where supported. The fallback itself remains unchanged.

### Investigate stale inventory

Shopify shows 4 units while IMS shows 2 available. Check the exact variant linkage, mapped location, and recent inventory sync or webhook. Correct the failed mapping or event and retry that sync; do not simply set both systems to a guessed quantity.

---
{"id":"ims-shopify-sync","title":"Shopify Sync and Product Mapping","audiences":["ims"],"capability":"integrations","screen":"Integrations > Shopify","product":"ims","format":"task","parentId":"ims-xero-shopify","contexts":["shopify"],"contextSections":{"shopify":"Step-by-step"},"relatedTopics":["ims-xero-shopify","ims-online-shop","ims-customer-orders"],"order":92,"summary":"Monitor Shopify synchronization, maintain product linkage, and resolve unmatched order lines safely.","lastReviewed":"2026-08-23","owner":"integrations"}
---
# Shopify Sync and Product Mapping

Use Shopify integration status and history to keep supported catalogue and order information linked without creating duplicate products or incorrect stock movements.

## Main operations

- Confirm Shopify connection health and required access before syncing.
- Review products that are linked, not linked, or waiting for synchronization.
- Trace customer, order, inventory, fulfilment, and webhook activity in sync history.
- Repair variant linkage before retrying affected Shopify data.
- Use Xero's Shopify Payouts area for payout accounting, not product sync.

## At a glance

| Need | Check | Safe action |
|---|---|---|
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
| Several sync actions fail | Authorization or required Shopify access changed | Reconnect or correct access before retrying individual items |
| One product remains unlinked | Variant linkage is absent or points to another item | Inspect every variant and repair the intended match |
| Inventory differs between systems | Queued update, location mapping, webhook failure, or manual change | Trace sync history and source stock before correcting anything |
| An old order still shows the fallback after mapping is fixed | Existing import has not been reprocessed | Use the supported Shopify update or retry and verify the order |
| Payout status is missing here | Payout accounting is handled in Xero activity | Open **Xero > Shopify Payouts** |

## Worked examples

### Identify an unmatched size variant

Online Sales shows **Shopify Misc Charge**, with **Shopify item: Harbour Tee - Black / Medium** beneath it. The title explains the real item ordered. Staff find that the Medium Shopify variant is not linked to the IMS Medium variant, repair and sync that mapping, then reprocess the order update where supported. The fallback itself remains unchanged.

### Investigate stale inventory

Shopify shows 4 units while IMS shows 2 available. Check the exact variant linkage, mapped location, and recent inventory sync or webhook. Correct the failed mapping or event and retry that sync; do not simply set both systems to a guessed quantity.

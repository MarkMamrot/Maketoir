---
{"id":"ims-catalogue-stock","title":"Catalogue and Stock","audiences":["ims"],"capability":"inventory","screen":"Products","product":"ims","format":"overview","parentId":"ims-products","contexts":["brands","gift-cards","bulk-edit"],"contextSections":{"brands":"Brands","gift-cards":"Gift cards","bulk-edit":"Bulk edit"},"relatedTopics":["ims-product-setup-variants","ims-stock-levels-adjustments","ims-inventory-costing"],"order":15,"summary":"Choose the right Products workspace for catalogue details, stock checks, brands, gift cards, and bulk changes.","lastReviewed":"2026-08-27","owner":"inventory"}
---
# Catalogue and Stock

Use this page to choose the right Products workspace. Product details describe what you sell; stock records show what is physically available and why.

## Main operations

| I need to... | Open | What it changes |
|---|---|---|
| Create an item or add sizes and colours | **Products > All Products** | Product and variant details |
| Check quantity at a store | **Products > Stock Levels** | Nothing; this is a read-only view |
| Correct a physical count | **Stocktakes** | Stock on hand when the count is completed |
| Maintain a brand name | **Products > Brands** | Catalogue grouping and presentation |
| Review an issued gift card | **Products > Gift Cards** | Nothing unless a supported card action is used |
| Change the same field on many products | **Products > Bulk Edit** | The supported fields on the reviewed selection |
| Repair a Shopify product link | Open the product, then **Sync status > Advanced** | Shopify product and exact variant links only |

> **Important:** Selling prices in the catalogue are entered tax-inclusive. A $110 retail price already includes $10 GST. Supplier costs and inventory value are normally considered tax-exclusive.

## Choosing a workspace

| Question | Best place to start |
|---|---|
| Is the SKU, barcode, price or variant wrong? | All Products |
| Why can only 7 of 10 units be promised? | Stock Levels, then check committed demand |
| Did a delivery arrive? | Purchase Orders and Receive |
| Does the shelf count differ from the system? | Stocktakes |
| Are several products assigned to the wrong brand? | Brands or a carefully filtered Bulk Edit |

Do not type a new stock quantity into product details. Receipts, sales, transfers, returns and completed stocktakes provide the reason for each stock change.

## Shopify product links

The small **Advanced** menu at the bottom-right of a product's Sync status panel is for repairing an incorrect or missing Shopify relationship.

- **Delink from Shopify item** clears the Shopify product link and all Shopify variant and inventory-item links in Solvantis after confirmation. It does not delete the product in Shopify or change local product details, prices, stock or barcodes.
- **Link Shopify item** verifies a Shopify product number before saving it. In Shopify Admin, open the product and copy the number immediately after `/products/` in the page URL. For example, the number in `/products/9404164997336` is `9404164997336`.

When linking, Solvantis restores variant links only where an exact SKU or barcode identifies one Shopify variant. Ambiguous or unmatched variants remain unlinked rather than being guessed. Review the reported matched count before using product, price or inventory sync.

## Brands

Create a consistent brand name before assigning it to products. A brand can be used in filters and may also affect online or wholesale presentation, so check affected products before renaming it.

Use one spelling for the same brand. For example, choose **Coastal Home** rather than mixing **Coastal Home**, **CoastalHome** and **Coastal Home AU**.

## Gift cards

Gift Cards shows issued cards, linked customer details, balance activity and Shopify reconciliation state. Search can use the card code, customer name, email, phone or mobile number. Issue and redemption belong to the gift-card and POS workflow; a gift-card balance is not a product price, customer store credit or stock quantity.

When **Shopify > Gift Cards** is set to **Combined**, a paid Shopify order that uses a gift card triggers an immediate gift-card check before Solvantis acknowledges the order notification. Solvantis also checks Shopify each day for new cards, disabled cards and transaction activity, covering delayed or missed order notifications. Use **Reconcile Now** in Shopify settings when another immediate check is needed. Shopify-created cards appear with a protected placeholder ending in the visible last four characters until the full code is resolved at POS.

The Shopify connection needs gift-card read and write access. Event-level history and proven balance updates also require Shopify's `read_gift_card_transactions` access. Without that access, new cards and deactivations still reconcile, while transaction history remains unavailable and an integration issue is recorded for an administrator.

The **Sync** column shows whether balances agree. **Review** means Shopify and Solvantis differ but the available Shopify events do not prove the complete change, so Solvantis keeps its existing balance. Open the card to inspect activity on both sides before making a correction.

Use **Apply Adjustment** for a deliberate signed balance correction and enter a reason. A positive amount adds value; a negative amount removes value. In Combined mode the same change is sent to Shopify and recorded in history. Use **Retry** on an activity row when that provider update failed. Retry first checks Shopify history so an update that already succeeded is not repeated.

Use **Deactivate** only when the card must no longer be accepted. Deactivation requires a reason, is sent to Shopify first for linked cards, and cannot be reversed in Solvantis.

> **Important:** Do not repeat an adjustment manually in Shopify after Solvantis reports a sync error. Retry the activity from the card history so Solvantis can first check whether Shopify already recorded it.

## Bulk edit

Bulk Edit is useful when the same supported change applies to a known group. Before applying it:

- [ ] Clear old filters.
- [ ] Filter to the intended products or variants.
- [ ] Review the full selection, not only the first rows.
- [ ] Check whether the value is tax-inclusive or tax-exclusive.
- [ ] Reopen a few affected products after the change.

Stop and narrow the selection if unrelated products appear. Use the individual product screen when exceptions need different values.

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| A product is missing | A filter is still active, or the search term differs | Clear filters and search by product name, SKU and barcode |
| Available is lower than on hand | Some units are committed to customer demand | Open Stock Levels and trace the committed quantity to Sales Orders or Stock Allocation |
| A quantity cannot be edited in All Products | Stock is changed by an operational document | Use the receipt, return, transfer or stocktake that matches what happened |
| Bulk Edit includes too many items | The selection is broader than intended | Stop before applying, refine the filters and review again |

## Worked examples

### Update a winter price group

A retailer needs to change 24 winter jackets to a tax-inclusive retail price of $220. They filter by the exact brand and product type, review all 24 products, apply the supported price change, then open three products to confirm the new price. The $220 price already contains $20 GST; GST is not added again at the register.

### Investigate a stock question

Stock Levels shows 10 candles on hand and 3 committed, so 7 are available. The retailer checks the customer orders behind the committed quantity instead of increasing stock to 10 again.
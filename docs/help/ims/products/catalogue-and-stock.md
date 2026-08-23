---
{"id":"ims-catalogue-stock","title":"Catalogue and Stock","audiences":["ims"],"capability":"inventory","screen":"Products","product":"ims","parentId":"ims-products","contexts":["products","stock","brands","gift-cards","bulk-edit"],"contextSections":{"products":"Products and variants","stock":"Stock levels","brands":"Brands","gift-cards":"Gift cards","bulk-edit":"Bulk edit"},"order":15,"summary":"Maintain products, variants, brands, stock visibility, gift cards, and supported bulk changes.","lastReviewed":"2026-08-23","owner":"inventory"}
---
# Catalogue and Stock

## Main operations

- Use **All Products** to create and maintain products and variants.
- Use **Stock Levels** to compare on-hand, committed, incoming, and available quantities by location.
- Maintain brands before relying on brand filters or customer-facing presentation.
- Review issued gift cards and supported balance activity from the dedicated workspace.
- Use **Bulk Edit** only after filtering and reviewing the complete selected set.

## Products and variants

Product detail owns catalogue identity, descriptions, SKUs, barcodes, tax-inclusive selling prices, suppliers, images, online content, and variant settings. Search before creating a product to avoid duplicate identities. Where a product has variants, maintain variant-specific identifiers and prices on the correct row.

Stock quantity is not ordinary product metadata. Use receipts, sales, transfers, stocktakes, returns, and supported adjustments so quantity changes retain an operational reason.

## Stock levels

Stock Levels separates physical stock on hand from quantities committed to demand, expected from supply, and available to promise. Select the relevant location before comparing values. Average cost is shared organisation-wide per variant; location stock value differs because each location has its own quantity.

## Brands

Brands provide consistent catalogue grouping and can affect online and wholesale presentation. Confirm the intended name and customer-facing identity before assigning products. Review dependent products before renaming or retiring a brand.

## Gift cards

Gift Cards shows issued cards and supported balance activity. Issue and redemption effects belong to the gift-card and POS workflow. Do not imitate a balance change through product pricing, customer credit, or a generic stock edit.

## Bulk edit

Bulk Edit applies supported field changes across the selected product set. Check active filters, selected variants, destination value, tax treatment, and online state before applying. Reopen a sample of affected products after completion to verify the intended result.

## Troubleshooting

- If a product is missing, clear filters and search by SKU or barcode as well as name.
- If available stock differs from on hand, inspect committed demand and incoming supply.
- If an edit is unavailable, check role, product state, and whether the value belongs to a stock or ledger workflow.
- If a bulk change selected too many records, stop before applying and narrow the filters.

## Worked examples

### Investigate low availability

Open Stock Levels, choose the location, and compare on hand, committed, incoming, and available. Follow committed quantities into Sales Orders or Stock Allocation and incoming quantities into Purchase Orders before changing stock.

### Prepare a controlled price update

Filter Bulk Edit to the intended products, review the complete selection, choose the supported selling-price field, and enter tax-inclusive prices. Apply the change, then open representative products to confirm the result.
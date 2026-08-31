---
{"id":"ims-product-setup-variants","title":"Product Setup, Variants, and Non-stock Items","audiences":["ims"],"capability":"inventory","screen":"Products > All Products","product":"ims","format":"task","parentId":"ims-catalogue-stock","contexts":["products"],"contextSections":{"products":"Step-by-step"},"relatedTopics":["ims-catalogue-stock","ims-stock-levels-adjustments","ims-inventory-costing","ims-stocktakes-adjustments"],"order":16,"summary":"Create a product, choose its inventory behavior, add product photos and variants, and optionally establish opening stock by location.","lastReviewed":"2026-08-31","owner":"inventory"}
---
# Product Setup, Variants, and Non-stock Items

Use this guide to create a clean product record and give each sellable option its own SKU, barcode, prices and cost.

## Main operations

- Create one product for the item customers recognise.
- Add up to 10 product photos when creating or editing a product.
- Add a default variant for a single-option item, or generate variants from Size, Colour or Style.
- Give each variant a unique SKU and, where used, a unique barcode.
- Enter retail, wholesale and sale prices as tax-inclusive selling prices.
- Choose which optional product and variant fields appear under **Settings > Products**.
- Leave **Tracks Inventory** on for physical stock, or turn it off for items sold without quantity limits.
- Enter opening stock quantity by variant and location while creating a tracked product. Optionally enable **Minimum and reorder quantities** when those replenishment fields are also needed.
- Use the Product Import header list or copy its current CSV titles before preparing a spreadsheet.
- Use Product Type to classify an item; do not assume the wording alone switches stock tracking off.

## At a glance

| Decision | Use | Example |
|---|---|---|
| One item with no choices | One default variant | Ceramic vase |
| Same product in sizes or colours | One product with several variants | Linen shirt: S / Navy, M / Navy |
| A fee or service that is not physically counted | Turn **Tracks Inventory** off | Gift wrapping service |
| Different products that only look similar | Separate products | Adult raincoat and children's raincoat |

> **Important:** Product Type is a catalogue label. **Tracks Inventory** is the control that decides whether Solvantis checks and moves stock. An untracked product can be sold in POS, the native Online Shop and Wholesale without an available-stock limit.

## Before you begin

- [ ] Search by name, Product SKU, variant SKU and barcode to avoid a duplicate.
- [ ] Decide the product name customers and staff will recognise.
- [ ] Decide which choices create separate variants.
- [ ] Prepare unique SKUs and barcodes.
- [ ] Confirm retail and wholesale prices, supplier cost and tax treatment.
- [ ] Choose the default supplier and brand where known.

Selling prices are tax-inclusive. A retail price of $110 includes $10 GST. The Cost field represents buying cost and should be entered on the appropriate tax-exclusive basis; do not enter the $110 selling price as cost.

## Step-by-step

1. Open **Products > All Products** and search for the item.
	The Product SKU column shows the product-level identifier. Expand a product to see the separate SKU for each variant.
2. Select **New Product** when no matching product exists.
3. Enter the product Name and Product SKU.
4. Choose or type the Product Type, brand, category, subcategory, tags and default supplier as needed. Optional fields are shown only when enabled under **Settings > Products**.
5. Add a description and set Active to **Yes** when the item should be available.
6. Leave **Tracks Inventory** on for physical goods. Turn it off for a service, fee or other item that must sell without stock checks or movements.
7. In Media, select **Add photos** and choose up to 10 photos. The first selected photo becomes the primary image. Photos are uploaded when the product is saved.
8. For a simple product, add one blank row and use the default variant.
9. For choices, enter up to three Option Sets, such as Size and Colour, then select **Generate Variants**.
10. Review every generated row. Enter a unique SKU and barcode, tax-inclusive RRP, wholesale or sale price, tax-exclusive cost and weight where relevant.
11. Use **Copy** only when the source row's prices and sale dates genuinely apply to the other variants.
12. After creating and reviewing the variants, use Inventory to choose whether the product tracks inventory.
13. If **Add stock with new products** is enabled, enter opening quantity for each variant and location. Enable **Minimum and reorder quantities** under **Settings > Products** only when those extra fields are needed. Zero is a valid value.
14. Select **Save All**, then check the uploaded photos, representative variants and any completed opening-stock stocktakes.

Under **Settings > Products**, authorised users can show or hide Category and Subcategory, Tags, Product Type, Wholesale Price, Weight, **Add stock with new products**, and **Minimum and reorder quantities**. Opening quantity is available by default. Min Qty and Reorder Qty are off by default because most product creation does not need replenishment settings. Hiding a field removes it from product entry; it does not erase values already saved.

Opening quantities are set through a completed stocktake at each location, so Stock History retains the adjustment. If saving opening stock is interrupted, retry the save; Solvantis reuses the protected request rather than creating the product or applying a completed location twice.

## Import products

Open **Import Products** and review the accepted CSV titles before preparing the file. Select **Copy CSV titles** to copy the current tab-separated header row, which can be pasted into the first row of a spreadsheet. Keep the supplied column names unchanged when exporting the completed sheet as CSV.

Every imported row requires **Product_SKU**. A default or single variant uses Product_SKU as its SKU. When option values are present, Solvantis derives the variant SKU by appending Option1, Option2 and Option3 values in order, with spaces removed. For example, Product_SKU **HLS** with Size **M** and Colour **Navy** becomes **HLS-M-Navy**. Product Import does not accept a separate variant SKU override.

Each Product SKU must belong to only one product. Each variant SKU and each non-blank barcode must belong to only one variant. Solvantis checks all import rows before creating products, brands or suppliers. If an identifier is already used, the import stops and names both the imported product and the existing product causing the conflict. Correct the Product_SKU, option values or Barcode in the spreadsheet, then review and import it again. Rows classified as updates may retain the identifiers already assigned to that same product or variant.

Before reimporting products that already use custom variant SKUs, align those SKUs with the derived Product_SKU and option pattern. A legacy custom SKU that does not match the derived value cannot identify that existing variant during import.

## Variant setup matrix

| Field | Product or variant? | Practical rule |
|---|---|---|
| Name, brand, description | Product | Shared customer-facing identity |
| Category, subcategory, tags, Product Type | Product | Optional catalogue classification controlled by Settings > Products |
| Tracks Inventory | Product | On by default; turn off only when sales must ignore stock availability and movements |
| Product SKU | Product | Groups the variants under one product |
| Size, colour, style | Variant | Describes the exact choice |
| SKU and barcode | Variant | Keep each sellable row unique |
| RRP, wholesale and sale price | Variant | Tax-inclusive selling amounts |
| Cost | Variant | Tax-exclusive buying cost used for purchasing reference |
| Weight | Variant | Optional kilograms used where the item needs a recorded weight |
| Active | Product and variant | Inactive records should not be used for new work |

## Non-stock decision guide

| Item | Recommended setup | Quantity caution |
|---|---|---|
| Gift wrapping charged at checkout | Clearly named product with Tracks Inventory off | Sells without reservation, commitment or stock movement |
| Repair labour | Separate product with Tracks Inventory off | Sells without an available-stock limit |
| Display sample that can later be sold | Normal stock product | Track its physical location and count |
| Gift card | Use the dedicated gift-card workflow | Do not imitate a gift-card balance with product stock |

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Generate Variants produces the wrong combinations | Option names or comma-separated values are wrong | Correct the option sets before saving |
| An imported variant SKU is not what you expected | Product_SKU or an option value contains the wrong text | Correct Product_SKU and the option values; the imported SKU is derived from them |
| Product save or import reports an identifier conflict | Another product or variant already uses that Product SKU, variant SKU or barcode | Search for the named existing product, then give the new product or variant a unique identifier |
| Two variants scan as the same item | A SKU or barcode was reused | Give each sellable variant a unique identifier |
| Price at the register is 10% too high | GST was added to an already tax-inclusive selling price | Enter the final shelf price, including GST |
| A service is blocked by zero stock | Tracks Inventory is still on | Edit the product and turn Tracks Inventory off |
| Save is unavailable | The account may be read-only | Ask an authorised IMS user to make the change |

## Worked examples

### Create a shirt with size and colour variants

Create **Harbour Linen Shirt** with Product SKU **HLS**. Add Size values **S, M, L** and Colour values **Navy, White**, then generate six variants. Assign SKUs such as **HLS-S-NAVY** and **HLS-M-WHITE**. Set the shelf price to $110 including GST and the supplier cost to $42 tax-exclusive for each applicable row.

### Set up gift wrapping

Create **Gift Wrapping Service** with one default variant and a tax-inclusive selling price of $8.80, which contains $0.80 GST. Classify it clearly for staff, but do not receive ten units on a PO or include it in a physical stocktake merely because Product Type says “Service”.
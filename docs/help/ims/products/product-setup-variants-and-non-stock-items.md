---
{"id":"ims-product-setup-variants","title":"Product Setup, Variants, and Non-stock Items","audiences":["ims"],"capability":"inventory","screen":"Products > All Products","product":"ims","format":"task","parentId":"ims-catalogue-stock","contexts":["products"],"contextSections":{"products":"Step-by-step"},"relatedTopics":["ims-catalogue-stock","ims-stock-levels-adjustments","ims-inventory-costing"],"order":16,"summary":"Create a product, build its variants, set tax-inclusive selling prices, and handle items that are not normally counted as stock.","lastReviewed":"2026-08-23","owner":"inventory"}
---
# Product Setup, Variants, and Non-stock Items

Use this guide to create a clean product record and give each sellable option its own SKU, barcode, prices and cost.

## Main operations

- Create one product for the item customers recognise.
- Add a default variant for a single-option item, or generate variants from Size, Colour or Style.
- Give each variant a unique SKU and, where used, a unique barcode.
- Enter retail, wholesale and sale prices as tax-inclusive selling prices.
- Use the Product Import header list or copy its current CSV titles before preparing a spreadsheet.
- Use Product Type to classify an item; do not assume the wording alone switches stock tracking off.

## At a glance

| Decision | Use | Example |
|---|---|---|
| One item with no choices | One default variant | Ceramic vase |
| Same product in sizes or colours | One product with several variants | Linen shirt: S / Navy, M / Navy |
| A fee or service that is not physically counted | A clearly named product and variant used only where supported | Gift wrapping service |
| Different products that only look similar | Separate products | Adult raincoat and children's raincoat |

> **Important:** Product Type is a catalogue label. Entering “Service” or “Non-stock” does not by itself guarantee that every sale, PO or stock workflow will ignore quantity. Keep non-stock items out of physical receiving and counting unless your business has confirmed the intended workflow.

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
2. Select **New Product** when no matching product exists.
3. Enter the product Name and Product SKU.
4. Choose or type the Product Type, brand, category, tags and default supplier as needed.
5. Add a description and set Active to **Yes** when the item should be available.
6. For a simple product, add one blank row and use the default variant.
7. For choices, enter up to three Option Sets, such as Size and Colour, then select **Generate Variants**.
8. Review every generated row. Enter a unique SKU and barcode, tax-inclusive RRP, wholesale or sale price, tax-exclusive cost and weight where relevant.
9. Use **Copy** only when the source row's prices and sale dates genuinely apply to the other variants.
10. Select **Save All**, then reopen the product and check representative variants.

## Import products

Open **Import Products** and review the accepted CSV titles before preparing the file. Select **Copy CSV titles** to copy the current tab-separated header row, which can be pasted into the first row of a spreadsheet. Keep the supplied column names unchanged when exporting the completed sheet as CSV.

## Variant setup matrix

| Field | Product or variant? | Practical rule |
|---|---|---|
| Name, brand, description | Product | Shared customer-facing identity |
| Product SKU | Product | Groups the variants under one product |
| Size, colour, style | Variant | Describes the exact choice |
| SKU and barcode | Variant | Keep each sellable row unique |
| RRP, wholesale and sale price | Variant | Tax-inclusive selling amounts |
| Cost | Variant | Tax-exclusive buying cost used for purchasing reference |
| Active | Product and variant | Inactive records should not be used for new work |

## Non-stock decision guide

| Item | Recommended setup | Quantity caution |
|---|---|---|
| Gift wrapping charged at checkout | Clearly named service-style product | Do not receive or count it as a physical unit |
| Repair labour | Separate service-style product | Keep it out of stocktakes unless a physical item is also supplied |
| Display sample that can later be sold | Normal stock product | Track its physical location and count |
| Gift card | Use the dedicated gift-card workflow | Do not imitate a gift-card balance with product stock |

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Generate Variants produces the wrong combinations | Option names or comma-separated values are wrong | Correct the option sets before saving |
| Two variants scan as the same item | A SKU or barcode was reused | Give each sellable variant a unique identifier |
| Price at the register is 10% too high | GST was added to an already tax-inclusive selling price | Enter the final shelf price, including GST |
| A non-stock item appears in quantity workflows | Product Type is only a classification | Stop using it in receipts or counts and review the intended operational setup |
| Save is unavailable | The account may be read-only | Ask an authorised IMS user to make the change |

## Worked examples

### Create a shirt with size and colour variants

Create **Harbour Linen Shirt** with Product SKU **HLS**. Add Size values **S, M, L** and Colour values **Navy, White**, then generate six variants. Assign SKUs such as **HLS-S-NAVY** and **HLS-M-WHITE**. Set the shelf price to $110 including GST and the supplier cost to $42 tax-exclusive for each applicable row.

### Set up gift wrapping

Create **Gift Wrapping Service** with one default variant and a tax-inclusive selling price of $8.80, which contains $0.80 GST. Classify it clearly for staff, but do not receive ten units on a PO or include it in a physical stocktake merely because Product Type says “Service”.
---
{"id":"ims-product-builds","title":"Product Builds","audiences":["ims"],"capability":"inventory","screen":"Products > Builds","product":"ims","format":"task","parentId":"ims-catalogue-stock","contexts":["builds","products","stock","sales-orders","pos"],"contextSections":{"builds":"Step-by-step","products":"Step-by-step","stock":"Step-by-step","sales-orders":"Step-by-step","pos":"Step-by-step"},"relatedTopics":["ims-product-setup-variants","ims-stocktakes-adjustments","ims-business-operations-pos-settings","ims-inventory-costing"],"order":17,"summary":"Create versioned recipes, build finished stock from available components, handle order shortfalls, and reverse completed builds safely.","lastReviewed":"2026-09-10","owner":"inventory"}
---
# Product Builds

Use Product Builds to convert stocked components into finished products at one location while preserving quantities, costs, recipe revisions, and operator history.

## Main operations

- Save a recipe for a finished product variant.
- Preview and confirm several recipe outputs in one atomic build.
- Review open **Build for Order** tasks without reserving components.
- Use **Build & Confirm** or **Build & Fulfil** when an eligible sales order is short.
- Reverse all or part of a completed build with a reason.
- Follow build and reversal references from Stock History.

## At a glance

| Action | Stock effect | Important limit |
|---|---|---|
| Confirm build | Components decrease; finished products increase | Every component must have enough Available stock at the selected location |
| Build for Order | Creates the required finished shortfall | The build does not fulfil the order by itself |
| Build & Confirm | Builds the draft-order shortfall and confirms the order together | Available only when the location policy and all components permit it |
| Build & Fulfil | Builds the shipment shortfall and fulfils it together | Existing normal, incoming-stock, and negative-stock choices remain separate |
| Reverse build | Finished stock decreases; original component proportions return | Finished Available stock must cover the reversal |

> **Important:** A preview is advisory. Confirmation checks the recipe revision and Available component stock again, and the whole batch succeeds or nothing changes.

## Before you begin

- [ ] Enable **Use Builds** under **Settings > General > Inventory**.
- [ ] Edit each finished product that will be assembled and enable **Use Builds** on that product.
- [ ] Create and save the finished product and every component as active tracked-stock variants.
- [ ] Check that all components are held at the location where the build will occur.
- [ ] Confirm component average costs and the tax-exclusive overhead per output.
- [ ] For sale-assisted builds, enable the business policy and review any location override.
- [ ] Finish unrelated receipts, transfers, or stocktakes that could change component availability.

## Step-by-step

### Create or revise a recipe

1. Open **Products > All Products** and edit the saved finished product.
2. Confirm **Tracks Inventory** is on, then enable **Use Builds** for this product. The Build Recipe section is hidden for products that have not opted in.
3. In **Build Recipe**, choose the output variant.
4. Search the existing product catalogue by product name, variant, SKU, or barcode and select each component. Enter the quantity needed for one output unit.
5. Enter optional tax-exclusive overhead per output and revision notes.
6. Review the current output cost, then select **Save New Revision**.

Each save creates a new revision. Completed builds keep the exact recipe, quantities, costs, overhead, and revision used at confirmation.

### Run a bulk build

1. Open **Products > Builds** and select **New Build**.
2. Choose one location for the complete batch.
3. Add each recipe-backed output and enter its quantity. Add an overhead override only when this build differs from the recipe default.
4. Review the combined component table: On Hand, Committed, Available, Required, After, average cost, and value.
5. Check each resulting output unit cost, then select **Confirm atomic build**.
6. Open the build detail to review captured components, costs, operator, source, and reversal history.

Shared component demand is combined before confirmation. A variant cannot be both an output and a component in the same batch.

### Build for a sales order

Open **Build for Order** in the Builds workspace and select **Build item**. Review the live component and cost preview, then confirm. The task links to the completed build item. Building creates finished stock but does not fulfil the order; use the normal fulfilment action when the goods are ready to ship.

For a draft staff-managed order, **Build & Confirm** may be offered when only finished stock is short. For a confirmed or partly fulfilled order, **Build & Fulfil** may be offered for the selected shipment. Both actions build only the current shortfall and complete both operations together.

Draft orders may be saved when finished stock is short. After save, and whenever the order is viewed, **Build Product Availability** separates each build product's outstanding quantity into **Ready**, **Buildable**, and **Unavailable**. Buildable quantity is based on current Available component stock and is advisory until a build is completed.

At confirmation, Solvantis checks finished Available stock and the components required for the full build shortfall. When the full shortfall is buildable, staff can choose **Build & Confirm**. When components are insufficient, confirmation names the shortage and requires acknowledgement; confirming keeps the quantity as open demand but does not create stock or permit unsupported fulfilment.

Shopify, the Solvantis Online Store, and Wholesale advertise actual finished Available stock, not potential component capacity. Eligible later shortfalls appear as staff tasks.

### Build during a POS sale

When the location policy is enabled, the register can show finished stock and separately show quantity that can currently be built. If checkout needs a build, staff review the exact shortage, components, availability, and cost before completing payment. The build and sale complete together.

Build-dependent checkout requires an online connection and is unavailable in Training Mode. Parked sales and laybys do not build until their existing completion action moves stock. A return or void restores the finished SKU through its normal workflow; it does not automatically dismantle the product.

### Review and reverse a build

1. Open **Products > Builds** and select the build number.
2. Review each output and its immutable component snapshot.
3. Select **Reverse** beside an output.
4. Enter all or part of the remaining reversible quantity and a specific reason.
5. Confirm the reversal.

The reversal removes finished Available stock and restores components in their original proportions at captured costs. It is blocked when committed finished stock leaves too little Available quantity.

## Costing and connected channels

Component value plus tax-exclusive overhead becomes the finished output cost. The finished variant's weighted average cost is updated for future sale cost of goods. Internal build conversion does not create a Xero journal.

Build and reversal movements update actual stock and queue affected Shopify-linked variants for inventory refresh. They never increase marketplace availability before finished stock exists.

After completed build movements exist, raw Cin7 stock replacement is blocked because it could erase the quantity effect while leaving audit history behind. Use a stocktake or an audited stock adjustment to reconcile a verified difference. Catalogue-only Cin7 sync remains available.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Preview reports a component shortage | Some on-hand units are committed or have moved since the last check | Receive, transfer, or release stock through its owning workflow, then preview again |
| Confirm says the recipe is stale | Another user saved a new recipe revision | Reload the build and review the new components and cost |
| Build from sale is not offered | The policy is off, the location override disables it, there is no eligible shortage, or components are unavailable | Review Settings, the active recipe, and current location stock |
| Builds or Build Recipe is not visible | Builds is disabled for the business, or the product has not opted in | Enable **Use Builds** in Settings, then enable **Use Builds** on the tracked product |
| Reversal is blocked | Finished Available stock is lower than the requested reversal | Reduce the quantity or resolve the finished-stock commitment first |
| Cin7 stock sync is blocked | This business has completed build movements | Reconcile with a stocktake or audited stock adjustment instead of replacing balances |
| Returned item did not restore components | Returns restore the sold finished SKU | Use a separate explicit build reversal only when the returned finished stock is available and dismantling is appropriate |

> **Warning:** Do not imitate a build or reversal with manual adjustments. Use the build record so component quantities, output costs, and history remain connected.

## Worked examples

### Build several candle packs

A recipe for one gift pack uses two candles at an average cost of $6 each, one box at $1.50, and $0.50 overhead. Building 10 requires 20 candles and 10 boxes. The output unit cost is $14.00 and the batch transfers $140.00 into finished inventory. If either component's Available stock is short, none of the batch is posted.

### Reverse part of a build

A build produced 10 gift packs and 3 remain Available after sales. Staff discover that two were assembled incorrectly. Reversing 2 removes two gift packs and restores four candles and two boxes using the captured recipe proportions. Eight units remain built and one further unit remains reversible from current Available stock.
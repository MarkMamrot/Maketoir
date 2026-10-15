---
{"id":"ims-shipping-settings","title":"Shipping Settings","audiences":["ims"],"capability":"orders","screen":"IMS Settings > Sales & Customers > Shipping","product":"ims","format":"task","parentId":"ims-business-operations-pos","relatedTopics":["ims-sales-orders-fulfilment","ims-product-setup-variants"],"contexts":["settings-shipping","settings-delivery-tracking"],"contextSections":{"settings-shipping":"Main operations","settings-delivery-tracking":"Delivery tracking by online channel"},"order":53,"summary":"Connect Australia Post eParcel, select online channel types for delivery tracking, define package presets, and manage shipping preparation and batches.","lastReviewed":"2026-10-15","owner":"sales","quickSections":["Main operations","At a glance"],"navigation":{"category":"settings","label":"Configure shipping"}}
---
# Shipping Settings

Use Shipping Settings to connect an Australia Post eParcel account and optionally define reusable boxes, satchels, pallets or custom packages. Staff can also enter actual parcel measurements directly while preparing Sales Orders.

## Main operations

- Add or update an Australia Post eParcel account.
- Choose which online channel types may collect parcel delivery information for this business. Amazon defaults On; Shopify and Solvantis Online Store default Off.
- Test saved credentials against the Australia Post production Shipping API.
- Keep MyPost Business unavailable until approved partner access is supported.
- Add package presets with internal dimensions, tare weight and an optional maximum weight.
- Use **Save as preset** in Shipping Workspace's **Orders ready to ship** tab to save a parcel's measurements as a named custom package for all staff in the same business. Packed weight is not saved; weigh each future parcel.
- Add selected Australia Post reference packaging to the editable preset list.
- **Save dimensions** beneath each ready order in **Orders ready to ship** without choosing a carrier. Choose the carrier in **Make a shipping batch**, then choose postage inside **Batches**; manifests remain the later carrier lodgement step.
- **Close batch** collapses the current batch without closing the workspace or changing saved shipments, postage or stock.
- Create one manifest for each carrier account and physical pickup location, then print its lodgement summary.

## At a glance

| Setting | Purpose | Practical rule |
|---|---|---|
| Dispatch location | Supplies the sender address used for carrier prices and shipments | Keep its street, suburb or city, state and postcode complete |
| Delivery information by online channel | Permits future delivery checks for selected types in this business | Save the switches; the platform-wide delivery tracking job must also be On |
| Package dimensions | Determines whether a product can fit | Enter internal length, width and height in millimetres |
| Tare weight | Adds the empty package weight | Enter kilograms |
| Maximum weight | Prevents an overweight suggestion | Leave blank only when the package has no configured limit |

## Before you begin

- [ ] Obtain an eParcel account number, API key and API password from Australia Post.
- [ ] Complete the dispatch location address.
- [ ] Measure the packages used by the dispatch team.

> **Important:** Carrier credentials are not shown again after saving. Each field shows one masking dot per stored character. Leave those dots unchanged to keep the saved value, or type a replacement.

## Delivery tracking by online channel

1. Select the intended business and open **Settings > Sales & Customers > Shipping**.
2. Under **Delivery information by online channel**, review Amazon, Shopify and Solvantis Online Store. Each switch applies to every store of that type in this business, not to other businesses.
3. Choose On or Off, then select **Save delivery tracking**. Unsaved changes do not affect polling. Advisor accounts can view but cannot change these settings.
4. Use **Reload saved settings** to read the saved values again, replacing unsaved edits. If loading or saving fails, do not assume defaults or success; resolve the displayed failure and review Runtime Issues.
5. A SuperAdmin must separately verify carrier tracking access and enable **Online channel delivery tracking** in **Admin > Cron Jobs**. That master job starts Off. Saving a business switch does not enable the master job, run an immediate check, create a channel connection, or enable order sync.

The job runs hourly at 43 minutes past the hour. It considers up to 20 eligible parcels per business in a bounded run, using saved Australia Post eParcel article IDs on original parcels prepared and marked dispatched in Solvantis. Pending parcels normally become eligible again after six hours; failures retry after one hour and operational failures are reported in Runtime Issues. Once a parcel has verified delivery evidence, repeated polling stops for that parcel. A shipping connection test does not establish tracking permission.

Unsupported carriers, external shipments without prepared parcel records, missing article IDs, ambiguous dates and unknown delivery events cannot establish automatic delivery. Delivery is never inferred from a label, fulfilment status, return, or absence of a tracking result. Only a matching article with a recognized delivery event and explicit timezone supplies a verified timestamp; raw carrier responses and recipient details are not saved as evidence.

Turning a channel type Off, pausing business automation or switching the master job Off stops future checks, not work already in progress. Existing evidence remains. Disabling a store connection alone does not prevent checks for previously dispatched parcels if that channel type and the master job remain On.

Amazon's 30-day PII review rules and **Admin > Security & Compliance** workflows remain Amazon-only. Enabling Shopify or Solvantis Online Store tracking does not apply those rules to their customers. Turning Amazon tracking Off does not suspend its retention obligations or restart any existing review deadline. Tracking does not change stock, customer details, fulfilment or financial records, and it does not anonymize or delete data.

## Step-by-step

1. Open **Settings > Sales & Customers > Shipping**.
2. Choose **Australia Post eParcel** and enter a recognisable account name.
3. Enter the production account number, API key, API password, and dispatch location. Solvantis uses Australia Post's production Shipping API address automatically.
4. Select **Add account** or **Update account**.
5. Select **Test connection** beside the saved account. The status indicator changes to **Connected** after a successful test, or **Connection failed** when the carrier rejects the connection. Review the reported error before using the account for shipment preparation.
6. Under Package presets, enter a name, package type, internal length, width and height in millimetres, and tare weight in kilograms.
7. To start from carrier packaging, select **Australia Post presets**, choose the required satchels, envelopes or boxes, and select **Add selected**. Existing names are skipped rather than overwritten.
8. Review imported dimensions and enter a measured tare weight where needed. Carrier packaging and service limits can change.
9. Enter a maximum weight where the package or carrier service has one. Keep product rotation enabled only when products may safely be turned to fit.
10. Save the preset. It becomes available when preparing selected Sales Orders.

Alternatively, in Shipping Workspace's **Orders ready to ship** tab, enter a parcel's length, width and height in centimetres, select **Save as preset**, enter a unique name, and select **Save preset**. The new custom package appears immediately in the preset dropdowns and can be maintained in **Settings > Sales & Customers > Shipping**. This shortcut saves dimensions only: it starts with no empty-package weight or maximum-weight limit, and product rotation enabled. Review those settings before relying on packing suggestions. Saving a preset does not save the order's preparation or buy postage; use **Save dimensions** separately for the actual parcel details.

> **Note:** Saving dimensions, making a batch and saving a postage service do not purchase postage or reduce stock. The confirmed **Submit to Australia Post & create labels** action creates billable carrier shipments. **Mark dispatched** reduces stock when labelled parcels physically leave.

Use **Shipping Workspace** in Sales Orders to reopen saved work. In **Orders ready to ship**, dimensions appear directly beneath each order's details. Enter actual packed dimensions and weight, then **Save dimensions**. Saved preparation survives closing or refreshing and is available to other staff. Only saved, measured orders can be selected for a new or existing batch. Choose prices and save postage services inside the batch. A new single parcel contains all remaining unshipped quantities automatically; multi-parcel allocation is shown separately. Switching tabs retains unsaved preparation; closing asks before discarding it.

Use **Batches** to open saved groups, add measured orders, choose postage, or move existing shipments. **Remove from batch** returns unpurchased orders to **Orders ready to ship** with their dimensions saved. Booked shipments go to **Unbatched shipments** with postage retained. **Undo batch** removes the entire working group without deleting dimensions, cancelling postage or reversing dispatch. Unsafe or dispatched shipments cannot be ungrouped. Grouping changes do not buy postage or alter stock. Once labelled parcels physically leave, **Mark dispatched** applies parcel quantities to Sales Order fulfillment and sends tracking to the connected channel. Channel retries do not repeat stock movement or postage.

After services are chosen, **Stock available for this batch** confirms a successful check. **Recheck stock** repeats it without changing quantities. Detailed shortages appear when attention is needed; incoming stock is not on hand until received. Buying labels despite a shortage requires explicit acknowledgement, and dispatch checks stock again.

To correct an eligible saved shipment before dispatch, use **Edit shipment details** for that order in Shipping Workspace. An unsubmitted draft can change carrier account or parcel count. An existing carrier shipment keeps its account and parcel identities, and its destination must remain domestic or international as originally prepared. In-place carrier amendments must be verified before that editing path is available. Saving a delivery-address change also updates the Sales Order. Refresh prices and review the service before saving; an edit never automatically cancels or replaces purchased postage.

Carrier-affecting edits require fresh labels. When several orders shared one PDF, Solvantis refreshes that shared document without changing the other orders' shipment details or postage. Discard old printed and downloaded copies. Dispatch is blocked until current labels are ready; uncertain carrier updates must be reconciled first.

Changing batch membership can also require a fresh shared PDF when the old document would print removed shipments. This regenerates labels for the existing bookings, not replacement postage. Dispatched, manifested, in-flight or uncertain shipments cannot change working groups.

Before the carrier pickup, open the **Manifests** tab. Solvantis groups dispatched shipments by carrier account and dispatch location. Choose the shipments in that pickup, then use **Create booking & manifest**. Australia Post requires one Order per pickup and a signed Order Summary when the parcels are lodged. Print the summary immediately or use manifest history when another copy is needed. A completed manifest cannot accept more shipments.

> **Warning:** An unknown manifest outcome may already represent a carrier booking. Check the carrier portal and use **Reconcile** with the confirmed order ID instead of creating another booking.

Package presets are shortcuts, not a requirement. In **Sales > Sales Orders > Ship Orders**, staff can select a preset or manually enter each parcel's dimensions in centimetres and final packed weight in kilograms. Australia Post prices use the current parcel details and the saved account's contract rates. Before creating labels, leave **Print Australia Post header and footer** selected for plain paper, or clear it when the Australia Post label stock already includes that branding. This choice changes only the carrier header and footer; recipient, barcode and shipment fields retain their carrier-defined positions. Selected shipments are grouped by label family. Generated PDF labels use four labels per A4 page for Parcel Post, three per A4 page for Express Post, and one customs label per A4 page for International. Each family is returned as a separate PDF. Manifest submission remains a separate later operation.

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| Credentials are unavailable | The account was saved without both credential values | Edit it, enter both values, and save again |
| Connection verification fails | The production credentials or account number do not match | Check the Australia Post details and retry once |
| Shipping says the dispatch address is incomplete | The selected location is missing one or more sender fields | Follow **Update location** from Ship Orders and complete every field named there |
| MyPost Business cannot be enabled | Approved ecommerce-partner API access is not available | Use eParcel or leave the MyPost record inactive |
| A preset is not offered | It is inactive or cannot contain the item | Reactivate it or add a suitable larger package |
| An Australia Post preset is marked Added | A tenant preset already uses that name | Edit the existing preset; importing will not overwrite it |

## Worked examples

### Create a package preset

A carton has internal dimensions of 300 × 200 × 100 mm, weighs 0.2 kg empty, and can carry 2 kg. Add those measurements to a Box preset. A 0.8 kg product measuring 100 × 100 × 100 mm can be suggested for this carton, while the tare weight is included in the parcel's suggested shipping weight.
---
{"id":"ims-shipping-settings","title":"Shipping Settings","audiences":["ims"],"capability":"orders","screen":"IMS Settings > Shipping","product":"ims","format":"task","parentId":"ims-business-operations-pos","relatedTopics":["ims-sales-orders-fulfilment","ims-product-setup-variants"],"contexts":["settings-shipping"],"contextSections":{"settings-shipping":"Step-by-step"},"order":53,"summary":"Connect an Australia Post eParcel account and optionally define reusable package presets.","lastReviewed":"2026-09-09","owner":"sales"}
---
# Shipping Settings

Use Shipping Settings to connect an Australia Post eParcel account and optionally define reusable boxes, satchels, pallets or custom packages. Staff can also enter actual parcel measurements directly while preparing Sales Orders.

## Main operations

- Add or update an Australia Post eParcel account.
- Test saved credentials against the Australia Post production Shipping API.
- Keep MyPost Business unavailable until approved partner access is supported.
- Add package presets with internal dimensions, tare weight and an optional maximum weight.
- Add selected Australia Post reference packaging to the editable preset list.

## At a glance

| Setting | Purpose | Practical rule |
|---|---|---|
| Dispatch location | Supplies the sender address used for carrier prices and shipments | Keep its street, suburb or city, state and postcode complete |
| Package dimensions | Determines whether a product can fit | Enter internal length, width and height in millimetres |
| Tare weight | Adds the empty package weight | Enter kilograms |
| Maximum weight | Prevents an overweight suggestion | Leave blank only when the package has no configured limit |

## Before you begin

- [ ] Obtain an eParcel account number, API key and API password from Australia Post.
- [ ] Complete the dispatch location address.
- [ ] Measure the packages used by the dispatch team.

> **Important:** Carrier credentials are not shown again after saving. Each field shows one masking dot per stored character. Leave those dots unchanged to keep the saved value, or type a replacement.

## Step-by-step

1. Open **Settings > Shipping**.
2. Choose **Australia Post eParcel** and enter a recognisable account name.
3. Enter the production account number, API key, API password, and dispatch location. Solvantis uses Australia Post's production Shipping API address automatically.
4. Select **Add account** or **Update account**.
5. Select **Test connection** beside the saved account. The status indicator changes to **Connected** after a successful test, or **Connection failed** when the carrier rejects the connection. Review the reported error before using the account for shipment preparation.
6. Under Package presets, enter a name, package type, internal length, width and height in millimetres, and tare weight in kilograms.
7. To start from carrier packaging, select **Australia Post presets**, choose the required satchels, envelopes or boxes, and select **Add selected**. Existing names are skipped rather than overwritten.
8. Review imported dimensions and enter a measured tare weight where needed. Carrier packaging and service limits can change.
9. Enter a maximum weight where the package or carrier service has one. Keep product rotation enabled only when products may safely be turned to fit.
10. Save the preset. It becomes available when preparing selected Sales Orders.

> **Note:** Preparing a shipment saves the selected service, price and parcels locally. The separate confirmed **Submit to Australia Post & create labels** action creates the billable carrier shipment. Neither action reduces stock; use Sales Order fulfilment when goods physically leave.

Package presets are shortcuts, not a requirement. In **Sales > Sales Orders > Ship Orders**, staff can select a preset or manually enter each parcel's dimensions and final packed weight. Australia Post prices use the current parcel details and the saved account's contract rates. Generated PDF labels use four labels per A4 page for Parcel Post and three per A4 page for Express Post. Manifest submission remains a separate later operation.

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
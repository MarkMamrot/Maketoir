---
{"id":"ims-shipping-settings","title":"Shipping Settings","audiences":["ims"],"capability":"orders","screen":"IMS Settings > Shipping","product":"ims","format":"task","parentId":"ims-business-operations-pos","relatedTopics":["ims-sales-orders-fulfilment","ims-product-setup-variants"],"contexts":["settings-shipping"],"contextSections":{"settings-shipping":"Step-by-step"},"order":53,"summary":"Connect an Australia Post eParcel account and define package presets used to prepare Sales Order shipments.","lastReviewed":"2026-09-08","owner":"sales"}
---
# Shipping Settings

Use Shipping Settings to connect an Australia Post eParcel account and define the boxes, satchels, pallets or custom packages available when preparing Sales Orders.

## Main operations

- Add or update an Australia Post eParcel account.
- Test saved credentials against the Australia Post production Shipping API.
- Keep MyPost Business unavailable until approved partner access is supported.
- Add package presets with internal dimensions, tare weight and an optional maximum weight.

## At a glance

| Setting | Purpose | Practical rule |
|---|---|---|
| Dispatch location | Supplies the sender address | Keep its street, suburb, state and postcode complete |
| Package dimensions | Determines whether a product can fit | Enter internal length, width and height in millimetres |
| Tare weight | Adds the empty package weight | Enter kilograms |
| Maximum weight | Prevents an overweight suggestion | Leave blank only when the package has no configured limit |

## Before you begin

- [ ] Obtain an eParcel account number, API key and API password from Australia Post.
- [ ] Complete the dispatch location address.
- [ ] Measure the packages used by the dispatch team.

> **Important:** Carrier credentials are not shown again after saving. Leaving the credential fields blank while updating an existing account keeps the saved values.

## Step-by-step

1. Open **Settings > Shipping**.
2. Choose **Australia Post eParcel** and enter a recognisable account name.
3. Enter the production account number, API key, API password, and dispatch location. Solvantis uses Australia Post's production Shipping API address automatically.
4. Select **Add account** or **Update account**.
5. Use the flask button beside the saved account to test the connection. Review any visible connection error before using the account for shipment preparation.
6. Under Package presets, enter a name, package type, internal length, width and height in millimetres, and tare weight in kilograms.
7. Enter a maximum weight where the package or carrier service has one. Keep product rotation enabled only when products may safely be turned to fit.
8. Save the preset. It becomes available when preparing selected Sales Orders.

> **Note:** Preparing a shipment saves the selected parcels for later carrier submission. It does not by itself reduce stock or print a label.

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| Credentials are unavailable | The account was saved without both credential values | Edit it, enter both values, and save again |
| Connection verification fails | The production credentials or account number do not match | Check the Australia Post details and retry once |
| MyPost Business cannot be enabled | Approved ecommerce-partner API access is not available | Use eParcel or leave the MyPost record inactive |
| A preset is not offered | It is inactive or cannot contain the item | Reactivate it or add a suitable larger package |

## Worked examples

### Create a package preset

A carton has internal dimensions of 300 × 200 × 100 mm, weighs 0.2 kg empty, and can carry 2 kg. Add those measurements to a Box preset. A 0.8 kg product measuring 100 × 100 × 100 mm can be suggested for this carton, while the tare weight is included in the parcel's suggested shipping weight.
---
{"id":"ims-business-operations-pos-settings","title":"Business Operations and POS Settings","audiences":["ims"],"capability":"navigation","screen":"IMS Settings","product":"ims","format":"task","parentId":"ims-workspaces","relatedTopics":["ims-location-stock-operations","setup-connections","ims-online-shop","pos-register-device-login","pos-store-daybook"],"contexts":["dashboard","locations","location-daybooks","pos-sales"],"contextSections":{"dashboard":"Step-by-step","locations":"Manage POS registers","location-daybooks":"Configure Business Operations","pos-sales":"Manage POS registers"},"order":90,"summary":"Complete onboarding, choose operational capabilities, and manage each location's POS registers without editing location details.","lastReviewed":"2026-08-29","owner":"setup"}
---
# Business Operations and POS Settings

Use IMS Settings to choose the workflows the business uses and to maintain the registers available at each location.

## Main operations

- Complete business setup in the recommended dependency order.
- Enable only the location, catalogue, purchasing, and sales-channel capabilities the business uses.
- Enable Shopify, the native Solvantis Online Store, both channels, or neither channel.
- Add, rename, activate, or set the default float for POS registers without changing location details.

## At a glance

| Need | Open | Result |
|---|---|---|
| Complete the guided checklist | IMS onboarding | Core records and settings prepared in dependency order |
| Choose operational capabilities | Settings > General | Relevant IMS workflows enabled |
| Manage tills by location | Settings > Point of Sale > Registers | Active registers available for POS device setup |

## Before you begin

- Select the intended business.
- Confirm the locations that will trade through POS.
- Gather the brand names and active suppliers needed by the product catalogue.
- Decide whether online sales will use Shopify, the native Solvantis Online Store, both during a transition, or neither.

## Step-by-step

The onboarding checklist starts with business, tax, integration, user, and location decisions. Before importing products, add the brands and suppliers that the catalogue will reference.

Once the full checklist is finished, onboarding is complete for the whole business and does not reopen when Solvantis adds steps for future new businesses. An explicitly reopened step makes the checklist available again for that business.

1. Complete Business identity, Operations, Tax settings, and Integrations.
2. Add additional users and locations.
3. Add brands.
4. Add supplier contacts.
5. Import products.
6. Continue with sales orders, purchase orders, opening stock, and the POS readiness review.

Each action step opens its owning IMS workspace. Return to the onboarding checklist and choose **Mark done and continue** after reviewing the step.

## Configure Business Operations

Open **Settings > General**. Business Operations is grouped by purpose:

| Group | Settings | Effect |
|---|---|---|
| Locations and catalogue | Multiple locations, Zones and bins, Product categories | Controls location-aware and catalogue organisation workflows |
| Purchasing | Foreign currencies | Shows currency and exchange-rate fields for purchasing |
| Sales channels and integrations | Business requires POS, Wholesale sales, Shopify, Solvantis Online Store, Accounting software | Enables the relevant POS, Daybook, portal, store, connection, and mapping workflows |

Use each switch to enable or disable the capability, then select **Save Settings**. Only settings changed in the current form are updated. A **Saved** confirmation appears after the changes have been stored. If current settings cannot be loaded or a save fails, the controls remain unavailable and the error is shown without applying the draft values.

These settings control available workflows; they do not move stock, create orders, or connect an external account by themselves.

When **Accounting software** is off, accounting integration navigation, setup connections, document statuses, posting controls, automation, and contextual guidance are hidden. Integration requests are also blocked, so switching the capability off is more than a display preference. Turn it on and choose the supported accounting platform before connecting an organisation or configuring posting rules.

Enable **Business requires POS** when the business sells directly to the public in stores or other staffed locations. This makes **Locations > Location Daybooks** available. Existing businesses default to enabled. If the switch is later disabled, Location Daybooks remains available while an active location still has POS enabled, an enrolment code, or an active register.

Shopify and the Solvantis Online Store are independent switches:

- Enable **Solvantis Online Store** to configure the native hosted storefront. Setup can be completed before launch; the public storefront remains unavailable until it is activated.
- Enable **Shopify** for Shopify product, inventory, customer, and order synchronisation.
- Enable both while operating both channels or transitioning between them.
- Disable both when the business does not use an online sales channel.

Disabling a channel hides its integration workspace and stops new connection or synchronization activity. Existing credentials, historical orders, and source information are retained so the channel can be restored later. Historical native orders can still be corrected or refunded after the native storefront is disabled.

## Manage POS registers

1. Open **Settings > Point of Sale**.
2. Expand **Registers**.
3. Find the location in the read-only location table and select **Manage registers**.
4. Add a register with a name and default float, or rename, change the float, deactivate, or reactivate an existing register.
5. Configure any payment terminal separately under **Card Terminals**.

Location names, codes, addresses, and operational flags cannot be edited from this section. Use **Locations** for those changes.

> **Important:** Deactivating a register prevents it from being selected for future POS device setup. It does not remove historical sales or register sessions.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| A supplier is missing during product setup | The supplier step was skipped or the contact is not an active Supplier | Open Contacts, create or update the supplier, then return to Products |
| A brand is missing during product import | The brand has not been created | Open Brands, add it, then retry the product workflow |
| Onboarding content does not fit at high browser zoom | The visible wizard area is shorter at higher zoom levels | Scroll the middle setup panel; the Back and continue buttons remain available below it |
| A location has no register choices in POS | No active register exists for that location | Open Settings > Point of Sale > Registers and add or reactivate one |
| Online Store controls are not available | Online shop is disabled or another platform is selected | Enable Online shop, choose Solvantis Online Store, save, then open Integrations > Online Shop |
| Accounting integration controls are not available | Accounting software is disabled in Business Operations | Enable Accounting software, choose the supported platform, and save before opening its connection or posting setup |

## Worked examples

### Prepare a new shop for POS

Create the location first, then open **Settings > Point of Sale > Registers**. Select the new location, add **Front Till** with its normal opening float, and leave it active. The POS device can then be assigned to that location and register without changing any location address or stock settings.

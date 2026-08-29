---
{"id":"ims-online-shop","title":"Online Shop","audiences":["ims"],"capability":"integrations","requiresCapabilities":["native_shop"],"screen":"Integrations > Online Shop","product":"ims","format":"overview","parentId":"ims-integrations","contexts":["online-shop","online-shop-settings","online-shop-templates","online-shop-pages","online-shop-products","online-shop-shipping","online-shop-checkout","online-shop-account"],"contextSections":{"online-shop":"Storefront workflow","online-shop-settings":"Store settings","online-shop-templates":"Templates and pages","online-shop-pages":"Templates and pages","online-shop-products":"Products and publication","online-shop-shipping":"Shipping and fulfilment","online-shop-checkout":"Checkout and signed-in customers","online-shop-account":"Checkout and signed-in customers"},"relatedTopics":["ims-xero-reconciliation","ims-shopify-sync","ims-customer-orders"],"order":95,"summary":"Configure, publish, fulfil, and support the native Solvantis consumer storefront.","lastReviewed":"2026-08-29","owner":"commerce"}
---
# Online Shop

The Online Shop is Solvantis's native consumer storefront. Its publication is separate from Shopify, while successful checkouts become normal IMS online Sales Orders.

## Main operations

- Configure store identity, hosted address, optional custom domain, and Stripe connection.
- Build and publish templates and content pages.
- Publish eligible IMS products independently of Shopify.
- Configure delivery rates, click and collect, and order fulfilment.
- Support signed-in customer rewards, store credit, orders, and refunds.

## Storefront workflow

| Area | Main decision | Public effect |
|---|---|---|
| Store settings | Identity, address, domain, payments, fulfilment mode | Controls whether checkout and the storefront can operate |
| Products | Publish or unpublish eligible products | Changes native catalogue visibility only |
| Shipping | Delivery coverage, price, free threshold, pickup branches | Controls available checkout choices |
| Templates | Draft, review, and publish page layouts | Changes standard storefront pages |
| Pages | Content, navigation, visibility, and publication | Adds pages such as Shipping, Returns, or Privacy |

## Store settings

Checkout needs an active native shop, online stock locations, a delivery rate or click-and-collect option, and a connected Stripe account ready to accept charges. An optional custom domain becomes active only after the displayed ownership record, CNAME target, HTTPS routing, and certificate are verified. The hosted `/shop/` address continues to work while a custom domain is pending or disconnected.

Retail prices and delivery rates are tax-inclusive AUD amounts. At checkout the server recalculates publication, price, delivery, GST, and available stock before reserving concrete quantities for a limited time.

> **Important:** Native publication does not depend on a Shopify product ID. Switching a product on or off in the native shop does not publish or unpublish it in Shopify.

## Products and publication

A product needs at least one active variant with a retail price and a unique native store address before publication. Review images, content, current sale pricing, and availability before publishing. Sold-out products may remain visible but cannot be added to the cart.

## Templates and pages

Templates and content pages keep separate draft and published revisions. Save the draft before publishing; publishing is blocked while the editor has unsaved changes. A content page is public only when it has published content and **Visible when published** is selected.

## Shipping and fulfilment

| Mode | Best when | What Solvantis creates |
|---|---|---|
| **One location per order** | One branch can supply the complete delivery | One order from that location; checkout cannot combine stock from several branches |
| **Consolidate to one dispatch location** | One parcel and one dispatch team are preferred | Transfer work brings stock to the selected dispatch branch before fulfilment |
| **Split by fulfilment location** | Faster supply matters more than one parcel | One Sales Order per source location, which may mean separate fulfilments |

Choose consolidation when staff can manage the transfer and the customer should receive one dispatch. Choose split fulfilment when separate branch work and possible separate parcels are acceptable. Click and collect uses the customer-selected enabled pickup location.

## Checkout and signed-in customers

| Shopper | Checkout capability |
|---|---|
| Guest | Delivery or click and collect, current pricing, secure Stripe payment |
| Signed in | Guest capabilities plus eligible loyalty rewards and available store credit |

Signed-in customers can view account value and use one eligible fixed-value loyalty reward, store credit, or both. The reward reduces eligible merchandise first; store credit then settles the remaining order value before Stripe. Reservations do not change points or store credit until checkout succeeds. If account value covers the whole order, checkout completes without opening Stripe.

For a native return, create the customer credit note from the linked Sales Order and complete the supported refund choice. A partial mixed-payment refund restores the original store-credit payment before sending any remainder to Stripe. Stock and customer value do not change if Stripe rejects the refund.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| A product is absent | Not published, no active retail-priced variant, duplicate address, or no online stock location | Correct the requirement and publish again |
| A page is not public | Draft not published or visibility is off | Publish the saved revision and enable visibility |
| No delivery option appears | Address is outside active state or postcode rules | Review the destination and delivery-rate coverage |
| Payment cannot start | Stripe setup is incomplete or charges are not enabled | Complete or reconnect the merchant Stripe account |
| Reward or store credit is unavailable | Shopper is not signed in, balance changed, or selection expired | Sign in, refresh the current value, and apply it again |
| A custom domain will not verify | DNS record, CNAME, HTTPS, or certificate is incomplete | Compare the displayed records exactly and retry after propagation |

## Worked examples

### Choose split or consolidated fulfilment

A customer orders a jacket held at Brisbane and shoes held at Sydney. **Split by fulfilment location** creates separate branch Sales Orders. **Consolidate** creates transfer work to the chosen dispatch branch so one team can send the complete parcel.

### Combine a reward and store credit

For a $100 order, a signed-in customer applies a $20 reward and $30 store credit. The order records a $20 merchandise discount, $30 settled by store credit, and $50 due through Stripe. Points and store credit change only after successful checkout.

---
{"id":"ims-online-shop","title":"Online Shop","audiences":["ims"],"capability":"integrations","screen":"Integrations > Online Shop","product":"ims","parentId":"ims-integrations","contexts":["online-shop","online-shop-settings","online-shop-templates","online-shop-pages","online-shop-products","online-shop-shipping","online-shop-checkout","online-shop-account"],"order":95,"summary":"Prepare and publish the native Solvantis consumer storefront.","lastReviewed":"2026-08-23","owner":"commerce"}
---
# Online Shop

Administrators open **Integrations > Online Shop** to prepare Solvantis's native consumer storefront. Native publication is separate from Shopify publication.

## Main operations

- Configure store identity, hosted address, support email, logo, and search metadata.
- Edit and publish templates for Home, Catalogue, Collection, Product, Cart, Checkout, Sign in, and Account.
- Create and publish custom content pages such as About, Shipping, Returns, and Privacy.
- Publish eligible products to the native shop independently of Shopify.
- Configure delivery rates, free-shipping thresholds, click-and-collect locations, and order fulfilment behavior.
- Connect the merchant's Stripe account for secure checkout payments.
- Let signed-in customers apply an eligible loyalty reward, store credit, or both at checkout.
- Review the active native online channel, catalogue availability, prices, and public routes.

## Before you begin

The native shop profile and native online sales channel must be active for public browsing. Product publication requires at least one active retail-priced variant and a unique native product address. Uploaded store images support JPEG, PNG, WebP, and GIF up to 10 MB.

Checkout also requires active online stock locations, at least one delivery rate or click-and-collect location, and a connected Stripe account that is ready to accept charges.

## Step-by-step workflows

### Publish a template change

1. Open Templates and choose the storefront view.
2. Add, edit, remove where allowed, or reorder compatible sections.
3. Save the draft.
4. Review the saved version and publish it. Publishing is blocked while unsaved editor changes remain.

### Publish a product

1. Open Products in Online Shop.
2. Confirm an active variant has a retail price and the product has a unique native address.
3. Review imagery, content, current sale pricing, and availability.
4. Publish to the native shop. Existing Shopify links remain for context but do not control native publication.

### Configure fulfilment and shipping

1. In Store settings, choose whether each delivery order must come from one location, may be consolidated to a dispatch location, or may split by fulfilment location.
2. For consolidation, choose the branch that dispatches the completed parcel.
3. Open Shipping and add tax-inclusive delivery rates. Optionally limit a rate by Australian state, exact postcode, postcode range, or prefix, and set a free-shipping threshold.
4. Enable each online location that customers may choose for click and collect.

### Connect payments

In Store settings, connect the merchant's Stripe account. Stripe must report that account setup is complete and charges are enabled before checkout can start payment. Payments, Stripe fees, disputes, and payouts belong to the connected merchant account; Solvantis does not store the merchant's Stripe secret key.

### Use loyalty rewards and store credit

Customers sign in before creating the checkout and use the same email address at checkout. After stock is reserved, checkout shows active fixed-value rewards that the customer has enough available points and eligible merchandise to use, plus available store credit. A customer may apply one reward and store credit together. The reward is applied to merchandise first and store credit is applied to the remaining order value.

The selection is reserved while checkout is active but does not change either customer ledger until payment succeeds. Starting payment locks the selection. If the selected value covers the complete order, checkout completes without opening Stripe.

## Statuses, calculations, and permissions

Each template and content page has draft and published revisions. Revision checks prevent one editor from silently overwriting another saved draft. Required commerce sections cannot be removed.

A custom page is publicly eligible only after it has published content and is marked visible. Product unpublishing removes it from native browsing without deleting the IMS product or Shopify mapping.

Retail prices are tax-inclusive AUD values. Active sale pricing respects saved start and end dates. Availability uses uncommitted stock at active locations enabled for online sales. Sold-out products remain browseable but cannot be added, and only whole individual units are orderable.

The server recalculates product prices, delivery, GST, and stock when checkout is created. Checkout reserves concrete stock for a limited period. A loyalty reward is a merchandise discount; store credit settles the discounted balance and Stripe settles any amount still due. Successful settlement converts the reservation into ordinary confirmed IMS online sales orders, records loyalty and store-credit ledger entries idempotently, and awards points on eligible merchandise after the loyalty discount. Delivery and payment methods do not reduce eligible merchandise spend. Split fulfilment creates one order per source location; consolidation creates transfer work into the selected dispatch location. These orders continue through the normal IMS fulfilment and daily online Xero batch processes, where Stripe cash and store-credit liability settlement remain separate.

## Troubleshooting

- Save outstanding editor changes before publishing.
- Resolve a revision conflict by refreshing and reconciling the newer saved draft rather than overwriting it blindly.
- Confirm page visibility and published content when a custom page is not public.
- Confirm native publication, active retail pricing, unique address, channel state, and enabled online stock locations when a product is absent.
- Every cart refresh recalculates current publication, price, and availability on the server.
- If checkout reports no delivery option, review the destination state/postcode coverage and active rates.
- If payment cannot start, complete Stripe account onboarding and confirm the deployment publishable key and Connect webhook are configured.
- If a reward or store-credit selection has expired, review the current balance and apply it again before starting payment.

## Related tasks

Related Help topics include All Products, Website Content Studio, Shopify, Online Sales, Brands, and Stock Levels.

## Worked examples

### Publish a returns page

Create a Returns page, choose its address and navigation placement, write and save the draft, publish that revision, and mark the page visible. A saved but unpublished or hidden page is not publicly eligible.

### Unpublish a native product without affecting Shopify

Open the product in Online Shop and unpublish it from the native channel. It disappears from native browsing, while the IMS product and any existing Shopify mapping remain intact.

### Combine a reward and store credit

For a $100 order, a signed-in customer may select a fixed $20 reward and then apply $30 store credit. The order records a $20 loyalty discount, $30 of store-credit settlement, and $50 due through Stripe. Points and store credit remain unchanged until successful settlement.
---
{"id":"ims-online-shop","title":"Online Shop","audiences":["ims"],"capability":"integrations","screen":"Integrations > Online Shop","product":"ims","parentId":"ims-integrations","contexts":["online-shop","online-shop-settings","online-shop-templates","online-shop-pages","online-shop-products"],"order":95,"summary":"Prepare and publish the native Solvantis consumer storefront.","lastReviewed":"2026-08-23","owner":"commerce"}
---
# Online Shop

Administrators open **Integrations > Online Shop** to prepare Solvantis's native consumer storefront. Native publication is separate from Shopify publication.

## Main operations

- Configure store identity, hosted address, support email, logo, and search metadata.
- Edit and publish templates for Home, Catalogue, Collection, Product, Cart, Checkout, Sign in, and Account.
- Create and publish custom content pages such as About, Shipping, Returns, and Privacy.
- Publish eligible products to the native shop independently of Shopify.
- Review the active native online channel, catalogue availability, prices, and public routes.

## Before you begin

The native shop profile and native online sales channel must be active for public browsing. Product publication requires at least one active retail-priced variant and a unique native product address. Uploaded store images support JPEG, PNG, WebP, and GIF up to 10 MB.

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

## Statuses, calculations, and permissions

Each template and content page has draft and published revisions. Revision checks prevent one editor from silently overwriting another saved draft. Required commerce sections cannot be removed.

A custom page is publicly eligible only after it has published content and is marked visible. Product unpublishing removes it from native browsing without deleting the IMS product or Shopify mapping.

Retail prices are tax-inclusive AUD values. Active sale pricing respects saved start and end dates. Availability uses uncommitted stock at active locations enabled for online sales. Sold-out products remain browseable but cannot be added, and only whole individual units are orderable.

## Troubleshooting

- Save outstanding editor changes before publishing.
- Resolve a revision conflict by refreshing and reconciling the newer saved draft rather than overwriting it blindly.
- Confirm page visibility and published content when a custom page is not public.
- Confirm native publication, active retail pricing, unique address, channel state, and enabled online stock locations when a product is absent.
- Every cart refresh recalculates current publication, price, and availability on the server.

## Related tasks

Related Help topics include All Products, Website Content Studio, Shopify, Online Sales, Brands, and Stock Levels.

## Worked examples

### Publish a returns page

Create a Returns page, choose its address and navigation placement, write and save the draft, publish that revision, and mark the page visible. A saved but unpublished or hidden page is not publicly eligible.

### Unpublish a native product without affecting Shopify

Open the product in Online Shop and unpublish it from the native channel. It disappears from native browsing, while the IMS product and any existing Shopify mapping remain intact.
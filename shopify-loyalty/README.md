# Solvantis Loyalty Customer Account Extension

Read-only Shopify customer account experience backed by customer metafields in the
`solvantis_loyalty` namespace. It contains a profile summary block and a full rewards page.

## Link and preview

1. Run `npm install` in this directory.
2. Run `npm run shopify -- app config link` and select or create the Solvantis app.
3. Request level 1 protected customer data access in the Shopify Dev Dashboard.
4. Run `npm run dev` and select a development store using new customer accounts.
5. Add the profile block and rewards page in Shopify's checkout and accounts editor.

The extension reads Shopify's authenticated Customer Account API directly. It has no external
network capability and cannot change points, membership, rewards, or discount codes.

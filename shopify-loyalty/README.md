# Solvantis Loyalty Customer Account Extension

Shopify customer account experience backed by customer metafields in the
`solvantis_loyalty` namespace. It contains a profile summary block, a full rewards page,
and authenticated self-service reward claiming.

## Link and preview

1. Run `npm install` in this directory.
2. Run `npm run shopify -- app config link` and select or create the Solvantis app.
3. Request level 1 protected customer data access and network access in the Shopify Dev Dashboard.
4. Configure the shared Solvantis Partner app credentials in Railway:
	- `SHOPIFY_LOYALTY_APP_CLIENT_ID`
	- `SHOPIFY_LOYALTY_APP_SECRET`
5. Run `npm run dev` and select a development store using new customer accounts.
6. Add the profile block and rewards page in Shopify's checkout and accounts editor.

The extension reads Shopify's authenticated Customer Account API directly. Claims call
`https://solvantis.com.au/api/shopify/loyalty/rewards` with a fresh customer-account session token;
the backend verifies the signed shop and customer identity before resolving a tenant. The endpoint
uses the existing loyalty reward issuance service, so points reservation, Shopify discount creation,
retries, and idempotency remain server-owned.

Reward claims are hard-bound to `https://solvantis.com.au`. The customer session token is never sent
to a merchant-configurable or caller-selected origin. Local UI development should mock the claim
client rather than redirecting authenticated requests to another host.

## Validate

Run these commands from this directory before deploying:

```sh
npm ci
npm test
npm run typecheck
npm run build
```

The repository CI runs the same extension tests, typecheck, and Shopify production bundle build.

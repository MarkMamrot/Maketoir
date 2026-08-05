# Shopify Access Review Readiness

This document describes the Solvantis Loyalty Customer Account extension as implemented. It is
supporting evidence, not a substitute for a published privacy policy, data processing agreement,
retention policy, or legal review.

## Requested access

- Protected customer data: Level 1 only.
- Protected fields: none. The extension does not request name, address, email, or phone.
- Customer Account API scope: `customer_read_customers`.
- Extension capability: `network_access`.

Suggested protected-data justification:

> Solvantis displays the authenticated customer's loyalty membership, points balance, program
> labels, and available rewards from six app-owned customer metafields. It does not request the
> customer's name, email, phone, address, orders, or payment information. Access is limited to the
> signed-in customer's record and is required to provide their loyalty account experience.

Suggested network-access justification:

> Network access is used only when the authenticated customer confirms a reward claim. The
> extension obtains a fresh Shopify Customer Account session token and sends it over HTTPS to
> `https://solvantis.com.au/api/shopify/loyalty/rewards`. The server verifies the token signature,
> audience, expiry, shop, and customer before resolving the exact connected tenant and enrolled
> loyalty contact. The browser cannot provide a business or contact identity. The endpoint creates
> the selected single-use Shopify discount through the existing idempotent loyalty issuance service
> and returns the voucher code and updated points balance. The token is not persisted or logged and
> cannot be redirected to a merchant-configurable host.

## Data inventory and controls

| Data | Purpose | Storage and transfer |
| --- | --- | --- |
| Shopify shop domain | Resolve the exact connected merchant | Signed JWT claim; normalized and matched to the main connection record |
| Shopify customer ID | Resolve the exact enrolled loyalty contact | Signed JWT subject; stored on the tenant contact record |
| Loyalty membership and balance | Display and enforce the loyalty program | Tenant IMS database and app-owned Shopify customer metafields |
| Program labels and rewards | Display available rewards | App-owned Shopify customer metafields |
| Reward claim and voucher code | Maintain an auditable, idempotent redemption | Tenant loyalty ledger/redemption tables; voucher created in the merchant's Shopify store |
| Customer Account session token | Authenticate one claim request | HTTPS in transit only; verified in memory; never persisted or included in Runtime Issues |
| Shopify Admin access token | Create the single-use discount | Encrypted connection secret; server-side only; never sent to the extension |

Implemented controls:

- The customer account query requests only six `solvantis_loyalty` metafields.
- Per-customer `loyalty_member` is off by default and records enrollment/opt-out timestamps.
- Opt-out prevents new loyalty mutations while preserving corrective accounting history.
- JWT verification requires HS256, the exact app audience, active lifetime, Shopify customer GID,
  token identifier, and a normalized `*.myshopify.com` destination.
- Tenant selection comes only from the verified shop claim and runs inside
  `runImsForBusiness(businessId, callback)`.
- Customer selection comes only from the verified customer claim and must resolve exactly one
  active, enrolled tenant contact.
- Claims use a server-prefixed idempotency key and the existing transactional issuance service.
- Responses use `Cache-Control: no-store`; request bodies must be JSON and no more than 2 KiB.
- Operational reports contain bounded identifiers and never tokens, authorization headers, or raw
  customer payloads.
- The extension sends authenticated claims only to the fixed Solvantis HTTPS origin.

## Evidence to prepare before requesting review

The following are business/governance requirements and cannot be satisfied by application code
alone:

- Publish a privacy policy that identifies the data above, purposes, processors, retention periods,
  customer rights, contact method, and international transfer arrangements if applicable.
- Put a data processing agreement or equivalent privacy terms in place with merchants.
- Define and apply retention periods for Shopify customer linkage, loyalty ledger/redemptions,
  runtime issue records, and backups. Document any legally required transaction-record retention.
- Retain evidence that production databases, disks, backups, and all network traffic are encrypted.
- Document who can access production customer data and how access is removed and reviewed.
- Maintain an incident-response procedure with notification and escalation responsibilities.
- Capture screenshots or a short review video showing enrollment, the customer loyalty page,
  confirmation, successful voucher issuance, and opt-out behavior.

## Public distribution blocker

Before Shopify App Store review, implement and configure HMAC-verified compliance handlers for:

- `customers/data_request`
- `customers/redact`
- `shop/redact`

The handlers must reject invalid HMAC signatures with HTTP 401, acknowledge valid requests, and
drive a documented export/redaction workflow completed within Shopify's required period. Redaction
must account for loyalty ledger records that may need legally justified retention or anonymization;
do not delete financial history without an approved retention policy.

These webhooks are mandatory for App Store distribution. They are not required merely to test on a
development store, and Shopify documents Level 1 access as always available to custom apps.
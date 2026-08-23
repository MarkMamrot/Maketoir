---
{"id":"ims-xero-shopify","title":"Xero and Shopify","audiences":["ims"],"capability":"integrations","screen":"Integrations","product":"ims","parentId":"ims-integrations","contexts":["xero","shopify"],"contextSections":{"xero":"Xero","shopify":"Shopify"},"order":90,"summary":"Configure, monitor, troubleshoot, and safely retry supported accounting and commerce synchronization.","lastReviewed":"2026-08-23","owner":"integrations"}
---
# Xero and Shopify

## Main operations

- Confirm connection health before changing mappings or retrying work.
- Maintain Xero ledger, tax, tracking, payment, and automation settings required by enabled postings.
- Use Xero Sync History to inspect the source, status, and retry path of accounting work.
- Review Shopify product, customer, order, inventory, and webhook synchronization from its owning status.
- Retry only the failed integration action; do not repeat a successful stock, order, sale, receipt, or credit operation.

## Xero

Xero configuration includes connection status, automation policy, ledgers, tracking, payment routing, Sync History, COGS Reconciliation, and applicable Shopify payout activity. A missing mapping can block the affected accounting posting while the operational transaction remains valid. Correct the mapping or connection, then retry the unfinished posting.

POS sales are summarized for Xero by the End of Day workflow. Online sales follow the configured online-sales accounting policy rather than being included in the POS EOD summary.

## Shopify

Shopify integration coordinates supported products, customers, orders, inventory, and webhooks. Check source ownership and status before manual action. A delayed or failed synchronization does not by itself mean the operational record should be recreated.

## Sync status and retries

Use status and history to distinguish pending, successful, blocked, and retryable work. Resolve expired authorization or missing mappings first. Repeating the source transaction can duplicate stock or financial effects, whereas a supported retry continues only the integration work.

## Troubleshooting

- If many actions fail together, check connection authorization before individual records.
- If one posting is blocked, inspect its required ledger, tax, tracking, or payment mapping.
- If Shopify data appears stale, review sync and webhook status before editing both systems.
- Keep online sales and POS EOD accounting workflows separate when reconciling Xero.

## Worked examples

### Retry a blocked Xero posting

Open Sync History, select the failed source, read the safe error detail, and correct the missing mapping or connection. Retry that posting and confirm success without recreating the operational transaction.

### Investigate a Shopify inventory delay

Open Shopify integration status, confirm connection health and the product mapping, then inspect the relevant sync or webhook event. Retry only where offered after correcting the cause; verify the destination before making any manual stock change.
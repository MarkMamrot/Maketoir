---
{"id":"ims-xero-shopify","title":"Xero and Shopify","audiences":["ims"],"capability":"integrations","screen":"Integrations","product":"ims","format":"overview","parentId":"ims-integrations","contexts":["integrations"],"contextSections":{"integrations":"Choose an integration"},"relatedTopics":["ims-sales-channels","ims-xero-reconciliation","ims-shopify-sync","ims-online-shop"],"order":90,"summary":"Choose the right setup, monitoring, and recovery guide for Xero or Shopify.","lastReviewed":"2026-09-27","owner":"integrations","quickSections":["Main operations","Choose an integration","Safe retry rule"]}
---
# Xero and Shopify

Xero handles supported accounting work. Shopify exchanges supported catalogue, customer, order, inventory, fulfilment, and payout information. Each integration has its own connection, mappings, statuses, and retry path.

## Main operations

- Confirm connection health before changing mappings or retrying records.
- Use Xero for accounting setup, Sync History, cost reconciliation, and Shopify payout posting.
- Use Shopify for commerce sync, product linkage, webhooks, and sync history.
- Retry only the failed integration action after fixing its cause.

## Choose an integration

| Need | Open | Detailed guide |
|---|---|---|
| Review every connected storefront and its operating state | **Sales Channels** | **Sales Channels** |
| Configure Xero accounts, tracking, payments, or sync rules | **Xero > Setup** | **Xero Sync and Reconciliation** |
| Investigate an accounting warning | **Xero > Sync History** | **Xero Sync and Reconciliation** |
| Review COGS or Shopify payouts in Xero | **Xero > Activity** | **Xero Sync and Reconciliation** |
| Sync products or check Shopify linkage | **Sales Channels > Shopify store > Configure > Products** | **Shopify Sync and Product Mapping** |
| Investigate a stale order, inventory update, or webhook | **Sales Channels > Shopify store > Configure > Activity** | **Shopify Sync and Product Mapping** |
| Publish through Solvantis instead of Shopify | **Online Shop** | **Online Shop** |

Xero Settings owns the business-wide accounting policy. Each Shopify store's **Accounting** tab only opts that store into eligible daily sales and payout workflows; it cannot weaken the global Xero policy.

## Safe retry rule

An IMS operation and its integration posting are separate steps. A sale, fulfilment, receipt, return, or credit can be complete even when Xero or Shopify still needs attention.

> **Warning:** Do not recreate a successful IMS transaction to clear an integration error. Repair the connection or mapping, then retry the unfinished sync where offered.

## Troubleshooting

| Symptom | Start with | Do not do |
|---|---|---|
| Many Xero items fail together | Connection authorization | Recreate every source transaction |
| One Xero item is blocked | Its required account, tax, tracking, or payment mapping | Post an unrelated manual duplicate |
| Shopify information looks stale | Connection, sync history, and webhooks | Edit stock independently in both systems without tracing the sync |
| Shopify Misc Charge appears | The original Shopify line and variant linkage | Edit or delete the protected fallback product |

## Worked examples

### Choose the right recovery page

A completed supplier receipt shows a Xero warning. Open **Xero > Sync History**, not the Purchase Order receipt action. Fix the named accounting setup and retry the posting so the stock receipt is not repeated.

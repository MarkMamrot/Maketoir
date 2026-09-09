---
{"id":"ims-sales-channels","title":"Sales Channels","audiences":["ims"],"capability":"integrations","screen":"Integrations > Sales Channels","product":"ims","format":"overview","parentId":"ims-xero-shopify","contexts":["sales-channels"],"contextSections":{"sales-channels":"Review channel instances"},"relatedTopics":["ims-shopify-sync","ims-online-shop","ims-xero-shopify"],"order":91,"summary":"Review each connected online storefront and its current operating state.","lastReviewed":"2026-09-09","owner":"integrations"}
---
# Sales Channels

Sales Channels shows each online storefront separately. A business with multiple Shopify stores has one row per store, while the Solvantis Online Store appears as its own channel.

## Main operations

- Confirm that every expected storefront appears as a separate channel.
- Check whether a channel is active, paused, waiting for setup, or needs attention.
- Review the external account identity and last successful synchronization time.
- Compare the operations supported by each provider.
- Rename a channel so staff can distinguish its purpose.
- Test a Shopify instance against its exact saved store and credentials.
- Open the provider's integration area when catalogue, order, mapping, or synchronization work is required.

## Review channel instances

Open **Integrations > Sales Channels**. Each row identifies the storefront, provider, operating state, account identity, last synchronization time, and supported operations.

Administrators can use the pencil button beside a channel name to rename it. Other IMS users can review the same status information but cannot change it.

Administrators can choose **Test connection** on a Shopify row. Solvantis authenticates with that instance's saved credentials and confirms Shopify returns the same permanent store domain. The result updates the readiness status but does not synchronize products, orders, customers, inventory, or payments.

| Status | Meaning | Next step |
|---|---|---|
| Active | The instance is enabled and passed its latest readiness check | Continue normal monitoring |
| Paused | New provider synchronization is paused for this instance | Review the provider setup before resuming it |
| Setup pending | The instance has not completed readiness checks | Complete the provider connection setup |
| Needs attention | The latest readiness or runtime state contains an operational problem | Read the safe error summary and inspect the provider integration |

> **Important:** The operating state is informational on this screen. Use the existing provider setup while connection and synchronization controls are being moved into Sales Channels.

## Troubleshooting

| Symptom | What to check |
|---|---|
| An expected store is missing | Confirm the business has that provider enabled, then review its connection setup |
| Two stores look similar | Compare the external account identity; channel names are labels and may be changed later |
| A row needs attention | Use its error summary, then open the matching provider integration for detailed history |
| Products or orders are stale | Check the exact channel instance before retrying provider synchronization |

## Worked examples

### Review two Shopify stores

A retailer operates separate Australian retail and wholesale Shopify stores. **Sales Channels** shows two Shopify rows with different store domains. Staff use the domain to choose the correct instance before investigating a stale order or product mapping.

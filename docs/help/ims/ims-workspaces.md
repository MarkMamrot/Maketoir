---
{"id":"ims-workspaces","title":"IMS Workspaces","audiences":["ims"],"capability":"navigation","screen":"IMS","product":"ims","format":"overview","contexts":["dashboard"],"contextSections":{"dashboard":"Choose a workspace"},"order":1,"summary":"Find the right IMS workspace for products, orders, customers, stock, reports, and integrations.","lastReviewed":"2026-08-25","owner":"operations"}
---
# IMS Workspaces

IMS brings day-to-day retail operations into one workspace. Start with the business question, then open the area that owns the record or action.

## Main operations

- Use the Dashboard to spot work that needs attention.
- Open the workspace that owns the product, order, customer, stock movement, report, or connection.
- Follow a source link when reviewing a summary instead of recreating the transaction.
- Use Team Chat to communicate with POS locations as the configured default warehouse.
- Use Ask Solvantis for an explanation or read-only lookup; it cannot approve or change work.

## Choose a workspace

| What you need to do | Start here | Typical work |
|---|---|---|
| Maintain products, prices, variants, brands, or stock | **Products** | Catalogue setup, stock levels, gift cards, bulk edit |
| Buy from suppliers | **Purchasing** | Purchase orders, backorders, returns, supplier credits, order planning |
| Sell and fulfil customer orders | **Sales** | Sales Orders, allocation, backorders, returns, POS and online sales |
| Manage customer relationships | **Contacts** | Contacts, profiles, tasks, segments, pipeline, data quality |
| Move or count physical stock | **Locations** | Branch transfers, receiving, stocktakes, location setup |
| Answer a business question | **Reports** | Sales, margin, valuation, registers, banking, availability |
| Manage connected services | **Integrations** | Xero, Shopify, and the native Online Shop |

## How summaries work

Dashboard cards, CRM profiles, and reports help you find and understand activity. They do not replace the source sale, order, credit note, receipt, transfer, or accounting sync. Open the source record before correcting anything.

Ask Solvantis can use the current screen and supported read-only lookups to explain visible information. It does not see hidden form values, credentials, or arbitrary records, and it cannot edit data or run a workflow.

Select the Team Chat icon at the bottom right to open the all-locations group conversation. Choose a location for a direct message. New direct messages sent to the warehouse appear as a badge on the icon and beside the sending location. The Help icon in the top bar opens the same drawer directly to Help; Ask Solvantis remains available in its own tab.

Paste a JPG, PNG, or WebP screenshot directly into the message box before sending. Up to three screenshots can be attached to one message, with a maximum size of 10 MB each. Staged screenshots are shown above the message box and can be removed before sending.

Team Chat sends as the active business's **Default Warehouse Location** from **Settings > IMS Settings > Locations**. POS staff can reply by selecting that Warehouse location in Team Communications.

> **Important:** If an integration step fails after an IMS operation succeeds, retry the unfinished integration step. Do not repeat the sale, receipt, fulfilment, transfer, or credit.

## Troubleshooting

| Symptom | Check first | Next step |
|---|---|---|
| A list is empty | Search text, date range, location, and status | Clear one filter at a time |
| An action is unavailable | Your access and the record's current status | Use the action offered on the source record |
| A total needs explaining | The detailed report or source links | Trace representative transactions |
| Accounting shows a warning | Xero Sync History | Repair the connection or mapping, then retry the posting |
| Team Chat says no chat location is configured | The Default Warehouse Location is missing or inactive | Select an active warehouse under **Settings > IMS Settings > Locations**, then reopen Team Chat |

## Worked examples

### Trace unavailable stock

Open **Products > Stock Levels** to compare stock on hand, committed, incoming, and available. Follow committed demand to Sales Orders or Stock Allocation and incoming supply to Purchase Orders. This explains the quantity without changing it.

### Follow up a customer

Open **Contacts > CRM**, find the customer, review the profile timeline, and create a task for the next action. Use the linked sale, order, or credit note when the underlying transaction needs attention.
---
{"id":"ims-workspaces","title":"IMS Workspaces","audiences":["ims"],"capability":"navigation","screen":"IMS","product":"ims","contexts":["dashboard","products","stock","brands","gift-cards","bulk-edit","sales-orders","wholesale-applications","backorders","customer-backorders","stock-availability","credit-notes","pos-sales","online-sales","order-planner","supplier-backorders","supplier-credit-notes","contacts","crm","contact-profile","locations","branch-transfers","smart-device-receive","receive-transfers","stocktakes","reports","report-sales-detail","report-sales-by-branch","report-sales-summary","report-sales-search","report-inventory-valuation","report-product-margin","report-pos-price-changes","report-pos-registers","report-cash-banking","report-stock-availability","xero","shopify","online-shop"],"contextSections":{"dashboard":"Dashboard","products":"All Products","stock":"Stock Levels","brands":"Brands","gift-cards":"Gift Cards","bulk-edit":"Bulk Edit","sales-orders":"Sales Orders","wholesale-applications":"Wholesale Applications","backorders":"Customer Backorders","customer-backorders":"Customer Backorders","stock-availability":"Stock Allocation","credit-notes":"Customer Credit Notes","pos-sales":"POS Sales","online-sales":"Online Sales","order-planner":"Order Planner","supplier-backorders":"Supplier Backorders","supplier-credit-notes":"Supplier Credit Notes","contacts":"Contacts","crm":"CRM","contact-profile":"CRM","locations":"Locations","branch-transfers":"Branch Transfers","smart-device-receive":"Receive Transfers","receive-transfers":"Receive Transfers","stocktakes":"Stocktakes","reports":"Reports","report-sales-detail":"Reports","report-sales-by-branch":"Reports","report-sales-summary":"Reports","report-sales-search":"Reports","report-inventory-valuation":"Reports","report-product-margin":"Reports","report-pos-price-changes":"Reports","report-pos-registers":"Reports","report-cash-banking":"Reports","report-stock-availability":"Reports","xero":"Xero","shopify":"Shopify","online-shop":"Online Shop"},"order":1,"summary":"Navigate IMS products, orders, contacts, stock operations, reports, and integrations.","lastReviewed":"2026-08-23","owner":"inventory"}
---
# IMS Workspaces

IMS brings product, stock, purchasing, sales, customer, location, reporting, and integration workflows into one tenant-scoped workspace. The sidebar groups related operations and preserves normal page scrolling within each view.

## Main operations

- Use **Products** to maintain catalogue data and review stock.
- Use **Sales** and **Purchasing** for customer and supplier documents.
- Use **Contacts** for customer, supplier, CRM, task, segment, and pipeline work.
- Use **Locations** and **Stocktakes** for physical stock operations.
- Use **Reports** for read-only operational and financial analysis.
- Use **Integrations** to configure and monitor Xero, Shopify, and the Online Shop.

## Dashboard

The IMS Dashboard summarises current operational state and provides entry points into detailed workspaces. Treat summary values as navigation cues; use the owning report or list when reviewing individual records.

## All Products

Open **Products > All Products** to search, create, review, and maintain products and variants. Product detail owns identity, descriptions, barcodes, pricing, tax-inclusive POS values, supplier information, images, online content, and variant settings. Availability and role determine which edits are offered.

## Stock Levels

Open **Products > Stock Levels** to compare stock on hand, incoming, committed, and available quantities by location. Average cost is organisation-wide per variant, while displayed stock value is based on each location's quantity at that shared cost.

## Brands

Brands provide catalogue grouping and can affect online and wholesale presentation. Keep brand identity consistent before assigning products or using brand-specific portal settings.

## Gift Cards

Gift Cards shows issued cards and supported balance activity. POS issue and redemption accounting follows the configured gift-card workflow; do not replace balances through generic product or customer edits.

## Bulk Edit

Bulk Edit changes supported product fields across selected records. Filter and review the selected set carefully before applying changes, especially prices, tax, online state, and stock-related settings.

## Sales Orders

Sales Orders records customer demand from Draft through confirmation, incremental fulfilment, completion, cancellation, and supported correction. Confirmed quantities can commit stock. Use Fulfil or Continue Fulfilment for shipment quantities and Resolve Outstanding for an unshipped balance.

## Wholesale Applications

Wholesale Applications is the review queue for buyer access requests. Approval should confirm the intended customer/company relationship and permitted portal access before the applicant can order.

## Customer Backorders

Customer Backorders tracks outstanding customer supply. Use the owning order and allocation workflow to source, release, transfer, or fulfil demand without duplicating stock movements.

## Stock Allocation

Stock Allocation links specific incoming PO supply to outstanding SO demand. It distinguishes protected, received-ready, incoming, unsourced, overdue, and at-risk quantities. Allocation protects supply but does not itself fulfil the customer order.

## Customer Credit Notes

Customer Credit Notes owns manual IMS returns and customer credits. Completion can restock eligible lines and issue store credit through the customer ledger. POS returns create linked POS-sourced credit notes so stock is not returned twice.

## POS Sales

POS Sales provides read-only transaction and payment detail from store activity. Use it to inspect line items, returns, payment splits, and source references; corrections should use the supported POS or credit-note workflow.

## Online Sales

Online Sales shows imported online activity and its synchronization state. Online accounting is separate from POS EOD summaries and follows the configured online-sales/Xero policy.

## Order Planner

Order Planner analyses demand and supply signals to suggest replenishment. Review location, supplier, quantities, current stock, incoming stock, and forecast assumptions before creating purchasing work.

## Supplier Backorders

Supplier Backorders shows supplier-side outstanding supply. Continue receiving genuine later deliveries or use the supported outstanding-resolution path for cancelled or transferred balances.

## Supplier Credit Notes

Supplier Credit Notes records supplier returns and credits. Use completion and correction actions so stock, supplier value, evidence, and Xero state remain auditable.

## Contacts

Contacts contains customers, suppliers, leads, and related commercial details. Generic edits must not overwrite ledger-owned store credit or loyalty balances.

## CRM

CRM provides customer profiles, derived activity history, manual interactions, tasks, tags, live segments, pipeline stages, and opportunities. CRM activity supplements authoritative POS, order, credit, loyalty, and store-credit records rather than replacing them.

## Locations

Locations defines operating branches and settings used by stock, POS, transfers, tracking, and reporting. Deactivation or configuration changes can affect downstream availability and mappings.

## Branch Transfers

Branch Transfers moves stock between locations through explicit send and receive stages. The source movement occurs when sent; the destination movement occurs when received. Do not use generic adjustments to imitate a transfer already in progress.

## Receive Transfers

Receive Transfers records physical arrival at the destination. Confirm quantities against the shipment and investigate discrepancies before completion.

## Stocktakes

Stocktakes compares counted stock with the locked application snapshot and applies the exact difference on completion. A supported mistaken-stocktake reversal compensates the original applied delta while preserving intervening movements.

## Reports

Reports contains Sales Detail, Sales by Branch, Sales Summary, Sales Search, Inventory Valuation, Product Margin, POS Price Changes, POS Registers, Cash Banking, and Stock Availability. Date-based reports use shared presets or a custom range. Reports are analytical and do not mutate source transactions.

## Xero

Xero contains connection status, automation policy, ledger and tracking mappings, payment routing, Sync History, COGS Reconciliation, and Shopify Payout activity. Use Sync History to distinguish successful, pending, blocked, and retryable accounting work. Missing mappings can block only the affected posting while the underlying operational transaction remains valid.

## Shopify

Shopify controls product, customer, order, inventory, webhook, and related synchronization. Review connection status and the owning workflow before manually retrying; imports and webhooks must remain tenant-bound and idempotent.

## Online Shop

Online Shop configures the customer-facing catalogue and content workflow. Product publication, images, pricing, availability, collections, and generated content should be reviewed before becoming visible online.

## Troubleshooting

- If an action is unavailable, check role, lifecycle state, existing physical/accounting effects, and the actions offered on the owning document.
- If a list appears empty, confirm filters, date range, location, and status before assuming data is missing.
- If an integration fails after an IMS transaction succeeds, repair and retry the integration action instead of repeating stock or financial work.
- Advisor accounts are intentionally read-only in operational IMS workflows.

## Worked examples

### Trace an unavailable product quantity

Open Stock Levels to compare stock on hand, committed, and incoming. Follow committed demand into Sales Orders or Stock Allocation, and incoming supply into Purchase Orders. This explains availability without changing any quantities.

### Investigate an accounting warning

Open Xero Sync History, inspect the affected source and status, correct a missing mapping or stale connection, and retry only the unfinished accounting action. Do not recreate the source order, receipt, sale, or credit.
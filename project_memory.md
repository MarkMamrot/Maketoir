# Project Memory & Development Notes

**🤖 AI AGENT INSTRUCTIONS:** 
Always read this file when starting a new session or implementing a feature to understand project constraints, deployment workflows, and important architectural decisions. Proactively update this file as new quirks, dependencies, or workflows are established during development.

---

## 🌐 Deployment Environment
* **Hosting:** Vercel (serverless, auto-deploys on push to `main`)
* **Public URL:** TBC (Vercel project URL)
* **Framework:** Next.js 14 (App Router)
* **Database:** MySQL (external — connection via `MYSQL_HOST` env var)
* **Build quirk (Shopify/Got):** `shopify-api-node -> got -> cacheable-request -> keyv` can emit Webpack "Critical dependency" warnings in Vercel builds. Mitigated in `next.config.mjs` by externalizing these packages (`experimental.serverComponentsExternalPackages`) and adding a targeted `webpack.ignoreWarnings` filter for `node_modules/keyv/src/index.js`.

## 🚀 Deployment Workflow

### Normal Deployment (Fully Automatic):
1. **Develop locally** and commit/push to `main` via GitHub Desktop.
2. **Vercel** detects the push, builds, and deploys automatically (serverless functions for API routes).
3. No restart needed — each deploy creates a fresh deployment.

### Environment Variables:
- Managed in **Vercel Dashboard → Settings → Environment Variables**.
- Includes: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `ENCRYPTION_KEY`, `XERO_CLIENT_ID`, `XERO_REDIRECT_URI`, and all other secrets.
- `.env` is used locally only and is gitignored.

### Monitoring:
- Check the **Vercel Dashboard** for build status, logs, and function errors.
- Runtime logs available under the Logs tab per deployment.

### Previous Hosting (archived):
- Was on PromptWebHosting (cPanel + Phusion Passenger) with GitHub Actions deploy pipeline.
- Migrated to Vercel for simpler serverless deployment and no memory constraints.

## 🛒 POS System (built this session)
* **DB tables**: 5 tables in the IMS database (`pos_users`, `pos_sales`, `pos_sale_items`, `pos_payments`, `pos_eod_reconciliations`). Created by `scripts/setup-pos-tables.mjs`.
* **`ims_stock_movements`** ALTERed to include `pos_sale` and `pos_return` in `movement_type`/`reference_type` enums.
* **Repository**: `src/lib/db/PosRepository.ts` — `PosUsersRepo`, `PosSalesRepo`, `PosEodRepo`, `PosReportsRepo`.
* **API routes** (13 routes under `src/app/api/pos/`): auth (login/logout/me), users, settings/payment-methods, products, locations, sales, sales/[id], sales/[id]/payments, eod, reports/daily, reports/graph.
* **POS app**: `src/app/pos/page.tsx` — full browser POS with device setup, cashier login, product search/barcode, cart with discounts, payment modal (offline queue support), parked sales, receipt printer, EOD reconciliation (with denomination breakdown), and reports.
* **Setup integration**: `src/app/setup/page.tsx` has a POS tab for managing cashier users and payment methods.
* **IMS integration**: `src/app/ims/page.tsx` has a "POS Sales" view — date + location picker, summary cards (revenue, count, by method), expandable transaction list with items and payments.
* **Auth**: POS uses `pos_session` cookie (16-hr), separate from admin `marketoir_session`. bcryptjs (12 rounds) for cashier passwords.
* **Payment methods**: stored in main DB `config` table via `ConfigRepository.set(bizId, 'POS_PaymentMethods', JSON.stringify(methods))`.
* **Offline queue**: Failed sales are queued in localStorage and retried on reconnect/login.

## 🧠 AI Helper Notes
* AI Helper now supports a running in-session chat with role labels: **Professor KnowItAll** and **The Business**.
* Chat history is sent back to `/api/ai/ask` on each message so responses use current-session context.
* Ending a chat opens a save modal. If saved, summary is written to a Drive spreadsheet named **BusinessChats** in the business folder (`Config!FolderID`).
* Business chat summaries are stored in sheet `Chats` with boolean classification fields: `inventoryManagement`, `marketing`, `businessStrategy`, `websiteManagement`.

## 📦 Inventory Notes
* Inventory Management now includes an **Order Planner** view backed by `/api/inventory/order-planner`.
* The planner reads the synced `Products` and `Suppliers` sheets, calculates reorder suggestions from branch-level sales quantities plus `createdDate`, and can save each plan to a **Draft Orders** spreadsheet in the business Drive folder.
* Pushing a draft to Cin7 currently posts directly to `/PurchaseOrders` and requires a single supplier plus a selected branch.
* Sync Inventory includes a **Branch List** source backed by `/api/sync/branches`, which writes Cin7 branch records to the `Branches` sheet in the resolved inventory system spreadsheet.
* Branch-dependent flows (`/api/inventory/order-planner`, `/api/sync/products`, `/api/sync/sales`) now read active branch metadata from the synced `Branches` sheet first, then fall back to live `/Branches` API if the sheet is missing/empty.

## 🏷️ IMS — Pending Sync Work
* **product_type from Cin7** — Cin7 returns a `Type` field on product records. The Cin7→cache sync currently does NOT write this to the `products` cache table.
  * **TODO**: Add `product_type VARCHAR(255)` column to the `products` cache table (or confirm it already exists via schema).
  * **TODO**: In the Cin7 sync route (`src/app/api/sync/`), map `cin7Product.Type → product_type` when inserting/updating rows.
  * **TODO**: In the IMS import products route (`src/app/api/ims/import/products/route.ts`), include `product_type` in the upsert into `ims_products`.
  * The IMS products view already has a `product_type` column in the table and filter dropdowns — it will populate automatically once the sync is updated.

## 🔗 Xero Integration — Phase 1 Status & Next Steps
* Phase 1 OAuth scaffolding is complete (connect/callback/status/disconnect routes + Connections UI card).
* **✅ DONE (architectural fix):** `xero_client_id` / `xero_redirect_uri` moved back to `.env` — they are app-level config, not per-business. The Xero card in Connections now shows a warning if env vars are missing, and the Connect button when they are set.

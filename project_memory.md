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

## 🛒 POS System — Updates (2026-06-23)

### Tax Handling (IMPORTANT)
* **Product prices are stored tax-inclusive (Australian GST 10%).** Never add tax on top — always extract it.
* EOD Accounting columns: `taxExc = salesAmt / (1 + rate)`, `gst = salesAmt - taxExc`, `taxInc = salesAmt`.
* `effectiveTaxRate` is derived as `tax_total / total_exc_tax` from `pos_sales` day totals (= 0.10 for standard GST). Fallback: 0.10.
* **Xero EOD invoices**: `LineAmountTypes: 'Inclusive'`, `TaxType: 'OUTPUT'` — Xero receives the tax-inc amount and extracts GST itself.

### POS PIN Login
* Replaced email+password login with staff-picker + PIN UI.
* `pos_pin_hash VARCHAR(255)` column added to `users` table (migration: `scripts/add-pos-pin.mjs`).
* New APIs: `GET /api/pos/auth/staff?location_id=X` (returns staff list with `has_pos_pin`), `POST /api/pos/auth/pin-login` (bcrypt PIN verify).
* IMS Users edit modal supports setting/clearing POS PIN.
* Admin email+password login still available as fallback link.

### Register Lifecycle
* `pos_registers` and `pos_register_sessions` tables manage register state.
* Opening a register blocks re-opening (409 conflict). Register must be closed at EOD.
* `GET /api/pos/register/session?register_id=X` — returns current open session if any.
* `RegisterGate` screen shown when a stale open session is detected on login.

### EOD Reconciliation
* Cash Counted ($) is now a direct input field (not just via denomination count).
* Denomination count auto-syncs the Counted field when updated — both methods work.
* `updateEntry` for `denominations` key also sets `counted = String(calcCash(newDenoms))`.
* All payment methods use `parseFloat(e.counted)` for the counted value (no more `calcCash` in saveEod).

### SOH Sync
* Instant in-memory SOH patch on sale complete (decrements sold qty, increments on return).
* Background sync every 5 min via `setInterval` in `useEffect` when screen is `'pos'` or `'receipt'`.
* **Bug fixed (2026-06-23):** Background sync `useEffect` was placed after early returns — violated Rules of Hooks → React error #310. Fixed by moving it before all early returns in `PosPage`.

### POS Sales View (IMS)
* Expanded sale dropdown now shows: `#txnId` badge, payment split strip, line item columns Ex-Tax | GST | Total (inc).
* `/api/ims/pos-sales/day` now fetches payments per sale and attaches `payments[]` to each sale object.

### Service Worker
* Cache version `v2` — bumped to evict stale cached pages.
* `res.clone()` race fixed: clone immediately before returning response, then put clone in cache.

### Deployment
* **Hosting moved to Railway** (not Vercel). Auto-deploys from `main` branch.
* Two MySQL DBs on Railway: main (`MYSQL_DATABASE` — users, business config) and IMS (`IMS_MYSQL_DATABASE` — all POS/IMS tables).
* Auth cookies: `marketoir_session` (admin/IMS), `pos_session` (POS cashier, 16-hr).

### Multi-tenant IMS provisioning (2026-07-21)
* New homepage registrations must provision a dedicated IMS schema and set `businesses.ims_db_name`; otherwise the business falls back to the default Monsterthreads IMS schema.
* Public `/api/auth/register` now calls `provisionBusinessIms()` after creating the business row.
* `scripts/ims-schema.sql` is the source for fresh tenant schemas. Keep it aligned with live migrations, including `business_id` columns, POS register/session columns, `ims_sales_history`, and `trg_ims_stock_bizid` / `trg_ims_sales_cache_bizid` compatibility.
* IMS API routes that touch IMS tables must call `getImsSession()` or `enterImsForBusiness()` before any `imsQuery`, `imsExecute`, `getIMSPool`, or `Ims*Repo` call. Local cookie parsing alone is not tenant-safe.
* Sage was provisioned as `readyedu_SageIMS`; leak-prone tables verified empty after provisioning.

### Tenant gatekeeper rewrite (2026-07-21) — ROOT CAUSE of cross-tenant leaks
* `AsyncLocalStorage.enterWith()` inside an awaited function does NOT propagate back to the caller, so `await enterImsForBusiness()` / `getImsSession()` **never actually bound the tenant schema** — every IMS query silently fell back to `IMS_MYSQL_DATABASE` (= Monsterthreads). This is why Sage saw Monsterthreads data everywhere despite per-route fixes.
* Fix: `imsQuery`/`imsExecute`/`getIMSPool` are now strict tenant gatekeepers. Per-call resolution: explicit db arg → bound context (`runImsForBusiness`) → session cookie (`marketoir_session`/`pos_session`/`wholesale_session` → `businesses.ims_db_name`) → env default only when NO session exists. A signed-in session with no schema mapping **throws** (fail closed) instead of falling back.
* No-cookie flows must use `runImsForBusiness(businessId, fn)` (callback form — the only ALS pattern that propagates). Converted: online-sales auto-sync-cron, shopify payout-sync cron (now discovers businesses from the main registry, not one tenant schema), shopify sync-inventory cron drain (per-tenant), shopify orders webhook, POS pin-login (explicit db arg), POS chat SSE stream (explicit db into detached timers).
* `enterImsForBusiness()` is deprecated (harmless cache warmer). `getImsDbNameStrict()` returns the mapping or `undefined` — never the env fallback, and never caches the fallback.
* Dashboard onboarding is business-scoped via `/api/onboarding`; it stores progress in tenant `ims_settings.onboarding_completed_steps` and reuses existing IMS settings keys for business profile, operations, tax, Shopify, and Xero setup prompts.
* Stocktakes and branch transfers were originally created by standalone migrations without `business_id` and were missing from `scripts/ims-schema.sql`; keep both table families tenant-scoped in repo/routes and fresh schema provisioning.

---

## 📦 IMS — Purchase Orders (2026-06-24)

### Partial Receives & Backorder POs
* `POStatus` type now includes `'partially_received'` (between `approved` and `received`).
* Smart device `/receive` page has two submit buttons: **Save Progress** (partial, stays on page) and **Mark as Received** (finalise).
* **Save Progress** sets PO to `partially_received`; items accumulate across multiple receive sessions.
* **Mark as Received** with shortfall prompts user to create a **Backorder PO** for missing items.
* Backorder POs named `{original}-B` (e.g. `PO-2025-0042-B`), falling back to `-B2`, `-B3`; start in `draft`.
* From the IMS PO list, `partially_received` POs show: "Continue" (device link), "Mark Received", "Revert to Approved" (view context), "Cancel".
* **Revert to Approved** from `partially_received`: fully reverses all stock updates (decrements `qty_on_hand`, restores `qty_incoming`, resets `qty_received = 0` per item).
* **Cancel** from `partially_received`: reverses on-hand stock AND remaining incoming, then cancels.

### Batch Receive API (`/api/ims/receive/batch`) — Bug fixes + new fields
* **`qty_received` now accumulates** (`qty_received = qty_received + ?`) — multiple partial sessions are safe.
* **`qty_incoming` is now decremented** on each item received (was missing before).
* Returns `shortfallItems[]`, `newStatus`, `allReceived`, `backorderPoId`, `backorderPoNumber`.
* Fires `triggerPOXeroSync(businessId, poId, 'received')` post-commit when PO is fully received.
* Fires `refreshVariantCache` post-commit for all received variant IDs.

### Xero on Revert/Cancel (2026-06-24)
* **PO revert/cancel** → attempts to void the Xero Draft Bill (always safe — no payments on drafts).
* **SO revert/cancel** → voids Xero Invoice only if `AmountPaid === 0`; if payments exist, returns a warning requiring manual Xero reconciliation.
* Both operations are non-blocking; failures logged to `xero_sync_log` and surfaced as `xeroWarning` in the API response / UI alert.
* PO route Xero dispatch is now explicit: `cancelled` → void, `draft` → void, `received` → approve bill, `approved`/`partially_received` → no Xero action (prevents duplicate draft bill on revert).

### `changeStatus` transitions (ImsRepository.ts)
* `partially_received → received`: processes only remaining items (qty_ordered − qty_received) with full landed cost + avg cost calculation.
* `partially_received → approved`: reverses received stock, restores incoming, resets qty_received = 0.
* `partially_received → cancelled`: reverses received stock + remaining incoming qty, resets qty_received = 0.
* `received → ordered`: reverses all received stock (qty_on_hand −= qty_received, qty_incoming += qty_received), inserts `po_unapproved` movements, resets qty_received = 0, clears received_date. Used for PO revert from received state.

### PO Xero Sync Flow (as-built 2026-06-24)
| Status | Xero Bill | Edit behaviour |
|--------|-----------|----------------|
| draft | — | No Xero |
| ordered | DRAFT Bill | Auto-syncs DRAFT on edit (triggerPOXeroUpdate) |
| partially_received | DRAFT Bill | Auto-syncs DRAFT on edit |
| received | AUTHORISED | ⚠️ xeroWarnModal shown for edit/delete (bookkeeper message) |
| cancelled | VOIDED | Edit/Delete allowed (no Xero) |

* **PO Due Date in Xero**: `supplier_invoice_date + payment_terms_days`; falls back to `order_date + payment_terms_days`; then `order_date`. Set via `calcDueDate()` in XeroSyncService.ts.
* **PO received edit/delete**: shows warning modal with draft bookkeeper message; Xero NOT auto-synced (AUTHORISED bills can't be updated via API).
* `triggerPOXeroUpdate` — updates DRAFT bill on PO edit; silently skips if AUTHORISED.
* `triggerPOXeroVoid` — voids bill on revert/cancel; for `received → ordered` revert: voids AUTHORISED bill then creates new DRAFT.

### SO Xero Sync Flow (as-built 2026-06-24)
| Status | Xero Invoice | Edit behaviour |
|--------|-------------|----------------|
| draft | — | No Xero |
| confirmed | DRAFT Invoice | Auto-syncs DRAFT on edit (triggerSOXeroUpdate) |
| fulfilled | AUTHORISED | ⚠️ xeroWarnModal shown for edit/delete (bookkeeper message) |
| cancelled | VOIDED (if no payments) | Warning if payments exist |

* `triggerSOXeroSync('confirmed')` — creates DRAFT ACCREC Invoice (NOT AUTHORISED — changed from original).
* `triggerSOXeroSync('fulfilled')` — approves the invoice to AUTHORISED; awaited in route (ensures approval before response).
* `triggerSOXeroUpdate` — updates DRAFT invoice on SO edit; silently skips if AUTHORISED.
* `approveInvoice()` in XeroSyncService.ts — mirrors `approveBill` for ACCREC type; logs as `so_invoice`.
* `updateXeroDraftInvoice()` in XeroSyncService.ts — mirrors `updateXeroDraftBill` for ACCREC; checks DRAFT status first.
* **Backward compat**: Old confirmed SOs with AUTHORISED invoices — `updateXeroDraftInvoice` skips; `approveInvoice` on already-AUTHORISED is a no-op in Xero.
* **GET /api/ims/xero/invoice-details?soId=X** — returns `{invoiceNumber, total, subTotal, taxTotal, status}` from Xero; mirrors bill-details endpoint.
* `SoAccountingSection` shows live invoice # + Xero total; mismatch warning if IMS ≠ Xero total.
* SO fulfilled edit/delete: `editSoWithWarn`/`deleteSoWithWarn` helpers (same pattern as PO's `editPoWithWarn`/`deletePoWithWarn`).

### Modal z-index fix (2026-06-24)
* Warning modals (xeroWarnModal, soXeroWarnModal) must render when viewModal is CLOSED, not open.
* Fix: `beforeAction?.()` (which closes viewModal) is called BEFORE `showXeroWarnForReceived` / `showSoXeroWarnForFulfilled`, not inside the onConfirm callback.
* This ensures the warning modal renders on top of everything.

### Shopify retail customer sync (2026-07-23)
* Added two-way retail customer sync foundation under `src/app/api/ims/shopify/sync-customers/route.ts` with modes:
  * `pull` (Shopify -> IMS): imports all Shopify customers, matches by `shopify_customer_id` first, then email fallback, fills blank IMS fields only.
  * `push` (IMS -> Shopify): syncs `retail_customer` contacts to Shopify on demand.
* Added contact linkage field `ims_contacts.shopify_customer_id` with unique index `(business_id, shopify_customer_id)`.
  * Bootstrap schema updated in `scripts/ims-schema.sql`.
  * Tenant catch-up updated in `scripts/catchup-schema-all-tenants.mjs`.
  * Runtime guard migration helper added: `src/lib/ims/ensureContactShopifyCustomerSchema.ts`.
* Added outbound sync helper `src/lib/ims/shopifyCustomerSync.ts` and wired contact save hooks:
  * POST `src/app/api/ims/contacts/route.ts`
  * PUT `src/app/api/ims/contacts/[id]/route.ts`
  * Contact saves remain non-blocking; API returns `shopifySync` result/warning.
* Added Shopify customer operations in `src/services/ShopifyService.ts`:
  * `getAllCustomers`, `findCustomerByEmail`, `createCustomer`, `updateCustomer`, `disableCustomer`.
* Soft-delete mirroring (outbound): when IMS retail contact is set inactive and has linked Shopify id, sync attempts to disable Shopify customer.
* IMS Shopify UI (`src/app/ims/components/ShopifyView.tsx`) now includes:
  * Pull button, Push button, run summary, and unresolved gift-card customer link examples.
* Gift-card linkage visibility:
  * Sync response now includes `matchedGiftCardCustomers`, `missingGiftCardCustomers`, and `missingGiftCardExamples` sample rows.
* Required Shopify scopes for this flow:
  * `read_customers`, `write_customers` (plus existing product/order/inventory scopes).

### IMS reports extraction hardening (2026-07-23)
* `src/app/ims/page.tsx` had prior structural corruption after a large patch attempt in the report section. Safe recovery path was: restore from `HEAD`, then re-apply in small bounded edits.
* Extracted/wired report views now use wrappers in `src/app/ims/page.tsx`:
  * `SalesByBranchView` -> `src/app/ims/views/reports/SalesByBranchView.tsx`
  * `SalesSearchView` -> `src/app/ims/views/reports/SalesSearchView.tsx`
* Shared report filter/date helpers moved to `src/app/ims/views/reports/reportFilterHelpers.tsx` and imported back into `page.tsx` (behavior preserved).
* Practical rule for this monolith: avoid single giant diffs; patch by anchor in small chunks and run diagnostics (`get_errors`) after each chunk.

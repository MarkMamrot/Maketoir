# Project Memory & Development Notes

**🤖 AI AGENT INSTRUCTIONS:** 
Always read this file when starting a new session or implementing a feature to understand project constraints, deployment workflows, and important architectural decisions. Proactively update this file as new quirks, dependencies, or workflows are established during development.

---

## 🌐 Deployment Environment
* **Hosting:** PromptWebHosting (cPanel, strictly memory-constrained, Node.js managed via Phusion Passenger).
* **App Root Directory:** `/home/readyedu/marketoir-live`
* **Public URL:** `http://maketoir.exam-ready.com.au/`
* **Framework:** Next.js 14 (App Router) using `output: "standalone"`

## 🚀 Deployment Workflow (Automated via GitHub Actions)

**⚠️ Do NOT run `npm install` or Next.js build commands via cPanel SSH or dashboard — memory limits will crash it!**

### Normal Deployment (Automated):
1. **Develop locally** and commit/push to `main` via GitHub Desktop as usual.
2. **GitHub Actions** automatically triggers (`.github/workflows/deploy.yml`):
   - Runs `npm ci` + `npm run build` on a Linux runner (no MAX_PATH, no memory limits)
   - Packages `.next/standalone` + `.next/static` + `public` into a deploy directory
   - Force-pushes an orphan commit to the **`deploy`** branch (history is replaced, not appended — no git bloat)
3. **cPanel Git Version Control** detects the new commit on the `deploy` branch and runs `.cpanel.yml`, which:
   - Copies all files to `/home/readyedu/marketoir-live`
   - Touches `tmp/restart.txt` to signal Phusion Passenger to restart
4. Wait ~30–60s then refresh the live URL.

### Monitoring:
- Check **GitHub → Actions tab** to confirm the build passed before expecting a live update.
- If cPanel doesn't auto-pull, go to **cPanel → Git Version Control → Update** to manually trigger.

### cPanel Configuration (one-time, already done):
- Repository at `/home/readyedu/repositories/Maketoir` tracks the **`deploy`** branch (NOT `main`).
- Auto-deploy must be enabled.

### Fallback (manual deploy if GitHub Actions is unavailable):
1. Run `npm run build` locally.
2. Run `tar -a -c -f deploy.zip -C .next\standalone .` in PowerShell. *(Do NOT use `Compress-Archive` — it silently drops nested Next.js core files due to MAX_PATH limits.)*
3. In cPanel File Manager, delete old `.next`, `node_modules`, `server.js` in `marketoir-live/`.
4. Upload and extract `deploy.zip`, then restart the app in the Node.js dashboard.

### .env Safety:
The server's `.env` file is **never overwritten** — `cp ./*` in `.cpanel.yml` skips dotfiles, and the `deploy` branch contains no `.env`.

## ⚠️ Known Quirks & Bugs
* **503 Service Unavailable:** This error in cPanel is almost always caused by a corrupted/incomplete `node_modules` folder (usually resulting from clicking "Run NPM Install" in cPanel, which crashes silently due to memory limits). Fix by extracting a fresh `deploy.zip`.
* **MAX_PATH Windows Zip Bug:** Windows ZIP utilities drop files like `next.js` in deeply nested module folders. Always use `tar` to create the deploy file.
* **Port Binding:** Phusion Passenger handles port bindings dynamically. Avoid hardcoding `app.listen(3000)` in `server.js` without letting `process.env.PORT` dictate the connection.

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

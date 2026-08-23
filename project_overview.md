# Marketoir Project Overview

**🤖 AI AGENT INSTRUCTIONS:**
Always consult this file to understand the core mission, business logic, overall architecture, and current roadmap of the Marketoir project. When asked what to build next or how a new feature fits into the grand scheme, check this document first.

---

## 🎯 Project Mission & Aims
Marketoir is a business management platform for small-to-medium Australian retail businesses. It provides:
- A **POS (Point of Sale)** system for in-store sales, cash management, and EOD reconciliation
- IMS/Reporting views should use the shared date-range picker from [src/app/ims/views/reports/reportFilterHelpers.tsx](src/app/ims/views/reports/reportFilterHelpers.tsx) for any report that filters by date; prefer the same presets and custom range behavior across reports instead of introducing ad-hoc date inputs.
- An **IMS (Inventory Management System)** integrated with Cin7 for stock control, purchase orders, and sales reporting
- A **Dashboard** with AI-assisted insights (Google Ads, Meta Ads, Google Analytics, Shopify)
- **Xero integration** for accounting — EOD sales synced as ACCREC invoices
- **Google Sheets** used as a lightweight DB for legacy reporting flows

Target user: retail store owners/managers who need a unified view of POS sales, inventory, and marketing performance.

---

## Help and Assistant Knowledge

Current user-facing product behavior is maintained in the canonical Help corpus under `docs/help/`. The normal build validates that content and compiles it into both the contextual in-product Help index and the private Solvantis Assistant retrieval index. This overview remains the project and architecture reference rather than a second copy of product Help.

---

## 🗺️ Roadmap & Next Steps

### ✅ Completed
- [x] POS system (device setup, PIN login, cart, payments, parked sales, receipt, EOD reconciliation)
- [x] POS branch transfer creation/receiving, receipt order notes, resizable chat attachments, and per-location custom appearance
- [x] Register lifecycle management (open/close, stale session detection)
- [x] EOD accounting with Tax-Exc / GST / Tax-Inc columns (tax-inclusive price handling)
- [x] Xero EOD sync (Inclusive tax treatment, one invoice per payment method per day)
- [x] IMS POS Sales view (txn ID, payment split, line item breakdown)
- [x] SOH instant patch on sale + 5-min background sync
- [x] Xero OAuth + connection management
- [x] Cin7 product/stock sync to IMS
- [x] Order Planner (reorder suggestions → Draft Orders sheet → Cin7 PO)
- [x] AI Helper chat (Professor KnowItAll persona, chat history, save to Drive)
- [x] Customer SO incremental partial fulfilment (delta stock/commitment movements, idempotent retries, final-only Xero approval)
- [x] Resolve Outstanding Orders (customer/supplier cancel or held child, evidence-backed no-stock credits, Xero refund/unapplied/deferred allocation)
- [x] Deploy partial-fulfilment and resolution schema to all active tenants
- [x] Incoming PO stock allocation to SO demand, including receipt readiness notifications and direct SO actions

### 🔲 In Progress / Next
- [ ] **Cin7 product_type sync** — map `cin7Product.Type` → `product_type` in IMS cache (see project_memory.md TODO)
- [ ] **Xero Phase 2** — sync product sales, customer invoices (not just EOD summaries)
- [ ] **POS layby payments** — accept partial payments on laybys
- [ ] **Staff performance reporting** — sales by cashier in IMS POS Sales view
- [ ] **Customer accounts** — attach customer to sale, view purchase history
- [ ] **Marketing dashboard** — Google Ads / Meta Ads spend vs revenue visualisation

---

## 🏗️ Architecture & Core Technologies
- **Frontend/Backend:** Next.js 14 (App Router, TypeScript)
- **IMS data tables:** Follow [docs/table-scrolling-conventions.md](docs/table-scrolling-conventions.md): split sticky header/horizontal body, explicit frozen identity columns, and shared four-arrow keyboard scrolling. Standard list views retain normal page-level vertical scrolling.
- **Deployment:** Railway (auto-deploy from `main` branch)
- **Databases:**
  - Main MySQL (Railway): users, business config, connections
  - IMS MySQL (Railway): all IMS/POS tables (`ims_*`, `pos_*`)
- **Auth:** Session cookies — `marketoir_session` (admin) + `pos_session` (POS cashier)
- **Key Integrations:** Cin7 (inventory), Xero (accounting), Shopify (online sales), Google Ads, Meta Ads, Google Analytics, Google Sheets (legacy reporting)
- **Tax:** Australian GST 10%. All POS prices stored **tax-inclusive**. GST is always extracted, never added.
- **POS stack:** Browser-based POS at `/pos`, service worker for offline shell, localStorage for device config + product cache + offline queue

### Customer Returns and Store Credit
- IMS customer credit notes are the authoritative return records. Completing a manual IMS credit note issues the customer store credit; drafts do not affect the balance.
- POS returns automatically create completed `source='pos'` IMS credit notes. Store-credit returns issue credit through that note; cash/card refunds create the note without changing store credit.
- POS-sourced credit notes remain in the existing POS/EOD Xero accounting flow and are not posted as separate Xero credit notes. Shopify credit notes remain externally settled by Shopify.
- `ims_contacts.store_credit` is a read-only cached balance. Runtime mutations must be recorded through `store_credit_transactions`; generic contact updates must never replace it.

### Order Shortfalls and Backorders
- Customer SOs support repeated incremental shipments. A short shipment leaves the original SO `partially_fulfilled`; stock on hand and commitments decrease only by each shipped delta.
- Example: 100 units ordered and 70 shipped leaves 30 committed on the original SO. Shipping the final 30 completes the SO and triggers the configured fulfilled Xero action.
- From a partial order, **Resolve Outstanding** can leave the remainder open, cancel it, or transfer it to a held child without repeating shipment/receipt stock movements.
- Unpaid editable Draft/Authorised Xero documents are resized. Paid/part-paid value starts with an Authorised no-restock credit note, then refund, unapplied credit, or a child-order reservation is recorded durably.
- Reserved credit is allocated only after the held child invoice/bill is Authorised. Held orders owning reserved/allocated credit cannot be merged or cancelled casually.
- Supplier financial correction requires a supplier credit reference or evidence note; Solvantis never invents supplier credit.

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

## 📘 Assistant-Safe Product Reference

This section is the canonical user-facing description of current Solvantis behaviour. It is compiled automatically into the Solvantis Assistant knowledge index during every build. Keep it current whenever visible workflows, calculations, navigation, permissions, or integration behaviour change. Describe only current product behaviour; do not include credentials, tenant identifiers, database objects, source paths, incidents, deployment commands, or planned features.

### IMS inventory costing and stock value

Solvantis uses one organisation-wide weighted-average cost for each product variant. This method is also called weighted average cost, average cost, moving average cost, or WAC. It is not FIFO or LIFO, and it does not maintain a different average cost for each location.

When stock is received, the new average combines the value of existing stock on hand with the tax-exclusive AUD cost of the received stock. The received cost reflects the purchase-order line cost after discount, removes included purchase tax when applicable, converts foreign currency to AUD, and can include allocated landed costs and freight according to the saved costing settings. If there is no existing positive stock quantity, the received unit cost becomes the new average cost.

The organisation-wide average cost is used for current inventory valuation, product margin analysis, and as the fallback cost of goods sold. Completed stock movements preserve their recorded unit cost, so later receipts do not rewrite historical movement costs. In IMS, open **Products > All Products** and enable **Average Cost**, or open **Products > Stock Levels** to see average cost and stock value by location.

### IMS purchase orders

IMS users can create and manage supplier purchase orders from **Purchasing > Purchase Orders** in the left navigation. If the sidebar is collapsed, the **Purchasing** icon opens Purchase Orders directly. Select **New Purchase Order**, choose the supplier and receiving location, add product variants and quantities, and review costs, tax, dates, freight, discounts, currency, and landed costs as applicable.

A purchase order can remain Draft while it is being prepared. Confirming it records incoming stock. Confirmed orders can be received incrementally; quantities not yet received remain outstanding on a Partially Received order until a later receipt or supported resolution. Completed and Cancelled orders remain as audit records. Advisor accounts are read-only, and actions can be restricted when receipts, payments, credits, or accounting state require a controlled correction workflow.

### IMS Online Shop workspace

Administrators can open **Integrations > Online Shop** to prepare Solvantis's native consumer storefront. **Store settings** manages the store name, hosted store address, support email, logo, and default search metadata. Uploaded store images accept JPEG, PNG, WebP, and GIF files up to 10 MB and remain separate from wholesale portal images.

**Templates** manages independent drafts for the Home, Catalogue, Collection, Product, Cart, Checkout, Sign in, and Account storefront views. Required commerce sections cannot be removed. Administrators can add and reorder compatible content sections, edit their content and images, save a draft, reset it to the published version, and publish saved changes. Publishing is blocked while the editor still has unsaved changes, and revision checks prevent one editor from silently overwriting another editor's saved draft.

**Pages** manages separate custom content pages such as About, Shipping, Returns, and Privacy. Each page has its own address, navigation placement, visibility, content draft, and published revision. A page is publicly eligible only after it has published content and is marked visible. The workspace displays the current online sales channel but does not change or activate that channel.

**Products** controls native storefront publication independently of Shopify. Publishing requires at least one active retail-priced variant and a unique native product address. Existing Shopify links are preserved and displayed for context, but they do not publish or hide a native storefront product. Unpublishing removes the product from native public browsing without deleting its IMS product or Shopify mapping.

When an organisation's native shop profile and native online sales channel are active, customers can browse the hosted store, catalogue, routed product details, and visible published content pages. Retail prices are tax-inclusive AUD prices, active sale pricing respects its saved start and end dates, and only whole individual units are orderable. Availability is calculated from uncommitted stock at active locations enabled for online sales. Sold-out products remain browseable but cannot be added. The browser cart is scoped to the individual store, while every cart refresh recalculates published products, current prices, and availability on the server. Checkout and customer account actions are not currently exposed.

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

# Marketoir Project Overview

**🤖 AI AGENT INSTRUCTIONS:**
Always consult this file to understand the core mission, business logic, overall architecture, and current roadmap of the Marketoir project. When asked what to build next or how a new feature fits into the grand scheme, check this document first.

---

## 🎯 Project Mission & Aims
Marketoir is a business management platform for small-to-medium Australian retail businesses. It provides:
- A **POS (Point of Sale)** system for in-store sales, cash management, and EOD reconciliation
- An **IMS (Inventory Management System)** integrated with Cin7 for stock control, purchase orders, and sales reporting
- A **Dashboard** with AI-assisted insights (Google Ads, Meta Ads, Google Analytics, Shopify)
- **Xero integration** for accounting — EOD sales synced as ACCREC invoices
- **Google Sheets** used as a lightweight DB for legacy reporting flows

Target user: retail store owners/managers who need a unified view of POS sales, inventory, and marketing performance.

---

## 🗺️ Roadmap & Next Steps

### ✅ Completed
- [x] POS system (device setup, PIN login, cart, payments, parked sales, receipt, EOD reconciliation)
- [x] Register lifecycle management (open/close, stale session detection)
- [x] EOD accounting with Tax-Exc / GST / Tax-Inc columns (tax-inclusive price handling)
- [x] Xero EOD sync (Inclusive tax treatment, one invoice per payment method per day)
- [x] IMS POS Sales view (txn ID, payment split, line item breakdown)
- [x] SOH instant patch on sale + 5-min background sync
- [x] Xero OAuth + connection management
- [x] Cin7 product/stock sync to IMS
- [x] Order Planner (reorder suggestions → Draft Orders sheet → Cin7 PO)
- [x] AI Helper chat (Professor KnowItAll persona, chat history, save to Drive)

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
- **Deployment:** Railway (auto-deploy from `main` branch)
- **Databases:**
  - Main MySQL (Railway): users, business config, connections
  - IMS MySQL (Railway): all IMS/POS tables (`ims_*`, `pos_*`)
- **Auth:** Session cookies — `marketoir_session` (admin) + `pos_session` (POS cashier)
- **Key Integrations:** Cin7 (inventory), Xero (accounting), Shopify (online sales), Google Ads, Meta Ads, Google Analytics, Google Sheets (legacy reporting)
- **Tax:** Australian GST 10%. All POS prices stored **tax-inclusive**. GST is always extracted, never added.
- **POS stack:** Browser-based POS at `/pos`, service worker for offline shell, localStorage for device config + product cache + offline queue

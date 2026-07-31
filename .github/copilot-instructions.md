<!-- Use this file to provide workspace-specific custom instructions to Copilot. -->

# Marketoir — Copilot Instructions

Business management platform (POS + Inventory + Xero/Cin7/Shopify integrations) for
Australian retail. Next.js 14 App Router, TypeScript, MySQL (Railway), deployed on
Railway (auto-deploy on push to `main`, no test gate other than CI below).

## Always read first
- [project_overview.md](../project_overview.md) — mission, architecture, roadmap. Read before
  any new feature or architectural change.
- [project_memory.md](../project_memory.md) — dated log of deployment workflows, quirks, and
  decisions. Read before touching deployment, hosting, or anything that previously bit us.
- Also check repository memory (`/memories/repo/*.md` via the memory tool) for topic-specific
  gotchas (tenant architecture, DB gotchas, PO receive flow, sales cache builders, etc.) —
  it's more current and more targeted than the two files above for implementation details.
- After finishing a non-trivial task, offer to update `project_memory.md` (chronological/
  deployment facts) and/or repo memory (topic gotchas) with anything newly learned.

## Hard rules (frequently violated in the past — do not skip)
1. **Tenant safety.** Any code path touching IMS/POS tables must resolve the tenant schema
   before querying — `getImsSession()` in request-scoped routes, or `runImsForBusiness(businessId, fn)`
   (callback form) in cron jobs / webhooks / detached async work. Do NOT rely on
   `enterImsForBusiness()` + `await` alone — `AsyncLocalStorage.enterWith()` inside an awaited
   function does not propagate to the caller and silently falls back to the wrong tenant. This
   caused a real cross-tenant data leak; `imsQuery`/`imsExecute`/`getIMSPool` are strict gatekeepers
   now, but new code should still pass tenant context explicitly rather than relying on fallback.
2. **Tax handling.** All POS/product prices are stored **tax-inclusive** (AU GST 10%). Always
   extract GST (`tax = total - total/1.1`), never add it on top.
3. **MySQL ENUM columns** (e.g. `ims_stock_movements.movement_type`/`reference_type`) — check
   `scripts/ims-schema.sql` or `information_schema.COLUMNS` before assuming a new string value can
   be inserted; widening an enum requires a migration.
4. **Schema migrations must be multi-tenant safe.** Use `scripts/catchup-schema-all-tenants.mjs`
   (iterates every schema in `businesses.ims_db_name` + env fallback, checks
   `information_schema.COLUMNS` before each ALTER, safe to re-run) — not a single-schema script.
5. **Customer store credit is ledger-owned.** Never update `ims_contacts.store_credit` through
  generic contact writes. Manual and POS-issued credit must come from idempotent customer credit-note
  completion and write `store_credit_transactions` in the same tenant transaction. POS returns use
  the linked CN as the sole stock owner; do not restock in both POS and CN paths.
6. **Runtime failures must be visible.** New handled operational exceptions and integration failures
  must call `reportRuntimeIssue()` from `src/lib/runtimeIssues.ts` with the tenant `businessId`, source,
  operation, safe context, and source reference. Keep domain-specific logs too. Do not persist secrets,
  tokens, cookies, authorization headers, or raw customer payloads. Expected validation/auth 4xx results
  are not runtime issues. Never rely on `console.error` as the only record of a live operational failure.

## Testing
- Vitest is configured (`npm test` / `npm run test:watch`) but only has light coverage under
  `src/lib/**/__tests__/*.test.ts`. CI (`.github/workflows/ci.yml`) now runs `npm test` and
  `npm run build` on every push/PR to `main` — this is the only regression gate; Railway deploy
  itself does not run tests.
- When you extract or write a new pure function in `src/lib/**`, add a matching `*.test.ts`
  file in a sibling `__tests__/` folder (see `src/lib/ims/__tests__/stockHistoryTimeline.test.ts`
  for the pattern).
- Run `npm test` locally after changing anything in `src/lib/**` before considering the change done.

## Report/date-filter conventions
- Any IMS report that filters by date should use the shared date-range picker from [src/app/ims/views/reports/reportFilterHelpers.tsx](src/app/ims/views/reports/reportFilterHelpers.tsx) and follow the same `SBDateRange` shape used by Sales by Branch.
- Prefer the shared presets/custom range behavior over ad-hoc date inputs in new reports or when updating existing ones.
- When a report needs a date filter in the API, map the shared range to the route parameters consistently (`window` for preset windows, or `from`/`to` for custom ranges).

## Codebase scale — be deliberate
- [src/app/ims/page.tsx](../src/app/ims/page.tsx) (~20k lines) and
  [src/app/pos/page.tsx](../src/app/pos/page.tsx) (~6.8k lines) are large single-file monoliths.
  Prefer targeted `grep_search`/ranged `read_file` over reading either file in full. When adding a
  substantial new view/component to one of these, consider extracting it into its own file under
  `src/app/ims/views/` or `src/app/pos/components/` rather than growing the monolith further —
  do this opportunistically, not as a standalone refactor task unless asked.
- `scripts/` contains many one-off migration/debug scripts (prefixed `_`, `check-`, `debug-`,
  `fix-`). These are historical, not part of the running app — don't assume they still need
  maintaining, and feel free to suggest archiving stale ones.

## Ambiguous / risky feature requests
For anything touching money, stock quantities, or multi-tenant data where the request has more
than one reasonable interpretation, ask concrete clarifying questions with concise tradeoffs
(e.g. via `vscode_askQuestions`) before writing code, rather than guessing the most literal (often
most invasive) interpretation.

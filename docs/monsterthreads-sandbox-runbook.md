- 2026-10-11 approved Shopify refund provenance fix supersedes the blocked refund finding: both direct refund and awaiting-return completion retain the exact original SO item, persist source_so_item_id and use the inserted credit-note item ID for stock/FIFO history. Shared restoration retains original FIFO allocation costs and captured Average Cost; Shopify credits explicitly use external settlement. No historical costs or prior movements are rewritten. All 21 focused credit tests passed (both refund paths, mapping guard, gateway rollback, replay, no-restock and Average Cost). Full suite: 3,700 passed, five skipped, only known unrelated foresight:connections Help failure. Production build completed after correcting the new Help context target to a top-level section; canonical Shopify Help and indexes updated.
- Approved exact recovery of campaign-20261011-shopify-paid-fifo-003 passed without another provider refund: one source-linked external customer credit, original AUD 1 FIFO cost, stock restored once, duplicate refund replay unchanged and real authorised Xero customer credit AUD 1/zero tax. Linked supplier return/completion replay restored stock and layers to zero; original bill and supplier Xero credit verified, provider product archived and full temporary policy restored. Manifest clean with recoveryPassed true/originalLifecyclePassed false/providerRefundResubmitted false. Independent final SQL confirmed one exact source-linked credit, two retained layers at zero remaining quantity, stock 0/0/0, FIFO epoch 7, automation paused and register closed. Broader campaign remains incomplete; no commit or deployment.
# Monsterthreads development sandbox runbook

The sandbox is a separate tenant in the production Solvantis deployment. It contains the operational Monsterthreads IMS/POS snapshot, but excludes the historical Cin7 sales import and unreferenced Shopify retail contacts. It starts with no external credentials or platform identities. Shared scheduled automation remains paused unless explicitly enabled for a bounded test.

## 2026-10-10 FIFO campaign continuation

- 2026-10-11 fresh campaign-20261011-distinct-cost-fifo-003 passed aggregate AUD 1 across two POs (4928/4929), two independent new variants and the shared fixture at TEST. The fixture retained distinct half-unit FIFO sources at AUD 0.40 and 0.80; the new variants captured AUD 0.20 and 0.60. Exact receipt replays preserved independent stock/layer/movement snapshots, real Xero totals were AUD 0.30/0.70 with zero tax, and reverse-order revision-checked receipt undo reversed only each PO's two original quantities/costs. Earlier -001 supplied po_date instead of required order_date and created no PO; -002 omitted the supplier invoice number and completion was atomically rejected with zero received quantities. Both failed runs were separately cleaned through unused product archive or exact unreceived cancellation/Xero deletion; their original failures remain retained. Fresh -003 ended all variants zero and unused product archived, with both saved Xero bills DELETED/VOIDED.
- Read-only @branch-ui-audit passed real desktop overflow, synchronized header/body, two frozen columns, all four arrow keys and input-arrow isolation, then established transfer detail mobile overflow: at 390px the uncontained line table extended to approximately 449px and clipped rightmost values. The user explicitly approved a transfer-detail-only repair. Added a contained named horizontal line region and opt-in dialog labeling used only by transfer detail; canonical transfer Help updated in its existing Step-by-step context. Isolated production-preview build completed and the rebuilt port 3014 passed authenticated desktop/mobile audit including access to the scrolled rightmost values. No inventory/history mutation occurred in UI verification, and no deployment was performed.
- 2026-10-11 user authorized selecting the second sandbox location; Warehouse Branch was explicitly chosen for the bounded one-unit TEST round trip. Fresh campaign-20261011-branch-fifo-001 passed UI PO 4926 confirmation/receipt, authenticated IMS transfer 124 send, two half-unit receipts, cumulative line-correction replay, complete receipt replay, and return transfer 125 send/receipt/replay. Independent SQL reconciled source commitments, both location quantities, original AUD 1 FIFO layer costs and balanced transfer movement costs; replay snapshots retained identical stock, layers and movement history. Partial quantity replay uses set_item_received: partial-to-received is an explicit close action, not a keyed partial-receipt replay contract.
- Exact PO-line-linked supplier credit 19 completed and replayed without duplicate stock history. Actual Xero bill and supplier credit were independently read at AUD 1, zero tax; the full temporary Draft supplier-credit policy was restored and read back. Final independent audit confirmed manifest clean, transfers received, supplier credit complete, all fixture locations and remaining layers zero, register closed, FIFO active and automation paused. Labelled documents and historical movements remain intact. This covers the authorized cross-location API lifecycle, not transfer UI ergonomics or varying-cost/multiple-variant cases. No production repair, commit or deployment occurred; the broader campaign remains incomplete.
- 2026-10-11 user explicitly approved temporary sandbox non-stock purchases account 429 General Expenses, restoring the originally unmapped state afterward. Fresh campaign-20261011-non-stock-po-fifo-004 passed authenticated UI create/confirm, Receive from the automatically opened detail dialog, one-unit administrative receipt, independent non-stock line snapshot and zero stock/movement/FIFO history, real Xero AUD 1/zero-tax expense bill to account 429, accepted native Undo Receipt confirmation, Xero bill deletion and unused product archive. Earlier -002 stopped on a list action hidden behind the detail dialog and was cancelled unreceived; -003 passed receipt/expense accounting but omitted the undo confirmation handler, then exact revision-checked undo recovery passed without another receipt. Original failed runs remain failed despite cleanup.
- The approved temporary configuration was removed only after locking and verifying the exact tenant/role/account identity. Independent final audit confirmed all four non-stock run records clean, all created expense products archived, POs cancelled, actual saved Xero bills DELETED/VOIDED with account 429 retained in history, no non-stock stock movements or FIFO layers, original unmapped state restored, register closed, FIFO active and automation paused. Manifest sanitization redacts keys containing mapping, including mappingId and expenseMappingPassed; use direct SQL/provider evidence rather than interpreting redacted fields. Product UUID lookups use product_id, not numeric id. No production code fix or deployment occurred.
- 2026-10-11 isolated production-mode local preview on port 3014 used NEXT_DIST_DIR=.next-campaign-preview; existing development servers left untouched and no deployment performed. Fresh campaign-20261011-pos-build-ui-fifo-005 passed real native build-consent cancellation with unchanged component/output snapshots and no sale, accepted consent with captured actual browser payload/ID, atomic build-sale at AUD 1 FIFO cost, replay without duplication, linked original-cost return with sole credit-note restock, output supplier return/replay, and real Xero bill/credit totals. Full temporary policies restored; recipe disabled/product archived/register closed. Independent closing SQL/API audit confirmed zero component/output quantities and remaining layers, FIFO active and automation paused. The fresh stable-preview pass supersedes unresolved UI acceptance coverage, not the earlier failed development-mode runs.
- Added a capped non-stock PO campaign case in the existing purchasing test file. campaign-20261011-non-stock-po-fifo-001 stopped at its prerequisite before mutations because the sandbox has no non_stock_purchases account mapping. Independent SQL proved no labelled product or PO was created; manifest blocked with no mapping changed. Existing active Xero test-org expense options include 429 General Expenses and 453 Office Expenses. A specific temporary sandbox mapping and restoration must be approved before this case can proceed; no accounting configuration was guessed. The full campaign remains incomplete.
- 2026-10-11 ordinary service-worker-enabled offline lifecycle campaign-20261011-pos-offline-fifo-004 passed: final cash Add submitted offline, exactly one tenant queue entry captured with no saved sale before reconnect, existing-session gate continued when required, exactly one saved sale, queue clearance, exact replay, FIFO source-cost consumption, linked cash return with sole customer-credit restock, over-return rejection, supplier-return cleanup and closed register. The earlier -003 saved its exact queued sale after Continue Session but failed a five-second queue-clearance assertion; exact existing-sale recovery passed without resubmission and original failure remains retained. Queue clearance now uses the same 45-second bound as server synchronization.
- POS UI build-consent campaigns -001/-002 stopped before checkout on late register-gate/variant-label selector assumptions; independent no-sale/no-build audits, unused recipe/product disable and supported untouched receipt undo passed. -003 reached and cancelled the native build confirmation, proving output/component snapshots and sale counters unchanged, but a subsequent register-gate reset removed the payment modal before acceptance. Its global timeout interrupted automatic cleanup; explicit tenant-scoped register close, full policy restoration, zero-sale/build audit, output disable and receipt undo restored baseline. -004 did not observe the confirmation within five seconds; independent audit likewise proved no sale/build and completed exact cleanup. UI build acceptance remains unresolved; no production POS defect established or production fix applied. Harness now matches the standalone output SKU, handles late gates and bounds accepted-sale response waiting.
- Independent closing audit of offline -003/-004 and UI build -001 through -004: all six manifests clean, touched fixture quantities zero, remaining FIFO layers zero, register closed, full saved location build/accounting policies restored, FIFO active and automation paused. Failed original cases remain failed despite successful cleanup. The comprehensive campaign is still incomplete.
- 2026-10-11 POS sale-triggered build campaign-20261011-pos-build-fifo-001 passed API preview/consent, atomic one-unit build and sale at captured AUD 1 FIFO cost, exact replay, linked original-cost customer return and sole credit-note restock, output supplier return/replay, and real Xero bill/supplier-credit totals. Independent final audit confirmed both variants zero, retained layers with zero remaining quantity, register closed, full build/accounting policies restored, FIFO active and automation paused. POS UI build-consent interaction remains untested.
- Offline checkout routing correction: final cash Add automatically calls completeSale. Earlier offline tests added cash while online, then clicked Complete Sale during the existing submission; those runs do not establish an offline product defect. campaign-20261011-pos-offline-fifo-001 saved one ordinary sale after reconnect and was cleaned by exact linked return without resubmitting the original sale. Failed original coverage remains retained.
- Fresh campaign-20261011-pos-offline-training-003 moved the offline transition before final cash Add and passed with the service worker active: visible internet-required guard, unchanged tenant-prefixed pending/failed queues, unchanged ordinary/training counters, inventory and register. Earlier diagnostic runs remain failed, clean observations rather than coverage passes.
- Fresh campaign-20261011-pos-offline-fifo-002 successfully captured exactly one labelled AUD 1 sale in the tenant offline queue and proved no server sale before reconnect. Reconnect did not save it within 45 seconds; screenshot showed Register Left Open. Sync remains unresolved, not a completed offline lifecycle or established production defect. Independent SQL subsequently proved no sale for the exact queued local ID, marker or session, closed register and untouched receipt layer. The isolated browser context was discarded without another checkout; acknowledged supported receipt undo passed and restored baseline stock. Original sync failure remains retained. Comprehensive campaign remains incomplete; no production POS fix, historical repair, commit or deployment.
- 2026-10-11 approved receipt-undo cutoff fix: the supported reversePurchaseOrderReceiptTx cutoff now requires a negative po_unapproved movement with non-null unit_cost. Incoming-only reductions omit cost and no longer hide earlier receipts; genuine zero-cost receipt reversals still form a cutoff. Explicit movement-history regressions at costs zero and eight reproduced the failure before the fix; all 31 PO repository tests pass afterward. The legacy status reversal branch remains unchanged because lifecycle policy blocks its partial-receipt transitions. Canonical PO correction Help updated under its existing context mapping; build completed. Full suite: 3,700 passed / five skipped / known foresight:connections mapping failure plus a Shopify credential-scan timeout; that scan passed on isolated rerun.
- Fresh campaign-20261011-po-amend-fifo-004 / PO 4912 passed authenticated UI create/confirm, positive pre/post-receipt amendments and exact replays, two half receipts at FIFO cost AUD 0.50, and Xero total AUD 0.50 / zero tax. Independent audit proved the null-cost incoming reduction lies between the two untouched receipt sources. Ordinary authenticated IMS Undo Receipt then passed without supplier-return fallback. Final independent audit: manifest clean, PO cancelled, stock 0/0/0, both original FIFO source layers retained at zero, two physical reversal movements at quantity -0.50 / cost 0.50, actual saved Xero bill DELETED, FIFO still active and automation paused. Earlier run -003 remains a failed undo with successful alternate cleanup; no historical stock/cost repair, commit or deployment.
- 2026-10-11 approved PO amendment replay fix: ImsPORepo.update now resolves the keyed operation immediately after the locked header, before revision/line/allocation checks. Completed exact retries return without repeated changes; mismatched payloads still conflict and fresh stale requests roll back. Existing PO regression strengthened to reproduce the stale replay before the fix; all 30 PO tests pass afterward. Canonical PO edit Help updated in its existing mapped section; production build completed. Full suite: 3,700 passed, five skipped, only the previously known foresight:connections Help coverage failure.
- Fresh replay retest campaign-20261011-po-amend-fifo-002 confirmed replay passed but stopped on an incorrect harness assumption that incoming edits write no movement. Corrected assertions now require exact po_approved +1 / po_unapproved -1 commercial deltas, with full snapshots unchanged on replay. PO 4910 was unreceived and cancelled through the supported API; independent stock zero and original Xero bill DELETED. Original harness failure retained.
- Fresh campaign-20261011-po-amend-fifo-003 / PO 4911 passed quantity/cost amendment and exact stale-revision replay, first half receipt, reduction of the outstanding balance with received cost/quantity preserved, second half receipt and replay, FIFO integrity, and Xero totals. Independent audit verified two completed amendment keys, two half-unit receipt movements at cost AUD 0.50, and the actual saved Xero Draft bill total AUD 0.50 / zero tax. Cleanup exposed a separate unapproved defect: Undo Receipt uses the latest po_unapproved movement as a reversal cutoff, so the legitimate outstanding-quantity reduction hides the first receipt and reports incomplete valuation history. No production undo fix applied. Exact guarded linked supplier return passed at AUD 0.50, including replay, real Xero bill/credit totals, stock/layers zero, and full policy restoration. Manifest clean with originalUndoPassed false and alternativeCleanupPassed true; positive amendment workflow remains passed and failed undo history is retained.
- 2026-10-11 fresh Shopify follow-up: campaign-20261011-shopify-paid-fifo-004 passed paid import/fulfilment/refund stock and replay checks but failed Xero verification. Independent read found IMS header AUD 1 with a zero-priced line and a zero-valued PAID Xero credit; the immediate refund-create response used by the harness differed from the persisted refund readback, whose subtotal is AUD 1. Harness now fetches and validates the saved provider refund before IMS processing. Do not infer a production webhook parsing defect from this mutation-response fixture. Exact completed-refund cleanup passed without another refund or accounting edit; stock/layers zero, product archived, original zero-valued accounting artifact retained and original test remains failed.
- Fresh campaign-20261011-shopify-paid-fifo-005 passed the entire paid lifecycle without recovery: explicit PO confirmation/receipt, paid mapped order/import replay, real fulfilment/FIFO consumption/replay, persisted refund with validated subtotal, sole customer-credit restock/replay, real authorised Xero AUD 1 credit/zero tax, linked supplier cleanup and actual supplier credit/bill, product archive and full policy restoration. This is the fresh end-to-end Shopify paid pass; earlier failed/recovered runs remain separate history.
- Positive PO amendment campaign-20261011-po-amend-fifo-001: first unreceived quantity/cost edit succeeded (two units at AUD 0.50, total AUD 1, incoming 2). Product defect: replay of the same key/payload with its original expectedUpdatedAt returned stale-revision conflict. ImsPORepo.update checks revision before beginOrderAmendment can return its completed-key replay. Independent audit verified one complete amendment operation and zero received quantity. Supported exact cancellation under sandbox advisory lock restored stock 0/0/0 and original Xero bill DELETED. Manifest clean originalTestPassed false/unreceivedAmendmentPassed true/amendmentReplayPassed false/cleanupPassed true. No production replay fix applied; separately approve scoped replay ordering fix and retest before continuing post-receipt positive amendments.
- Reconciled the interrupted untouched PO receipt/undo run: manifest clean, PO cancelled, original Xero bill independently read as DELETED, fixture on-hand/incoming/committed all zero, FIFO layers zero with no integrity violations, and no active tenant transaction.
- FIFO unsourced SO passed through authenticated UI creation, sourcing acknowledgement, confirmation and supported cancellation. One unit committed with zero ready stock and one unsourced unit; the real Xero Draft was AUD 1 No Tax. Independent SQL restored all fixture quantities to zero, and the original Xero invoice was independently read as DELETED. FIFO integrity remained clear in epoch 4.
- A generic compensation action was rejected by preflight before mutation; the required SO-specific action completed successfully. Safety guards were not bypassed.
- Standalone read-only probes importing application services can remain alive after successful output because shared database pools and telemetry timers remain open. Bound probe completion after all awaited work; do not repeat mutations because the probe process failed to exit.
- FIFO manual build passed component consumption, captured output cost, two partial reversals, completion/reversal replay and conflict rejection. Linked supplier return restored fixture stock/layers to zero while preserving receipt and allocation history. Supplier-credit sync was originally disabled; only Draft supplier credits were temporarily enabled for the exact completed return, the real bill/credit pair was independently verified, and the entire original policy was restored. Both accounting documents remain labelled audit artifacts.
- Zero-float POS register lifecycle passed with duplicate-open/close rejection and unchanged sale/payment/stock counters. Real FIFO cash sale and linked cash refund passed original-line cost, sole credit-note restock ownership, replay and over-return rejection. Exact supplier return restored stock/layers to zero and the register closed. Harness payload/oracle failures were reconciled without repeating a sale.
- FIFO stocktake two-unit gain and supported exact reversal passed with reconciled layers and zero final fixture stock.
- Approved reverse-switch performance fix replaces per-variant round trips with bounded tenant-scoped updates, preserving weighted cost, atomicity and historical snapshots. Focused tests passed; full suite passed 3,689 tests with five skips and the known unrelated foresight Connections Help mapping failure. Production build completed. Approved build-dialog containment fix passed authenticated desktop/mobile geometry and horizontal table checks.
- Both prospective transitions now passed: FIFO to Average Cost, then Average Cost to FIFO. Quantity/history fingerprints and prior layers were preserved, exact replay returned the same epoch, and changed payload/stale revision rejected. Current FIFO epoch is 7; automation remains paused. The earlier timed-out transition is retained as a failed run, not rewritten as successful. Comprehensive campaign testing and final restoration are not complete.
- Closing read-only checkpoint: FIFO epoch 7/revision 6, sandbox and automation-paused flags set, fixture on-hand/incoming/committed all zero, TEST register has no open session, supplier-credit policy restored to none, and no active tenant transaction. All four build-table arrow keys passed in the actual authenticated view.
- Development-app scope readback confirmed order/fulfilment/return write permissions. `campaign-20261010-shopify-order-fifo-001` passed one real unpaid AUD 1 test order on the verified development store: exact product/variant mapping, one committed unsourced unit, import replay without duplication, provider cancellation, IMS cancellation and cancellation replay. Independent SQL showed zero final stock/commitments. Provider product is archived; labelled cancelled orders and the offline IMS mapping remain. An initial channel-key lookup failed before mutation and was corrected to the canonical channel_instance_id.
- `campaign-20261010-build-sale-fifo-001` passed atomic Build & Confirm for one labelled wholesale SO: one component consumed at captured FIFO cost, one output produced and committed, exact replay without duplication, cancellation releasing commitment, and two half-reversals restoring the component. Linked supplier return left both variants/layers zero. Actual Xero bill/credit are retained and the SO's original invoice is independently DELETED/VOIDED. Location sale-build policy and full supplier-credit policy were restored; recipe retained disabled at revision 2.
- POS device setup containment passed at 1440px and 390px. The real checkout screen's empty-cart Charge gate, Settings > Misc Training Mode toggle and offline indicator passed without an ordinary transaction or register opening. `campaign-20261010-pos-training-ui-fifo-001` is clean. Selector/navigation failures are retained as harness failures, not product findings.
- `campaign-20261010-pos-training-checkout-fifo-001` completed exactly one real UI simulated AUD 1 cash checkout. Independent SQL reconciled training audit ID 3, exact fixture variant/quantity/payment, no matching ordinary sale, fixture stock 0/0/0 and closed TEST register. The test remains blocked on harness verification: its page.route interception did not capture the outgoing local ID, so the first audit lookup used a missing ID. Do not resubmit this checkout. Exact local ID and audit ID are appended to the immutable manifest. Reconcile service-worker interception behavior before repairing/replaying verification. This is not a live POS transaction defect or a passed checkout harness run.
- 2026-10-11 recovery supersedes the blocked state above without rewriting history. `@pos-ui-audit-recovery` verified the exact saved audit/local ID, unique labelled training row, captured variant/quantity/AUD 1 cash tender, absence of an ordinary matching sale, closed register and zero fixture/FIFO layers. The manifest is now clean with `originalUiTestPassed: false`, `recoveryVerificationPassed: true` and `resubmitted: false`; repeat read-only verification passed. The original checkout was not submitted again.
- Guarded POS browser tests now block service workers only within their own describe group so interception is deterministic; service-worker-enabled offline workflows are not covered by this group. The pre-submit guard now checks the actual `payment_method` payload field rather than `method`, and successful checkout verification requires a captured local ID. `@pos-request-capture` passed a locally fulfilled checkout-shaped request without reaching the server or writing a sale. The POS service worker explicitly skips API cache handling; the original bypass mechanism remains unproven. A duplicate recovery tag initially selected an older incompatible test; its action assertion failed before mutation and the recovery tag is now unique.
- Paid Shopify fulfilment/refund/accounting, POS sale-triggered builds and ordinary UI/offline checkout, and broader variant/location/partial-receipt/amendment/non-stock cases remain pending. The comprehensive campaign is incomplete; automation remains paused and FIFO epoch 7/revision 6 remains active.
- `campaign-20261011-po-partial-fifo-001` passed two 0.5-unit receipts against one labelled AUD 1 No Tax PO. Independent counters moved 0/1/0 -> 0.5/0.5/0 -> 1/0/0, with matching FIFO quantity. Both receipt keys replayed without stock/history changes; changed-key payloads, ordered quantity below received quantity and captured received-line cost changes were rejected. The actual Xero bill remained AUD 1, zero tax.
- Product defect: supported FIFO Undo Receipt rejected that fully received PO solely because its two untouched receipt layers reference two valid source movements. The receipt-reversal planner in ImsRepository currently requires exactly one source movement per variant despite cumulative multi-session receiving. No product fix or historical repair was applied. The original cleanup failure remains immutable and is not a passed undo case.
- Authorized alternate cleanup `@po-partial-return` independently proved two unconsumed/untransferred 0.5-unit layers at AUD 1 unit cost, then completed one exact PO-line-linked supplier return. Completion replay added nothing; stock/layers returned to zero. Actual Xero AUD 1 bill and credit are retained, and the full temporary supplier-credit policy was restored. Manifest is clean with `originalUndoPassed: false` and `alternativeCleanupPassed: true`. Partial receipt and invalid amendment guards are covered; safe positive amendments, differing receipt costs and ordinary multi-receipt undo remain outstanding.
- Approved multi-receipt FIFO undo fix now groups untouched receipt layers by exact source movement and writes a quantity/captured-cost reversal for each source, rather than requiring one source per variant. Stock and average-cost updates remain once per variant in the existing transaction. Missing/invalid source IDs or costs, incomplete coverage, consumed or transferred layers and commitments remain blockers; failure of a later source reversal rolls back the whole correction. No original movement costs or prior allocation history are rewritten, and no migration is needed.
- Validation: all 30 focused PO repository tests passed, including distinct receipt costs, missing provenance, dependent consumption and second-reversal rollback. Full serial suite: 3,693 passed, five skipped, only the existing unrelated foresight:connections Help mapping failure. Production build completed. Canonical receiving Help now documents multi-session undo and maps its undo context; Help/Assistant indexes regenerated with 71 topics and 801 chunks.
- Fresh retest `campaign-20261011-po-partial-undo-fifo-001` passed exact PO creation, both half receipts/replays/amendment guards, and ordinary authenticated Undo Receipt. Independent SQL verified two preserved original half-unit layers, two distinct reverse-inbound movements/allocations, zero remaining quantity and AUD 1 reversal value. The original Xero bill was fetched by its saved external ID and confirmed DELETED. Manifest clean; fixture 0/0/0, FIFO epoch 7 with no integrity findings, automation paused. Original failed run remains unchanged; broader campaign coverage is still incomplete.
- Paid Shopify continuation: `campaign-20261011-shopify-paid-fifo-001` was aborted before order creation on harness errors (credit-note oracle used refund_method instead of settlement_method; direct PO creation omitted header totals). Exact supported undo restored the untouched receipt, archived the provider product and retained the failed lifecycle. Correction requests require operationKey and expectedUpdatedAt; an incomplete undo request was rejected before mutation, then guarded cleanup passed. Direct PO payload now includes subtotal, tax_amount, total_amount and line_total, and verifies its header before receiving.
- Fresh `campaign-20261011-shopify-paid-fifo-002` passed real AUD 1 paid test-order creation, exact mapped IMS import, one committed layer-backed unit and import replay without duplication. Provider fulfillment-order access returned a permission error before any fulfilment. Granted scopes contain read_fulfillments/write_fulfillments, but not read_merchant_managed_fulfillment_orders/write_merchant_managed_fulfillment_orders. Enable those on the development app and confirm the installed app grants them before a fresh paid fulfilment/refund retest. The harness now checks both scopes before fixture creation; paid fulfilment, refund-restock and customer-credit accounting assertions are implemented but NOT yet validated live.
- Exact cleanup for the permission-blocked run passed: Shopify paid order cancelled with notifyCustomer false, refund true and restock false; independent provider transaction read verified one successful AUD 1 refund and no fulfilments. IMS cancellation released commitment, supported undo reversed the untouched receipt, and the labelled provider product was archived. Both manifests are clean with originalLifecyclePassed false/abortedSeedCleanupPassed true. Independent audit confirmed both variants zero, original layers retained at zero remaining, both original Xero bills DELETED, FIFO epoch 7/revision 6, automation paused, document policy restored and TEST register closed. No production fix, permission change, commit or deployment was performed in this continuation.
- 2026-10-11 installed app scope readback confirmed both merchant-managed fulfillment-order permissions after the user's update. `campaign-20261011-shopify-paid-fifo-003` caught another harness assumption before receipt: PO create always returns draft. Harness now confirms explicitly through PUT; exact draft PO 4906 was verified and resumed without creating a second fixture. Paid order creation/import/replay, real Shopify fulfilment, FIFO consumption at captured AUD 1 cost and fulfilment replay passed.
- Product defect: Shopify refund restock under FIFO fails because processShopifyRefund resolves the variant but does not retain source_so_item_id in either credit-note insert path; synthetic credit-note item IDs are also zero when passed to the shared restock gateway. Real provider refund completed once, but IMS refund transaction rolled back. Independent SQL verified SO 49657 remains fulfilled, refunded_amount zero, no credit note, stock 0/0/0, one consumed original layer, and only po_received +1 / so_fulfilled -1 movements at cost 1. Provider order is fulfilled/refunded with exactly one saved refund. Original policy restored and automation paused. Manifest remains blocked, not clean; do not resubmit the provider refund, undo the consumed PO, create a replacement refund or rewrite captured history. A separately approved source-line/item-ID fix plus exact existing-refund retry is needed before supported supplier cleanup and Xero customer-credit verification.

## Safety invariants

- Source business: `Monsterthreads`
- Source business ID: `1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps`
- Source IMS schema: `readyedu_MonsterthreadsIMS`
- The target must have `is_sandbox=1` and `automation_paused=1`.
- The target starts quarantined with `deleted_at` set and becomes active only after verification.
- No source `connections` row, OAuth token, API key, webhook secret, email recipient, Xero action, or payout state is copied.
- Historical cloned documents are reference data. Integration tests create new documents.
- `ims_sales_history` is created empty. It can be rebuilt or imported later if a test needs Cin7 history.
- Contacts retain all non-retail rows plus retail contacts referenced by retained orders, credit notes, POS sales, gift cards, customer-service threads, loyalty, store credit, or wholesale drafts.
- Never paste tokens, secrets, or customer payloads into command output or clone reports.

## 1. Deploy code and migration

Deploy the application changes before creating a sandbox so every shared scheduler understands `automation_paused`.

Run the additive main-database migration twice and verify it is idempotent:

```powershell
node scripts/add-business-sandbox-controls.mjs
node scripts/add-business-sandbox-controls.mjs
```

Existing businesses must remain `is_sandbox=0` and `automation_paused=0`.

## 2. Human approvals

Before dry run, record:

- A current Railway MySQL backup or restore-point timestamp.
- The target business ID and schema name.
- The sandbox Admin email.
- Who may access the copied customer and transaction data.

Recommended target values:

- Business ID: `biz_monsterthreads_sandbox`
- Name: `Monsterthreads DEV SANDBOX`
- Schema: `readyedu_MonsterthreadsSandboxIMS`

## 3. Clone dry run

Dry run is the default and performs no writes:

```powershell
node scripts/clone-business-sandbox.mjs `
  --source-business-id=1wzuBk0M_FjEFdZkWyz0PVHcQsIh8s0Ejve-MTV3_8Ps `
  --target-business-id=biz_monsterthreads_sandbox `
  --target-name="Monsterthreads DEV SANDBOX" `
  --target-schema=readyedu_MonsterthreadsSandboxIMS `
  --confirm-source-name=Monsterthreads `
  --backup-confirmed-at=2026-08-15T00:00:00Z
```

Replace the backup timestamp with the actual verified restore point. Review the generated JSON manifest and SHA-256 before approving apply.

## 4. Apply clone

Repeat the reviewed command with `--apply`. The script:

1. Creates a paused, quarantined sandbox registry row and empty connections row.
2. Recreates the source's live non-archived table contract in the target schema.
3. Fails closed if the copied source and target table/column contracts differ.
4. Copies the live IMS table contract under a repeatable-read consistent snapshot, excluding `_archived_*` tables.
5. Rewrites populated tenant stamps while preserving intentionally empty child stamps.
6. Excludes Cin7 sales history and unreferenced Shopify retail contacts while retaining operational contact dependencies.
7. Clears Shopify, Xero, and Zeller identities and resets IMS/POS authentication hashes.
8. Marks records historical where supported.
9. Disables Shopify order/inventory/Xero automation, customer-service automation, Xero posting, reconciliation, digests, COGS, payments, batches, and payouts.
10. Verifies transformed row counts, tenant stamps, external identities, settings, and empty connections.
11. Activates the tenant only after all checks pass, while leaving automation paused.

Create a new sandbox Admin through the existing SuperAdmin user tooling. Do not reuse a production user password or POS PIN.

## 5. Shopify development store

Human actions:

1. Create an empty Shopify Partner development store with no customers or orders.
2. Create the store's Admin API app with the scopes required by products, inventory, orders, fulfillments, refunds, webhooks, and Shopify Payments testing.
3. Store its domain, token, app secret, and location ID in a password manager.
4. Enter the dev domain and token through Sandbox Setup > Connections.

Agent verification:

1. Confirm the connection resolves the dev `.myshopify.com` domain, never the live Monsterthreads domain.
2. Keep order sync, inventory sync, and Shopify-to-Xero sync off.
3. Upload catalog products in controlled batches.
4. Reconcile by SKU, then barcode; stop on ambiguous or duplicate identifiers.
5. Register fresh webhook topics and confirm every callback contains the sandbox business ID.
6. Enable order sync only and run synthetic order/payment/fulfillment/refund tests.
7. Preview inventory before one manual push. Leave scheduled inventory and payout automation paused.

## 6. Xero test organisation

Human actions:

1. Create an Australian Xero demo/test organisation named clearly, such as `Monsterthreads Solvantis Sandbox`.
2. Use a Xero login exposing only that organisation during OAuth because the callback currently selects the first tenant returned.
3. Connect from the sandbox IMS Xero screen.

Agent verification:

1. Immediately confirm the stored tenant name and ID are the test organisation.
2. Disconnect and stop if the live Monsterthreads tenant appears.
3. Configure test account, tracking, clearing, and payment mappings.
4. Keep all Xero policies and schedulers off.
5. Enable only Draft SO sync and create a synthetic invoice; verify inclusive Australian GST and that it exists only in test Xero.
6. Repeat with one synthetic Draft PO bill before testing authorization or payment.
7. Keep payout auto-post and COGS off by default.

## 7. Scheduled automation

Recommended permanent setting: `automation_paused=1`.

For a cron-specific test:

1. Approve a short test window.
2. Enable only the relevant per-feature setting.
3. Set `automation_paused=0` in SuperAdmin.
4. Observe one scheduled run and verify the external target.
5. Immediately restore `automation_paused=1`.

## 8. Refresh and cleanup

Do not overlay a fresh snapshot while integrations are connected. Revoke/unregister dev integrations first, then clean up and clone again.

Cleanup defaults to dry run and requires exact identity confirmation:

```powershell
node scripts/cleanup-business-sandbox.mjs `
  --business-id=biz_monsterthreads_sandbox `
  --schema=readyedu_MonsterthreadsSandboxIMS `
  --confirm="DELETE biz_monsterthreads_sandbox readyedu_MonsterthreadsSandboxIMS"
```

Review the plan, then repeat with `--apply`. Cleanup refuses a tenant that is not both sandbox and automation-paused or whose schema is referenced by another active business.

## 9. FIFO browser verification

FIFO activation is a one-time, prospective accounting change. The activation run creates an immutable costing epoch and opening layers, and the sandbox must remain on FIFO afterward. Do not use the activation command as routine test setup and do not switch the sandbox back to Average Cost between runs.

Before running Playwright:

1. Confirm the target is `Monsterthreads DEV SANDBOX`, its IMS schema is `readyedu_MonsterthreadsSandboxIMS`, and automation remains paused.
2. Confirm the configured Shopify shop and Xero tenant are the development/test identities.
3. Use a dedicated active stock variant, isolated non-POS location, supplier, and customer. The fixture must have no unrelated open PO or SO work.
4. Set `LIVE_E2E_EXPECTED_COSTING_METHOD=average_cost` only for the preflight and one-time activation run. Set it to `fifo` for every subsequent run.
5. Never store credentials, tokens, tenant IDs, or fixture IDs in this runbook or a committed file.

For local browser automation, `LIVE_E2E_MFA_BYPASS_EMAIL` may match the configured E2E admin email. The password is still verified. The login route bypasses MFA only when the request hostname is localhost, the exact live-E2E confirmation and expected business ID are configured, and the database confirms that business is both a sandbox and automation-paused. Missing or mismatched conditions retain the normal MFA enrollment/challenge flow.

Run the read-only browser and database preflight first:

```powershell
$env:LIVE_E2E_ACTION = 'preflight'
npm run e2e:live:preflight
```

After reviewing the preview and confirming there are no blockers, use a new run ID and explicitly invoke the irreversible activation scenario:

```powershell
$env:LIVE_E2E_ACTION = 'fifo-activate'
npm run e2e:live:fifo:activate
```

The activation scenario verifies the UI preview, submits the switch once, records the epoch, and checks stock against opening layers before marking the manifest clean. A blocked activation manifest requires inspection; do not retry by creating another run ID until the resulting costing state and epoch are understood.

After activation, set `LIVE_E2E_EXPECTED_COSTING_METHOD=fifo`. Run the integrity audit before and after each browser phase:

```powershell
node scripts/audit-fifo-integrity-all-tenants.mjs --schema=readyedu_MonsterthreadsSandboxIMS
```

The existing P1 purchase-order and P3 partial-fulfilment scenarios become FIFO-aware under that setting. They record FIFO integrity snapshots after stock mutation and compensation. P3 requires at least one unit of positive layer-backed fixture stock; fulfilling from zero stock is an Average Cost-only test assumption and is intentionally blocked under FIFO.

Xero and Shopify scenarios retain their existing low-value cap, exact integration identity checks, operator acknowledgement, and compensating workflow. External voids, cancellations, and audit trails are permanent test artifacts even when local stock returns to baseline.

## 10. Comprehensive inventory campaign

The comprehensive campaign is separate from routine one-time FIFO activation verification. It may test Average Cost, FIFO, and prospective switches in both directions only after explicit operator approval. Never reuse the one-time activation action to imply approval for a switch back. Verify current method and revision rather than assuming the snapshot still uses its original method.

Before creating campaign fixtures or changing costing:

1. Confirm the exact paused sandbox identity and a usable local application server.
2. Run authenticated preflight with a new run ID and the actual current costing method.
3. Verify canonical Shopify channel ownership as well as the legacy connection. The expected development store must have exactly one sandbox owner, with the channel enabled, active, and ready.
4. Run the read-only campaign baseline and sandbox-scoped integrity audit. A successful baseline records evidence; it does not authorize a costing switch or override audit findings.
5. Review any unresolved manifests and confirm the restore point before a tenant-wide costing switch. Historical stock or cost repairs require separate approval.

```powershell
$env:LIVE_E2E_ACTION = 'preflight'
$env:LIVE_E2E_RUN_ID = 'campaign-YYYYMMDD-baseline-001'
$env:LIVE_E2E_EXPECTED_COSTING_METHOD = 'average_cost'
npm run e2e:live:campaign:baseline
npm run e2e:live:fifo:audit
```

Replace the example run ID and expected method with the reviewed values. Set `LIVE_E2E_BASE_URL` to the verified localhost server without editing or exposing credentials.

The baseline compares independently read stock totals with the Inventory Costing preview and fingerprints stock, layer history, and historical movement costs before and after inspection. It records transition blockers without applying corrections. Read-only baseline runs can finish `clean` with documented transition blockers because they have no transactional compensation; this does not mean the mutating campaign passed.

Playwright login traces and videos are disabled to avoid persisting credentials and session material. Screenshots remain available; keep reports and manifests local and private. The login helper clears the password input after submission before failed-navigation snapshots can be produced.

Automation pause blocks schedulers, not all manual integrations or webhooks. Every external mutation still requires exact development/test identity checks, fixture scoping, the existing low-value cap, and the applicable operator gate. POS campaign fixtures must use a separately guarded sandbox register/location; do not weaken the ordinary isolated IMS fixture rules.

If a costing-switch preview and integrity audit disagree, stop dependent mutation and record both results. Do not mark an audit finding repaired by modifying costing-state rows or bypassing the audit. Resolve the contract through a separately approved code fix and regression test.

### Incoming allocation stages

The allocation harness accepts only recorded campaign-owned documents: at most two POs and two SOs, with the isolated fixture, No Tax, the existing document cap, and no receipt or shipment. Its cleanup action must not be reused for received or fulfilled work.

Use a fresh run ID, the actual costing method, and authenticated preflight before choosing one setup stage. Quote Playwright tags in PowerShell.

```powershell
$env:LIVE_E2E_ACTION = 'allocation'
npx playwright test --project=live-monsterthreads --grep '@allocation-create'
npx playwright test --project=live-monsterthreads --grep '@allocation-exercise'
```

For the separate two-SO concurrency and batch case, use another freshly preflighted run and the `@allocation-multi-create` and `@allocation-multi-exercise` stages instead. Never run both setup stages in one manifest or use an unfiltered allocation tag to execute all stages.

Create & Confirm is a two-request PO flow. Record the creation ID immediately, then wait for confirmation before navigating away. If setup is interrupted, inspect actual state before using the narrowly guarded confirmation recovery stage; do not repeat creation. The read-only verification recovery stage requires the exact released single-SO lifecycle history. Inspection may also authorize supported cleanup of a failed case, but does not mark the case passed.

After evaluating artifacts, use the existing acknowledgement gate, set `LIVE_E2E_ACTION=allocation-compensate`, and run only `@allocation-compensate`. Cancellation restores stock counters but retains cancelled documents and released allocation history. Independently check Xero deletion by original external ID from the tenant-scoped sync audit: cancellation clears local links, and invoice-number searches do not reliably return deleted Drafts.

### Received allocation stages

Received protection uses a separate gate rather than weakening incoming-only cleanup. Start from a fresh authenticated preflight, then use `LIVE_E2E_ACTION=allocation` and `@allocation-multi-create` to create two unsourced SOs and two confirmed POs. Set `LIVE_E2E_ACTION=allocation-received` before running only `@allocation-received-exercise`.

This stage records one exact two-unit PO receipt before applying it. It protects that supply for the newer SO, receives through the UI, checks physical readiness and rejection of another SO's shipment even with negative-stock override, checks received shrink/reassignment rejection, and releases protection back to ordinary priority. A completed receipt must match its recorded PO, fixture variant/location/supplier, two-unit quantity, No Tax and document cap.

After artifact assessment and acknowledgement, set `LIVE_E2E_ACTION=allocation-received-compensate` and run only `@allocation-received-compensate`. Cleanup cancels exact unshipped SOs, undoes the recorded mistaken receipt, cancels the remaining unreceived PO and verifies stock baseline. It captures external IDs before cancellation and reads back all four original Xero documents as DELETED or VOIDED. Never use either allocation cleanup stage to reverse a shipped SO or an unrecorded receipt; reconcile actual state first if a check fails.

### Draft SO movement stages

Use a separate fresh preflight, `LIVE_E2E_ACTION=allocation`, and only `@allocation-move-create` followed by `@allocation-move-exercise`. The two drafts start below the cap so their consolidated target remains within it. The case checks UI partial movement into a compatible draft, exact replay, changed payload/stale revision/excess quantity rejection, and full consolidation with the close-source acknowledgement.

The SO row action value is `move_items`, whereas the PO action uses `move-items`; browser tests select the visible Move items label. Draft SOs cannot be cancelled directly. For this recorded movement scenario only, cleanup retains the labelled target through supported confirmation then cancellation, waits for asynchronous Xero Draft creation, verifies its value and tax, and independently verifies its deletion. The empty consolidated source is already cancelled. Do not delete retained campaign documents as a shortcut.

### Verified allocation coverage, 2026-10-09

- `campaign-20261009-allocation-average-001`: UI allocate, reassign, exact promise-date revision and release; authenticated API resize up/down, exact replay, changed-payload rejection, stale revision rejection and over-demand rejection. Incoming protection never became physical stock and did not change committed demand or stock-movement cost history.
- `campaign-20261009-allocation-multi-average-001`: two competing SO requests for one PO produced exactly one success and one 409. Shared-supply resize overflow was rejected. Batch replay added nothing; a changed batch was rejected; an invalid second entry rolled back the valid first entry and the whole batch.
- All seven low-value Xero Draft bills/invoices had the expected totals and zero tax, and were independently confirmed DELETED after supported cancellation. Both runs restored the fixture to 0 on hand, 0 incoming and 0 committed, with no active allocations or new store credit. The sandbox-scoped integrity audit was balanced with no findings.
- The single-SO run retained two harness failures and resumed exact recorded artifacts: premature navigation interrupted PO confirmation, then a mistaken stock-availability response shape interrupted only final read-only checks. Neither failure required a product fix or repeated document creation. The two-SO run passed uninterrupted through setup, exercise and cleanup.
- The serial regression gate passed 3,685 tests with five skipped; the known unrelated `foresight:connections` Help-context mapping test remained the only failure.

The first two results cover unreceived incoming supply only. Subsequent received-protection and draft-movement results are recorded below. Builds/POS, Shopify transactions, broader variant/location cases and costing transitions remain pending. Average Cost remained active and automation remained paused for these cases; final FIFO restoration has not yet been performed. Historical cost repair remains a separate approval.

### Additional verified coverage, 2026-10-09

- `campaign-20261009-allocation-received-average-001`: two units received through the UI at the captured per-unit cost. Only the newer protected SO became ready; the older SO's shipment was hard-blocked with PROTECTED_STOCK_CONFLICT even when negative-stock override was requested. Shrinking below received quantity and reassigning received protection were rejected without mutation. Release restored the older SO's ordinary priority without changing physical stock or cost history.
- The exact receipt was undone after cancelling unshipped demand; fixture counters returned to 0/0/0 with no active allocations or new store credit. All four original external documents were independently verified DELETED or VOIDED during cleanup. The post-undo scoped audit was balanced with no findings.
- `campaign-20261009-so-move-average-001`: UI partial movement preserved quantity and value, exact replay added nothing, and changed-payload/stale/excess requests were rejected. Full consolidation required source-closure acknowledgement, cancelled the empty source and left all four units on the target within the document cap. Stock counters, allocation history and movement-cost history were unchanged.
- The movement run retained an initial harness selector failure before any transfer and an expected lifecycle rejection during cleanup: direct draft cancellation is unsupported. The corrected supported cleanup retained both labelled SOs as cancelled, independently verified the temporary Xero Draft was DELETED, and restored 0/0/0 without shipment or store credit.
- The serial regression gate passed 3,686 tests with five skipped; the known unrelated foresight:connections Help-context mapping test remained the only failure. No product fix or historical cost repair was applied in these slices.

Received protection and draft SO movement are now covered under Average Cost. Confirmed-order protected transfer results follow below. Builds/POS, Shopify transactions, broader variants/locations and costing transitions remain outstanding. These runs do not represent final FIFO restoration or completion of the comprehensive campaign.

### Confirmed protected SO movement, 2026-10-10

- `campaign-20261010-protected-move-average-001`: UI partial transfer split two protected incoming units into one unit on each confirmed SO. Exact replay added nothing. Acknowledged consolidation moved the remaining protection to the target, cancelled the empty source and preserved four committed units, four incoming units and zero physical units. Stock-movement costs were unchanged.
- Independent Xero readback verified the original source invoice was deleted/voided and the target invoice matched the consolidated capped value with zero tax. The harness needed read-only recovery because cancellation correctly cleared the local source invoice link; no transfer was repeated.
- Supported cleanup first released exact recorded unreceived protections, then cancelled the unshipped target and unreceived POs. Fixture counters returned to 0/0/0 with no active allocations or new credit. All four original external documents were independently confirmed DELETED.
- Date-filter issue observed and not fixed: at an Australian/UTC day boundary, newly created drafts dated 10 October were absent from the default 90 Days SO list while UTC was still 9 October. They appeared with the explicit Last 30 days range. The retained initial setup failure was resumed using recorded documents, without duplicate creation. The harness now uses an explicit current-day range for these SO interactions. Product remediation requires separate approval.

Protected incoming confirmed-order movement is covered under Average Cost. This does not cover transfers of received protection, a different tenant/variant/location, builds/POS, Shopify transactions or costing transitions. Final FIFO restoration remains pending.

### Average Cost manual build and reversal, 2026-10-10

- Read-only authenticated recipe, history and requirement discovery passed without changing the isolated component fixture. Builds and build-from-sale were already enabled; no business settings were changed.
- The existing guarded P1 UI flow supplied exactly one component at AUD 1, No Tax, with independent stock and actual Xero test-bill verification. A separately labelled, offline output product/variant and new recipe were retained as campaign fixtures; no existing recipe was edited.
- The recipe used one component per output with zero overhead. Building one output consumed one component, captured AUD 1 component/output cost and added exactly two Average Cost Stock History movements. Exact build replay added nothing; changed operation-key payload returned 409 without stock/history changes.
- A half reversal restored 0.5 component and consumed 0.5 output at the captured cost. Exact replay and conflicting payload checks passed. Excess reversal was rejected with 400 without mutation. The second half restored the remaining component and left output stock zero; all six build/reversal movements balanced to zero value.
- The run retained two harness assertion failures: conflict responses omit `success`, and excess reversal is validation 400 rather than conflict 409. Recovery checked the exact recorded product, variant, batch, item and unreversed quantity, then resumed through keyed replay without creating duplicate fixtures or builds. These are harness corrections, not reported product defects.
- The recipe was disabled through a new immutable revision 2. The exact source receipt was undone through the supported UI. Independent closing reads verified component counters 0/0/0, output stock zero, the original fully reversed build, disabled recipe and original Xero bill deleted/voided. The manifest is clean; labelled product, recipe revisions, build/reversal and cancelled receipt audit history remain.

This verifies an authenticated API manual build with independent SQL oracles, not the Builds UI or sale-triggered builds. IMS/POS sale builds, Shopify transactions, FIFO builds and costing transitions remain pending. Automation remains paused and Average Cost remains active; final FIFO restoration has not been performed.

### Builds UI and guarded phase recovery, 2026-10-10

- Real authenticated history/detail inspection verified the retained build row, fully reversed quantity, absence of a further Reverse command, horizontal overflow, Right/Left movement, synchronized header offset and fixed Build-column geometry. The mobile detail dialog extended slightly past the 390px viewport; the screenshot is retained as a product geometry finding, not fixed. Vertical key behavior was not established by this short history case.
- A fresh AUD 1 component receipt supplied a separate labelled output/recipe. New Product Build displayed one available component, zero commitments, AUD 1 output cost and zero overhead. Confirm atomic build and the first half reversal were executed through actual UI controls; exact captured UI command keys were retained for replay checks. The remaining half reversal, changed-key payload guards, excess-quantity rejection and six-movement value conservation passed through authenticated APIs and independent tenant SQL.
- Setup-only failures exposed harness assumptions about accessible labels and the atomic command text. A subsequent failed assertion reset the local recovery phase even though immutable history still recorded recipe creation. Recovery now retains the prior phase and permits that specific regression only when the same product/variant/PO checkpoint exists, no batch/item is recorded, SQL shows no build and zero output, and the exact enabled revision-1 recipe/component remains unchanged. The original manifest was not edited and no duplicate fixture was created.
- Supported exact receipt undo and independent closing reads passed: both fixture stocks zero, component counters 0/0/0, recipe disabled at revision 2, one fully reversed build and original Xero bill deleted/voided. The UI run manifest is clean. No production code or historical costs were changed.

Manual Builds UI creation and partial reversal are now covered under Average Cost. Sale-triggered IMS/POS builds, Shopify transactions, FIFO builds, costing transitions and broader inventory cases remain pending; the comprehensive campaign and final FIFO restoration are not complete.

### POS training isolation and costing transition checks, 2026-10-10

- Authenticated admin-backed POS session resolved only the expected fixture location, with no assigned register. One labelled simulated AUD 1 sale persisted only in the training audit; exact replay returned the same training ID. Returns, laybys, gift-card items/tenders, store credit, negative quantity and linked loyalty/return flows were rejected with 400. Independent ordinary sale/item/payment and stock-movement counts stayed unchanged, as did fixture stock/history. The retained training audit run is clean; no real register, payment or inventory operation occurred. POS UI training, offline behavior and ordinary checkout remain pending.
- Average Cost to FIFO passed the supported prospective switch with no preview blockers. Independent SQL verified one new active epoch, unchanged inventory quantities and historical movement-cost fingerprint, unchanged prior layers, exact replay without an additional epoch, changed-key payload/stale revision rejection and FIFO integrity.
- The opposite FIFO to Average Cost request exceeded the ten-minute test limit. Independent readback still showed the prior FIFO epoch, no committed reverse-switch operation, and a live open transaction locking about 90,000 rows. The owning reverse path performs two sequential awaited updates for each stocked variant; the sandbox has 8,059 such variants. This is an operational/performance finding, not a completed reverse-transition result. Do not retry the unknown request or run overlapping stock mutations until its exact operation and transaction outcome are reconciled. No product performance fix or forced transaction cancellation has been applied.

At this checkpoint the reverse transition may still commit after client timeout. Do not treat the observed FIFO state as the final restored state. Second FIFO epoch, FIFO transactions/builds, real POS, Shopify and the broader campaign remain pending.

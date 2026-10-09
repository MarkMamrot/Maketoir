# Monsterthreads inventory campaign: findings and coverage

Date: 2026-10-07. Phase: Average Cost PO/SO receipt, unsourced confirmation, partial shipment, held backorder, rejection and compensation.

Campaign orders, stock movements, Xero test documents and customer credit notes have been created. Executed fixture stock and open work have been compensated through supported workflows; immutable history remains. Two linked returns issued AUD 1.00 total in store credit. The sandbox remains automation-paused and on Average Cost, revision 3. No costing switch or historical repair has been performed.

The user waived the restore-point prerequisite for this sandbox only and delegated assessment of expected behavior and supported campaign-owned cleanup to Copilot. Product fixes and historical cost repairs remain separately approved actions.

## F004: Average Cost linked return does not capture a movement cost

Severity: High for accounting reconciliation. Prospective linked-SO fix implemented and live-verified with user approval on 2026-10-09; historical records remain unchanged.

Reproduction under Average Cost:

1. Receive one fixture unit at AUD 1.00, No Tax, through a run-labeled PO.
2. Confirm an SO for two units at AUD 0.50 each; explicitly acknowledge the one unsourced unit.
3. Ship the available unit and hold the remainder on a backorder child.
4. Cancel the exact child. Create a credit note linked to the source SO and source SO item, with quantity one and Restock selected, then complete it.
5. Compare the receipt, shipment and linked return movement costs with the credit ledger.

Observed: receipt +1 at unit cost 1.00; shipment -1 at unit cost 1.00; linked return +1 with unit cost NULL. All three movements reference Average Cost epoch 3. The source shipment cost remains unchanged. Stock is restored and exactly one AUD 0.50 store-credit issue is recorded for this return.

The controlling return implementation inserts the movement without unit_cost and only invokes cost restoration under FIFO. The COGS calculator classifies a NULL movement cost as missing and blocks affected-period accounting. This impact is established by the actual persisted movement and calculator contract; no COGS posting was attempted. Correct quantity and credit settlement are not sufficient for accounting reconciliation.

Expected: linked returns record an authoritative captured return cost under both methods, with current-cost changes and cross-epoch behavior explicitly covered. Historical correction requires a separately reviewed provenance-safe proposal, not a broad stock or movement rewrite.

Evidence: run campaign-20261007-p3-average-ready-003 and supply run campaign-20261007-p1-average-stock-002. Both manifests report stock/open-work cleanup only. Their clean states must not be interpreted as successful COGS reconciliation. The earlier zero-stock override return also has an uncaptured Average Cost return movement.

Fix: Average Cost restocked lines linked to a source Sales Order now capture the fulfilled line's quantity-weighted unit cost. Lookup is constrained by business, order, source line and variant inside the existing completion transaction. Completed shipment history, catalogue Average Cost, credit settlement, idempotency and FIFO restoration are unchanged. Missing/invalid source costs remain unknown; zero is preserved rather than replaced with a positive catalogue estimate. Unlinked and POS return-cost behavior is outside this specific linked-SO fix.

Verification on 2026-10-09: the new regression failed before the fix and passed afterwards. Thirty focused completion/reversal/COGS tests passed. Full serial suite: 3,683 passed, five skipped, one pre-existing foresight:connections Help mapping failure. Production build completed, regenerating contextual Help, Assistant and the corresponding public summary. Modified source/test diagnostics and git diff --check passed. The subsequent live retest below verified the prospective fix against real persisted sandbox transactions.

### Live regression and cleanup (2026-10-09)

- Port 3012 verified as the development server. Fresh guarded preflights verified tenant, paused-sandbox state, Average Cost and expected Xero/Shopify test identities before mutations.
- Supply run campaign-20261009-p1-return-retest-001 received one unit at AUD 1.00, No Tax; actual Xero bill totals and persisted stock passed.
- SO run campaign-20261009-p3-return-retest-001 confirmed two units at AUD 0.50 each, explicitly acknowledged one unsourced unit, shipped the available unit without negative stock and held the remaining unit on a child. Xero invoice readback was Authorised AUD 0.50 with zero tax.
- Exact child cancellation and source-item-linked restocking return CN-00025 completed. Independent guarded read-only queries verified shipment -1 at unit cost AUD 1.00 and return +1 at unit cost AUD 1.00, both Average Cost epoch 3. This known pair nets to zero COGS; it does not establish that the whole accounting period is unblocked.
- Return ledger contains exactly one AUD 0.50 issue. Replaying the same completion operation key succeeded and left ledger, stock and movement snapshots unchanged.
- Supported supply receipt undo passed and Xero bill voiding was confirmed. Both new runs ended stock-clean, with fixture On Hand, Incoming and Committed restored to zero and open fixture PO/SO work closed. Final scoped costing audit: balanced, findings empty.
- Retained customer store credit increased by this return's AUD 0.50 to AUD 3.40. This is expected linked-return settlement, not a cash refund or full financial rollback. No balance edits, old-cost repairs or COGS journal posting were performed. Existing historical correction proposal remains unapplied.

### Separate historical-correction proposal (not applied)

- Scope only the completed return owned by campaign-20261007-p3-average-ready-003. Re-resolve the exact movement from its manifest credit-note ID, credit-note source line and linked SO before approval; do not use a same-SKU bulk update.
- Recheck paused-sandbox identity, original source shipment quantity/cost, unchanged captured SO cost, completed return provenance, current NULL movement cost and absence of prior correction. The previously verified source cost is AUD 1.00 for one returned unit.
- If those checks still agree, propose the existing audited COGS cost-repair workflow for that one movement: NULL to AUD 1.00, with a provenance-based reason and the expected prior value. Do not change quantity, store credit, catalogue cost, FIFO history or posted journals.
- Recalculate the affected period after correction; the known sale/return pair should net to zero COGS. Unrelated missing/zero costs can still block period posting. Reconcile any existing Xero journal separately rather than automatically posting or rewriting it.
- Do not assign AUD 1.00 to the earlier harness override return. Its shipment captured zero, so a positive cost is not established by source evidence. That case requires its own reviewed decision; setting its return to zero would not establish complete positive-cost accounting.

Applying either historical correction requires separate approval. This proposal has not written to any database or external accounting document.

## F001: Average Cost transition state disagrees with FIFO integrity audit

Severity: High for campaign verification. Resolved with user-approved audit-only fix; not stock corruption.

Observed:

- The current state references an active Average Cost epoch.
- `switchInventoryCostMethod` creates an active epoch for either target method and assigns that epoch to the costing state.
- `auditFifoTenant` requires Average Cost to have no active epoch reference and no active epochs. The sandbox-scoped audit therefore reports one `invalid_costing_state` finding.
- The read-only FIFO switch preview returns no blockers. There are no negative stock rows or positive positions with missing positive costs.
- The audit emitted no other findings. Active-FIFO stock/layer balance is not tested by that audit while Average Cost is active; do not infer active FIFO reconciliation from this result.

Reproduction:

1. Run `npm run e2e:live:campaign:baseline` using reviewed paused-sandbox settings and a fresh run ID.
2. Run `npm run e2e:live:fifo:audit`.
3. Compare the recorded method/epoch with `src/lib/ims/costing/inventoryCostSwitch.ts` and the `invalid_costing_state` predicate in `scripts/lib/fifo-integrity-audit.mjs`.

Expected: supported Average Cost transition epochs and the verifier use one consistent contract; genuinely invalid ownership, epoch status/method or multiple active epochs remain blocked.

Implemented: accept initial Average Cost without an epoch and switched Average Cost with the one correct active epoch. Unsupported methods, wrong business/method/status, missing references and multiple active epochs remain invalid. No sandbox epoch or stock was rewritten. All 19 focused audit tests passed, including nine switched-Average-Cost cases. The scoped live audit now reports balanced with no findings.

## F002: Initial browser login navigation stalled

Severity: Medium; intermittent, root cause unconfirmed.

The first login request returned success but the browser stayed on `/login` for the 15-second navigation timeout. An independent fresh browser login and the subsequent official preflight both reached IMS, verified the expected Admin identity and completed successfully. The safe probe recorded no browser page errors or failed requests. Do not classify the original failure as fixed or automatically retry it away.

Evidence: local Playwright results for `campaign-20261007-preflight-001` and the later passing `campaign-20261007-preflight-002` run. The original initialized manifest remains unresolved; it was not silently marked clean.

## F003: P3 harness accepted the negative-stock override

Classification: test-harness defect, not unexplained product mutation. Corrected and independently retested.

The old blanket native-dialog acceptance handler accepted the app's explicit negative-stock prompt. The first request returned 409, but its accepted confirmation triggered a follow-up shipment request. A premature checkpoint incorrectly claimed atomic rejection before that follow-up committed. That checkpoint is superseded, not erased.

Read-only recovery established the actual shipment/backorder and verified the Xero Authorised invoice for AUD 0.50. Cleanup cancelled only the recorded child and completed one source-linked restocking return. Stock was restored; the return legitimately issued AUD 0.50 store credit. Manual customer-credit Xero posting is configured as none, so absence of a Xero credit note matches policy, not a failed sync.

The corrected test explicitly dismisses the negative-stock prompt and waits for the UI to finish handling the decision. Fresh run campaign-20261007-p3-average-reject-002 passed: SO remained Confirmed with two ordered and zero fulfilled, Xero stayed Draft at AUD 1.00, and inventory/layer/history fingerprints were unchanged. Supported cancellation deleted the Draft and restored commitments without issuing return credit. The preflight cleanup gate now recognizes only this exact run-owned, verified, unshipped and authorized case.

## Completed checks

- Exact sandbox/schema mapping and automation pause verified from the registry before scoped reads.
- Average Cost method/revision confirmed independently.
- Canonical Shopify ownership, legacy development-store identity and expected Xero organisation identity passed preflight.
- Real UI authentication and provider-status preflight passed on the second run.
- Baseline inspected 24,602 stock positions, including 8,520 positive positions; no negative or missing-positive-cost positions were found.
- Preview totals matched independent reads; before/after stock, layer-history and movement-cost fingerprints were unchanged.
- Original read-only baseline completed clean without stock mutation.
- P1 campaign-20261007-p1-average-001: one-unit AUD 1.00 PO receipt, Xero Draft bill readback, supported receipt undo and stock restoration passed.
- P2 campaign-20261007-p2-average-001: one-unit zero-stock/no-incoming SO, explicit unsourced acknowledgement, committed/unsourced workbench readback and Xero Draft AUD 1.00 passed; supported cancellation and cleanup passed.
- P3 campaign-20261007-p3-average-001: recovered harness-induced negative-stock partial shipment, exact held child, Xero Authorised AUD 0.50 and linked return cleanup verified. Not normal positive-stock shipment or atomic-rejection coverage.
- P3 campaign-20261007-p3-average-reject-002: fresh no-stock shipment rejected after declining override; unchanged persisted state and Xero Draft verified; cancelled and cleaned without a return credit.
- P1 campaign-20261007-p1-average-stock-002 plus P3 campaign-20261007-p3-average-ready-003: actual one-unit receipt, mixed ready/unsourced confirmation, physical partial shipment and held child, Authorised shipped amount, AUD 1.00 captured outbound cost, linked return and receipt undo passed for quantity/workflow. Independent return-cost oracle failed as F004.
- The two actual returns issued exactly AUD 0.50 each, once, through ledger-owned completion. Retained fixture customer credit increased by AUD 1.00 to AUD 2.90. No direct balance edits or money refunds were performed. Manual credit-note Xero posting policy remains none.
- Fixture On Hand, Incoming and Committed are restored to zero; no campaign open fixture PO/SO work remains after the supported cleanups. Historical accounting remains unresolved as F004.

## Regression gate status

The latest serial full suite produced 3,443 passes, five skips and one unrelated failure: Help context coverage for foresight:connections. Earlier parallel runs also had source-scanning timeouts; those source guards passed isolated. The audit-focused suite passed 19 tests. Do not change unrelated Help/user work to make this campaign green.

Authenticated baseline and the executed named scenario checks passed as scoped above. Modified support/spec diagnostics are clean. No production build was run; campaign support and audit changes do not modify application workflows or selectors. The full regression gate remains non-green, and the independent return-cost oracle failed despite stock-clean scenario manifests.

## Remaining phases

F004 requires separate product-fix and historical-correction decisions before claiming accounting reconciliation. Broader labeled multi-product/location/POS fixtures, PO amendments and partial receipts, incoming allocations/release/reassignment, SO moves/consolidation, IMS/POS builds, Shopify development transactions, FIFO matrix, costing transitions and viewport/table ergonomics remain unexecuted. The sandbox-only restore-point waiver does not waive tenant identity, integrity, history or external-target guards.

Retain reports/manifests privately. Do not commit credentials, session material, fixture IDs or customer payloads.
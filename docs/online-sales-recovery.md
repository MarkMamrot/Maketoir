# Online-sales recovery infrastructure

## Implementation status

The replacement workflow is wired behind per-business rollout controls. Unmigrated
and `legacy` businesses retain their existing behaviour. `validation` and `cutover`
businesses use shared recovery for webhooks, manual imports and fulfilment repair;
stale-browser accounting calls cannot fall back to historical imports. At verified
`cutover`, the existing POS permissions and IMS user-context responses also suppress
browser startup calls without disabling Xero functionality.

The user has authorised deployment, additive migration and Monsterthreads-only
activation **after verification passes**. No online-recovery production deployment,
migration or activation has been performed. The normal build and full unit suite
now pass in an isolated release tree that excludes unrelated working-tree edits.
Production and provider acceptance must still pass before cutover. Do not enable
another business. Creating the schema never inserts or changes rollout-control rows.

## Implemented components

- `src/lib/channels/onlineSyncPolicy.ts`: fixed reconciliation windows, overlap,
  visibility lag, validated page continuations, deterministic storefront scheduling,
  retry policy and provider-specific accounting readiness.
- `src/lib/channels/onlineSyncJobs.ts`: shared business claims and exact-channel,
  operation-specific job claims in the existing channel ledger. Both unexpired
  tokens fence renewals, checkpoints and completion.
- `src/lib/channels/shopifyReconciliationSlice.ts`: one discovery page and at most
  25 order applications per storefront slice, also respecting the invocation's
  remaining budget and deadline. Discovery is saved before application; failed
  orders remain pending. Actual lifecycle effects are supplied by the caller.
- `src/lib/channels/shopifyReconciliationPage.ts` and the new methods in
  `src/services/ShopifyService.ts`: bounded created-time baseline discovery,
  updated-time incremental discovery, native pagination tokens, complete-order
  retrieval and explicit historical order-scope checks. Recovery calls use their
  own finite-timeout, no-hidden-retry client; existing service calls are unchanged.
- Additive tenant state for rollout, channel coverage, order effects and dirty
  accounting days, and additive accounting-stage fields in the main batch table.
- Real-MySQL lease/migration coverage in CI, alongside existing provisioning tests.
- `src/lib/channels/shopifyOrderProcessing.ts`: shared event dispatcher used by
  the existing exact-instance webhook route, preserving its domain handlers,
  partial/full fulfilment distinctions, paid-effect ordering and error propagation
  for legacy businesses. Activated businesses durably queue authenticated delivery
  identities, fetch full provider snapshots and use the same coordinated owners as
  scheduled recovery. Pausing execution still permits durable webhook handoff.
  Authentication, eligibility, delivery claims and tenant binding remain in the route.
- `recoverShopifyOrderRefund` in `src/lib/channels/shopifyOrderRefund.ts`: an
  unwired recovery-only entry point which verifies an existing completed,
  exact-owned credit note before resuming loyalty, customer projection, financial
  status and accounting effects. Existing notes bypass stock processing entirely;
  missing notes still use the original transactional refund/stock owner.
  Conflicting amounts or unverifiable local completion fail rather than advancing.
  The ordinary webhook duplicate path remains unchanged.
- `syncCNXeroWithOutcome` in `src/lib/ims/xeroHooks.ts`: explicit blocked,
  not-required, queued or linked outcomes while preserving the original
  void-returning hook for existing callers. A linked Xero ID is not proof that
  all accounting stages finished, and queued/blocked work must remain unfinished.
  Recovery can defer loyalty's provider projection until after the local
  transaction is released, and retry that projection independently of the
  idempotent loyalty ledger mutation.
- `src/lib/channels/shopifyOrderSnapshot.ts`: full-order-only version descriptors
  and deterministic fingerprints of functional order fields. Dictionary key order
  and unused customer/marketing fields do not affect the fingerprint; financial,
  item, delivery, cancellation, refund, fulfilment and paid-effect inputs do.
  Persisted descriptors contain only exact owner IDs, a timestamp and a hash.
  The functional hash is separate from the provider update timestamp; unchanged
  inputs can advance the observed version without repeating effects. The
  loyalty paid-date fallback remains part of the functional projection.
- `src/lib/channels/shopifyOrderCoordination.ts`: recovery-only per-order claims
  with renewable tokens and frozen effect plans. Local domain callbacks receive
  one transaction connection: mutation and receipt commit or roll back together.
  Receipts survive worker replacement and prevent repeated committed effects.
  Completion requires every planned local effect or a verified exact-owner
  durable job handoff. It does not imply queued accounting has posted.
  Activated live entry points and scheduled recovery share these primitives.
- `src/lib/channels/shopifyOrderLocalEffects.ts`: coordinated refund and
  fulfilment adapters. Exact order/refund/shipment identities select frozen
  effect keys; the existing CN/stock, partial fulfilment and shipment owners now
  expose caller-owned transaction functions. Their local changes and the
  coordinator's receipt use one connection and one commit. Existing standalone
  wrappers retain transaction ownership for live callers.
  Local refund recovery verifies completed CN ownership and amounts before
  acknowledgment, including notes created before recovery acquired its lease.
  Metadata-only shipment updates do not repeat stock, and order-level fulfilment
  fallbacks use only outstanding quantities. Loyalty, Shopify projections and
  Xero calls are excluded from these local transactions.
- `src/lib/channels/shopifyOrderRecovery.ts`: full-source orchestration of
  caller-owned import/update/cancellation, local fulfilment/refund effects,
  financial dirty-day changes and verified exact-hash downstream jobs.
  Unverifiable historical stock, mapping/provenance conflicts and unsupported
  fulfilment history are quarantined instead of manufacturing stock evidence.
- `src/lib/channels/shopifyOrderRecoveryEffects.ts`: idempotent paid/refund
  loyalty recovery, independently replayable provider projections and explicit
  credit-note accounting evidence. No customer refund is created.
- `src/lib/channels/shopifyGiftCardRecoveryEffects.ts`: one coalesced gift-card
  job per storefront, with bounded native discovery and transaction-history
  pages, namespaced ledger receipts and complete per-card financial checkpoints.
  It requires `read_gift_cards` and `read_gift_card_transactions`. Missing scope
  or unverifiable balance evidence blocks rather than claiming completion.
- `src/lib/channels/onlineRecoveryWorker.ts`: rotating registry dispatch,
  persisted UTC last-served fairness, shared tenant leases, a 45-second soft
  budget, at most 25 applications per storefront and 100 per invocation, and at
  most 25 jobs per business. Multiple small durable jobs can drain in one slice;
  mixed snapshot/downstream work shares the same per-store allowance.
  Unready automatic accounting cannot starve the initial Shopify baseline.
  Baseline completion requires a separate update-time catch-up interval;
  checkpoint and coverage/job completion changes are transactional.
- `src/lib/xero/onlineDailyAccountingRecovery.ts`: staged exact-channel/day
  accounting, frozen-input evidence, dirty generation propagation and review-only
  handling of newly discovered financial changes to already-posted days.
  Required reconciliation cannot be bypassed by administrators. Native channels
  do not wait on Shopify baselines, but retain their own posting/readiness guards.
- Recovery status/control routes and the Sales Channels panel expose coverage,
  job failures and total/truncated order-review counts. Admin/SuperAdmin can
  pause/resume or request retries; Advisors have status access only. Retrying a
  job never clears sticky order/day reviews or steals a live lease.
- `.github/workflows/online-recovery.yml`: five-minute bounded dispatch, with
  durable staggered 15-minute storefront eligibility and seven-day anti-entropy.
  The separate `online-sales` Cron pause suppresses automatic accounting without
  stopping order recovery or separately authorised manual accounting.
  Business automation/deletion is rechecked before work.

## Invariants

- No successful timestamp is inferred from an unverified existing watermark.
  Baseline work starts from the configured eligible history.
- A continuation retains its frozen interval, current native cursor and remaining
  order references. It contains IDs and update timestamps, not customer payloads.
- A valid empty interval can complete. A malformed response or oversized page
  cannot be interpreted as an empty successful result.
- Incremental filtering uses update time, so an old order changed now remains
  discoverable. Baseline discovery alone uses creation time.
- History older than Shopify's normal order-access window requires
  `read_all_orders`; absence of that scope blocks the baseline.
- Lease ownership cannot be renewed after expiration. A stale owner cannot
  checkpoint, finish, fail or clear a successor's lease.
- New jobs explicitly use UTC eligibility timestamps even when the MySQL session
  timezone is not UTC. Existing inventory/publication operations are not reclaimed
  or modified by the recovery-specific claims.
- Fairness uses `last_run_at`, explicitly written in UTC on business claim, not
  the session-timezone-dependent implicit `updated_at` timestamp.
- Gift-card checkpoints whitelist provider identities, native cursors, versions
  and required financial scalars, never raw provider/customer payloads. Terminal
  blocked work is retained and excluded from automatic selection until explicit
  retry; null terminal continuation must not restart discovery automatically.
- Gift-card ledger transactions require the worker's supplied commit guard before
  local writes and immediately before commit. Both checks verify the exact live
  job/business lease on the caller's connection; no provider call occurs inside
  that transaction. Accounting completion also fences main-business availability
  and locks tenant control before finalisation.
- Durable retries retain continuation state and respect a longer provider
  Retry-After. Reaching the alert threshold must not discard the job.
- A database fence alone cannot prevent an expired worker's in-flight external
  request. Domain idempotency and external-result reconciliation remain required
  before enabling actual effects.
- Per-order local transactions check the exact snapshot/token and rollout/pause
  gate under a row lock, then check the live fence again before committing their
  receipt. An expired worker cannot commit its local mutation after losing that
  fence. Provider requests must never run inside these transaction callbacks.
- Older full snapshots cannot replace newer state. Equal provider timestamps
  with different fingerprints require review, never arbitrary hash ordering.
  A changed snapshot with committed partial effects retains those receipts for
  review. A discovered snapshot with no committed effect can be replaced safely.
  Identical functional inputs retain their existing receipts across newer source
  versions. A crash after the last receipt but before completion can be repaired
  from those committed receipts without repeating the old effects.
  Partial webhook payloads must not advance the full-snapshot version fence.

## Schema installation

The canonical tenant definitions are in `scripts/ims-schema.sql`; fresh tenant
provisioning reads those definitions and validates their schema contracts.
Canonical main accounting additions are in `scripts/setup-xero-tables.sql`.

`scripts/online-sync-schema.mjs` provides narrow installers. The tenant catch-up
runner exposes `--online-sync-only`, which:

1. Rejects combinations with other table, repair, catalogue or stock-cost modes.
2. Resolves registered/fallback tenant schemas using the existing runner.
3. Installs the main accounting additions and tenant recovery state.
4. Uses a bounded session metadata-lock wait.
5. Skips unrelated repairs, broad verification and historical ownership backfills.
6. Leaves rollout rows/settings and all operational data unchanged.

Existing recovery tables are upgraded with nullable per-order lease columns and
the nullable UTC business last-served field;
their version, effect and review records are retained. The broad tenant catch-up
runner also registers these columns, and fresh provisioning reads them from the
canonical tenant definition.

Do not use the broad Xero setup script as a substitute for a scoped migration:
that script also contains historical ownership work. Existing-definition audits
and an approved production preflight are still required before a live migration.

## Remaining acceptance and rollout

- Verify hosted CI and deployment for the isolated recovery release.
  Normal production build, full local unit tests and real-MySQL fencing checks
  have passed; live acceptance remains separate.
- Validate the authenticated interface and operational read-only preflight,
  including provider history/gift-card access and unambiguous stock/accounting
  evidence. Mocked transport tests alone do not establish provider permissions.
- Deploy disabled code, independently audit and rerun the narrow additive
  migration, and activate only Monsterthreads validation.
- Monitor the bounded baseline and catch-up, durable downstream work, failures,
  review queues and accounting policy invariants. Advance to cutover only after
  trustworthy readiness. Missing history, unresolved reviews or uncertain
  external outcomes are stop conditions, not reasons to force readiness.
- Preserve all other businesses in legacy mode. Broad expansion is not authorised.

Canonical Help describes the workflow conditionally on activation; it does not
claim that the production cutover has occurred.

## Coordination validation

The coordination-primitives run passed 516 tests, including 26 real loopback-only MySQL
tests (18 per-order coordination and eight business/job fencing tests). Coverage
includes concurrent claims and effect replay, worker replacement, expiry before
mutation and during a transaction, atomic rollback, exact-owner job handoffs,
source-version conflicts, unchanged-version fast-forwarding, interrupted final
completion, non-UTC SQL sessions and state-preserving additive migration/reruns.
The private test server and downloaded tooling were removed afterwards.

The new coordination modules and tests have no TypeScript diagnostics, and their
targeted lint and migration syntax checks pass. Repository-wide type checking
still has pre-existing failures. This slice does not establish that live domain
handlers share these transactions or that startup work has been replaced.

## Local domain transaction validation

The subsequent focused run passed 110 tests, including 12 actual loopback-only
MySQL tests using the complete canonical tenant schema and non-UTC sessions.
These execute the real refund, stock, fulfilment and shipment owners through the
coordinator, rather than replacing domain SQL with mock writes.

Coverage includes concurrent effect replay, replacement workers, partial shipping,
outstanding-only fallback, tracking-only updates, value-only refunds, existing CN
reuse and rejection of changed, incomplete or differently owned CN evidence.
Injected final-fence loss rolls stock, CNs, shipments, fulfilment operations and
receipts back together. Shipment persistence failure also rolls back earlier stock
writes. Global database access, nested connection acquisition and downstream
loyalty/provider calls fail explicitly in these integration tests.

Transactional refund verification locks inventory cost state before the sales
order and completed CN evidence, preserving the stock owner's lock order.
A real concurrent-edit test proves verification waits for locked CN evidence and
rejects changed amounts before acknowledging the effect.

The full regression run before that final evidence-lock strengthening recorded
5,927 passes, 29 pending and the same two independent failures: the existing
shipping migration-source assertion and the concurrently edited model-asset Help
context. Final focused tests passed after the strengthening.
Targeted lint passes; the legacy repository retains exactly the same 215 lint
findings as HEAD. Final type checking has no diagnostics in the new modules,
tests or extracted refund code; unrelated repository diagnostics remain.
Standalone Next production compilation passed for that earlier transaction slice.
The normal build remains blocked
by the unrelated Help context targeting a missing section.

The isolated test schemas, server, downloaded tooling and build output were
removed. These results establish local transaction safety, not complete live
webhook/manual/recovery coordination or a completed startup cutover. The subsequent
integrated implementation is described above; its final acceptance and production
rollout remain separately gated.

## Integrated runtime validation before gate resolution

The final full-suite run recorded 6,315 passes, 29 pending and two independent
failures: the shipping migration-source assertion and the model-preview Help
context assertion. All 90 actual loopback-only MySQL tests passed across the seven
recovery integration files, including worker throughput/deadlines, mixed-job
budgets, order lifecycle replay/rollback, gift-card commit guards and accounting
stage/dirty-generation races.

Queue-aware import and daily-accounting feedback is covered by UI tests: a queued
response never claims import or Xero posting has completed. Recovery Cron gate
lookup failures fail closed and report a Runtime Issue. Impossible configured
calendar dates are rejected before recovery can claim or mutate an order.

Targeted changed-code lint passes. The final actual TypeScript run introduced no
diagnostic messages against the recorded repository baseline; the three SQL
parameter diagnostics in the new accounting integration test were corrected.
Repository-wide type checking still fails on existing diagnostics. Earlier
standalone Next production compilation passed, but the required normal build
still fails because the independent model-preview Help context targets a missing
section. Standalone compilation is not a substitute for that gate.

No online-recovery production deployment, migration, activation or cutover has
occurred. These local results do not establish authenticated live UI behaviour,
provider access or production baseline readiness.

## Release gate resolution

The model-preview guidance existed as a third-level heading, while Help context
targets require a second-level section. Its working-tree heading was corrected
without changing the other work. The shipping assertion was updated to exercise
the actual guard, including exclusion of consignment-only runs; shipping runtime
behaviour was not changed.

An isolated release tree excludes the unrelated model-preview UI, Help and test
edits and regenerates its own canonical indexes. Both its normal production build
and full unit suite pass. Read-only production preflight confirms five mapped
tenant schemas, an active Monsterthreads storefront with a configured historical
start and warehouse, and the required order-history and gift-card scopes. No
credential rotation was needed. GitHub has the required existing scheduled-job
and package-access secret names. None of these checks activates recovery.

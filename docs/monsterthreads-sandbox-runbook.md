# Monsterthreads development sandbox runbook

The sandbox is a separate tenant in the production Solvantis deployment. It contains the operational Monsterthreads IMS/POS snapshot, but excludes the historical Cin7 sales import and unreferenced Shopify retail contacts. It starts with no external credentials or platform identities. Shared scheduled automation remains paused unless explicitly enabled for a bounded test.

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

# IMS Collation Migration Runbook

This runbook covers the controlled normalization of shared textual machine IDs. It does not convert human-entered text columns.

## Current Safety Boundary

The migration tool supports read-only audit, verification, data preflight, SQL plan generation, and guarded apply/resume for registered tenants. Production apply/resume additionally requires `--production-confirmed`; omitting it fails closed.

The retired `fix-all-collations.mjs` script must not be restored or used. Its broad conversion behavior would rewrite unrelated human text.

## Read-Only Commands

Audit every registered IMS schema:

```powershell
npm run schema:collations:audit
```

Audit one registered schema and run count-only identity preflights:

```powershell
npm run schema:collations:audit -- --schema=readyedu_ExampleIMS --preflight
```

Generate an unexecuted SQL plan after passing preflights:

```powershell
npm run schema:collations:plan -- --schema=readyedu_ExampleIMS
```

Reports and plans are written under `tmp/collation-audits/`. They can contain schema names, row estimates, and aggregate mismatch counts. Do not commit them.

## Plan Review Gate

Before approving any apply implementation or execution, verify:

1. The schema is registered to the intended business.
2. Ownership and relationship case-only mismatch counts are zero.
3. Existing exact orphans and unrelated historical business IDs are understood but are not silently repaired by this migration.
4. The SQL contains no broad table character-set conversion.
5. Every `MODIFY COLUMN` targets a contracted machine identity.
6. Foreign-key drop and add counts match, preserving column order and delete/update rules.
7. The source metadata hash still matches a fresh audit.
8. The plan hash matches the reviewed statement list.

## Sandbox Apply Prerequisites

Do not run apply until all of the following are true:

- Verified Railway backup or point-in-time restore checkpoint.
- A tested restore rehearsal against a disposable or cloned schema.
- Write suspension for the Railway application, cron workflows, workers, webhooks, and detached jobs.
- Active-transaction and lock inspection before the first DDL statement.
- The registered sandbox business has `automation_paused = 1`.

Apply uses an advisory schema lock, requires zero other active InnoDB transactions, sets short metadata/InnoDB lock waits, and journals every operation before execution. On retry it verifies actual table/FK state before deciding whether to skip, reconcile, or execute a step.

## Sandbox Apply

Generate and review a fresh plan. Record its source metadata hash and plan hash, then construct the confirmation token shown by the tool:

```powershell
npm run schema:collations:plan -- --schema=readyedu_ExampleSandboxIMS
```

After writes are suspended, apply the exact reviewed plan:

```powershell
npm run schema:collations:apply -- `
	--schema=readyedu_ExampleSandboxIMS `
	--metadata-hash=<reviewed-metadata-sha256> `
	--plan-hash=<reviewed-plan-sha256> `
	--backup-reference=<non-secret-verified-backup-reference> `
	--confirm=APPLY-COLLATION-readyedu_ExampleSandboxIMS-<first-12-plan-hash> `
	--maintenance-confirmed
```

If execution is interrupted, do not generate a replacement plan. Resume the exact journaled plan:

```powershell
npm run schema:collations:resume -- `
	--schema=readyedu_ExampleSandboxIMS `
	--metadata-hash=<original-reviewed-metadata-sha256> `
	--plan-hash=<original-reviewed-plan-sha256> `
	--backup-reference=<same-backup-reference> `
	--confirm=APPLY-COLLATION-readyedu_ExampleSandboxIMS-<first-12-plan-hash> `
	--maintenance-confirmed
```

The journal tables are `_solvantis_collation_migration_runs` and `_solvantis_collation_migration_steps` inside the sandbox schema. They contain schema-operation metadata only, not customer payloads.

## Post-Apply Verification

After a future approved sandbox apply:

1. Run `npm run schema:collations:verify -- --schema=readyedu_ExampleIMS` twice; both runs must report no drift.
2. Compare identity row counts and checksums with the pre-migration snapshot.
3. Repeat relationship and ownership preflights.
4. Confirm every dropped foreign key was recreated.
5. Run focused POS, loyalty, Shopify, FIFO, native-shop, and shipping tests.
6. Run the full test suite and production build.
7. Compare high-volume query plans and latency before considering production rollout.

For an explicitly approved production tenant, use the same reviewed single-schema apply/resume command and add:

```powershell
--production-confirmed
```

Apply production tenants sequentially. Verify each tenant twice and confirm its journal and foreign keys before starting the next tenant.
# IMS Collation Migration Runbook

This runbook covers the controlled normalization of shared textual machine IDs. It does not convert human-entered text columns.

## Current Safety Boundary

The migration tool currently supports read-only audit, verification, data preflight, and SQL plan generation. It does not support or perform `--apply`.

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

Apply mode must not be added or used until all of the following exist:

- Explicit schema and confirmation-token requirements.
- Fresh metadata-hash and plan-hash validation immediately before execution.
- A durable per-statement journal with interrupted-operation reconciliation.
- Verified Railway backup or point-in-time restore checkpoint.
- A tested restore rehearsal against a disposable or cloned schema.
- Write suspension for the Railway application, cron workflows, workers, webhooks, and detached jobs.
- Active-transaction and lock inspection before the first DDL statement.
- Table-specific lock and duration abort thresholds.

## Post-Apply Verification

After a future approved sandbox apply:

1. Run `npm run schema:collations:verify -- --schema=readyedu_ExampleIMS` twice; both runs must report no drift.
2. Compare identity row counts and checksums with the pre-migration snapshot.
3. Repeat relationship and ownership preflights.
4. Confirm every dropped foreign key was recreated.
5. Run focused POS, loyalty, Shopify, FIFO, native-shop, and shipping tests.
6. Run the full test suite and production build.
7. Compare high-volume query plans and latency before considering production rollout.

Production rollout remains a separate approval after the sandbox migration and restore rehearsal succeed.
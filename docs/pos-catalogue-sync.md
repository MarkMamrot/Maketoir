# POS catalogue sync

The versioned catalogue endpoint keeps complete POS variant records but sends only changes. Legacy clients remain supported. The new protocol is disabled until the tenant's `pos_catalogue_sync_v2` IMS setting is `yes`; keep it disabled during migration and verification.

## Migration and rollout

Production migration and enablement require separate operational approval. The scoped command is:

```powershell
node scripts\catchup-schema-all-tenants.mjs --pos-catalogue-only
```

The existing `--schema=registered_schema` selector can restrict an approved run to one registered tenant. This mode creates only the four catalogue metadata tables and their source-table invalidation triggers, seeds variant generations, and verifies installation. It does not enable the rollout setting, alter source stock/prices, or run unrelated historical repairs. Fresh provisioning installs the same definitions.

Apply this additive migration before deploying the new POS code, then verify the deployed application before enabling incremental sync. Catalogue-only migration sessions use a five-second metadata-lock wait limit; if a busy transaction prevents installation, let it finish and re-run the scoped command rather than allowing an indefinite deployment-time wait.

Enable in a controlled sandbox first, and confirm the deployed POS browsers support Web Locks (current Chrome, Edge, Firefox and Safari). Unsupported browsers retain legacy operation while the protocol is disabled; enablement produces an explicit browser-update warning before any new consumer or full lease is created. Existing timestamp-based catalogues need a one-off generation baseline; cached trading remains available with a freshness warning during this rebuild. Missing schema/readiness is an explicit reported failure, not request-time DDL or a silent empty catalogue. Disable the tenant setting to return to the legacy sync path.

## Correctness model

- Per-variant opaque generations coalesce changes transactionally with the source mutation. Never interpret a timestamp or an auto-increment ID as transaction commit order.
- Each browser's business/location cache has an independent consumer identity. All tabs sharing that cache use the same browser lock.
- A delivery receipt stores the exact generations and projection snapshot delivered. Only acknowledge it after the matching IndexedDB transaction commits.
- An acknowledgement of an older generation cannot acknowledge a newer concurrent mutation. Lost acknowledgements replay the persisted receipt.
- Parent deletion captures removal evidence before foreign-key cascades, which do not invoke child deletion triggers.
- Promotion-bearing variants are reconsidered on a business-date change even without a source update. Build and image dependencies invalidate affected output variants.
- Last-image removal is explicit in the variant record. CDN image bytes remain managed by the existing service worker.
- Local optimistic stock patches are marked for explicit reconciliation and must not overwrite identity/prices from a newer catalogue delivery.

Do not truncate or replace source tables while the protocol is enabled. Row triggers cannot observe `TRUNCATE`, disabled triggers, or direct metadata edits. For such maintenance, disable the rollout, invalidate `pos_catalogue_control.epoch` for affected businesses, verify/reseed tracking with the scoped migration, and establish new full baselines before re-enabling. Ordinary application DELETE and update operations are captured without this maintenance procedure.

## Scheduling and leases

After a successful full rebuild, the next automatic rebuild is eligible one calendar month later in the business timezone. Month-end days clamp to the target month's last day. A due cache persists a random target zero to two hours after authenticated opening; reloads cannot resample it.

The business-wide database lease applies across replicas, independent cache consumers, and legacy full-download requests while the new protocol is enabled. Manual/bootstrap requests bypass the monthly timer but not exclusion. Full deliveries renew the fenced lease before browser storage and every 45 seconds while applying; expired owners cannot renew or acknowledge. Legacy requests hold their lease through server-side projection, since old clients do not send browser-persistence acknowledgements.

A due-day opening anchor is retained for that business day. A calendar-month anniversary inside its two-hour window can delay the target until eligibility; an anniversary outside that window waits for a later authenticated opening. Reloading never moves a pending target. A closed/offline browser cannot run maintenance, and lease contention can delay execution beyond the randomized target. Only successful acknowledgement after durable browser storage advances the full-rebuild checkpoint, using the server's completion timestamp rather than snapshot creation.

## Verification

Unit tests cover calendar/DST boundaries, payload guards, selective IndexedDB writes, atomic rollback and receipt recovery. Real MySQL tests are opt-in, connect only to loopback, create a uniquely named disposable schema, and never use application environment credentials:

```powershell
$env:POS_CATALOGUE_TEST_PORT = '33417'
npm test -- src\lib\pos\__tests__\catalogueSync.integration.test.ts
```

The local test server must be a private disposable MySQL server accepting the test root connection. Tests cover triggers, parent cascades, late commits, rollbacks, receipts, independent consumers, shared leases, promotions, build dependencies, image removal and a populated-catalogue payload comparison.

Server `[pos-catalogue]` logs record mode, record/removal counts and projection duration without product/customer payloads. Client operational failures go through Runtime Issues. Compare authenticated real-terminal startup and first-scan timings before and after enabling; synthetic payload tests alone are not production latency evidence.

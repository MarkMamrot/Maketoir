# Solvantis / Marketoir

Business management platform for Australian retail, covering POS, inventory, purchase and sales orders, Shopify, Cin7, Xero, reporting, and marketing operations.

## Order Shortfall Status

Customer sales orders now support incremental partial fulfilment:

- Enter the quantities shipping now; unshipped quantities remain outstanding on the original SO.
- Stock on hand and committed stock decrease only by each shipment delta.
- Exact retries are idempotent and cannot deduct stock twice.
- Partial shipments do not Authorise the Xero invoice. The configured fulfilled action runs after the final shipment.

Example: for 100 units ordered and 70 shipped, record 70. The SO becomes `partially_fulfilled` with 30 still committed. Later, ship the remaining 30 to complete it.

The **Resolve Outstanding** action is available from partially fulfilled customer SOs and partially received supplier POs:

- Leave the remainder open, cancel it, or move it to a held child backorder.
- Unpaid Draft/Authorised Xero documents are resized when Xero permits it.
- Paid/part-paid value is corrected with a no-restock credit note. By default it is Authorised; the optional Draft-review policy leaves it in Xero Draft until an administrator continues it from Sync History.
- Customer credit can be refunded, left unapplied, or reserved for the held child invoice.
- Supplier credit requires a supplier reference or evidence note and can be refunded, left unapplied, or reserved for the held child bill.
- Reserved credit is allocated only after the child Xero invoice/bill is Authorised.

Example: 100 units ordered, 70 shipped, and 30 cancelled. Solvantis closes the source SO at 70 and releases only the remaining commitment. If the $100 invoice was paid, it creates a $30 no-restock credit note and performs the selected settlement. Creating a backorder instead moves the 30 to a held child without shipping stock twice.

Supplier example: 100 units ordered and 70 physically received leaves 30 incoming. Leave the PO partial for a short delay, cancel the remainder to remove those 30 from incoming stock, or create a held child PO that owns the existing 30 incoming units. A paid supplier shortfall requires the supplier's credit reference or evidence note before refund, unapplied-credit, or child-bill reservation settlement.

Operational rules:

- Release a held child from the Backorders workspace; this runs the normal Confirmed Xero policy and normally creates a Draft invoice/bill.
- Freight and order-level discount stay on the source order. Child orders and shortfall credits contain delayed merchandise only, avoiding duplicate freight.
- A child with reserved or allocated Xero credit cannot be merged or cancelled until the credit is reconciled.
- The source and child order detail screens show the shortfall credit separately from the order total, including settlement status and a link to the original Xero credit note.
- An allocated backorder credit can be unallocated from the order screen. Available credit can then be refunded or allocated to another compatible Xero invoice/bill; each change is append-only and replay-protected.
- If Xero fails after the local quantity resolution, do not create a second manual refund or credit note. Open **Xero → Sync History**, find the Customer/Supplier Shortfall row, fix the named problem, and choose **Retry Xero**. Unknown outcomes require checking Xero first.
- With **Review shortfall credits as Draft in Xero** enabled, inspect the linked Draft from Sync History and choose **Authorise & continue** to perform the originally selected refund, unapplied-credit, or reservation action.

## Xero Operations

### Document policy

Configure future Xero transitions under **Xero → Ledger Mapping → Document Status & Payments**. `No sync` leaves that event in IMS, `Draft` creates an editable Xero document, and `Authorised` creates one ready for settlement. A payment may safely promote a linked Draft before applying the payment.

The transparent starting presets are **Bookkeeper review**, **Balanced automation**, and **Higher automation**. Applying one shows an exact field diff and populates ordinary settings; there is no persistent hidden mode. Every actual change records an immutable actor-aware before/after event. Policy changes affect future transitions only and never rewrite existing Xero documents.

### Xero-aware edit matrix

| Live Xero state | Financial or Xero-visible edit |
| --- | --- |
| Draft or Submitted | Allowed and synchronously mirrored |
| Authorised, unpaid, uncredited, outside lock date | Supported PO/SO edits are allowed after live preflight |
| Part-paid, paid, credited, voided, deleted, locked, or unverifiable | Blocked; use a supported credit, refund, cancellation, or reconciliation workflow |
| Local-only field | Allowed |
| Admin override of a blocked PO/SO edit | Requires a reason and creates a Needs Attention issue; it does not imply Xero matches |

### Sync History

**All activity** is immutable sync history. **Needs attention** is the current reconciliation workspace. It compares expected IMS facts with live Xero state, mapping readiness, and durable action outcomes.

- **Recheck** reads Xero and mapping state without posting or changing accounting documents.
- **Retry Xero** resumes a safe replay-protected operation and skips completed steps. Admin/SuperAdmin only. Unknown outcomes are never blindly retried.
- **Authorise & continue** promotes a deliberately Draft shortfall credit and completes its saved settlement. Admin/SuperAdmin only.
- **Ignore** accepts the current exact mismatch with a required reason. A changed mismatch fingerprint reopens it.
- **Send to Accounts** emails safe summaries of selected open issues without changing issue or accounting state.
- Admins and Advisors can inspect, Recheck, Ignore, export, and Send. Accounting mutations and policy/mapping changes remain Admin/SuperAdmin-only.

Accounts recipients and optional daily/weekly digests are configured in Needs Attention. Digests use the selected local timezone/schedule, contain only currently open issues, and cap each delivery at 200 issues.

### Mapping readiness

Ledger Mapping labels accounts, active PO/SO payment methods, POS clearing, known gateways, and tracking as required or optional from the enabled document policy. Saves and reconciliation checks validate references against live active Xero values.

- Missing required and stale saved mappings appear as actionable Needs Attention issues.
- Unused optional mappings do not become errors, but an already saved optional mapping is flagged if its Xero reference becomes stale.
- Missing POS clearing blocks only that location/payment method's Xero posting. It never blocks register or EOD closure.

Examples:

- For a total mismatch, Recheck, compare both systems, correct the source of truth, then Recheck again. Ignore only an intentional exact difference and record the reason.
- For an archived clearing account, choose an active account in Ledger Mapping before retrying payment.
- For an unknown payment outcome, inspect Xero before any retry. Never create a second manual payment merely because Solvantis did not receive the response.

### Rollout order

1. Apply `node scripts/setup-xero-tables.mjs` before deploying code that depends on policy history or reconciliation tables. The script is guarded and safe to rerun.
2. Deploy the application and open Ledger Mapping. Review the current policy and live mapping readiness before changing presets.
3. Run a manual **Recheck** and review the initial Needs Attention results before enabling scheduled scans or email digests.
4. Configure accounts recipients, then opt into daily or weekly digests only after the initial queue is understood.
5. Reconnect Xero when required scopes have changed, and exercise Draft, Authorised-unpaid, part-paid, paid, credited, voided/deleted, and locked-period examples in a test organisation before production accounting changes.

## Required Migration

To install partial fulfilment and outstanding-resolution tables in every configured tenant, run:

```powershell
node scripts/catchup-schema-all-tenants.mjs
node scripts/setup-xero-tables.mjs
```

This installs the `partially_fulfilled` SO status, durable operation records, settlement/reservation tables, provenance, and required enums across all configured tenants. The migration is guarded and safe to re-run.

## Development Checks

```powershell
npm test
npm run build
```

See [project_overview.md](project_overview.md) for architecture and roadmap, and [project_memory.md](project_memory.md) for deployment history and operational constraints.

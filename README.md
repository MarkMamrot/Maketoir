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
- Paid/part-paid value is corrected with a no-restock Authorised credit note.
- Customer credit can be refunded, left unapplied, or reserved for the held child invoice.
- Supplier credit requires a supplier reference or evidence note and can be refunded, left unapplied, or reserved for the held child bill.
- Reserved credit is allocated only after the child Xero invoice/bill is Authorised.

Example: 100 units ordered, 70 shipped, and 30 cancelled. Solvantis closes the source SO at 70 and releases only the remaining commitment. If the $100 invoice was paid, it creates a $30 no-restock credit note and performs the selected settlement. Creating a backorder instead moves the 30 to a held child without shipping stock twice.

## Required Migration

To install partial fulfilment and outstanding-resolution tables in every configured tenant, run:

```powershell
node scripts/catchup-schema-all-tenants.mjs
```

This installs the `partially_fulfilled` SO status, durable operation records, settlement/reservation tables, provenance, and required enums across all configured tenants. The migration is guarded and safe to re-run.

## Development Checks

```powershell
npm test
npm run build
```

See [project_overview.md](project_overview.md) for architecture and roadmap, and [project_memory.md](project_memory.md) for deployment history and operational constraints.

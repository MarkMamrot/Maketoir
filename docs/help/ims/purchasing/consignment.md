---
{"id":"ims-consignment","title":"Consignment stock and supplier statements","audiences":["ims"],"capability":"orders","screen":"IMS Consignment","product":"ims","format":"task","parentId":"ims-supplier-work","relatedTopics":["ims-feature-toggle"],"contexts":["report-consignment-activity","consignment-statements"],"contextSections":{"report-consignment-activity":"Consignment Activity","consignment-statements":"Managed settlement statements"},"order":47,"summary":"Identify supplier-owned consignment stock, report period activity and optionally manage supplier settlement statements without creating purchasing invoices or recording payments.","lastReviewed":"2026-10-16","owner":"purchasing","quickSections":["Main operations","Consignment Activity","Managed settlement statements"],"navigation":{"category":"purchasing","label":"Consignment stock and settlement","sections":[{"heading":"Main operations","label":"Set up consignment suppliers"},{"heading":"Consignment Activity","label":"Report consignment activity"},{"heading":"Managed settlement statements","label":"Manage supplier statements"}]}}
---
# Consignment stock and supplier statements

## Main operations

1. An Admin or SuperAdmin opens the supplier in **Contacts** and selects **Consignment supplier**.
2. Assign the supplier as the product's default supplier. The ownership setting applies supplier-wide from that point onward; changing it does not rewrite earlier ownership.
3. Receive and return goods through the usual purchase-order and supplier-return workflows. Consignment documents display a **stock-only** notice.
4. Open **Reports > Consignment Activity** for period reporting, regardless of whether optional tracking is enabled.
5. To manage settlement statements, first review **Settings > Business & Team > Feature Toggle > Consignment Tracking**.

Consignment goods belong to the supplier until sold. Internal stock costs remain available for operational costing, but consignment is excluded from owned inventory valuation. Receiving consignment goods does not create an amount payable, supplier payment or accounting bill. Consignment supplier returns move goods without creating an accounting credit.

Consignment purchase orders use **AUD with exchange rate 1**, matched stock lines for one supplier, and no freight, landed costs or header discount. Per-line supplier-cost discounts remain available. Supplier returns use linked received PO lines, move stock only and have zero supplier-money totals while retaining source costs. Supplier payments and early-payment discount credits do not apply.

Keep supplier settlement, external accounting and payment reconciliation separate from receiving and returns. A statement is not a purchase order, supplier invoice or payment.

## At a glance

| Need | Open or choose | Result |
|---|---|---|
| Identify supplier-owned goods | Contacts > Consignment supplier | Associated products inherit consignment ownership |
| Review a month without tracking | Reports > Consignment Activity | Read-only activity, with CSV and PDF exports |
| Manage settlement records | Purchasing > Consignment Statements | Reviewed Draft, Finalised and Accounted stages |
| Stop managed settlement work | Feature Toggle > Consignment Tracking | Reviewed external handover; history remains read-only |

> **Important:** Accounted means recorded externally, not paid. Neither a stock receipt nor a settlement statement creates a supplier bill or payment.

## Before you begin

Select the intended business and confirm the supplier, product assignments and captured costs. Only Admins and SuperAdmins can change supplier ownership, transition tracking or mutate managed statements. Reporting and historical statement review remain available to authorised IMS users.

Before enabling tracking, reconcile earlier activity externally and choose an eligible business-local cutover date. Do not assume earlier sales are unpaid.

## Step-by-step

1. Set the supplier's consignment ownership and assign the supplier to its products.
2. Receive goods using a stock-only purchase order; review its supplier costs and quantities.
3. Select a period in Consignment Activity and investigate cost, tax or ownership exceptions.
4. Export activity for external reconciliation, or review the tracking cutover if managed statements are required.
5. With tracking enabled, create a Draft for one supplier and explicitly choose whether to include earlier eligible unallocated activity.
6. Review the Draft, refresh stale evidence and Finalise only after resolving exceptions.
7. Export or explicitly email the statement. Record supplier costs externally once, then mark Accounted with the external reference and date.
8. Reconcile actual supplier payments separately.

## Ownership filters and stock summaries

Use **Ownership: Owned / Consignment / All** in Stock Levels and Inventory Valuation. Owned is the default. Owned totals represent your inventory; consignment quantity and indicative supplier-cost value are shown separately as **not owned inventory**. Selecting All does not combine supplier-owned value into owned stock value. Historical evidence that cannot establish ownership is labelled unknown rather than assigned today's supplier setting.

Internal captured costs and margin evidence remain available in Sales & COGS Traceability. **Stock Ownership** can distinguish Owned, Consignment or Mixed source costs; missing immutable evidence is not silently called Owned. Accounting posting excludes consignment COGS and reports excluded cost, quantity and movement counts separately. Normal sales, customer refunds, revenue and GST accounting continue unchanged.

## Consignment Activity

The report starts with the previous calendar month. Use the shared date picker for calendar presets, rolling windows or a custom range, then optionally filter by supplier, location or channel.

Review sold quantities, refunds, net quantities and supplier cost totals, including the tax breakdown. Investigate listed exceptions before relying on the results. Export the current selection as **CSV** or **PDF**.

Use **Source activity** to inspect source references, locations, channels and original-event links. Signed evidence-backed corrections appear as Adjusted quantities rather than being presented as new sales or refunds.

This is an **activity report**, not a settlement or outstanding balance. It does not claim that reported activity is unpaid or Accounted. Activity reporting remains available when Consignment Tracking is off.

Source activity requires an actual captured supplier cost and unambiguous received supplier tax evidence. Missing costs or mixed historical receipt-tax evidence require review rather than a fallback to today's cost or tax setting. Quantity refunds retain original source costs, including refunds without restocking; restocking can be blocked if the original ownership changed or the source quantity is ambiguous.

Completed consignment POS sales cannot be manager-edited or voided. Use a linked quantity return and a new sale when a correction is needed.

Consignment POS refunds cannot be automatically voided. Review the linked return and financial records through a controlled correction rather than expecting a void to reverse them automatically.

Products and variants with consignment ownership history cannot be deleted; deactivate them instead to retain historical evidence. Supplier ownership changes remain subject to safety checks.

Consignment fulfilment cannot take supplier stock below zero. Imported or backdated sales before reliable ownership setup require a reviewed correction rather than an automatic historical backfill. A transfer reversal is blocked if stock ownership has changed since the transfer.

Cin7 stock replacement is blocked while consignment is configured, to protect source ownership and costs. Cin7 catalogue updates cannot change consignment-controlled products.

## Tracking cutover and handover

Consignment Tracking is **off by default**. The supplier ownership setting and basic activity report do not depend on it.

Only Admins and SuperAdmins can change tracking. Review the transition from Feature Toggle; the ordinary **Save feature toggles** button does not perform this operational change.

To enable tracking, choose an eligible cutover date and explicitly acknowledge that earlier activity has been reconciled externally. Earlier activity is not automatically treated as unpaid.

To disable tracking, review the handover totals, resolve any blockers, enter a reason and acknowledge responsibility for external reconciliation. Historical statements remain visible under **Consignment Statement History** and exportable but read-only while tracking is off. Managed creation and mutation controls are hidden.

## Managed settlement statements

Open **Purchasing > Consignment Statements**. When tracking is enabled, an Admin or SuperAdmin can choose a supplier and calendar or custom period to create a **Draft**. The carryforward option includes eligible earlier activity not already assigned to a statement; review it before finalising.

Earlier eligible unallocated activity is shown separately in statement detail, including whether your explicit carryforward choice included it. In the source view, use **Source period** to inspect earlier carryforward separately from the selected period.

- **Draft:** review included events and refresh before finalising.
- **Finalised:** the statement is fixed for settlement review. Export it, or mark it Accounted after recording it externally.
- **Accounted:** records an external accounting reference and date. This does **not** mean paid and does not create an accounting bill or payment.
- **Cancelled:** retained for history; cancellation requires a reason.

Accounted statements cannot be reopened or cancelled casually. To correct one, create a linked correcting Draft with the original event, signed quantity, reason and evidence reference. The original statement remains unchanged; duplicate or excessive corrections are rejected. Negative statements require the bookkeeper's supplier-credit or carryforward treatment, not a negative supplier bill.

Record the supplier cost once externally, normally as a supplier bill to the bookkeeper's agreed cost-of-sales account, then pay that bill. If a direct bank expense is used instead, do not also enter a bill. The bill normally records expense; payment clears the payable. Follow the bookkeeper's requirements for GST, invoice evidence and timing. The settlement statement is not a tax invoice or self-billed supplier invoice.

Actions use the version you reviewed. If another person has changed the statement, reload it and review the latest version before retrying. Errors are displayed; actions are not automatically retried.

CSV and PDF exports are available from statement detail. Email is a separate explicit action requiring a recipient and confirmation; finalising does not automatically send email. Review delivery history and any error. A missing email delivery service blocks sending rather than implying delivery succeeded.

**Provider accepted** is not proof of delivery. Resending after provider acceptance requires an explicit resend confirmation and reason. Sending or Unconfirmed attempts block further sends until reviewed. Investigate the provider's outcome, then record the reviewed result with a reason and evidence; acceptance requires the provider reference. Resolving an outcome does not send another email. A definite failure can be explicitly retried, but uncertain requests are never automatically resent.

## Troubleshooting

| Symptom | What to check |
|---|---|
| A stock-only PO cannot complete | Use AUD at exchange rate 1, matched stock lines for one supplier and no freight, landed costs or header discount; review source cost and tax evidence |
| Tracking cannot be enabled | Check the cutover date against reliable captured evidence and any earlier handover, then acknowledge external reconciliation |
| Tracking cannot be disabled | Resolve Draft or Finalised statements and uncertain email outcomes, then review the external handover |
| A statement action reports a conflict | Reload and review its latest version before retrying |
| Finalisation is blocked | Review missing cost, tax, ownership or cross-cutover exceptions; do not substitute current catalogue values |
| Email remains Sending or Unconfirmed | Investigate provider evidence and record the reviewed outcome; do not request an automatic resend |
| A historical statement has no mutation controls | Tracking may be off or your role may be read-only; exports and history remain available |
| A product cannot be deleted | Deactivate products or variants with consignment ownership history instead |

## Worked examples

### Monthly review without tracking

Leave tracking off. Select **Previous Month** in Consignment Activity, choose a supplier and export the report. Reconcile the supplier's invoice and payments externally; do not treat the activity total as an unpaid balance.

### Separate stock receipt from supplier settlement

Receive a consignment purchase order to record the goods arriving. Later, review sold and refunded activity for the supplier. If tracking is enabled, create and review a settlement Draft for the period. Mark it Accounted only after recording the obligation externally, and reconcile the actual payment separately.

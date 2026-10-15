---
{"id":"setup-security-compliance","title":"Security and Compliance Policies","audiences":["ims"],"capability":"navigation","screen":"SuperAdmin > Security & Compliance","product":"setup","format":"task","parentId":"setup-connections","contexts":["security-compliance","security-review-evidence","amazon-pii-inventory","amazon-delivery-evidence","amazon-pii-disposal"],"contextSections":{"security-compliance":"Step-by-step","security-review-evidence":"Security reviews and policy adoption","amazon-pii-inventory":"Amazon PII inventory and dry run","amazon-delivery-evidence":"Amazon delivery evidence","amazon-pii-disposal":"Amazon identifying-field cleanup"},"relatedTopics":["setup-runtime-issues","setup-team-access-security","setup-cron-jobs"],"order":8,"summary":"Read policies, save responsibilities, record policy adoption and security reviews, and manage Amazon delivery evidence and identifying-field cleanup.","lastReviewed":"2026-10-15","owner":"security","quickSections":["Main operations","At a glance"],"navigation":{"category":"platform","label":"Read security policies and assign responsibilities"},"requiredTier":"SuperAdmin"}
---
# Security and Compliance Policies

Security & Compliance is an organization-wide SuperAdmin workspace. It contains internal policies with quick summaries above the detailed procedures, named responsibilities, and attributed adoption and review records.

## Main operations

- Open **Admin > Security & Compliance**.
- Review the warning and adoption status before treating a document as an operating control.
- Enter responsible people as text and choose **Save responsibilities**.
- Select a policy to read its summary, responsible people, review cadence, and detailed version.
- Complete security log reviews at least every 14 days and record the reviewed UTC period, findings, follow-up actions, and restricted evidence reference.
- Record an explicit policy adoption only after authorising the current document; record later periodic policy reviews separately.
- Choose **Run read-only inventory** to review potential Amazon buyer details and retained copies for the active business.
- Load an Amazon order under **Amazon delivery evidence** to review carrier checks or record independently verified original buyer delivery.
- Use **Amazon identifying-field cleanup > Preview cleanup** before approving permanent removal of an eligible order's identifying fields.
- Use **Help** for the workspace instructions.

## At a glance

All responsibility names initially default to **Marek Mamrot**. Saved names apply across the internal policies, independently of the selected business. Responsibility names do not create accounts or grant permissions.

Documents without adoption evidence for their current text are marked **Draft - not yet adopted**. Saving responsibility names does not adopt a policy. Adoption records are human attestations, not certification that every control operates. The workspace displays due dates but does not send automatic review reminders or incident notifications.

The Amazon PII inventory is business-specific. Use the business selector in the header to change its scope; this does not change the organization-wide policy responsibilities.

## Before you begin

Sign in with a SuperAdmin account and identify the people who will own each responsibility.

> **Warning:** Documented policies and recorded attestations do not certify implemented security controls. Assigning a person does not grant access or certify compliance.

## Step-by-step

1. Sign in as a SuperAdmin and open **Admin > Security & Compliance**.
2. Wait for saved responsibilities to load. If loading fails, reload rather than saving the visible defaults.
3. Edit the relevant responsibility fields. Each field requires a name of up to 120 characters.
4. Choose **Save responsibilities** and check the success message and saved revision.
5. Select a policy. Read the quick summary first, then the detailed policy below it.
6. If another session changed the responsibilities, choose **Reload saved values**, review the current names, and reapply your intended edits. Reloading discards unsaved edits.

## Responsibility and adoption boundaries

Policy owner, incident lead and backup, Amazon notification owner, access owner, privacy owner, key custodian, log reviewer, change implementer and approver, and device owner are editable text assignments. The policy detail shows saved names, not uncommitted edits.

The initial defaults can name the same person for multiple roles. Assign a distinct reviewer before relying on independent change approval and establish a reachable incident backup. A name field does not verify availability, qualifications, account access, or a completed approval.

## Security reviews and policy adoption

1. Save the responsibility names first. Resolve unsaved changes or a stale revision before recording evidence.
2. In **Security reviews and policy adoption**, choose **Security log review**, **Adopt policy**, or **Periodic policy review**.
3. For a log review, select the reviewed UTC date period and choose **Load platform authentication history**. Entries cover all platform businesses and can include unidentified failed attempts. Load older pages as needed; each page contains up to 250 entries. Reload to include events that arrived after the first load.
4. Review relevant Runtime Issues and restricted hosting, source-control, and other security logs as well. The authentication history is not a complete record of every sensitive-data access, deployment, or key-management event.
5. Enter a concise summary of what was actually reviewed or authorised, findings, follow-up owners/actions, and a safe reference to supporting evidence. Do not copy credentials, customer information, or raw logs into these fields.
6. Tick the explicit acknowledgement and choose **Record evidence**. Check the confirmation and the new history entry.

The signed-in account, current policy text/version, saved responsibility revision, and time are attributed to each entry. Evidence is append-only: record a separate correction rather than overwriting a previous entry. The latest 100 entries are displayed.

Security log reviews are due at least every 14 days. Recording an old reviewed period does not move the deadline forward as though current logs had been reviewed. Incident-response policy reviews are due every six calendar months; other policy documents are due annually. These dates do not replace additional operational review frequencies in the detailed policy.

A periodic policy review requires adoption of the current policy text. Changed policy text requires fresh adoption evidence. If a page reports that its policy text changed, refresh it and read the current text before recording evidence.

## Reading the data retention policy

The draft policy calls for removing Amazon buyer PII within 30 days after delivery and using **Amazon Customer** as a generic label. A necessary non-PII order reference may remain for reconciliation; it must not preserve a hidden lookup to deleted buyer details.

Changing a display name alone is not disposal: delivery details, shipment copies, documents, and other retained identifying information also need to be removed. The workspace offers a manual, targeted identifying-field cleanup, not scheduled deletion or certification that every retained copy is removed.

## Amazon identifying-field cleanup

1. Select the intended business in the Admin header.
2. Enter the local Amazon sales order ID and choose **Preview cleanup**. This reads counts and eligibility without changing customer data or contacting Amazon or a carrier.
3. Review the exact deadline, fields, affected-record counts and blockers. Buyer values are not displayed in this preview.
4. Resolve missing delivery evidence, outstanding parcels, incomplete operational work, shared identifying customers or shared label PDFs before proceeding. An expired deadline does not waive these checks; investigate blocked overdue records promptly.
5. For an eligible order, type the displayed **CLEAR AMAZON PII** confirmation including its local order ID, then choose **Approve identifying-field cleanup**.
6. Check the completion message. Identifying fields are cleared, but separate review of retained copies is still required.

The deadline is exactly 30 days after the earliest active verified original buyer delivery. This is a maximum retention deadline, not a required waiting period: earlier approved cleanup is allowed once delivery and operational checks are satisfied. Future-dated delivery evidence blocks approval until corrected. An order must have resolved fulfilment and delivery evidence for its original prepared parcels; a verified whole-order delivery entry can cover those parcels. Later delivery or polling does not reset the deadline. A preview expires after 15 minutes and is rejected if the order, customer or reviewed snapshots change, or the active business changes.

Cleanup targets delivery addresses; an exclusive customer's name, email, phone, address and other explicit identifying fields; and known buyer fields inside shipment recipients, amendment snapshots and linked channel payloads. Existing generic shared customers remain untouched and are protected against later addition of identifying details. An exclusive identifying customer becomes **Amazon Customer** without changing its ID or financial ownership. Shared, externally mapped or financially active identifying customers require manual resolution.

Product descriptions, free-text notes, purchase-order text, refund references, amounts, quantities, tax, stock and customer-credit balances are not automatically removed or changed. Presence of text alone does not identify buyer PII. Known buyer fields are removed without replacing entire operational payloads.

Old in-app shipping label access is disabled because the PDF may contain a buyer's address. This does not delete a PDF already downloaded or held by a carrier. A label PDF shared with another order blocks cleanup until the shared copy is resolved.

Approval records the signed-in approver, delivery deadline, time and safe counts without saving the old identifying values. Repeating the same approval is safe; changing an approval or reusing it for a different cleanup is rejected. Missing platform readiness disables cleanup rather than offering an unsafe fallback.

After approval, Amazon order synchronization continues to update operational status but cannot restore the cleared address. Protected customer and shipment fields cannot be repopulated through ordinary writes, and old recipient copies or labels cannot be regenerated. These protections depend on the retained cleanup record and installed write controls; they do not certify arbitrary external imports or restored databases.

**Retained-copy boundary:** Notes, documents, exports, logs, caches, carrier-held copies and backups remain separate review areas. Backup deletion and restoration automation are not part of this workflow. Provider expiry has not been verified here. A successful identifying-field cleanup must not be described as complete removal of all Amazon PII or proof of the full retention policy.

## Amazon PII inventory and dry run

1. Select the intended business in the Admin header, then open **Security & Compliance**.
2. Choose **Run read-only inventory**. The report does not delete or change orders and does not contact Amazon or a carrier.
3. Check coverage warnings before interpreting the numbers. An unavailable source is not a zero count; partial results cover only available sources.
4. Review structured address/contact fields, shipment recipients, amendment history, stored label links, order and linked credit-note descriptions, free-text fields and channel payloads.
5. Use **Next order page** and **Previous order page** for order-linked candidates. Counts cover the whole active business, not just the displayed page.
6. Review generated documents, downloads, exports, carrier tracking identifiers and links, retained evidence references or fingerprints, logs, support copies, backups, processor-held data and manually reassigned or unlinked customer/refund records separately. References need classification and a justified retention purpose; they must not preserve a hidden lookup to deleted buyer details.

The report shows counts, local order IDs, validated Amazon references and dates, not buyer names, addresses, phone numbers, raw payloads or label links. Label contents are not downloaded.

Where delivery evidence is available, the earliest verified original buyer-delivery timestamp sets a review deadline exactly 30 days later. This includes split shipments: a later parcel does not move the earlier review deadline. The report counts potential-PII orders that have reached this delivery-based review deadline. It does not treat populated fields or unreviewed content as confirmed PII; **Confirmed overdue** therefore remains **Not assessable** until classification is complete.

Orders without verified delivery still need investigation. Age of 30 or more UTC calendar days is a separate priority-review measure, not a substitute delivery date or permission for indefinite retention. Shipment completion, fulfilment and return-delivery dates must never start the buyer-delivery clock. Unavailable delivery evidence is shown as unavailable, not zero.

Non-empty text and payloads may contain only product descriptions or operational references. They require review, not automatic deletion. Linked contacts may be shared with other orders; deleting a shared customer would be unsafe. Source counts measure records rather than unique buyers and must not be added together. Amazon event/job counts also include records that cannot be linked to a local order.

No candidate is approved for automatic disposal. Zero results do not prove that external or unclassified copies have been removed. If a scan fails, old results are cleared and the failure is shown; run the inventory again to retry.

## Amazon delivery evidence

### Automatic carrier tracking

The **Online channel delivery tracking** scheduled job runs hourly when its master switch is On and Amazon delivery tracking is On for the active business in **IMS Settings > Sales & Customers > Shipping**. The master starts **Off** until the evidence storage and carrier tracking access have been verified. Business channel-type defaults are Amazon On, Shopify Off and Solvantis Online Store Off. An existing Australia Post shipping account may still need permission to use tracking.

Automatic verification supports Australia Post eParcel article IDs on original Amazon parcels prepared and marked dispatched in Solvantis. It does not infer delivery from a consignment summary, a label, a shipping status, a return, or a missing tracking response. Unsupported carriers, external shipments without prepared parcel records, missing article IDs, ambiguous dates and unrecognized delivery events need manual verification.

The job checks bounded batches, spaces carrier requests, retries pending articles and reports operational errors in Runtime Issues. Once a parcel has active verified evidence, it does not need repeated polling. Only a matched original article with a recognized delivery event and explicit timezone can provide automatic evidence. Raw carrier responses, event locations and recipient details are not saved as evidence.

Business-wide **Pause scheduled automation**, the master job switch and the business's Amazon delivery tracking switch stop future polls, not work already in progress. Disabling an Amazon store connection does not erase delivery evidence or remove tracking of already dispatched parcels while its channel-type switch and the delivery job remain enabled. Pausing or late polling does not extend a recorded review deadline: the actual delivery timestamp, not the check time, is used. The inventory, manual evidence workflow and 30-day PII review rules remain Amazon-only even when another online channel type is enabled for carrier tracking.

### Manual verification and corrections

1. Select the intended business and enter the **local Amazon sales order ID** under **Amazon delivery evidence**.
2. Choose **Load delivery evidence**. Read the known dispatched parcels, last-check outcomes, earliest verified delivery and recent history.
3. Independently verify original buyer delivery. Choose a specific dispatched parcel, or **Order's first original buyer delivery** for an externally shipped or legacy order. For split orders, the order-level fallback must use the first original delivery, not the final parcel.
4. Enter the actual delivery timestamp with a timezone, such as `2026-10-15T14:43:09+11:00`. Unzoned, invalid and future dates are rejected.
5. Select **carrier-portal**, **amazon-proof** or **recipient-confirmation** and enter a non-personal record code such as `TICKET-123`. Do not paste buyer details, URLs, credentials, screenshots or raw carrier responses into the code.
6. Confirm the verification statement and choose **Save verified delivery**. The signed-in account is recorded as the verifier; the policy responsibility name is not used as an account identity.
7. Reload the order and run the read-only inventory again to see the persisted evidence and updated deadline.

Evidence history is append-only. To correct factually incorrect manual evidence, choose **Void incorrect manual evidence**, select the reason, and choose **Confirm factual correction**. The original record remains visible with the correction and verified actor. A valid correction can change the calculated deadline; it is not a retention-policy exception. Carrier evidence cannot be voided here: investigate suspected carrier errors in Runtime Issues before considering disposal.

The page shows the latest 50 history records. Deadline calculations use all active evidence, not just the visible page. A verified parcel does not prove that the whole order has arrived, and a first-delivery fallback does not certify every parcel. Missing parcels and external copies remain review obligations.

Neither automatic nor manual verification changes stock, financial records, order status, customer information or PII. **Automatic anonymization and deletion remain disabled.**

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Saved values are unavailable | Reload and resolve the reported failure before saving |
| Responsibilities changed in another session | Reload saved values, review them, and reapply only the intended edits |
| A field is rejected | Enter a non-empty name of up to 120 characters without control characters |
| Names appear unchanged in the policy detail | Save the edits first; the detail shows saved responsibilities |
| A document is still marked Draft | Names have been assigned, but policy adoption and control verification are separate work |
| Confirmed overdue shows Not assessable | Delivery evidence can set a review deadline, but content still needs classification before PII can be confirmed |
| A delivery review deadline is missing | Obtain verified original buyer-delivery evidence; do not substitute shipping or return dates |
| Delivery storage is unavailable | Resolve the reported setup failure before saving evidence or enabling the scheduled job |
| Carrier checks fail or stay unverified | Review Runtime Issues and account tracking access, then use independently verified manual evidence if available |
| A save result could not be confirmed | Reload the evidence history before changing or resubmitting details |
| An inventory source is Unavailable | Check the active business and the coverage warning in Runtime Issues; do not interpret it as zero |
| Inventory has zero candidates | Review unlinked payloads and the areas outside the automatic scan before drawing a disposal conclusion |

## Worked examples

### Assigning an incident backup

Open **Admin > Security & Compliance**, replace the incident backup name, and choose **Save responsibilities**. Select **Incident Response and Amazon Notification** to check the saved assignment. Confirm the person's availability separately; saving their name does not test an incident notification or establish a working backup arrangement.

### Reviewing Amazon retention

Select **Data Classification, Privacy and Retention**. The summary explains the 30-day-after-delivery target and the generic **Amazon Customer** label; the detailed procedure covers other copies of identifying information. Use this as the policy target, not as evidence that order anonymization already runs.

### Split shipment with late tracking

A parcel was delivered at `2026-09-01T10:00:00+10:00`; a second parcel arrived on 10 September. Even if the first event is collected on 12 September, the earliest original delivery remains 1 September. Its exact 30-day review deadline is `2026-10-01T00:00:00.000Z`. The second delivery and later check do not restart the clock. Review the earlier parcel's copies and shared identifying information while checking any outstanding fulfilment needs; do not treat the report as deletion approval.

### Investigating an older Amazon order

Run the inventory for the intended business. An order aged 45 days with a recipient snapshot is flagged for priority review, but this is not proof that the order was delivered 30 days ago. Obtain verified original delivery evidence and review all linked copies before setting a disposal deadline. The dry run changes nothing.

---
{"id":"ims-cash-banking-report","title":"Cash Banking Report","audiences":["ims"],"capability":"integrations","requiresCapabilities":["xero"],"screen":"Reports > Cash Banking","product":"ims","format":"task","parentId":"ims-operational-reports","contexts":["report-cash-banking"],"contextSections":{"report-cash-banking":"Step-by-step"},"relatedTopics":["ims-cash-banking","pos-end-of-day","pos-end-of-day-xero","ims-report-guide"],"order":64,"summary":"Review deposit recounts, bank acceptance, Xero posting outcomes and notes documenting manual accounting corrections.","lastReviewed":"2026-10-14","owner":"accounting","quickSections":["Main operations","At a glance"],"navigation":{"category":"reports","label":"Review cash deposits and correction notes","sections":[{"heading":"Step-by-step","label":"Review Cash Banking report outcomes"},{"heading":"Record a manual correction note","label":"Document an existing manual Xero correction"}]}}
---
# Cash Banking Report

Use **Reports > Cash Banking** to review deposit records and accounting outcomes. Use the separate **Finances > Cash Banking** workspace to prepare cash, confirm lodgement and post or retry accounting.

The report is available for Xero-enabled businesses with POS Manager-level access. Recording a correction note requires Admin or SuperAdmin access and an already posted deposit.

## Main operations

- Select the relevant date interval and accounting outcome.
- Compare store-reported cash, preparation recount and bank-accepted amounts separately.
- Distinguish a planned preparation from a confirmed lodgement.
- Check who prepared, confirmed and posted the deposit.
- Review the transfer reference and any recorded correction note.
- Use **Add note** only to document a correction already made manually in Xero.
- Export the filtered deposit records, remembering that correction notes are not included in CSV.

## At a glance

| Column or state | Meaning |
|---|---|
| Lodgement | Actual lodgement date, or Awaiting before it is recorded |
| Store reported | Cash reported by the linked End of Day records, not a new count |
| Till variance | Differences recorded at the original register-count stage |
| Prepared | Cash recounted while preparing the batch |
| Preparation variance | Prepared amount minus store-reported amount |
| Bank accepted | The final amount accepted at lodgement |
| Bank variance | Bank-accepted amount minus prepared amount |
| Planned | A preparation record awaiting confirmed lodgement |
| Posted to Xero | Solvantis recorded the posting outcome |
| Recorded in Xero manually | The deposit was recorded externally; Solvantis did not create a second posting |
| Correction | Date/reference of a saved manual-correction note; hover to read the note |

## Before you begin

- [ ] Have the register summaries, cash preparation evidence and bank receipt available.
- [ ] Use lodgement dates for bank-deposit questions, not the original trading dates.
- [ ] Check the deposit's actual confirmation and accounting outcome.
- [ ] Verify any manual correction in Xero before recording its note.

> **Important:** A correction note documents an external action. It does not make that correction in Xero, repost the deposit or rewrite the original cash amounts.

## Step-by-step

1. Open **Reports > Cash Banking**.
2. Choose the start and end dates. The initial interval is about 90 days. Confirm start is not later than end.
3. Select **All outcomes**, **Ready to post**, **Posting issue**, **Posted to Xero** or **Recorded in Xero manually**.
4. Wait for the filtered rows to load without an error. The date filter uses lodgement date when present, otherwise the preparation record's creation date.
5. Review **Branch**, **Destination**, **Store reported**, **Till variance**, **Prepared**, **Preparation variance**, **Bank accepted** and **Bank variance**.
6. Check **Status**, **Prepared by**, **Confirmed by**, **Posted by** and **Xero transfer**. An Awaiting lodgement or Planned status is not proof that the bank accepted the cash. The Ready to post filter can include a preparation that still needs confirmation.
7. Hover the **Xero transfer** cell for any available posting-error detail, and the **Correction** cell to read a saved note.
8. Use **Export CSV** after the result loads successfully. It exports all loaded deposits; there is no pagination.

There is no branch search or branch selector in this report. Dates and outcome changes reload the result automatically. The report does not offer deposit creation, lodgement confirmation, posting or retry actions; those belong to **Finances > Cash Banking**.

CSV includes deposit dates, branch, destination, bank reference, the three cash stages and their differences, confirmation/accounting outcome, deposit explanation, staff audit fields and transfer reference. It does not include the separate correction note, correction reference/date or posting-error detail shown through the table.

## Record a manual correction note

This records an annotation only: it does not make that correction in Xero or change the deposit's original amounts.

1. Verify that the accounting correction has already been made manually in Xero.
2. Find the already posted deposit. **Add note** is available to Admins and SuperAdmins when no correction note is displayed.
3. Enter a concise description of the correction.
4. Enter the optional Xero reference, then the correction date in the requested **YYYY-MM-DD** format.
5. Finish the prompts and check that the Correction cell shows the saved date/reference. Hover it to verify the description.

If the result is unclear, reload and inspect the existing Correction cell before repeating the entry. The table does not offer an edit button for an already displayed note.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| An older trading day is not found by its trading date | Filters use lodgement date, or creation date before lodgement | Search the date when the deposit was lodged or prepared |
| Ready to post shows an Awaiting lodgement | The preparation still needs confirmation | Continue that deposit in Finances; do not create another |
| Deposit amounts differ | The differences belong to separate count/recount/bank stages | Investigate the first stage where the difference arose |
| Posting is partial or failed | An accounting action is unfinished | Review the error and use the existing deposit's Retry action in Finances |
| Add note is unavailable | Access, posting status or an existing note does not meet the conditions | Check the role and posted deposit; inspect an existing note |
| CSV has no correction note | CSV exports deposit details, not correction annotations | Review the table's saved note separately when assembling evidence |

## Worked examples

### Identify where a difference occurred

Store-reported cash is **$1,000**. The preparation recount is **$995**, so Preparation variance is **-$5**. The bank accepts **$990**, so Bank variance is another **-$5**. Staff investigate those two stages separately from any original Till variance rather than attributing the whole difference to the cashier.

### Document a correction without posting again

An Admin verifies that a bookkeeper already corrected a posted deposit in Xero. They use **Add note** to record the explanation, reference and correction date. The original Solvantis amounts and posting reference remain historical; the note does not create another transfer. Staff inspect the note in the report rather than expecting it in the deposit CSV.

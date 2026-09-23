---
{"id":"ims-bookkeeper-audit","title":"Bookkeeper Audit","audiences":["ims"],"capability":"navigation","screen":"Reports > Bookkeeper Audit","product":"ims","format":"task","parentId":"ims-operational-reports","contexts":["report-bookkeeper-audit"],"contextSections":{"report-bookkeeper-audit":"Main operations"},"relatedTopics":["ims-operational-reports","ims-report-guide","ims-inventory-costing"],"order":62,"summary":"Review overdue documents and negative stock, record accepted exceptions, and understand incomplete audit coverage.","lastReviewed":"2026-09-23","owner":"reporting","quickSections":["Main operations","At a glance","Step-by-step","Troubleshooting"]}
---
# Bookkeeper Audit

Bookkeeper Audit brings recurring operational and accounting exceptions into one newest-first queue. Use it to investigate negative stock, incomplete sales cost, Xero reconciliation differences, and documents that have remained open beyond their expected or assumed due date.

## Main operations

- Open **Reports > Bookkeeper Audit** and start in **Open**.
- Review the source record and recommended action for each finding.
- Correct the source workflow when the finding represents a real problem.
- Use **Accept exception** only when the current evidence is legitimate and record why.
- Check the coverage notice before treating an empty queue as a completed audit.

> **Important:** The audit includes existing Xero reconciliation findings and sales COGS exceptions for the previous completed calendar month. Prior month-end inventory comparison is not yet checked here. An empty queue does not confirm that the Solvantis inventory valuation agrees with Xero's Inventory Asset account.

## At a glance

| Finding | When it appears | Normal next step |
|---|---|---|
| Missing, zero, or negative COGS | A genuine stock sale in the previous completed month has incomplete or invalid movement cost | Review the sale movement and its receipt or opening cost source |
| Xero reconciliation difference | The existing Xero reconciliation process finds a document, amount, state, contact, currency, payment, or mapping difference | Compare Solvantis and Xero, then correct the source of truth and recheck |
| Negative stock | An active stock position is below zero, including a fractional quantity | Review movements and correct through receiving, transfer, stocktake, or the source transaction |
| Overdue Purchase Order | Its expected date has passed, or it is more than 30 days from order date without one | Receive, resolve, or update the order |
| Overdue Sales Order | Its expected date has passed, or it is more than 14 days from order date without one | Fulfil, resolve the remainder, or update the order |
| Credit note awaiting product | It remains open 30 days after the credit-note date | Confirm the return or cancel the draft |
| Branch transfer in transit | It remains sent or partial seven days after transfer date | Confirm receipt at the destination |
| In-progress stocktake | It remains in progress two days after creation | Complete or cancel the count |
| Stale draft | The draft exceeds the period shown in the finding | Confirm whether it should proceed or be cancelled |

## Before you begin

- [ ] Confirm you are working in the correct business.
- [ ] Have access to the source orders, credit notes, transfers, products, and stocktakes you may need to inspect.
- [ ] Decide whether you are correcting a real issue or recording a legitimate exception.
- [ ] Read the coverage notice for checks that are not included.

## Step-by-step

### Review open findings

1. Open **Reports > Bookkeeper Audit**.
2. Read **Action required** and **Coverage** before reviewing rows.
3. Work from the first row downward; findings are ordered with the most recent activity first.
4. Check the source, due date, quantity, and value at risk.
5. Select **Open** to inspect the related workflow.
6. Correct the source record through its normal workflow.
7. Refresh the audit. A corrected finding clears automatically.

Sales COGS checks use the previous completed calendar month. They exclude historical imports, non-stock products, orphaned movements, and controlled zero-cost FIFO movements with a recorded reason.

### Read an assumed due date

When a document has no expected date, the audit applies a visible fallback. The row says **Assumed** and shows the number of days after the document date. The fallback prevents undated active work from disappearing from periodic review.

| Document | Assumed review date when no expected date exists |
|---|---:|
| Active Purchase Order | 30 days after order date |
| Active Sales Order | 14 days after order date |
| Credit note awaiting product | 30 days after credit-note date |
| Sent or partial branch transfer | 7 days after transfer date |
| In-progress stocktake | 2 days after creation |

### Accept a legitimate exception

1. Inspect the source and confirm the current quantity, amount, status, and due date are understood.
2. Select **Accept exception**.
3. Enter a reason another bookkeeper can understand later.
4. Open **Accepted** to confirm the reviewer and reason.
5. Select **Undo** if the acceptance was recorded incorrectly.

Acceptance applies only to the exact evidence reviewed. If the quantity, value, status, due date, or Xero mismatch changes, the finding returns to **Open** automatically. Accepted Xero findings keep using the Xero reconciliation review history rather than creating a separate accounting record.

> **Warning:** Accepting an exception does not change stock, complete a document, or post anything to Xero. Correct real problems in their source workflow.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| The queue is empty but Coverage says checks are incomplete | One or more checks failed, or month-end inventory comparison is not yet included | Read the coverage message and do not treat the result as month-end inventory confirmation |
| COGS checks could not be completed | Cost movement data could not be loaded | Refresh, then investigate the reported operational issue if it continues |
| Xero reconciliation could not be completed | Reconciliation records could not be loaded | Check the Xero connection and refresh; other audit areas remain available |
| A document has an assumed due date | No expected date was recorded | Review the displayed fallback and update the source date when a better commitment is known |
| An accepted finding returned to Open | Its evidence changed | Review the new quantity, value, status, or due date and make a fresh decision |
| Accept exception is unavailable | Your access level cannot record audit review decisions | Ask an Admin, SuperAdmin, or Advisor to review it |
| A corrected finding remains | The source still meets the finding rule or the report has not refreshed | Reopen the source, confirm its status and quantities, then refresh |

## Worked examples

### Sales Order without an expected date

SO-0042 was created on 1 September with no expected date and remains Confirmed. The audit assumes 15 September, which is 14 days after the order date. It appears after that date. The bookkeeper opens the order, confirms that fulfilment is genuinely outstanding, and asks operations to resolve it. Once the order no longer meets the rule, the finding clears.

### Accepted fractional negative stock

A location shows -0.25 units after a measured product sale. Staff confirm that a stocktake is scheduled and record that reason with **Accept exception**. If the quantity changes to -0.50, the evidence no longer matches the accepted review, so the finding returns to **Open**.
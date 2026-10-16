---
{"id":"pos-end-of-day","title":"End of Day and Register Close","audiences":["pos","ims"],"capability":"pos","screen":"POS > Register > End of Day","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-register-device-login","pos-selling-payments-manager-approval","pos-reports-transactions","pos-petty-cash","pos-settings-terminals-offline-recovery","pos-end-of-day-xero"],"contexts":["eod","pos-eod","pos-reports"],"contextSections":{"eod":"Step-by-step","pos-eod":"Step-by-step","pos-reports":"Till variance and cash activity"},"order":59,"summary":"Count register takings, account for the opening float and petty cash, investigate variances, and verify register closure without requiring an accounting connection.","lastReviewed":"2026-10-14","owner":"retail","quickSections":["Main operations","At a glance"],"navigation":{"category":"pos","label":"Close the register and reconcile takings","subgroup":"Start & end of day","sections":[{"heading":"Step-by-step","label":"Count takings and close the register"},{"heading":"Till variance and cash activity","label":"Investigate a till variance"}]}}
---
# End of Day and Register Close

Use End of Day to compare physical takings with recorded payments, save the reconciliation and close the register session. Register counts and closure do not require an accounting connection.

## Main operations

- Confirm the branch, register and session being closed.
- Sync queued sales before relying on expected takings.
- Count every payment method independently; enter zero when the verified amount is genuinely zero.
- Count the full cash drawer, including the opening float.
- If the recorded opening float is wrong, ask an administrator to correct it in **IMS > Reports > Daily POS Registers Report** before closing the session. Opening float is locked after closure.
- If saved closing counts are wrong after closure, an Admin or SuperAdmin can use **Edit closing totals** in that report. A reason and manual-accounting acknowledgement are required; notify the bookkeeper separately because this does not sync accounting or send an email.
- Check petty cash and recorded refunds before explaining a difference.
- Include layby deposits and instalments actually received in this session, not the unpaid merchandise balance.
- Recount and explain genuine variances before saving.
- Verify saved counts and register closure, then retain the reconciliation receipt.

## At a glance

| Value | How Solvantis treats it |
|---|---|
| Expected | Recorded payments and layby receipts for the session, grouped by method; recorded petty cash is deducted from Cash |
| Opening Float | Cash present when the register opened, not a sale |
| Counted cash | All physical cash in the drawer, including the opening float |
| Cash Sales | Counted cash minus opening float; compare it with expected cash after petty cash |
| Counted non-cash | The independently verified total for that payment method |
| Variance | Cash Sales or counted non-cash minus Expected |
| Petty cash | A separately recorded purchase paid from the open till |
| Layby takings | Money actually received; the unpaid balance is not money in the till |

## Before you begin

- [ ] Check the correct branch, register and session date.
- [ ] Resolve queued or failed sales and confirm they appear in Reports.
- [ ] Check the opening float against the opening count.
- [ ] Count the drawer and each non-cash settlement source independently.
- [ ] Keep petty-cash receipts and useful explanations for differences.

> **Warning:** End of Day needs an online connection. If saving fails or its result is unclear, reconnect and reload the register status and saved counts before repeating the action. Do not assume that a failed response proves nothing saved.

## Step-by-step

1. Open **Register**, then select **End of Day**.
2. Check the session date and **Expected ($)** amount for every payment method. Resolve missing transactions before accepting these totals.
3. Review **Opening Float ($)** for Cash against the recorded opening count. Do not change the float merely to make a variance disappear.
4. Enter the full physical drawer total in Cash's **Counted ($)** field. Alternatively, select **Count** beside Cash and enter the number of each note and coin; the denomination total fills Counted.
5. Enter the independently verified **Counted ($)** total for every other payment method. Do not copy Expected just to balance the register.
6. Review **Cash Sales**, **Variance** and **Notes**. Recount and inspect transactions, tender choices, refunds and petty cash when an amount differs.
7. Select **Save EOD Reconciliation**. If a variance warning appears, confirm only after the difference has been checked and is genuine.
8. Check the saved reconciliation and verify that the register session is closed. A saved-count indicator alone is not proof of closure.
9. Select **Print EOD Receipt** when the summary is available, and retain it according to the business's process.

Saving EOD reconciliation for an open assigned register also requests register closure. If counts saved but the session still appears open, reload and ask a manager to check the session rather than recreate sales or force the counts to match.

The Assistant's register-status check uses the open session assigned to the verified POS register. Its amounts are expected takings, with recorded petty cash deducted from Cash. A saved-count indicator means counted entries exist; it does not prove the register is closed.

## Till variance and cash activity

| Situation | What it means | What to check |
|---|---|---|
| Counted cash minus float equals Expected cash | Zero cash variance | Retain the verified count |
| Counted cash is higher | Positive variance | Recount, check change and tender choices, and add a useful note |
| Counted cash is lower | Negative variance | Recount, check refunds, petty cash and tender choices |
| Petty cash was recorded | Cash left the drawer for a documented purchase | Check amount, reason and receipt; do not deduct it again from Counted |
| Expected omits recent sales | The queue or register-session linkage needs checking | Resolve the queue and review Reports before finalising |
| Layby merchandise value exceeds money received | Part of the balance remains unpaid | Count only receipts taken in this session, not the full layby value |

The amount labelled **Cash Sales** is a reconciliation amount after subtracting float. Where cash paid a petty-cash expense, it can be lower than the original cash-sale payments without an unexplained till shortage.

## Optional accounting

Register reconciliation and accounting posting are separate outcomes. Count and close the register even when the business has no accounting connection.

When posting is enabled, review its status separately using the accounting guide available to your business. A failed posting does not reopen a closed register, and fixing accounting does not require recreating sales or taking payments again.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Counted cash appears too high | Float was not separated, or the wrong tender was used | Recount and compare float and transaction payments |
| Expected cash is lower than cash-sale payments | Recorded petty cash has been deducted | Check the petty-cash entries; compare Counted minus Float with the displayed Expected |
| Expected omits recent sales | Sales are queued or not linked to the session | Resolve the queue and review Reports before saving |
| Save fails while offline | Counts and closure need an online request | Reconnect, reload saved counts and register status, then complete only what remains |
| Counts appear saved but the register is open | Reconciliation and closure are separate checks | Ask a manager to review the same session; do not duplicate sales |
| The register was opened on a previous day | The earlier session still needs closing | Use Close Register (Enter Counts) when prompted, reconcile that session, then open a new session with a new counted float |

## Worked examples

### Cash count with float and petty cash

The drawer opens with **$200**. Recorded cash-sale payments are **$640**, and a **$22** purchase was recorded through **Petty Cash**. Expected cash is therefore **$618**.

Staff count **$818** in the drawer. **Cash Sales** is $818 minus the $200 float, or **$618**. Comparing that with Expected gives **$0 variance**. Staff do not subtract the petty-cash amount again from the physical count.

### Investigate a genuine shortage

Expected cash is **$618** after recorded petty cash. The float is **$200**, but the recounted drawer contains **$813**. Cash Sales is **$613**, giving a **-$5 variance**. Staff check transactions and refunds, add a note about the verified shortage and confirm the warning rather than entering $818 to make the report balance.

### Count a layby instalment without counting the unpaid balance

A customer pays a **$40** card instalment against a layby with **$120** still unpaid. Staff verify the $40 receipt in this session's card takings. They do not add the unpaid $120 to Counted or treat it as money already received.

## Related tasks

See **Register, Device, and Login** for opening float, **POS Reports and Transactions** for source sales, **Petty Cash at POS** for till expenses, and **Settings, Terminals, and Offline Recovery** for queued-sale recovery.

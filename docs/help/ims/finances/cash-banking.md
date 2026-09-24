---
{"id":"ims-cash-banking","title":"Cash Banking","audiences":["ims"],"capability":"integrations","requiresCapabilities":["xero"],"screen":"Finances > Cash Banking","product":"ims","format":"task","parentId":"ims-finances","contexts":["cash-banking"],"contextSections":{"cash-banking":"Main operations"},"relatedTopics":["pos-end-of-day-xero","pos-petty-cash","ims-xero-reconciliation","ims-report-guide"],"order":63,"summary":"Prepare cash deposits, record late or historical lodgements, and post each deposit to Xero without duplicating accounting.","lastReviewed":"2026-09-24","owner":"accounting","quickSections":["Main operations","At a glance","Step-by-step","Troubleshooting"]}
---
# Cash Banking

Cash Banking groups completed store cash counts into a bank deposit. It preserves what the store reported, what the depositor recounted, what the bank accepted, and how the deposit was handled in Xero.

## Main operations

- Choose one branch and the trading days included in the physical deposit.
- Recount the cash being prepared before creating the draft.
- After lodgement, enter the actual date, bank reference, destination bank, and amount accepted.
- Choose **Post through Solvantis** when Solvantis still needs to create the Xero accounting.
- Choose **Already recorded in Xero** only when someone has already entered that deposit manually in Xero.
- Use **Retry** after a partial posting failure. Do not recreate the deposit.

> **Important:** Creating a preparation draft reserves the chosen End of Day cash records. This prevents the same store cash from being included in another deposit.

## At a glance

| Stage | Meaning | Accounting effect |
|---|---|---|
| Store End of Day | The store records cash held after trading | Sales and GST follow the normal End of Day accounting; cash remains in Cash Clearing |
| Preparation draft | The depositor chooses days and recounts the physical cash | No new Xero transaction |
| Confirm lodgement | An Admin records what the bank accepted | No Xero transaction until an accounting outcome is chosen and completed |
| Post through Solvantis | Solvantis records variances and transfers accepted cash | Cash Clearing is credited, the destination Bank is debited, and differences use Cash Variances |
| Already recorded in Xero | The deposit was entered manually before this Solvantis record | No Xero action is created; the Solvantis record is retained for history only |

| Difference | What it compares |
|---|---|
| Till variance | Expected register cash against the store's End of Day count |
| Preparation variance | Store-reported cash against the depositor's recount |
| Bank acceptance variance | Prepared cash against the amount accepted by the bank |

## Before you begin

- [ ] Confirm every chosen register has completed End of Day and counted cash.
- [ ] Have the physical cash or preparation record available for an independent recount.
- [ ] Have the bank receipt, lodgement date, reference, destination account, and accepted amount.
- [ ] Check Xero before choosing **Already recorded in Xero**.
- [ ] For a late entry, have a short explanation for why it is being recorded after the lodgement date.

> **Warning:** Do not choose **Already recorded in Xero** merely because the cash was physically deposited. Use it only when the accounting entry also already exists in Xero.

## Step-by-step

### Prepare a deposit

1. Open **Finances > Cash Banking**.
2. Choose the branch and date range. Older eligible trading days may be chosen.
3. Review any blocked days. Open registers, missing cash counts, incomplete accounting, or days already reserved by another deposit cannot be chosen.
4. Choose the days included in the deposit.
5. Count the physical cash and enter the **Preparation recount** for each day.
6. Review the preparation variance, then choose **Create preparation draft**.

### Record the bank lodgement

1. Find the draft under **Recent deposits** and choose **Enter lodgement**.
2. Enter the actual lodgement date, bank reference, destination bank, and final amount accepted by the bank.
3. For a past date, enter both the bank reference and an explanation. Future dates are not accepted.
4. Choose the accounting outcome:
   - **Post through Solvantis** leaves the confirmed deposit ready for an Admin to post.
   - **Already recorded in Xero** finishes the record without creating Xero actions.
5. Confirm the lodgement.

### Complete Xero accounting

For **Post through Solvantis**, choose **Post to Xero**. Solvantis records preparation and bank acceptance differences where required, then transfers the accepted amount from Cash Clearing to the destination Bank account. Match the resulting transaction to the bank statement in Xero.

For **Already recorded in Xero**, verify the saved status says **Recorded in Xero manually**. No Post button is available and Solvantis cannot post that deposit later.

## Troubleshooting

| Symptom | Check first | Next step |
|---|---|---|
| An older day is missing | Date range and completed End of Day cash count | Widen the range, then close and count the register if needed |
| A day says it is reserved | Recent deposits and Cash Banking report | Continue the existing deposit; do not create another |
| The cash was banked before staff used Cash Banking | Whether the Xero accounting entry already exists | Prepare the historical days, then choose the matching accounting outcome |
| A backdated confirmation is blocked | Bank reference and explanation | Enter both using the bank receipt and reason for late entry |
| Xero posting partly failed | Deposit status and error | Choose **Retry**; completed actions are reused |
| The amount differs | Till, preparation, and bank acceptance variance | Investigate the stage where the difference first appeared |

## Worked examples

### Late entry that has not been recorded in Xero

Cash was deposited on Monday but entered in Solvantis on Wednesday. The Admin chooses Monday as the lodgement date, enters the bank receipt reference and explains the delay, then chooses **Post through Solvantis**. After confirmation, the Admin posts and reconciles the resulting Xero transaction.

### Historical deposit already entered in Xero

A prior month's deposit was physically banked and the bookkeeper already entered it manually in Xero. The Admin chooses the relevant eligible trading days, records the recount and bank details, enters the Xero or bank reference and explanation, then chooses **Already recorded in Xero**. Solvantis retains the linked history but creates no second Xero transaction.
